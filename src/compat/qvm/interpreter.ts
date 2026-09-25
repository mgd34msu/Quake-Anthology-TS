/*
 * Translated from Quake III Arena qcommon/vm.c and vm_interpreted.c.
 * Copyright (C) 1999-2005 Id Software, Inc.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { QvmOpcode } from "./image.ts";
import type { QvmDataImage, QvmImage } from "./image.ts";
import { CommonError } from "../../core/common-error.ts";
import type { QvmAllocation, QvmAllocationProfile } from "./allocation.ts";
import { evaluateQvmBinary, evaluateQvmBranch, evaluateQvmUnary } from "./operations.ts";
import { qualifyQvmRegion, qualifyQvmRegionEvaluation, type QvmRegionEvaluation } from "./regions.ts";
import { QvmMemory } from "./memory.ts";
import type { VmRegistration } from "./registry.ts";
import { QvmSymbols } from "./symbols.ts";
import type { QvmSymbolLoadOptions } from "./symbols.ts";

export type QvmArguments = readonly [
  number, number, number, number, number, number, number, number, number, number,
];

const cancellationScope = Symbol("QVM cancellation scope");
/** A capability for one live intercepted call, issued and checked by its interpreter. */
export interface QvmCancellationScope { readonly [cancellationScope]: true; }

export interface QvmEvaluationStack { readonly start: number; readonly end: number; }

export interface QvmReadOnlyEvaluation {
  readonly stack?: QvmEvaluationStack;
  readonly region: QvmRegionEvaluation;
  readonly inputs: readonly number[];
}

export interface QvmSyscall {
  /** Live little-endian words: syscall number, followed by its arguments. */
  readonly words: DataView;
  readonly memory: Uint8Array;
  readonly guest: QvmMemory;
  /** Recursive entry is valid only while this callback owns the suspended frame. */
  invoke(args: QvmArguments, instructionIndex?: number, evaluation?: QvmReadOnlyEvaluation): number;
  invokeAsync(args: QvmArguments, instructionIndex?: number, validate?: () => void): Promise<number>;
  cancelFunction(scope: QvmCancellationScope): never;
}

export type QvmSystemCallResult = number | Promise<number>;
export type QvmSystemCall = (call: QvmSyscall) => QvmSystemCallResult;

export interface QvmBranchBinding {
  readonly instructionIndex: number;
  decide(originalTaken: boolean, control: Pick<QvmSyscall, "cancelFunction">): boolean;
}

export interface QvmRegionControl extends Pick<QvmSyscall, "invoke" | "cancelFunction"> {
  /** Read an aligned word in this original function's local frame while the callback is active. */
  localWord(offset: number): number;
}
export interface QvmRegionBinding {
  readonly entry: number;
  readonly join: number;
  run(control: QvmRegionControl): "execute" | "skip";
  completed?(control: QvmRegionControl): void;
}

export interface QvmFunctionCall extends Pick<QvmSyscall, "invoke" | "invokeAsync" | "cancelFunction"> {
  readonly instructionIndex: number;
  /** Exact original CALL instruction; null for an invocation entered directly by the host. */
  readonly callerInstruction: number | null;
  readonly execution: "synchronous" | "asynchronous";
  /** Live source argument words, starting at the caller's first OP_ARG slot. */
  readonly words: DataView;
  readonly memory: Uint8Array;
  readonly guest: QvmMemory;
  /** Open before proceeding; cancellation returns zero from this exact source call. */
  cancellationScope(): QvmCancellationScope;
  /** Bind original conditional decisions once, before proceeding, for this exact invocation. */
  branches(bindings: readonly QvmBranchBinding[]): void;
  /** Bind closed, stack-neutral original regions to this invocation before proceeding. */
  regions(bindings: readonly QvmRegionBinding[]): void;
  /** Run a qualified standalone region in this original function's frame with explicit live-ins. */
  evaluateRegion(region: QvmRegionEvaluation, inputs: readonly number[]): number;
  /** Deliver a synchronous host effect under this live source invocation, including after an awaited continuation. */
  effect(perform: () => undefined): undefined;
  /** Runs the original body once with its actual caller stack and argument addresses. */
  proceed(): number;
  proceedAsync(): Promise<number>;
}
export type QvmFunctionHook = (call: QvmFunctionCall) => QvmSystemCallResult;
export type QvmFunctionResolver = (instructionIndex: number, firstArgument: number) => QvmFunctionHook | undefined;
export interface QvmFunctionObservation extends Pick<QvmSyscall, "invoke" | "invokeAsync" | "cancelFunction"> {
  readonly instructionIndex: number;
  argument(index: number): number;
}
export type QvmFunctionObserver = (call: QvmFunctionObservation) => undefined;
interface FunctionObserver { readonly observe: QvmFunctionObserver; active: boolean; }
interface FunctionBinding { readonly hook: QvmFunctionHook; readonly scope: "calls" | "invocations"; }
export type QvmSemantics = "interpreted" | "compiled";

class Operands {
  private readonly cells: (number | undefined)[] = new Array<number | undefined>(256);
  private depth = 0;

  constructor(private readonly debug = false) {}

  get count(): number { return this.depth; }

  reserve(): void {
    if (this.depth === 255) {
      if (this.debug) throw new CommonError("drop", "VM opStack overflow");
      throw new Error("QVM operand stack overflow");
    }
    this.depth++;
  }

  push(word: number): void { this.reserve(); this.cells[this.depth] = word; }

  peek(): number {
    const word = this.cells[this.depth];
    if (word === undefined) {
      if (this.debug) throw new CommonError("drop", "QVM reads an uninitialized operand");
      throw new Error("QVM reads an uninitialized operand");
    }
    return word;
  }

  set(word: number): void {
    this.cells[this.depth] = word;
  }

  pop(): number { const word = this.peek(); this.drop(); return word; }

  drop(): void {
    if (this.depth === 0) {
      if (this.debug) throw new CommonError("drop", "VM opStack underflow");
      throw new Error("QVM operand stack underflow");
    }
    this.depth--;
  }

  complementPrevious(): void {
    // This is the pinned interpreter's OP_BCOM, not the JIT's unary operation.
    if (this.depth === 0) {
      if (this.debug) throw new CommonError("drop", "VM opStack underflow");
      throw new Error("QVM operand stack underflow");
    }
    this.cells[this.depth - 1] = ~this.peek();
  }

  result(): number {
    if (this.depth !== 1) throw new CommonError("drop", `Interpreter error: opStack = ${this.depth}`);
    return this.peek();
  }

  truncate(depth: number): void {
    if (!Number.isSafeInteger(depth) || depth < 0 || depth > this.depth) throw new Error("QVM cancellation lost its caller operands");
    while (this.depth > depth) { this.cells[this.depth] = undefined; this.depth--; }
  }
}

