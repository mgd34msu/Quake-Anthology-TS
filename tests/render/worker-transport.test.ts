import { expect, test } from "bun:test";
import { RenderWorkerTransport } from "../../src/render/worker-transport.ts";
const workerUrl = new URL("./fixtures/transport-worker.ts", import.meta.url);

test("worker issue completion, copied ownership and synchronous order", async () => {
  const completed: unknown[] = [];
  const worker = await RenderWorkerTransport.open(workerUrl, { renderer: "test" }, {
    request() { throw new Error("Unexpected callback"); }, completed: value => { completed.push(value); return undefined; },
  });
  try {
    expect(worker.description).toEqual({ renderer: "test" });
    const bytes = new Uint8Array([1, 2, 3]); worker.issue(bytes); bytes[0] = 99;
    expect(worker.call("values")).toEqual([new Uint8Array([1, 2, 3])]);
    expect(completed).toEqual([new Uint8Array([1, 2, 3])]); expect(worker.settled).toBe(true);
  } finally { worker.close(); }
  expect(worker.retired).toBe(true); worker.close();
});

test("nested reached callbacks route subcalls to their exact suspended parent", async () => {
  const order: string[] = [];
  const worker = await RenderWorkerTransport.open(workerUrl, null, {
    request(payload) {
      if (payload === "outer-callback") {
        order.push("outer"); expect(() => worker.call("unrelated")).toThrow("Reentrant"); expect(() => worker.close()).toThrow("Reentrant");
        const value = worker.callbackCall("inner"); order.push("outer-return"); return value;
      }
      if (payload === "inner-callback") { order.push("inner"); return worker.callbackCall("leaf"); }
      throw new Error("Unexpected callback");
    }, completed() { return undefined; },
  });
  try { expect(worker.call("outer")).toBe("leaf-result"); expect(order).toEqual(["outer", "inner", "outer-return"]); }
  finally { worker.close(); }
});

test("nested host failures retain exact thrown identity and remain sticky", async () => {
  const original = new Error("original host error");
  const worker = await RenderWorkerTransport.open(workerUrl, null, {
    request(payload) { if (payload === "outer-callback") return worker.callbackCall("inner"); throw original; }, completed() { return undefined; },
  });
  try { worker.call("outer"); throw new Error("Expected failure"); } catch (error) { expect(error).toBe(original); }
  try { worker.call("leaf"); throw new Error("Expected sticky failure"); } catch (error) { expect(error).toBe(original); }
  try { worker.close(); } catch (error) { expect(error).toBe(original); }
  expect(worker.retired).toBe(true);
});

test("failed close acknowledgment never retires the worker", async () => {
  const worker = await RenderWorkerTransport.open(workerUrl, "close-fails-once", { request() {}, completed() {} });
  expect(() => worker.close()).toThrow("release failed"); expect(worker.retired).toBe(false);
  try { worker.close(); } catch (error) { expect(error).toBeInstanceOf(Error); }
  expect(worker.retired).toBe(true);
});

test("timeout does not retire pending ownership; late completion permits acknowledged close", async () => {
  const worker = await RenderWorkerTransport.open(workerUrl, null, { request() {}, completed() {} }, 60);
  expect(() => worker.call("slow")).toThrow("did not complete"); expect(worker.retired).toBe(false);
  await Bun.sleep(150);
  try { worker.close(); } catch (error) { expect(error).toBeInstanceOf(Error); }
  expect(worker.retired).toBe(true);
});

test("timed out nested subcall retains ownership of its late completion", async () => {
  const worker = await RenderWorkerTransport.open(workerUrl, null, {
    request() { return worker.callbackCall("slow"); }, completed() {},
  }, 60);
  expect(() => worker.call("outer")).toThrow("did not complete");
  expect(worker.retired).toBe(false);
  await Bun.sleep(150);
  try { worker.close(); } catch (error) { expect(error).toBeInstanceOf(Error); }
  expect(worker.retired).toBe(true);
});

test("completion publication cannot replace the operation being settled", async () => {
  const worker = await RenderWorkerTransport.open(workerUrl, null, {
    request() {}, completed() { expect(() => worker.call("unrelated")).toThrow("Reentrant"); },
  });
  try { worker.issue("first"); worker.synchronize(); expect(worker.call("values")).toEqual(["first"]); }
  finally { worker.close(); }
});

test("issued failure notifies asynchronous waiters exactly once without a renderer barrier", async () => {
  for (const command of ["failure", "outer", "slow"]) {
    const original = new Error("asynchronous host failure"), notifications: unknown[] = [];
    let deliver: ((error: unknown) => void) | null = null;
    const notification = new Promise<unknown>(resolve => { deliver = resolve; });
    const worker = await RenderWorkerTransport.open(workerUrl, null, {
      request() { throw original; }, completed() {},
      failed(error) { notifications.push(error); if (deliver === null) throw new Error("Missing failure waiter"); deliver(error); },
    }, command === "slow" ? 60 : 1000);
    worker.issue(command);
    const error = await notification;
    if (command === "outer") expect(error).toBe(original);
    else if (command === "failure") { expect(error).toBeInstanceOf(RangeError); expect(String(error)).toContain("worker failure"); }
    else { expect(String(error)).toContain("did not complete"); await Bun.sleep(150); }
    expect(notifications).toHaveLength(1);
    try { worker.close(); } catch (closeError) { expect(closeError).toBe(error); }
    expect(worker.retired).toBe(true);
    await Bun.sleep(1); expect(notifications).toHaveLength(1);
  }
});
