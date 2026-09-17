// R_IssueRenderCommands/R_SyncRenderThread and GLimp renderer sleep/wake ownership.
// Original renderer copyright (C) 1999-2005 Id Software, Inc.
// SPDX-License-Identifier: GPL-2.0-or-later
import { MessageChannel, MessagePort, parentPort, receiveMessageOnPort, Worker } from "node:worker_threads";

export interface RenderWorkerHost {
  request(payload: unknown): unknown;
  completed(payload: unknown): undefined;
  failed?(error: unknown): undefined;
}

export interface RenderWorkerRuntime {
  readonly description: unknown;
  dispatch(payload: unknown): unknown;
  close(): undefined;
}

type Failure =
  | { readonly kind: "error"; readonly name: string; readonly message: string }
  | { readonly kind: "host"; readonly token: number };
type Response = { readonly kind: "success"; readonly payload: unknown }
  | { readonly kind: "failure"; readonly failure: Failure };
type Message =
  | { readonly kind: "request" | "reply" | "complete"; readonly sequence: number; readonly parent: number | null; readonly response: Response }
  | { readonly kind: "dispatch" | "initialize"; readonly sequence: number; readonly parent: number | null; readonly payload: unknown }
  | { readonly kind: "close"; readonly sequence: number };

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

function sequence(input: unknown): number {
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input <= 0)
    throw new Error("Invalid render thread message sequence");
  return input;
}

function decodeFailure(input: unknown): Failure {
  if (!record(input)) throw new Error("Invalid render thread failure");
  if (input["kind"] === "host") return { kind: "host", token: sequence(input["token"]) };
  const message = input["message"];
  if (typeof message !== "string") throw new Error("Invalid render thread error message");
  if (input["kind"] === "error" && typeof input["name"] === "string")
    return { kind: "error", name: input["name"], message };
  throw new Error("Invalid render thread error kind");
}

function decodeResponse(input: unknown): Response {
  if (!record(input)) throw new Error("Invalid render thread response");
  if (input["kind"] === "success") return { kind: "success", payload: input["payload"] };
  if (input["kind"] === "failure") return { kind: "failure", failure: decodeFailure(input["failure"]) };
  throw new Error("Invalid render thread response kind");
}

function decodeMessage(input: unknown): Message {
  if (!record(input)) throw new Error("Invalid render thread message");
  const kind = input["kind"], number = sequence(input["sequence"]);
  if (kind === "close") return { kind, sequence: number };
  const parent = input["parent"] === null ? null : sequence(input["parent"]);
  if (kind === "dispatch" || kind === "initialize") return { kind, sequence: number, parent, payload: input["payload"] };
  if (kind === "request" || kind === "reply" || kind === "complete")
    return { kind, sequence: number, parent, response: decodeResponse(input["response"]) };
  throw new Error("Invalid render thread message kind");
}

class HostFailure extends Error {
  constructor(readonly token: number) { super("Renderer host callback failed"); }
}

function failure(error: unknown): Failure {
  if (error instanceof HostFailure) return { kind: "host", token: error.token };
  if (error instanceof Error) return { kind: "error", name: error.name, message: error.message };
  return { kind: "error", name: "Error", message: String(error) };
}

function restoreFailure(input: Failure): Error {
  switch (input.kind) {
    case "host": return new HostFailure(input.token);
    case "error": {
      const error = input.name === "RangeError" ? new RangeError(input.message)
        : input.name === "TypeError" ? new TypeError(input.message) : new Error(input.message);
      error.name = input.name;
      return error;
    }
  }
}

function send(port: MessagePort, signal: Int32Array<SharedArrayBuffer>, message: Message): void {
  port.postMessage(message);
  Atomics.add(signal, 0, 1);
  Atomics.notify(signal, 0);
}

function receive(port: MessagePort): Message | null {
  const result: unknown = receiveMessageOnPort(port);
  if (result === undefined) return null;
  if (!record(result) || !("message" in result)) throw new Error("Invalid render thread port result");
  return decodeMessage(result["message"]);
}

interface Pending {
  readonly sequence: number;
  readonly publish: boolean;
  response: Response | null;
  timeout: ReturnType<typeof setTimeout> | null;
}

/** One backend consumes a buffer while its frontend prepares the other buffer. */
export class RenderWorkerTransport {
  private readonly channel = new MessageChannel();
  private readonly signal = new Int32Array(new SharedArrayBuffer(8));
  private readonly hostFailures = new Map<number, unknown>();
  private nextSequence = 1;
  private nextHostFailure = 1;
  private pending: Pending | null = null;
  private readonly outstanding = new Map<number, Pending>();
  private fault: { readonly error: unknown } | null = null;
  private notifiedFailure: { readonly error: unknown } | null = null;
  private observedFault: { readonly error: unknown } | null = null;
  private readonly callbacks: { readonly request: number; readonly parent: number; readonly pending: Pending }[] = [];
  private closed = false;
  private deliveringCompletion = false;
  private closePending: Pending | null = null;
  private initialDescription: unknown;