interface Invocation {
  readonly operands: Operands;
  readonly stack: () => number;
  readonly execution: object;
  readonly asynchronous: boolean;
  readonly validate: () => void;
  readonly functionScope: SourceFunctionCall | null;
}
interface SyscallScope {
  open: boolean;
  pending: Promise<void> | null;
  failure: { readonly error: unknown } | null;
}
interface HostCallScope extends Pick<QvmSyscall, "invoke" | "invokeAsync" | "cancelFunction"> {
  run(operation: () => number): number;
  runAsync(operation: () => Promise<number>): Promise<number>;
  control<Result>(operation: () => Result): Result;
}
interface SourceFunctionCall {
  readonly stack: number;
  readonly returnPC: number;
  readonly operands: Operands;
  readonly operandDepth: number;
  readonly parent: SourceFunctionCall | null;
  active: boolean;
  branches: ReadonlyMap<number, QvmBranchBinding["decide"]> | null;
  regions: ReadonlyMap<number, SourceRegion> | null;
  regionJoins: ReadonlyMap<number, SourceRegion> | null;
  evaluation: { readonly region: QvmRegionEvaluation; readonly inputs: readonly number[]; readonly frameSize: number } | null;
  cancellation: { readonly signal: Error; requested: boolean; failure: { readonly error: unknown } | null } | null;
}
interface SourceRegion {
  readonly binding: QvmRegionBinding;
  readonly join: number;
  readonly stack: number;
  readonly frameSize: number;
  state: "ready" | "running" | "complete";
}

function signedWord(value: number): number {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
    throw new RangeError("QVM host value must be a signed 32-bit integer");
  }
  return value | 0;
}

/** Owns prepared bytecode and its private data for one module instance. */
export class QvmInterpreter {
  readonly memory: Uint8Array;
  readonly symbols: QvmSymbols;
  callLevel = 0;
  readonly addressSpace: QvmMemory;
  private readonly qualifiedRegions = new Map<string, number>();
  private counterEvaluation: { readonly address: number; value: number; readonly stackEnd: number; readonly stackStart: number;
    readonly functions: ReadonlySet<number>; readonly ranges: readonly { readonly start: number; readonly end: number }[]; remaining: number } | null = null;
  private readonly sourceDataEnd: number;
  private readonly memoryInitializedEnd: number;
  private readonly counterFunctions = new Map<string, { readonly functions: ReadonlySet<number>; readonly ranges: readonly { readonly start: number; readonly end: number }[] }>();
  private readonly qualifiedEvaluations = new Map<string, number>();
  private readonly data: DataView;
  private readonly observedData: DataView;
  private readonly code: Int32Array;
  private readonly instructionPointers: Int32Array;
  private readonly instructions: QvmImage["instructions"];
  private branchFunctionEnds: Map<number, number> | null = null;
  private readonly allocations: readonly QvmAllocation[];
  private readonly source: string;
  private readonly dataMask: number;
  private programStack: number;
  private active: Invocation | null = null;
  private rootActive = false;
  private executing: object | null = null;
  private breaks = 0;
  private debug = false;
  private functionHooks: Map<number, FunctionBinding> | null = null;
  private functionObservers: Map<number, readonly FunctionObserver[]> | null = null;
  private functionResolver: { readonly resolve: QvmFunctionResolver } | undefined;
  private readonly cancellationScopes = new WeakMap<QvmCancellationScope, SourceFunctionCall>();

  constructor(image: QvmImage, private readonly systemCall: QvmSystemCall,
    profile: QvmAllocationProfile = { kind: "unaccounted" },
    private readonly registration: VmRegistration | null = null,
    private readonly semantics: QvmSemantics = "interpreted",
    private readonly storeEffect: (scope: Pick<QvmSyscall, "invoke" | "invokeAsync" | "cancelFunction">, perform: () => undefined) => undefined = (_scope, perform) => perform(),
  ) {
    this.source = image.source;
    this.instructions = image.instructions;
    this.sourceDataEnd = image.dataLength + image.literalLength + image.bssLength;
    this.memoryInitializedEnd = image.dataLength + image.literalLength;
    const allocations: QvmAllocation[] = [];
    const allocate = (source: string, bytes: number, resource = image.source): Uint8Array => {
      if (profile.kind === "unaccounted") return new Uint8Array(bytes);
      const allocation = profile.allocate({ purpose: source, resource, byteLength: bytes });
      allocations.push(allocation);
      return allocation.bytes;
    };
    this.memory = allocate("VM_Create:dataBase", image.allocatedDataLength);
    registration?.bindData(this.memory);
    this.addressSpace = new QvmMemory(this.memory, perform => this.publishEffect(perform));
    this.memory.set(image.initializedData);
    this.data = new DataView(this.memory.buffer, this.memory.byteOffset, this.memory.byteLength);
    this.observedData = this.addressSpace.dataView(0, this.memory.byteLength);
    this.dataMask = image.dataMask;
    this.programStack = this.memory.length;
    // Source preparation expands each code byte to an int slot. Operand tails
    // and alignment slots remain zero, and return PCs address these slots too.
    registration?.bindInstructionPointersLength(image.instructions.length * 4);
    const pointers = allocate("VM_Create:instructionPointers", image.instructions.length * 4);
    this.instructionPointers = new Int32Array(pointers.buffer, pointers.byteOffset, image.instructions.length);
    registration?.bindCodeLength(image.codeLength);
    const code = allocate("VM_PrepareInterpreter", image.codeLength * 4);
    this.code = new Int32Array(code.buffer, code.byteOffset, image.codeLength);
    this.allocations = allocations;
    this.symbols = new QvmSymbols(this.instructionPointers,
      (bytes, resource) => allocate("VM_LoadSymbols", bytes, resource), () => this.live());
    for (const [index, instruction] of image.instructions.entries()) this.instructionPointers[index] = instruction.byteOffset;
    for (const instruction of image.instructions) {
      this.code[instruction.byteOffset] = instruction.opcode;
      if (instruction.operandWidth !== 0) {
        this.code[instruction.byteOffset + 1] =
          instruction.opcode >= QvmOpcode.OP_EQ && instruction.opcode <= QvmOpcode.OP_GEF
            ? this.targetPC(instruction.operand) : instruction.operand;
      }
    }
    registration?.bindInterpreter(this);
  }

  get isActive(): boolean { return this.rootActive; }
  get stackPointer(): number { return this.programStack; }

  /** Bind a source OP_CALL target in this interpreter's immutable instruction table. */
  bindFunction(instructionIndex: number, hook: QvmFunctionHook): () => void {
    return this.bindEntry(instructionIndex, hook, "calls");
  }

  /** Include direct host entry, retaining the same original-body and cancellation scope. */
  bindInvocation(instructionIndex: number, hook: QvmFunctionHook): () => void {
    return this.bindEntry(instructionIndex, hook, "invocations");
  }

  private bindEntry(instructionIndex: number, hook: QvmFunctionHook, scope: FunctionBinding["scope"]): () => void {
    this.live();
    if (!Number.isSafeInteger(instructionIndex) || instructionIndex < 0
      || this.codeWord(this.targetPC(instructionIndex)) !== QvmOpcode.OP_ENTER) throw new Error("QVM hook requires a function entry instruction");
    if (this.functionHooks?.has(instructionIndex)) throw new Error("QVM function already has a hook");
    const entry = { hook, scope };
    const hooks = this.functionHooks ?? new Map<number, FunctionBinding>();
    this.functionHooks = hooks;
    hooks.set(instructionIndex, entry);
    return () => {
      if (hooks.get(instructionIndex) !== entry) return;
      hooks.delete(instructionIndex);
      if (hooks.size === 0 && this.functionHooks === hooks) this.functionHooks = null;
    };
  }

