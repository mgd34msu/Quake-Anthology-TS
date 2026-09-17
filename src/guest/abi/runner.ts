// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, GuestCallContext, GuestCallResult, GuestCallValue, GuestValueLayout } from "../../contracts/execution.ts";
import type { GuestCallSignature, GuestCpu, GuestExecutionStop, GuestHostCallback, GuestProcessorState } from "../core/contracts.ts";
import { GuestCallbackTable } from "../core/callbacks.ts";
import { X86AbiAdapter } from "./adapter.ts";
import { planGuestCall } from "./classify.ts";
import { inferredLayout } from "./values.ts";

export interface AbiProcessorSnapshot {
  readonly architecture: GuestProcessorState["architecture"];
  readonly registers: Uint8Array;
  readonly instructionPointer: bigint;
  readonly flags: bigint;
  readonly segments: GuestProcessorState["segments"];
  readonly x87: GuestProcessorState["x87"];
  readonly simd: GuestProcessorState["simd"];
}
export function captureAbiProcessorState(state: GuestProcessorState): AbiProcessorSnapshot {
  return { architecture: state.architecture, registers: state.registers.checkpoint(), instructionPointer: state.instructionPointer, flags: state.flags.value,
    segments: { cs: { ...state.segments.cs }, ds: { ...state.segments.ds }, es: { ...state.segments.es }, ss: { ...state.segments.ss }, fs: { ...state.segments.fs }, gs: { ...state.segments.gs } },
    x87: { ...state.x87, registers: state.x87.registers.slice() }, simd: { ...state.simd, xmm: state.simd.xmm.slice() } };
}
export function restoreAbiProcessorState(state: GuestProcessorState, snapshot: AbiProcessorSnapshot): void {
  if (state.architecture !== snapshot.architecture) throw new TypeError("ABI processor snapshot architecture differs");
  state.registers.restore(snapshot.registers);
  state.instructionPointer = snapshot.instructionPointer;
  state.flags.value = snapshot.flags;
  Object.assign(state.segments.cs, snapshot.segments.cs); Object.assign(state.segments.ds, snapshot.segments.ds);
  Object.assign(state.segments.es, snapshot.segments.es); Object.assign(state.segments.ss, snapshot.segments.ss);
  Object.assign(state.segments.fs, snapshot.segments.fs); Object.assign(state.segments.gs, snapshot.segments.gs);
  state.x87.registers.set(snapshot.x87.registers);
  state.x87.controlWord = snapshot.x87.controlWord; state.x87.statusWord = snapshot.x87.statusWord; state.x87.tagWord = snapshot.x87.tagWord;
  state.x87.lastOpcode = snapshot.x87.lastOpcode; state.x87.instructionPointer = snapshot.x87.instructionPointer;
  state.x87.dataPointer = snapshot.x87.dataPointer; state.x87.instructionSelector = snapshot.x87.instructionSelector; state.x87.dataSelector = snapshot.x87.dataSelector;
  state.simd.xmm.set(snapshot.simd.xmm); state.simd.mxcsr = snapshot.simd.mxcsr; state.simd.mxcsrMask = snapshot.simd.mxcsrMask;
}

export class GuestCallStopped extends Error {
  constructor(readonly stop: GuestExecutionStop, readonly context: GuestCallContext) {
    super(`Guest call stopped: ${stop.kind}`);
    this.name = "GuestCallStopped";
  }
}
export interface GuestCallRequest {
  readonly target: GuestAddress;
  readonly signature: GuestCallSignature;
  readonly arguments: readonly GuestCallValue[];
  readonly context: GuestCallContext;
  readonly instructionBudget: number;
}
export interface GuestCallRunnerOptions {
  readonly cpu: GuestCpu;
  readonly callbacks: GuestCallbackTable;
  readonly returnAddress: GuestAddress;
  /** The owning host API determines variadic types, for example from printf's format string. */
  readonly variadicLayouts?: (callback: GuestHostCallback, fixedArguments: readonly GuestCallValue[], context: GuestCallContext) => readonly GuestValueLayout[];
}
interface ActiveCall { readonly context: GuestCallContext; remaining: number; }