  private constructor(private readonly worker: Worker, private readonly host: RenderWorkerHost,
    private readonly timeoutMilliseconds: number) {
    this.channel.port1.on("message", (input: unknown) => {
      try { this.accept(decodeMessage(input)); }
      catch (error: unknown) { this.fail(error); }
    });
    worker.on("error", error => { if (!this.closed) this.fail(error); });
    worker.on("exit", code => {
      if (!this.closed && this.closePending?.response?.kind !== "success") this.fail(new Error(`Render thread exited before shutdown (${code})`));
    });
  }

  static async open(workerUrl: URL, initialization: unknown, host: RenderWorkerHost, timeoutMilliseconds = 30_000): Promise<RenderWorkerTransport> {
    if (!Number.isFinite(timeoutMilliseconds) || timeoutMilliseconds <= 0) throw new RangeError("Invalid render thread timeout");
    const worker = new Worker(workerUrl);
    const backend = new RenderWorkerTransport(worker, host, timeoutMilliseconds);
    try {
      worker.postMessage({ port: backend.channel.port2, signal: backend.signal, timeoutMilliseconds }, [backend.channel.port2]);
      backend.begin("initialize", initialization, false);
      // Yield during startup so loader errors are delivered without waiting for the timeout.
      const deadline = performance.now() + timeoutMilliseconds;
      while (backend.pending?.response === null && backend.fault === null && performance.now() < deadline) {
        backend.drain();
        if (backend.pending?.response === null) await Bun.sleep(1);
      }
      backend.initialDescription = backend.synchronize();
      return backend;
    } catch (error: unknown) {
      const problem = backend.fail(error);
      try { backend.close(); }
      catch { /* Preserve startup failure; an unacknowledged context remains borrowed. */ }
      throw problem;
    }
  }

  get active(): boolean { return Atomics.load(this.signal, 1) !== 0; }
  get settled(): boolean { return this.closed || this.pending === null || this.pending.response !== null; }
  get retired(): boolean { return this.closed; }
  get description(): unknown { return this.initialDescription; }

  /** R_IssueRenderCommands waits for the previous buffer, then wakes this buffer. */
  issue(payload: unknown): void {
    this.synchronize();
    this.begin("dispatch", payload, true);
  }

  /** Synchronous source calls own the backend until their reply is published. */
  call(payload: unknown): unknown {
    this.synchronize();
    this.begin("dispatch", payload, false);
    return this.synchronize();
  }

  /** Screenshot readback can query the suspended backend at its reached callback. */
  callbackCall(payload: unknown): unknown {
    const callback = this.callbacks.at(-1);
    if (callback === undefined) return this.call(payload);
    if (this.pending !== callback.pending) throw new Error("Callback does not own suspended renderer operation");
    const suspended = this.pending;
    this.pending = null;
    try {
      this.begin("dispatch", payload, false, callback.request);
      return this.waitPending();
    } finally { this.pending = suspended; }
  }

  synchronize(): unknown {
    if (this.callbacks.length !== 0 || this.deliveringCompletion) throw new Error("Reentrant renderer synchronization during host callback");
    return this.waitPending();
  }

  private waitPending(): unknown {
    try {
      if (this.closed) throw new Error("Render thread is closed");
      const pending = this.pending;
      if (pending === null) { this.assertHealthy(); return undefined; }
      const deadline = performance.now() + this.timeoutMilliseconds;
      while (pending.response === null) {
        const wake = Atomics.load(this.signal, 0);
        this.drain();
        this.assertHealthy();
        if (pending.response !== null) break;
        if (performance.now() >= deadline) {
          const error = new Error("Render thread did not complete its issued buffer");
          throw this.fail(error);
        }
        Atomics.wait(this.signal, 0, wake, Math.min(10, Math.max(0, deadline - performance.now())));
      }
      this.pending = null;
      const response = pending.response;
      if (response.kind === "success") { this.assertHealthy(); return response.payload; }
      const error = response.failure.kind === "host" && this.hostFailures.has(response.failure.token)
        ? this.hostFailures.get(response.failure.token) : restoreFailure(response.failure);
      throw this.fail(error);
    } catch (error: unknown) {
      if (this.fault !== null && this.fault.error === error) this.observedFault = this.fault;
      throw error;
    }
  }

  /** Error recovery may retire an already-reported failure, never resume it. */
  retireAfterFailure(): boolean {
    if (this.fault === null || this.observedFault !== this.fault) return false;
    this.fault = null;
    this.observedFault = null;
    this.close();
    return true;
  }