  /** Resolve live guest callback pointers only for modules that explicitly request it. */
  bindFunctionResolver(resolve: QvmFunctionResolver): () => void {
    this.live();
    if (this.functionResolver !== undefined) throw new Error("QVM already has a function resolver");
    const binding = { resolve }; this.functionResolver = binding;
    return () => { if (this.functionResolver === binding) this.functionResolver = undefined; };
  }

  /** Observers share an entry with each other and with its optional replacement hook. */
  observeFunction(instructionIndex: number, observe: QvmFunctionObserver): () => void {
    this.assertAllocation();
    if (!Number.isSafeInteger(instructionIndex) || instructionIndex < 0
      || this.codeWord(this.targetPC(instructionIndex)) !== QvmOpcode.OP_ENTER) throw new Error("QVM observer requires a function entry instruction");
    const observers = this.functionObservers ?? new Map<number, readonly FunctionObserver[]>(), entry = { observe, active: true };
    this.functionObservers = observers;
    observers.set(instructionIndex, [...observers.get(instructionIndex) ?? [], entry]);
    return () => {
      if (!entry.active) return;
      entry.active = false;
      const retained = observers.get(instructionIndex)?.filter(value => value.active) ?? [];
      if (retained.length === 0) observers.delete(instructionIndex); else observers.set(instructionIndex, retained);
      if (observers.size === 0 && this.functionObservers === observers) this.functionObservers = null;
    };
  }

  restoreData(data: Uint8Array): void {
    if (this.rootActive) throw new Error("Cannot restore an active QVM");
    this.live();
    if (data.length !== this.memory.length) throw new Error("QVM checkpoint allocation mismatch");
    this.addressSpace.clearWriteObservers();
    this.memory.set(data);
  }

  get breakCount(): number { return this.breaks; }
  get debugEnabled(): boolean { return this.debug; }
  get codeLength(): number { this.live(); return this.code.length; }
  get instructionPointersLength(): number { this.live(); return this.instructionPointers.byteLength; }

  indent(): string {
    if (!Number.isInteger(this.callLevel) || this.callLevel < 0) throw new RangeError("VM indentation requires a nonnegative call level");
    return " ".repeat(2 * Math.min(this.callLevel, 20));
  }

  stackTrace(programCounter: number, programStack: number,
    print: (text: string) => void = text => { this.registration?.print(text); },
  ): void {
    this.live();
    let count = 0;
    do {
      print(`${this.symbols.valueToSymbol(programCounter)}\n`);
      programStack = this.readWord(programStack + 4);
      programCounter = this.readWord(programStack);
    } while (programCounter !== -1 && ++count < 32);
  }

  loadSymbols(options: QvmSymbolLoadOptions): void { this.symbols.load(options); }

  private live(): void {
    this.addressSpace.assertNotPublishing();
    this.assertAllocation();
  }

  private assertAllocation(): void {
    this.addressSpace.assertLive();
    if (this.registration?.binding.kind === "freed") throw new Error("QVM registration has been freed");
    for (const allocation of this.allocations) void allocation.bytes;
  }

  pointer(word: number): Uint8Array | null {
    this.live();
    return this.addressSpace.pointer(word);
  }

  restart(image: QvmDataImage): void {
    if (this.rootActive) throw new Error("Cannot restart an active QVM");
    this.live();
    if (image.allocatedDataLength > this.memory.length) throw new Error("QVM restart would exceed its original allocation");
    this.addressSpace.clearWriteObservers();
    this.memory.fill(0, 0, image.allocatedDataLength);
    this.memory.set(image.initializedData);
  }

  invoke(args: QvmArguments, instructionIndex = 0, evaluation?: QvmReadOnlyEvaluation): number {
    if (this.rootActive) throw new Error("QVM is already active; recursive calls belong to the current syscall");
    this.live();
    this.rootActive = true;
    try { return this.executeSync(args, instructionIndex, undefined, undefined, evaluation); }
    finally { this.rootActive = false; }
  }

  async invokeAsync(args: QvmArguments, instructionIndex = 0, validate: () => void = () => {}): Promise<number> {
    if (this.rootActive) throw new Error("QVM is already active; recursive calls belong to the current syscall");
    this.live();
    this.rootActive = true;
    try { return await this.executeAsync(args, instructionIndex, validate); }
    finally { this.rootActive = false; }
  }

  private readonly readOnlyRegions = new Map<string, number>();
  private executeSync(args: QvmArguments, instructionIndex: number, sourceCall?: SourceFunctionCall, functionScope?: SourceFunctionCall | null, evaluation?: QvmReadOnlyEvaluation): number {
    let qualified: SourceFunctionCall["evaluation"] = null;
    if (evaluation !== undefined) {
      const { region, inputs } = evaluation, key = `${instructionIndex}:${region.entry}:${region.join}:${region.inputs.join(",")}:${region.result}`;
      let frameSize = this.readOnlyRegions.get(key);
      if (frameSize === undefined) {
        frameSize = qualifyQvmRegionEvaluation(this.instructions, instructionIndex, region, "read-only");
        this.readOnlyRegions.set(key, frameSize);
      }
      if (inputs.length !== region.inputs.length) throw new Error("Read-only QVM region live-ins differ from its qualified frame");
      for (const word of inputs) signedWord(word);
      qualified = { region, inputs, frameSize };
    }
    const token = {}, execution = this.execute(token, args, instructionIndex, false, () => {}, sourceCall, functionScope, qualified, evaluation?.stack);
    const result = this.resume(token, () => execution.next());
    if (result.done) return result.value;
    // The trap boundary rejects promises before a synchronous invocation can yield.
    execution.return(0);
    throw new Error("Synchronous QVM call cannot suspend");
  }

  private async executeAsync(args: QvmArguments, instructionIndex: number, validate: () => void, sourceCall?: SourceFunctionCall, functionScope?: SourceFunctionCall | null): Promise<number> {
    validate();
    const token = {}, execution = this.execute(token, args, instructionIndex, true, validate, sourceCall, functionScope);
    let next = this.resume(token, () => execution.next());
    while (!next.done) {
      try {
        const value = await next.value;
        this.live();
        validate();
        next = this.resume(token, () => execution.next(value));
      } catch (error) { next = this.resume(token, () => execution.throw(error)); }
    }
    return next.value;
  }

  private resume<Result>(execution: object, perform: () => Result): Result {
    const previous = this.executing; this.executing = execution;
    try { return perform(); } finally { this.executing = previous; }
  }

  private publishEffect(perform: () => undefined): undefined {
    const frame = this.active;
    if (frame === null || this.executing !== frame.execution) return perform();
    const previous = this.programStack; this.programStack = frame.stack() - 4;
    try {
      const result = this.hostCall(frame, scope => {
        this.storeEffect({ invoke: scope.invoke, cancelFunction: scope.cancelFunction,
          invokeAsync: () => scope.control(() => { throw new Error("QVM store effects cannot start asynchronous calls"); }),
        }, perform);
        return 0;
      });
      if (typeof result !== "number") {
        void result.catch(() => {});
        throw new Error("QVM store effects cannot suspend");
      }
      return undefined;
    } finally { this.programStack = previous; }
  }