/** Synchronous nested entries preserve processor context and retain guest memory mutations. */
export class GuestCallRunner {
  readonly #active: ActiveCall[] = [];
  #callbackContext: GuestCallContext | null = null;
  #instructionsExecuted = 0n;
  #loadingSuspended = false;
  #maximumLoadingSliceMilliseconds = 0;
  get maximumLoadingSliceMilliseconds(): number { return this.#maximumLoadingSliceMilliseconds; }
  get instructionsExecuted(): bigint { return this.#instructionsExecuted; }
  constructor(readonly options: GuestCallRunnerOptions) {
    if (options.callbacks.memory !== options.cpu.memory) throw new TypeError("Callback table and CPU use different guest memory");
    options.cpu.memory.check(options.returnAddress, 1, "execute");
  }
  get depth(): number { return this.#active.length; }
  get currentContext(): GuestCallContext | null { return this.#callbackContext ?? this.#active.at(-1)?.context ?? null; }

  invoke(request: GuestCallRequest): GuestCallResult {
    if (this.#loadingSuspended) throw new Error("Guest loading call is suspended");
    const steps = this.invokeSteps(request);
    const result = steps.next();
    if (!result.done) throw new Error("Synchronous guest call yielded");
    return result.value;
  }
  async invokeLoading(request: GuestCallRequest, nextFrame: () => Promise<void>): Promise<GuestCallResult> {
    if (this.depth !== 0) throw new Error("Guest loading requires an idle call runner");
    const steps = this.invokeSteps(request, 16_384);
    try {
      for (;;) {
        const started = performance.now();
        const result = steps.next();
        this.#maximumLoadingSliceMilliseconds = Math.max(this.#maximumLoadingSliceMilliseconds, performance.now() - started);
        if (result.done) return result.value;
        this.#loadingSuspended = true;
        try { await nextFrame(); } finally { this.#loadingSuspended = false; }
      }
    } finally { steps.return({ kind: "void" }); }
  }
  private *invokeSteps(request: GuestCallRequest, slice = Number.MAX_SAFE_INTEGER): Generator<undefined, GuestCallResult, void> {
    if (!Number.isSafeInteger(request.instructionBudget) || request.instructionBudget <= 0) throw new RangeError("Guest instruction budget must be positive");
    const { cpu, callbacks, returnAddress } = this.options;
    if (request.context.module.id !== cpu.memory.module.id || request.context.module.digest !== cpu.memory.module.digest) throw new TypeError("Call context belongs to a different guest module");
    const enclosing = this.#active.at(-1);
    const context = enclosing === undefined ? request.context : { ...request.context, parent: this.currentContext };
    const active: ActiveCall = { context, remaining: Math.min(request.instructionBudget, enclosing?.remaining ?? request.instructionBudget) };
    const saved = captureAbiProcessorState(cpu.state), adapter = new X86AbiAdapter(request.signature.abi);
    const callerStack = cpu.state.registers.read("rsp", cpu.memory.pointerBytes === 4 ? 32 : 64);
    adapter.enter(cpu, request.target, request.signature, request.arguments, returnAddress);
    const width = cpu.memory.pointerBytes === 4 ? 32 : 64;
    const entryStack = cpu.state.registers.read("rsp", width);
    const plan = planGuestCall(request.signature, request.arguments.map((value, index) => request.signature.parameters[index] ?? inferredLayout(value, request.signature.variadic)));
    this.#active.push(active);
    let sliceRemaining = slice;
    try {
      for (;;) {
        if (sliceRemaining <= 0 && active.remaining > 0) { yield undefined; sliceRemaining = slice; }
        const rawStop = cpu.run({ instructionBudget: Math.min(active.remaining, sliceRemaining), returnAddress });
        const stop: GuestExecutionStop = rawStop.kind === "budget" && cpu.state.instructionPointer === returnAddress.byteOffset
          ? { kind: "return", instructions: rawStop.instructions, address: returnAddress } : rawStop;
        if (!Number.isSafeInteger(stop.instructions) || stop.instructions < 0 || stop.instructions > active.remaining) throw new Error("CPU returned an invalid instruction count");
        this.#instructionsExecuted += BigInt(stop.instructions);
        sliceRemaining -= stop.instructions;
        for (const frame of this.#active) frame.remaining = Math.max(0, frame.remaining - stop.instructions);
        if (stop.kind === "return") {
          if (cpu.state.registers.read("rsp", width) !== entryStack + BigInt(cpu.memory.pointerBytes + plan.calleePopBytes)) throw new Error("Guest returned with incorrect ABI stack cleanup");
          const result = adapter.returnValue(cpu, request.signature);
          if (enclosing !== undefined) restoreAbiProcessorState(cpu.state, saved);
          else {
            // The host caller reclaims its stack; guest register and floating state remain authoritative.
            cpu.state.registers.write("rsp", width, callerStack);
            cpu.state.instructionPointer = saved.instructionPointer;
          }
          return result;
        }
        if (stop.kind === "budget" && active.remaining > 0 && sliceRemaining <= 0) continue;
        if (stop.kind !== "host-call") throw new GuestCallStopped(stop, context);
        const callback = callbacks.resolve(stop.address);
        if (callback === null) throw new Error(`Unknown guest callback at 0x${stop.address.byteOffset.toString(16)}`);
        const callbackAdapter = new X86AbiAdapter(callback.signature.abi);
        const callbackContext: GuestCallContext = { ...context, parent: context,
          callback: { kind: "native-guest", module: cpu.memory.module, address: stop.address, abi: callback.signature.abi } };
        const fixed = callbackAdapter.arguments(cpu, callback.signature);
        if (callback.signature.variadic && this.options.variadicLayouts === undefined) throw new TypeError("Variadic host callback requires a layout resolver");
        const extra = callback.signature.variadic ? this.options.variadicLayouts?.(callback, fixed, callbackContext) ?? [] : [];
        const arguments_ = extra.length === 0 ? fixed : callbackAdapter.arguments(cpu, callback.signature, extra);
        sliceRemaining--;
        // Count dispatch as one step so a zero-instruction trap loop remains bounded.
        for (const frame of this.#active) frame.remaining = Math.max(0, frame.remaining - 1);
        const previousContext = this.#callbackContext;
        this.#callbackContext = callbackContext;
        let result: GuestCallResult;
        try { result = callbacks.invoke(stop.address, callbackContext, arguments_); }
        finally { this.#callbackContext = previousContext; }
        callbackAdapter.leave(cpu, callback.signature, result);
      }
    } finally {
      // Stops retain the actual faulting processor and memory for the runtime's exception policy.
      this.#active.pop();
    }
  }
}