  /** Final retirement remains available after a failed command; commands never replay. */
  close(): undefined {
    if (this.closed) return;
    if (this.callbacks.length !== 0 || this.deliveringCompletion) throw new Error("Reentrant render thread close");
    let first: { readonly error: unknown } | null = this.fault;
    this.fault = null;
    try { this.synchronize(); } catch (error: unknown) { first = { error }; }
    if (this.pending !== null && this.pending.response === null) {
      if (first !== null) throw first.error;
      throw new Error("Renderer cannot retire before its current operation completes");
    }
    if (this.closePending?.response?.kind === "success") {
      this.retire();
      if (first !== null) throw first.error;
      return;
    }
    this.fault = null;
    const pending: Pending = { sequence: this.nextSequence++, response: null, publish: false, timeout: null };
    this.pending = pending;
    this.closePending = pending;
    this.outstanding.set(pending.sequence, pending);
    this.armTimeout(pending);
    try {
      send(this.channel.port1, this.signal, { kind: "close", sequence: pending.sequence });
      this.synchronize();
    } catch (error: unknown) { first ??= { error: this.fail(error) }; }
    finally { if (pending.response?.kind === "success") this.retire(); }
    if (first !== null) throw first.error;
  }

  private retire(): void {
    this.closed = true;
    this.pending = null;
    this.channel.port1.close();
    void this.worker.terminate();
    this.hostFailures.clear();
    for (const pending of this.outstanding.values()) this.clearTimeout(pending);
    this.outstanding.clear();
  }

  private fail(error: unknown): unknown {
    this.notifiedFailure ??= { error };
    this.fault ??= this.notifiedFailure;
    if (this.failureDelivered) return this.fault.error;
    this.failureDelivered = true;
    try { this.host.failed?.(this.fault.error); }
    catch { /* Notification cannot replace the original terminal failure. */ }
    return this.fault.error;
  }
  private failureDelivered = false;
  private armTimeout(pending: Pending): void {
    pending.timeout = setTimeout(() => {
      if (this.closed || pending.response !== null) return;
      try { this.drain(); } catch (error) { this.fail(error); }
      if (pending.response === null) this.fail(new Error("Render thread did not complete its issued buffer"));
    }, this.timeoutMilliseconds);
  }
  private clearTimeout(pending: Pending | null): void {
    if (pending?.timeout !== null && pending?.timeout !== undefined) clearTimeout(pending.timeout);
    if (pending !== null) pending.timeout = null;
  }
  private assertHealthy(): void { if (this.fault !== null) throw this.fault.error; }

  private begin(kind: "initialize" | "dispatch", payload: unknown, publish: boolean, parent: number | null = null): void {
    if (this.closed) throw new Error("Render thread is closed");
    if (this.callbacks.length !== 0 && parent !== this.callbacks.at(-1)?.request) throw new Error("Reentrant renderer operation during host callback");
    this.assertHealthy();
    if (this.pending !== null) throw new Error("Renderer buffer is still owned by the backend");
    const sequence = this.nextSequence++;
    this.pending = { sequence, publish, response: null, timeout: null };
    this.outstanding.set(sequence, this.pending);
    this.armTimeout(this.pending);
    try { send(this.channel.port1, this.signal, { kind, sequence, parent, payload }); }
    catch (error: unknown) { this.clearTimeout(this.pending); this.outstanding.delete(sequence); this.pending = null; this.fail(error); this.observedFault = this.fault; throw error; }
  }

  private drain(): void {
    for (;;) {
      try {
        const message = receive(this.channel.port1);
        if (message === null) return;
        this.accept(message);
      } catch (error) { throw this.fail(error); }
    }
  }

  private accept(message: Message): void {
    if (message.kind === "request") {
      if (message.response.kind !== "success") throw new Error("Worker request carried an error response");
      const pending = this.pending;
      if (pending === null || pending.response !== null || message.parent !== pending.sequence) throw new Error("Worker callback has no matching parent operation");
      let response: Response;
      this.callbacks.push({ request: message.sequence, parent: pending.sequence, pending });
      try { response = { kind: "success", payload: this.host.request(message.response.payload) }; }
      catch (error: unknown) {
        const token = this.nextHostFailure++;
        this.hostFailures.set(token, error);
        response = { kind: "failure", failure: { kind: "host", token } };
      } finally { this.callbacks.pop(); }
      send(this.channel.port1, this.signal, { kind: "reply", sequence: message.sequence, parent: pending.sequence, response });
      return;
    }
    if (message.kind !== "complete") throw new Error("Unexpected renderer worker message");
    const pending = this.outstanding.get(message.sequence);
    if (pending === undefined || message.parent !== null || pending.response !== null)
      throw new Error("Renderer completed an unowned command buffer");
    pending.response = message.response;
    this.clearTimeout(pending);
    this.outstanding.delete(message.sequence);
    if (message.response.kind === "failure") {
      const problem = message.response.failure;
      this.fail(problem.kind === "host" && this.hostFailures.has(problem.token) ? this.hostFailures.get(problem.token) : restoreFailure(problem));
    }
    if (pending.publish && message.response.kind === "success") {
      this.deliveringCompletion = true;
      try { this.host.completed(message.response.payload); }
      catch (error: unknown) { throw this.fail(error); }
      finally { this.deliveringCompletion = false; }
    }
  }
}