  private range(address: number, length: number): void {
    if (address < 0 || address > this.memory.length - length) {
      throw new RangeError(`${this.source}: QVM memory access ${address}+${length} exceeds allocation`);
    }
  }

  private stack(address: number): number {
    this.range(address, 0);
    if (address % 4 !== 0) {
      if (this.debug) throw new CommonError("drop", "VM program stack misaligned");
      throw new Error("QVM program stack is misaligned");
    }
    return address;
  }

  /** Runs an original counter leaf with one virtual word; no source stores or host callbacks escape. */
  evaluateCounter(address: number, initial: number, functions: readonly number[], execute: () => number, stack?: QvmEvaluationStack): number {
    this.live(); this.range(address, 4); signedWord(initial);
    if (address % 4 !== 0 || address + 4 > this.sourceDataEnd || this.counterEvaluation !== null)
      throw new Error("QVM counter evaluation requires one live aligned source word and a fresh scope");
    const key = functions.join(":");
    let qualified = this.counterFunctions.get(key);
    if (qualified === undefined) {
      const admitted = new Set(functions);
      if (admitted.size !== functions.length || admitted.size === 0) throw new Error("QVM counter evaluation requires distinct original functions");
      const ranges = functions.map(entry => {
        if (this.instructions[entry]?.opcode !== QvmOpcode.OP_ENTER) throw new Error("QVM counter evaluation entry is not an original function");
        let end = entry + 1; while (end < this.instructions.length && this.instructions[end]?.opcode !== QvmOpcode.OP_ENTER) end++;
        return { start: this.targetPC(entry), end: end === this.instructions.length ? this.code.length : this.targetPC(end) };
      });
      qualified = { functions: admitted, ranges }; this.counterFunctions.set(key, qualified);
    }
    const stackStart = this.evaluationStackStart(stack);
    if (address + 4 > stackStart) throw new Error("QVM counter word overlaps its evaluation stack");
    const scope = { address, value: initial, stackStart, stackEnd: this.programStack, ...qualified, remaining: 100000 };
    this.counterEvaluation = scope;
    try { execute(); return scope.value; } finally { this.counterEvaluation = null; }
  }
  private evaluationStackStart(stack?: QvmEvaluationStack): number {
    if (stack === undefined) return Math.ceil(this.sourceDataEnd / 4) * 4;
    if (!Number.isSafeInteger(stack.start) || !Number.isSafeInteger(stack.end) || stack.start % 4 !== 0 || stack.end % 4 !== 0
      || stack.start < this.memoryInitializedEnd || stack.start >= stack.end || stack.end > this.memory.length || this.programStack > stack.end)
      throw new Error("QVM evaluation stack is outside its declared source reservation or active caller");
    return stack.start;
  }
  private counterRead(address: number, length: number): number | null {
    const scope = this.counterEvaluation;
    if (scope === null || address + length <= scope.address || address >= scope.address + 4) return null;
    if (address !== scope.address || length !== 4) throw new Error("QVM counter evaluation cannot partially read its isolated word");
    return scope.value;
  }
  private counterWrite(address: number, length: number, value: number): boolean {
    const scope = this.counterEvaluation;
    if (scope === null) return false;
    if (address === scope.address && length === 4) { scope.value = value | 0; return true; }
    if (address < Math.max(scope.stackStart, this.active?.stack() ?? scope.stackEnd) || address + length > scope.stackEnd)
      throw new Error("QVM counter evaluation attempted an unrelated source write");
    return false;
  }

  private readWord(address: number): number {
    this.range(address, 4);
    return this.counterEvaluation === null ? this.data.getInt32(address, true) : this.counterRead(address, 4) ?? this.data.getInt32(address, true);
  }

  private writeWord(address: number, word: number): void {
    this.range(address, 4);
    if (this.counterEvaluation !== null && this.counterWrite(address, 4, word)) return;
    (this.counterEvaluation === null && this.addressSpace.observesWrites ? this.observedData : this.data).setInt32(address, word, true);
  }