/** Worker runtime owns native resources; successful close must mean they were released. */
export function serveRenderWorker(initialize: (payload: unknown, request: (payload: unknown) => unknown) => RenderWorkerRuntime): void {
  if (parentPort === null) throw new Error("Render worker bootstrap requires a worker parent");
  parentPort.once("message", (input: unknown) => {
    if (!record(input) || !(input["port"] instanceof MessagePort) || !(input["signal"] instanceof Int32Array)
      || !(input["signal"].buffer instanceof SharedArrayBuffer) || input["signal"].length !== 2
      || typeof input["timeoutMilliseconds"] !== "number" || !Number.isFinite(input["timeoutMilliseconds"]) || input["timeoutMilliseconds"] <= 0)
      throw new Error("Invalid render worker bootstrap");
    servePort(input["port"], new Int32Array(input["signal"].buffer), input["timeoutMilliseconds"], initialize);
  });
}

function servePort(port: MessagePort, signal: Int32Array<SharedArrayBuffer>, timeoutMilliseconds: number,
  initialize: (payload: unknown, request: (payload: unknown) => unknown) => RenderWorkerRuntime): void {
  let runtime: RenderWorkerRuntime | null = null;
  let terminal: Failure | null = null;
  let nextRequest = 1;
  const operations: number[] = [];
  const callbacks: { readonly sequence: number; readonly parent: number }[] = [];
  const request = (payload: unknown): unknown => {
    const parent = operations.at(-1);
    if (parent === undefined) throw new Error("Worker callback requires an executing operation");
    const id = nextRequest++, deadline = performance.now() + timeoutMilliseconds;
    callbacks.push({ sequence: id, parent });
    try {
      send(port, signal, { kind: "request", sequence: id, parent, response: { kind: "success", payload } });
      for (;;) {
        const wake = Atomics.load(signal, 0), message = receive(port);
        if (message !== null) {
          if (message.kind === "dispatch" && message.parent === id && runtime !== null) {
            execute(message);
            continue;
          }
          if (message.kind !== "reply" || message.sequence !== id || message.parent !== parent) throw new Error("Unexpected render worker callback reply");
          if (message.response.kind === "failure") throw restoreFailure(message.response.failure);
          return message.response.payload;
        }
        if (performance.now() >= deadline) throw new Error("Render worker host callback timed out");
        Atomics.wait(signal, 0, wake, Math.min(10, Math.max(0, deadline - performance.now())));
      }
    } finally { callbacks.pop(); }
  };
  const execute = (message: Message): void => {
    let response: Response;
    operations.push(message.sequence);
    Atomics.store(signal, 1, 1);
    try {
      if (message.kind === "close") {
        if (callbacks.length !== 0) throw new Error("Cannot close a suspended render callback");
        runtime?.close();
        runtime = null;
        response = { kind: "success", payload: undefined };
      } else if (message.kind !== "dispatch" && message.kind !== "initialize") throw new Error("Unexpected render worker command");
      else if (message.parent !== (callbacks.at(-1)?.sequence ?? null)) throw new Error("Render worker dispatch has an invalid callback parent");
      else if (terminal !== null) response = { kind: "failure", failure: terminal };
      else if (message.kind === "initialize" && runtime === null && message.parent === null) {
        runtime = initialize(message.payload, request);
        response = { kind: "success", payload: runtime.description };
      } else if (message.kind === "dispatch" && runtime !== null) response = { kind: "success", payload: runtime.dispatch(message.payload) };
      else throw new Error("Unexpected render worker lifecycle command");
    } catch (error: unknown) {
      terminal ??= failure(error);
      response = { kind: "failure", failure: terminal };
    } finally {
      operations.pop();
      Atomics.store(signal, 1, Number(operations.length !== 0));
    }
    send(port, signal, { kind: "complete", sequence: message.sequence, parent: null, response });
    if (message.kind === "close" && response.kind === "success") { port.close(); parentPort?.close(); }
  };
  port.on("message", (input: unknown) => { execute(decodeMessage(input)); });
}