  private targetPC(index: number): number {
    const pc = this.instructionPointers[index];
    if (pc === undefined) throw new Error(`${this.source}: invalid QVM instruction index ${index}`);
    return pc;
  }
  private sourceInstruction(pc: number): number {
    let low = 0, high = this.instructionPointers.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1, candidate = this.instructionPointers[middle];
      if (candidate === undefined) break;
      if (candidate === pc) return middle;
      if (candidate < pc) low = middle + 1; else high = middle - 1;
    }
    throw new Error(`${this.source}: caller PC is not an original instruction`);
  }

  private codeWord(pc: number): number {
    const word = this.code[pc];
    if (word === undefined) throw new Error(`${this.source}: invalid QVM byte PC ${pc}`);
    return word;
  }

  private cancellationFailure(functionScope: SourceFunctionCall | null, error: unknown): void {
    for (let call = functionScope; call !== null; call = call.parent)
      if (call.active && call.cancellation?.requested && call.cancellation.signal === error) return;
    for (let call = functionScope; call !== null; call = call.parent)
      if (call.active && call.cancellation !== null && call.cancellation.failure === null) call.cancellation.failure = { error };
  }

  private checkCancellation(functionScope: SourceFunctionCall | null): void {
    let cancelled: Error | null = null;
    for (let call = functionScope; call !== null; call = call.parent) {
      if (!call.active || call.cancellation === null) continue;
      if (call.cancellation.failure !== null) throw call.cancellation.failure.error;
      if (call.cancellation.requested) cancelled = call.cancellation.signal;
    }
    if (cancelled !== null) throw cancelled;
  }

  private cancelFunction(capability: QvmCancellationScope, functionScope: SourceFunctionCall | null): never {
    const target = this.cancellationScopes.get(capability);
    if (target === undefined) throw new Error("QVM cancellation scope belongs to another interpreter");
    if (!target.active) throw new Error("QVM cancellation scope has expired");
    if (target.cancellation === null || target.cancellation.requested) throw new Error("QVM cancellation scope has already been used");
    let current = functionScope;
    while (current !== null && current !== target) current = current.parent;
    if (current === null) throw new Error("QVM cancellation scope is not an ancestor of this call");
    this.checkCancellation(functionScope);
    target.cancellation.requested = true;
    throw target.cancellation.signal;
  }

  private hostCall(frame: Invocation, perform: (scope: HostCallScope) => QvmSystemCallResult,
    functionScope: SourceFunctionCall | null = frame.functionScope): QvmSystemCallResult {
    const scope: SyscallScope = { open: true, pending: null, failure: null };
    const complete = (value: number): QvmSystemCallResult => {
      scope.open = false;
      const checked = (): number => {
        if (scope.failure !== null) throw scope.failure.error;
        this.checkCancellation(functionScope);
        this.live();
        frame.validate();
        return signedWord(value);
      };
      return scope.pending === null ? checked() : scope.pending.then(checked);
    };
    const failed = (error: unknown): never | Promise<number> => {
      scope.open = false;
      this.cancellationFailure(functionScope, error);
      if (scope.pending !== null) return scope.pending.then(() => { throw error; });
      throw error;
    };
    const available = (): void => {
      if (!scope.open || scope.pending !== null || this.active !== frame) throw new Error("QVM recursive call requires the active syscall or function hook with no pending child");
      this.live();
      frame.validate();
    };
    const control = <Result>(operation: () => Result): Result => {
      try { available(); return operation(); }
      catch (error) { scope.failure ??= { error }; this.cancellationFailure(functionScope, error); throw error; }
    };
    const run = (operation: () => number): number => {
      available();
      this.checkCancellation(functionScope);
      return operation();
    };
    const runAsync = (operation: () => Promise<number>): Promise<number> => {
      try {
        available();
        this.checkCancellation(functionScope);
        if (!frame.asynchronous) throw new Error("Synchronous QVM syscall cannot start an asynchronous child");
        const child = operation();
        scope.pending = child.then(
          () => { scope.pending = null; },
          (error: unknown) => { scope.pending = null; scope.failure = { error }; },
        );
        return child;
      } catch (error) { return Promise.reject(error); }
    };
    try {
      const result = perform({ run, runAsync, control,
        cancelFunction: capability => control(() => this.cancelFunction(capability, functionScope)),
        invoke: (args, instructionIndex = 0, evaluation) => run(() => this.executeSync(args, instructionIndex, undefined, functionScope, evaluation)),
        invokeAsync: (args, instructionIndex = 0, validate = () => {}) => runAsync(() => this.executeAsync(args, instructionIndex, () => { frame.validate(); validate(); }, undefined, functionScope)),
      });
      if (typeof result === "number") return complete(result);
      if (!frame.asynchronous) {
        scope.open = false;
        void result.catch(() => {});
        throw new Error("Synchronous QVM call received an asynchronous syscall");
      }
      return result.then(complete, failed);
    } catch (error) { return failed(error); }
  }

  private trap(frame: Invocation, sp: number): QvmSystemCallResult {
    this.range(sp + 4, 4);
    return this.hostCall(frame, scope => this.systemCall({
      words: this.addressSpace.dataView(sp + 4, this.memory.byteLength - sp - 4),
      memory: this.memory, guest: this.addressSpace, invoke: scope.invoke, invokeAsync: scope.invokeAsync, cancelFunction: scope.cancelFunction,
    }));
  }

  private decision(frame: Invocation, owner: SourceFunctionCall, decide: QvmBranchBinding["decide"], taken: boolean): QvmSystemCallResult {
    const previousStack = this.programStack; this.programStack = frame.stack() - 4;
    try { return this.hostCall(frame, scope => {
      let result = 0;
      this.storeEffect({ invoke: scope.invoke, cancelFunction: scope.cancelFunction,
        invokeAsync: () => scope.control(() => { throw new Error("QVM decision effects cannot start asynchronous calls"); }),
      }, () => { result = decide(taken, { cancelFunction: scope.cancelFunction }) ? 1 : 0; return undefined; });
      return result;
    }, owner); } finally { this.programStack = previousStack; }
  }

  private region(frame: Invocation, owner: SourceFunctionCall, region: SourceRegion, phase: "enter" | "complete"): QvmSystemCallResult {
    if (!owner.active || frame.stack() !== region.stack || frame.operands.count !== owner.operandDepth)
      throw new Error("QVM region lost its original frame or operand boundary");
    const previousStack = this.programStack; this.programStack = region.stack - 4;
    try { return this.hostCall(frame, scope => {
      let open = true;
      const current = <Result>(operation: () => Result): Result => scope.control(() => {
        if (!open || !owner.active || this.active !== frame || frame.stack() !== region.stack)
          throw new Error("QVM region callback has expired");
        return operation();
      });
      const control: QvmRegionControl = {
        invoke: (args, entry) => current(() => scope.invoke(args, entry)),
        cancelFunction: capability => current(() => scope.cancelFunction(capability)),
        localWord: offset => current(() => {
          if (!Number.isSafeInteger(offset) || offset < 8 || offset % 4 !== 0 || offset + 4 > region.frameSize)
            throw new Error("QVM region local is outside its original frame");
          return this.readWord(region.stack + offset);
        }),
      };
      try {
        let result = 0;
        this.storeEffect({ invoke: control.invoke, cancelFunction: control.cancelFunction,
          invokeAsync: () => scope.control(() => { throw new Error("QVM region effects cannot suspend"); }),
        }, () => {
          if (phase === "complete") region.binding.completed?.(control);
          else {
            const decision = region.binding.run(control);
            if (decision !== "execute" && decision !== "skip") throw new Error("QVM region requires one execution decision");
            result = decision === "execute" ? 1 : 0;
          }
          return undefined;
        });
        return result;
      } finally { open = false; }
    }, owner); } finally { this.programStack = previousStack; }
  }

  private intercept(frame: Invocation, sp: number, returnPC: number, instructionIndex: number, hook: QvmFunctionHook | undefined,
    observers: readonly FunctionObserver[] | undefined): QvmSystemCallResult {
    const sourceCall: SourceFunctionCall = { stack: sp, returnPC, operands: frame.operands, operandDepth: frame.operands.count,
      parent: frame.functionScope, active: true, branches: null, regions: null, regionJoins: null, evaluation: null, cancellation: null };
    const unusedArguments: QvmArguments = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    let proceeded = false;
    const failure: { value: { readonly error: unknown } | null } = { value: null };
    const begin = (): void => {
      if (proceeded) throw new Error("QVM function continuation can only run once");
      proceeded = true;
    };
    this.range(sp + 8, 0);
    const words = this.addressSpace.dataView(sp + 8, this.memory.byteLength - sp - 8);
    const proceed = (): QvmSystemCallResult => this.hostCall(frame, scope => {
      const call: QvmFunctionCall = { instructionIndex, callerInstruction: returnPC < 0 ? null : this.sourceInstruction(returnPC - 1), execution: frame.asynchronous ? "asynchronous" : "synchronous", memory: this.memory, guest: this.addressSpace,
        words,
        invoke: scope.invoke, invokeAsync: scope.invokeAsync, cancelFunction: scope.cancelFunction,
        effect: perform => scope.control(() => {
          this.checkCancellation(sourceCall);
          return this.storeEffect({ invoke: scope.invoke, cancelFunction: scope.cancelFunction,
            invokeAsync: () => scope.control(() => { throw new Error("QVM invocation effects cannot start asynchronous calls"); }),
          }, perform);
        }),
        cancellationScope: () => scope.control(() => {
          if (proceeded || sourceCall.cancellation !== null) throw new Error("QVM cancellation scope must open once before proceeding");
          const capability = Object.freeze<QvmCancellationScope>({ [cancellationScope]: true });
          sourceCall.cancellation = { signal: new Error("QVM function scope cancelled"), requested: false, failure: null };
          this.cancellationScopes.set(capability, sourceCall);
          return capability;
        }),
        branches: bindings => scope.control(() => {
          if (proceeded || sourceCall.branches !== null) throw new Error("QVM branches must bind once before proceeding");
          let end = this.branchFunctionEnds?.get(instructionIndex);
          if (end === undefined) {
            end = instructionIndex + 1;
            while (end < this.instructionPointers.length && this.codeWord(this.targetPC(end)) !== QvmOpcode.OP_ENTER) end++;
            this.branchFunctionEnds ??= new Map<number, number>(); this.branchFunctionEnds.set(instructionIndex, end);
          }
          const branches = new Map<number, QvmBranchBinding["decide"]>();
          for (const binding of bindings) {
            if (!Number.isSafeInteger(binding.instructionIndex) || binding.instructionIndex <= instructionIndex || binding.instructionIndex >= end)
              throw new Error("QVM branch is outside its owning function");
            const pc = this.targetPC(binding.instructionIndex), opcode = this.codeWord(pc);
            if (opcode < QvmOpcode.OP_EQ || opcode > QvmOpcode.OP_GEF || branches.has(pc))
              throw new Error("QVM branch requires a distinct original conditional instruction");
            branches.set(pc, binding.decide);
          }
          sourceCall.branches = branches;
        }),
        regions: bindings => scope.control(() => {
          if (proceeded || sourceCall.regions !== null) throw new Error("QVM regions must bind once before proceeding");
          const regions = new Map<number, SourceRegion>(), joins = new Map<number, SourceRegion>();
          let previous = instructionIndex;
          for (const binding of [...bindings].sort((left, right) => left.entry - right.entry)) {
            if (binding.entry < previous) throw new Error("QVM original regions overlap");
            const key = `${instructionIndex}:${binding.entry}:${binding.join}`;
            let frameSize = this.qualifiedRegions.get(key);
            if (frameSize === undefined) { frameSize = qualifyQvmRegion(this.instructions, instructionIndex, binding.entry, binding.join); this.qualifiedRegions.set(key, frameSize); }
            const join = this.targetPC(binding.join), region: SourceRegion = { binding: Object.freeze({ ...binding }), join, frameSize, stack: sp - frameSize, state: "ready" };
            regions.set(this.targetPC(binding.entry), region); joins.set(join, region); previous = binding.join;
          }
          sourceCall.regions = regions; sourceCall.regionJoins = joins;
        }),
        evaluateRegion: (region, inputs) => scope.run(() => {
          try {
            begin();
            const key = `${instructionIndex}:${region.entry}:${region.join}:${region.inputs.join(",")}:${region.result}`;
            let frameSize = this.qualifiedEvaluations.get(key);
            if (frameSize === undefined) { frameSize = qualifyQvmRegionEvaluation(this.instructions, instructionIndex, region); this.qualifiedEvaluations.set(key, frameSize); }
            if (inputs.length !== region.inputs.length) throw new Error("QVM region live-ins differ from its qualified frame");
            for (const word of inputs) signedWord(word);
            sourceCall.evaluation = { region: { ...region, inputs: [...region.inputs] }, inputs: [...inputs], frameSize };
            return this.executeSync(unusedArguments, instructionIndex, sourceCall);
          } catch (error) { failure.value = { error }; throw error; }
        }),
        proceed: () => scope.run(() => {
          try { begin(); return this.executeSync(unusedArguments, instructionIndex, sourceCall); }
          catch (error) { failure.value = { error }; throw error; }
        }),
        proceedAsync: () => scope.runAsync(() => { begin(); return this.executeAsync(unusedArguments, instructionIndex, frame.validate, sourceCall); }),
      };
      const result = hook !== undefined ? hook(call) : frame.asynchronous ? call.proceedAsync() : call.proceed();
      const checked = (value: number): number => { if (failure.value !== null) throw failure.value.error; return value; };
      return typeof result === "number" ? checked(result) : result.then(checked);
    }, sourceCall);
    const observeNext = (start: number): QvmSystemCallResult => {
      for (let index = start; observers !== undefined && index < observers.length; index++) {
        const observer = observers[index];
        if (observer === undefined || !observer.active) continue;
        const result = this.hostCall(frame, scope => {
          let open = true;
          const observation: QvmFunctionObservation = { instructionIndex, invoke: scope.invoke, invokeAsync: scope.invokeAsync, cancelFunction: scope.cancelFunction,
            argument: argumentIndex => {
              if (!open) throw new Error("QVM function observation has ended");
              if (!Number.isSafeInteger(argumentIndex) || argumentIndex < 0 || argumentIndex >= 10) throw new RangeError("QVM argument index outside source call");
              return words.getInt32(argumentIndex * 4, true);
            } };
          try { observer.observe(observation); return 0; }
          finally { open = false; }
        }, sourceCall);
        if (typeof result !== "number") return result.then(() => observeNext(index + 1));
      }
      return proceed();
    };
    const complete = (value: number): number => {
      try { this.checkCancellation(sourceCall); return value; }
      finally { sourceCall.active = false; sourceCall.branches = null; sourceCall.regions = null; sourceCall.regionJoins = null; }
    };
    const failed = (error: unknown): number => {
      try {
        const cancellation = sourceCall.cancellation;
        if (cancellation !== null && cancellation.failure !== null) throw cancellation.failure.error;
        if (cancellation?.requested && error === cancellation.signal) {
          sourceCall.operands.truncate(sourceCall.operandDepth);
          this.writeWord(sourceCall.stack, sourceCall.returnPC);
          return 0;
        }
        throw error;
      } finally { sourceCall.active = false; sourceCall.branches = null; sourceCall.regions = null; sourceCall.regionJoins = null; }
    };
    let result: QvmSystemCallResult;
    try { result = observeNext(0); } catch (error) { return failed(error); }
    return typeof result === "number" ? complete(result) : result.then(complete, failed);
  }

  private *execute(execution: object, args: QvmArguments, instructionIndex: number, asynchronous: boolean,
    validate: () => void, sourceCall?: SourceFunctionCall, functionScope?: SourceFunctionCall | null,
    readOnlyEvaluation: SourceFunctionCall["evaluation"] = null, readOnlyStack?: QvmEvaluationStack): Generator<Promise<number>, number, number> {
    for (const word of args) signedWord(word);
    if (sourceCall === undefined) this.registration?.printCall(args[0]);
    const profile = this.registration?.executionProfile() ?? { kind: "release" };
    const debug = profile.kind === "debug";
    const evaluationFloor = this.counterEvaluation?.stackStart ?? (readOnlyEvaluation === null ? null : this.evaluationStackStart(readOnlyStack));
    const previousDebug = this.debug;
    const trace = profile.kind === "debug" ? profile.trace : 0;
    const print = (text: string): void => { this.registration?.print(text); };
    const entryStack = this.programStack;
    const previousCallLevel = this.callLevel;
    let sp = sourceCall === undefined ? this.stack(entryStack - 48) : sourceCall.stack;
    if (evaluationFloor !== null && sp < evaluationFloor) throw new Error("QVM evaluation stack would overlap source data");
    this.debug = debug;
    const evaluationStack = sp, evaluation = readOnlyEvaluation ?? sourceCall?.evaluation;
    const previous = this.active;
    const frame: Invocation = { operands: sourceCall?.operands ?? new Operands(debug), stack: () => sp, execution, asynchronous, validate,
      functionScope: sourceCall ?? functionScope ?? previous?.functionScope ?? null };
    const operands = frame.operands;
    // vm_x86.c retains CALL/RET control on the host stack, outside writable guest locals.
    const returns = this.semantics === "compiled" ? [sp, sourceCall?.returnPC ?? -1] : null;
    this.active = frame;
    try {
      if (sourceCall === undefined) {
        this.writeWord(sp, -1);
        this.writeWord(sp + 4, 0);
        args.forEach((word, index) => this.writeWord(sp + 8 + index * 4, word));
        this.callLevel = 0;
        this.registration?.debug(0);
        const binding = this.functionHooks?.get(instructionIndex);
        if (binding?.scope === "invocations" && readOnlyEvaluation === null && this.counterEvaluation === null) {
          this.programStack = sp - 4;
          const result = this.intercept(frame, sp, -1, instructionIndex, binding.hook, undefined);
          return typeof result === "number" ? result : yield result;
        }
      }
      let pc = this.targetPC(instructionIndex);
      let evaluationStarted = false;
      let profileSymbol = debug ? this.symbols.valueToFunctionSymbol(0) : null;
      const debugString = (): string => `${this.indent()}${operands.count}`;
      for (;;) {
        const counter = this.counterEvaluation;
        if (counter !== null && (--counter.remaining < 0 || !counter.ranges.some(range => pc >= range.start && pc < range.end)))
          throw new Error("QVM counter evaluation escaped its admitted original functions or instruction budget");
        const owner = counter === null ? frame.functionScope : null;
        if (evaluation != null && sp === evaluationStack - evaluation.frameSize && pc === this.targetPC(evaluation.region.join)) {
          if (operands.count !== (sourceCall?.operandDepth ?? 0)) throw new Error("QVM region evaluation lost its caller operands");
          return evaluation.region.result === null ? 0 : this.readWord(sp + evaluation.region.result);
        }
        if (owner?.regions !== null && owner !== null) {
          const completed = owner.regionJoins?.get(pc);
          if (completed !== undefined && sp === completed.stack && completed.state === "running") {
            completed.state = "complete";
            const result = this.region(frame, owner, completed, "complete");
            if (typeof result !== "number") yield result;
          }
          const region = owner.regions.get(pc);
          if (region !== undefined && sp === region.stack) {
            if (region.state !== "ready") throw new Error("QVM region can execute only once per invocation");
            region.state = "running";
            const result = this.region(frame, owner, region, "enter"), execute = typeof result === "number" ? result : yield result;
            if (execute === 0) { region.state = "complete"; pc = region.join; continue; }
          }
        }
        if (debug) {
          if (pc < 0 || pc >= this.code.length) throw new CommonError("drop", "VM pc out of range");
          if (sp <= this.memory.length - 0x20000) throw new CommonError("drop", "VM stack overflow");
          if ((sp & 3) !== 0) throw new CommonError("drop", "VM program stack misaligned");
        }
        const opcode = this.codeWord(pc++);
        if (profileSymbol !== null) {
          if (trace > 1) {
            const name = QvmOpcode[opcode];
            // The source's sparse opnames table has no defined string outside the enum.
            if (name === undefined) throw new CommonError("drop", "Bad VM instruction");
            print(`${debugString()} ${name}\n`);
          }
          profileSymbol.profileCount = (profileSymbol.profileCount + 1) | 0;
        }
        switch (opcode) {
          case QvmOpcode.OP_UNDEF: case QvmOpcode.OP_IGNORE:
            if (debug) throw new CommonError("drop", "Bad VM instruction");
            break;
          case QvmOpcode.OP_BREAK:
            if (counter !== null) throw new Error("QVM counter evaluation cannot trigger a debug break");
            this.breaks = (this.breaks + 1) | 0; break;
          case QvmOpcode.OP_CONST: operands.push(this.codeWord(pc)); pc += 4; break;
          case QvmOpcode.OP_LOCAL: operands.push((sp + this.codeWord(pc)) | 0); pc += 4; break;
          case QvmOpcode.OP_PUSH: operands.reserve(); break;
          case QvmOpcode.OP_POP: operands.drop(); break;
          case QvmOpcode.OP_ENTER: {
            if (debug) profileSymbol = this.symbols.valueToFunctionSymbol(pc);
            const size = this.codeWord(pc);
            if (evaluationFloor !== null && (size < 0 || size % 4 !== 0 || sp - size < evaluationFloor))
              throw new Error("QVM evaluation stack would overlap source data");
            sp = this.stack(sp - size);
            pc += 4;
            if (evaluation != null && !evaluationStarted && pc - 5 === this.targetPC(instructionIndex)) {
              evaluationStarted = true;
              for (const [index, offset] of evaluation.region.inputs.entries()) {
                const value = evaluation.inputs[index]; if (value === undefined) throw new Error("Missing QVM region live-in");
                this.writeWord(sp + offset, value);
              }
              pc = this.targetPC(evaluation.region.entry);
            }
            if (debug) {
              this.writeWord(sp + 4, sp + size);
              if (trace !== 0) {
                print(`${debugString()}---> ${this.symbols.valueToSymbol(pc - 5)}\n`);
                if (profile.kind === "debug" && profile.breakFunction !== 0 && pc - 5 === profile.breakFunction) {
                  this.breaks = (this.breaks + 1) | 0;
                }
                this.callLevel++;
              }
            }
            break;
          }
          case QvmOpcode.OP_LEAVE: {
            sp = this.stack(sp + this.codeWord(pc));
            const target = returns === null ? this.readWord(sp) : returns.pop();
            if (target === undefined || returns !== null && returns.pop() !== sp) throw new Error("QVM function returned with an invalid program stack");
            if (debug) {
              profileSymbol = this.symbols.valueToFunctionSymbol(target);
              if (trace !== 0) {
                this.callLevel--;
                print(`${debugString()}<--- ${this.symbols.valueToSymbol(target)}\n`);
              }
            }
            if (sourceCall !== undefined && sp === sourceCall.stack && (returns === null || returns.length === 0)) {
              if (target !== sourceCall.returnPC || operands.count !== sourceCall.operandDepth + 1) throw new Error("QVM function returned with an invalid caller stack");
              return operands.pop();
            }
            if (target === -1) return operands.result();
            pc = target;
            break;
          }
          case QvmOpcode.OP_CALL: {
            const returnPC = pc;
            this.writeWord(sp, pc);
            const target = operands.pop();
            if (target >= 0) {
              if (counter !== null && !counter.functions.has(target)) throw new Error("QVM counter evaluation called an undeclared source function");
              const binding = counter === null ? this.functionHooks?.get(target) : undefined, observers = counter === null ? this.functionObservers?.get(target) : undefined;
              const hook = counter === null ? binding?.hook ?? this.functionResolver?.resolve(target, this.readWord(sp + 8)) : undefined;
              if (binding === undefined && hook !== undefined && this.codeWord(this.targetPC(target)) !== QvmOpcode.OP_ENTER)
                throw new Error("QVM resolver requires a function entry instruction");
              if (hook === undefined && observers === undefined) { returns?.push(sp, returnPC); pc = this.targetPC(target); }
              else {
                const savedCallLevel = this.callLevel, savedStack = this.programStack;
                this.programStack = sp - 4;
                try {
                  const result = this.intercept(frame, sp, returnPC, target, hook, observers);
                  operands.push(typeof result === "number" ? result : yield result);
                  pc = returns === null ? this.readWord(sp) : returnPC;
                } finally { this.callLevel = savedCallLevel; this.programStack = savedStack; }
              }
            }
            else {
              if (counter !== null) throw new Error("QVM counter evaluation cannot call an engine service");
              if (trace !== 0) print(`${debugString()}---> systemcall(${-1 - target})\n`);
              const savedCallLevel = this.callLevel;
              this.programStack = sp - 4;
              const savedFrame = debug ? this.readWord(sp + 4) : null;
              this.writeWord(sp + 4, -1 - target);
              const result = this.trap(frame, sp);
              const value = typeof result === "number" ? result : yield result;
              if (savedFrame !== null) this.writeWord(sp + 4, savedFrame);
              operands.push(value);
              pc = returns === null ? this.readWord(sp) : returnPC;
              this.callLevel = savedCallLevel;
              if (trace !== 0) print(`${debugString()}<--- ${this.symbols.valueToSymbol(pc)}\n`);
            }
            break;
          }
          case QvmOpcode.OP_JUMP: pc = this.targetPC(operands.pop()); break;
          case QvmOpcode.OP_LOAD1: {
            const address = operands.peek() & this.dataMask;
            if (counter !== null) this.counterRead(address, 1);
            operands.set(this.data.getUint8(address));
            break;
          }
          case QvmOpcode.OP_LOAD2: {
            const address = operands.peek() & this.dataMask;
            this.range(address, 2);
            if (counter !== null) this.counterRead(address, 2);
            operands.set(this.data.getUint16(address, true));
            break;
          }
          case QvmOpcode.OP_LOAD4:
            if (debug && (operands.peek() & 3) !== 0) throw new CommonError("drop", "OP_LOAD4 misaligned");
            operands.set(this.readWord(operands.peek() & this.dataMask));
            break;
          case QvmOpcode.OP_STORE1: {
            const value = operands.pop();
            const address = operands.pop() & this.dataMask;
            if (counter !== null) this.counterWrite(address, 1, value);
            (this.counterEvaluation === null && this.addressSpace.observesWrites ? this.observedData : this.data).setUint8(address, value);
            break;
          }
          case QvmOpcode.OP_STORE2: {
            const value = operands.pop();
            const address = operands.pop() & (this.dataMask & ~1);
            this.range(address, 2);
            if (counter !== null) this.counterWrite(address, 2, value);
            (this.counterEvaluation === null && this.addressSpace.observesWrites ? this.observedData : this.data).setUint16(address, value, true);
            break;
          }
          case QvmOpcode.OP_STORE4: {
            const value = operands.pop();
            this.writeWord(operands.pop() & (this.dataMask & ~3), value);
            break;
          }
          case QvmOpcode.OP_ARG: this.writeWord(sp + this.codeWord(pc++), operands.pop()); break;
          case QvmOpcode.OP_BLOCK_COPY: {
            if (counter !== null) throw new Error("QVM counter evaluation cannot copy source memory");
            const source = operands.pop();
            const destination = operands.pop();
            const count = this.codeWord(pc);
            pc += 4;
            if (this.semantics === "interpreted") {
              const from = source & this.dataMask, to = destination & this.dataMask;
              const sourceCount = ((from + count) & this.dataMask) - from;
              const copied = ((to + sourceCount) & this.dataMask) - to;
              if ((from | to | copied) & 3) throw new CommonError("drop", "OP_BLOCK_COPY not dword aligned");
              for (let word = (copied >> 2) - 1; word >= 0; word--) this.writeWord(to + word * 4, this.readWord(from + word * 4));
              break;
            }
            if (count < 0 || source < 0 || destination < 0 || source + count > this.dataMask || destination + count > this.dataMask) {
              throw new CommonError("drop", "OP_BLOCK_COPY out of range");
            }
            // Q3's compiled VM accepts unaligned literals; ioquake's VM_BlockCopy checks bounds and copies bytes.
            this.addressSpace.copyBytes(destination, source, count);
            break;
          }
          case QvmOpcode.OP_BCOM:
            if (this.semantics === "compiled") operands.set(~operands.peek());
            else operands.complementPrevious();
            break;
          case QvmOpcode.OP_SEX8: case QvmOpcode.OP_SEX16: case QvmOpcode.OP_NEGI:
          case QvmOpcode.OP_NEGF: case QvmOpcode.OP_CVIF: case QvmOpcode.OP_CVFI:
            operands.set(evaluateQvmUnary(opcode, operands.peek()));
            break;
          case QvmOpcode.OP_ADD: case QvmOpcode.OP_SUB: case QvmOpcode.OP_DIVI: case QvmOpcode.OP_DIVU:
          case QvmOpcode.OP_MODI: case QvmOpcode.OP_MODU: case QvmOpcode.OP_MULI: case QvmOpcode.OP_MULU:
          case QvmOpcode.OP_BAND: case QvmOpcode.OP_BOR: case QvmOpcode.OP_BXOR:
          case QvmOpcode.OP_LSH: case QvmOpcode.OP_RSHI: case QvmOpcode.OP_RSHU:
          case QvmOpcode.OP_ADDF: case QvmOpcode.OP_SUBF: case QvmOpcode.OP_DIVF: case QvmOpcode.OP_MULF: {
            const right = operands.pop();
            operands.set(evaluateQvmBinary(opcode, operands.peek(), right));
            break;
          }
          case QvmOpcode.OP_EQ: case QvmOpcode.OP_NE:
          case QvmOpcode.OP_LTI: case QvmOpcode.OP_LEI: case QvmOpcode.OP_GTI: case QvmOpcode.OP_GEI:
          case QvmOpcode.OP_LTU: case QvmOpcode.OP_LEU: case QvmOpcode.OP_GTU: case QvmOpcode.OP_GEU:
          case QvmOpcode.OP_EQF: case QvmOpcode.OP_NEF: case QvmOpcode.OP_LTF:
          case QvmOpcode.OP_LEF: case QvmOpcode.OP_GTF: case QvmOpcode.OP_GEF: {
            const right = operands.pop();
            const left = operands.pop();
            const target = this.codeWord(pc);
            const taken = evaluateQvmBranch(opcode, left, right), decide = counter === null ? frame.functionScope?.branches?.get(pc - 1) : undefined;
            if (decide === undefined) pc = taken ? target : pc + 4;
            else {
              const owner = frame.functionScope;
              if (owner === null || !owner.active) throw new Error("QVM branch invocation has expired");
              const result = this.decision(frame, owner, decide, taken);
              const chosen = typeof result === "number" ? result : yield result;
              this.checkCancellation(owner); this.live(); frame.validate();
              if (!owner.active || this.active !== frame) throw new Error("QVM branch invocation is no longer current");
              pc = chosen !== 0 ? target : pc + 4;
            }
            break;
          }
          // The release interpreter has no default trap. A return into an
          // operand slot can therefore encounter a non-opcode integer as a nop.
          default:
            if (debug) throw new CommonError("drop", "Bad VM instruction");
            break;
        }
      }
    } catch (error) {
      this.cancellationFailure(frame.functionScope, error);
      throw error;
    } finally {
      this.programStack = entryStack;
      this.active = previous;
      if (previous !== null) { this.debug = previousDebug; this.callLevel = previousCallLevel; }
    }
  }
}
