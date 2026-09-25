import type { ExecutionProfile, GuestCallbackReference, GuestCallContext, GuestCallResult, GuestCallValue, GuestCheckpoint, GuestExecutor, GuestPrivateState, ModuleIdentity, Q3ApiIdentity, QvmCheckpoint, SavedGuestCallbackBinding, QvmAbiProfile } from "../../contracts/execution.ts";
import type { NumericProfile, RandomState } from "../../contracts/numeric.ts";
import { float32ToBits } from "../../core/numeric.ts";
import { CommonError } from "../../core/common-error.ts";
import { QvmUiExport } from "./abi.ts";
import type { ResolvedQvmArtifact } from "./artifacts.ts";
import type { QvmAllocationProfile } from "./allocation.ts";
import { QvmGuestMemory } from "./guest-memory.ts";
import { QvmInterpreter } from "./interpreter.ts";
import type { QvmArguments, QvmEvaluationStack, QvmCancellationScope, QvmFunctionHook, QvmFunctionObserver, QvmFunctionResolver, QvmSyscall } from "./interpreter.ts";
import { parseQvmRestart } from "./image.ts";
import type { QvmMemory } from "./memory.ts";
import type { QvmRegionEvaluation } from "./regions.ts";
import type { VmRegistration } from "./registry.ts";
import { createQvmSystemCall } from "./syscalls.ts";
import type { QvmHost, QvmRole } from "./syscalls.ts";

export const qvmNumericProfile: NumericProfile = {
  id: "q3:qvm-interpreted", arithmetic: { kind: "binary32", round: "each-operation" },
  scalarStorage: "binary32", floatToInt: "qvm-indefinite", integerOverflow: "wrap32",
};
export function qvmApi(role: QvmRole, profile: QvmAbiProfile = "q3-modern"): Q3ApiIdentity {
  switch (role) {
    case "qagame": return { kind: "q3-qagame", version: profile === "q3-modern" ? 8 : 7 };
    case "cgame": return { kind: "q3-cgame", version: profile === "q3-modern" ? 4 : 3 };
    case "ui": return { kind: "q3-ui", version: profile === "q3-modern" ? 6 : 4 };
  }
}
export interface QvmHostCheckpoint {
  readonly state: GuestPrivateState;
  readonly random: readonly RandomState[];
  readonly callbacks: readonly SavedGuestCallbackBinding[];
}
export interface QvmHostState {
  readonly checkpoint: () => QvmHostCheckpoint;
  readonly restore: (state: QvmHostCheckpoint) => undefined;
}
export interface QvmModuleOptions {
  readonly artifact: Extract<ResolvedQvmArtifact, { readonly kind: "bytecode" }>;
  readonly host: QvmHost;
  readonly allocation?: QvmAllocationProfile;
  readonly registration?: VmRegistration;
  readonly hostState?: QvmHostState;
}
export function qvmArguments(words: readonly number[]): QvmArguments {
  if (words.length > 10) throw new RangeError("QVM entry accepts at most ten argument words");
  return [words[0] ?? 0, words[1] ?? 0, words[2] ?? 0, words[3] ?? 0, words[4] ?? 0,
    words[5] ?? 0, words[6] ?? 0, words[7] ?? 0, words[8] ?? 0, words[9] ?? 0];
}
function sameModule(left: ModuleIdentity, right: ModuleIdentity): boolean {
  return left.id === right.id && left.digest === right.digest && left.artifactPath === right.artifactPath && left.revision === right.revision;
}

const deferredUiInitialization = Symbol("deferred UI API validation");

/** One source VM instance. Reentry is scoped to the suspended host call. */
export class QvmModule implements GuestExecutor {
  private executionProfile: Extract<ExecutionProfile, { readonly kind: "qvm" }>;
  get abiProfile(): QvmAbiProfile { return this.options.artifact.abiProfile ?? "q3-modern"; }
  get profile(): Extract<ExecutionProfile, { readonly kind: "qvm" }> { return this.executionProfile; }
  readonly interpreter: QvmInterpreter;
  readonly memory: QvmMemory;
  readonly guestMemory: QvmGuestMemory;
  private currentEntry: Pick<QvmSyscall, "invoke" | "invokeAsync" | "cancelFunction"> | null = null;
  private currentCommandArguments: readonly string[] | null = null;
  private retired = false;

  cancelFunction(scope: QvmCancellationScope): never {
    if (this.currentEntry === null) throw new Error("QVM cancellation requires the current source invocation");
    return this.currentEntry.cancelFunction(scope);
  }

  constructor(private readonly options: QvmModuleOptions, initialization?: typeof deferredUiInitialization) {
    const artifact = options.artifact;
    this.executionProfile = { kind: "qvm", module: artifact.module, api: qvmApi(artifact.role, this.abiProfile), magic: 0x12721444, numeric: qvmNumericProfile };
    const systemCall = createQvmSystemCall(artifact.role, options.host, () => this.currentCommandArguments, this.abiProfile);
    this.interpreter = new QvmInterpreter(artifact.image, call => {
      const previous = this.currentEntry;
      this.currentEntry = call;
      try { return systemCall(call); }
      finally { this.currentEntry = previous; }
    }, options.allocation, options.registration, "compiled", (scope, perform) => {
      const previous = this.currentEntry; this.currentEntry = scope;
      try { return perform(); } finally { this.currentEntry = previous; }
    });
    this.memory = this.interpreter.addressSpace;
    this.guestMemory = new QvmGuestMemory(artifact.module, this.memory);
    if (artifact.role === "ui" && initialization !== deferredUiInitialization) {
      try { this.validateUiVersion(this.call([QvmUiExport.UI_GETAPIVERSION])); }
      catch (error) { this.retire(); throw error; }
    }
  }

  static async create(options: QvmModuleOptions, validate: () => void = () => {}): Promise<QvmModule> {
    const module = new QvmModule(options, deferredUiInitialization);
    try {
      if (options.artifact.role === "ui") module.validateUiVersion(await module.callAsync([QvmUiExport.UI_GETAPIVERSION], 0, validate));
      else validate();
      return module;
    } catch (error) { module.retire(); throw error; }
  }

  private validateUiVersion(version: number): void {
    if (this.abiProfile !== "q3-modern" && version !== 4) throw new CommonError("drop", `Legacy User Interface is version ${version}, expected 4`);
    if (version !== 4 && version !== 6) throw new CommonError("drop", `User Interface is version ${version}, expected 6`);
    this.executionProfile = { ...this.executionProfile, api: { kind: "q3-ui", version } };
  }

  private live(): void {
    this.memory.assertNotPublishing();
    this.assertOwner();
  }

  private assertOwner(): void {
    this.memory.assertLive();
    if (this.retired) throw new Error(`${this.options.artifact.role} QVM module has been retired`);
  }

  bindFunction(reference: Extract<GuestCallbackReference, { readonly kind: "qvm" }>, hook: QvmFunctionHook): () => void {
    return this.bindEntry(reference, hook, "calls");
  }

  bindInvocation(reference: Extract<GuestCallbackReference, { readonly kind: "qvm" }>, hook: QvmFunctionHook): () => void {
    return this.bindEntry(reference, hook, "invocations");
  }

  private bindEntry(reference: Extract<GuestCallbackReference, { readonly kind: "qvm" }>, hook: QvmFunctionHook, scope: "calls" | "invocations"): () => void {
    this.live();
    if (!sameModule(reference.module, this.profile.module)) throw new Error("QVM function hook belongs to a different module artifact");
    const wrapped: QvmFunctionHook = call => {
      this.live();
      const previous = this.currentEntry;
      this.currentEntry = call;
      try { return hook(call); }
      finally { this.currentEntry = previous; }
    };
    return scope === "calls" ? this.interpreter.bindFunction(reference.instructionIndex, wrapped) : this.interpreter.bindInvocation(reference.instructionIndex, wrapped);
  }

  bindFunctionResolver(resolve: QvmFunctionResolver): () => void {
    this.live();
    const wrappers = new WeakMap<QvmFunctionHook, QvmFunctionHook>();
    return this.interpreter.bindFunctionResolver((entry, firstArgument, words) => {
      const hook = resolve(entry, firstArgument, words); if (hook === undefined) return undefined;
      let wrapped = wrappers.get(hook);
      if (wrapped === undefined) {
        wrapped = call => {
          this.live();
          const previous = this.currentEntry; this.currentEntry = call;
          try { return hook(call); } finally { this.currentEntry = previous; }
        };
        wrappers.set(hook, wrapped);
      }
      return wrapped;
    });
  }

  observeFunction(reference: Extract<GuestCallbackReference, { readonly kind: "qvm" }>, observe: QvmFunctionObserver): () => void {
    this.assertOwner();
    if (!sameModule(reference.module, this.profile.module)) throw new Error("QVM function observer belongs to a different module artifact");
    return this.interpreter.observeFunction(reference.instructionIndex, call => {
      this.live();
      const previous = this.currentEntry; this.currentEntry = call;
      try { return observe(call); }
      finally { this.currentEntry = previous; }
    });
  }

  call(words: readonly number[], instructionIndex = 0): number {
    this.live();
    this.options.registration?.called();
    const arguments_ = instructionIndex === 0 || words.length <= 10 ? qvmArguments(words) : words;
    return this.currentEntry === null ? this.interpreter.invoke(arguments_, instructionIndex) : this.currentEntry.invoke(arguments_, instructionIndex);
  }

  evaluateRegion(words: readonly number[], instructionIndex: number, region: QvmRegionEvaluation, inputs: readonly number[], stack?: QvmEvaluationStack): number {
    this.live();
    const arguments_ = instructionIndex === 0 || words.length <= 10 ? qvmArguments(words) : words, evaluation = { region, inputs, ...(stack === undefined ? {} : { stack }) };
    return this.currentEntry === null ? this.interpreter.invoke(arguments_, instructionIndex, evaluation)
      : this.currentEntry.invoke(arguments_, instructionIndex, evaluation);
  }

  evaluateCounter(words: readonly number[], instructionIndex: number, address: number, functions: readonly number[], stack?: QvmEvaluationStack): number {
    this.live();
    if (!functions.includes(instructionIndex)) throw new Error("Counter operation lacks its original entry");
    return this.interpreter.evaluateCounter(address, 0, functions, () => this.call(words, instructionIndex), stack);
  }

  async callAsync(words: readonly number[], instructionIndex = 0, validate: () => void = () => {}): Promise<number> {
    this.live();
    this.options.registration?.called();
    const arguments_ = instructionIndex === 0 || words.length <= 10 ? qvmArguments(words) : words;
    const current = (): void => { this.live(); validate(); };
    current();
    const result = this.currentEntry === null
      ? await this.interpreter.invokeAsync(arguments_, instructionIndex, current)
      : await this.currentEntry.invokeAsync(arguments_, instructionIndex, current);
    current();
    return result;
  }

  async commandAsync(words: readonly number[], arguments_: readonly string[], validate: () => void = () => {}): Promise<number> {
    if (this.interpreter.isActive && this.currentEntry === null) throw new Error("QVM is already active; command arguments belong to the current invocation");
    const previous = this.currentCommandArguments;
    this.currentCommandArguments = arguments_;
    try { return await this.callAsync(words, 0, validate); }
    finally { this.currentCommandArguments = previous; }
  }

  command(words: readonly number[], arguments_: readonly string[]): number {
    const previous = this.currentCommandArguments;
    this.currentCommandArguments = arguments_;
    try { return this.call(words); }
    finally { this.currentCommandArguments = previous; }
  }

  invoke(context: GuestCallContext, arguments_: readonly GuestCallValue[]): GuestCallResult {
    const callback = context.callback;
    if (callback.kind !== "qvm" || !sameModule(callback.module, this.profile.module) || !sameModule(context.module, this.profile.module)) {
      throw new Error("QVM callback belongs to a different execution owner");
    }
    const words = arguments_.map(value => {
      switch (value.kind) {
        case "int32": return value.value;
        case "uint32": {
          if (!Number.isInteger(value.value) || value.value < 0 || value.value > 0xffffffff) throw new RangeError("Invalid QVM unsigned word");
          return value.value | 0;
        }
        case "float32": return float32ToBits(value.value) | 0;
        case "pointer": {
          if (value.value === null) return 0;
          this.guestMemory.borrow(value.value, 0);
          // A nonnull masked pointer at zero must retain a nonzero guest representation.
          const offset = Number(value.value.byteOffset);
          return offset === 0 ? this.memory.bytes.length : offset;
        }
        case "int64": case "uint64": case "float64": case "aggregate":
          throw new Error(`QVM callback requires ABI lowering for ${value.kind}`);
      }
    });
    return { kind: "int32", value: this.call(words, callback.instructionIndex) };
  }

  restart(bytes: Uint8Array): void {
    this.live();
    this.interpreter.restart(parseQvmRestart(bytes, this.profile.module.artifactPath));
  }

  checkpoint(): QvmCheckpoint {
    this.live();
    if (this.interpreter.isActive) throw new Error("QVM checkpoints require a completed source call");
    const state = this.options.hostState;
    if (state === undefined) throw new Error("QVM host has not bound checkpoint services");
    const host = state.checkpoint();
    if (!sameModule(host.state.module, this.profile.module)) throw new Error("QVM host checkpoint belongs to another module");
    return {
      kind: "qvm", module: this.profile.module, api: this.profile.api, abiProfile: this.abiProfile,
      data: this.memory.bytes.slice(), instructionIndex: 0, programStack: this.interpreter.stackPointer,
      operandStack: [], random: host.random, callbacks: host.callbacks,
      hostState: { ...host.state, bytes: host.state.bytes.slice() },
    };
  }

  restore(checkpoint: GuestCheckpoint): undefined {
    this.live();
    if (this.interpreter.isActive) throw new Error("Cannot restore an active QVM");
    if (checkpoint.kind !== "qvm" || (checkpoint.abiProfile ?? "q3-modern") !== this.abiProfile || !sameModule(checkpoint.module, this.profile.module)
      || checkpoint.api.kind !== this.profile.api.kind || checkpoint.api.version !== this.profile.api.version
      || !sameModule(checkpoint.hostState.module, this.profile.module)) throw new Error("QVM checkpoint artifact or API mismatch");
    if (checkpoint.instructionIndex !== 0 || checkpoint.operandStack.length !== 0 || checkpoint.programStack !== this.memory.bytes.length) {
      throw new Error("QVM checkpoint contains a suspended execution stack");
    }
    const state = this.options.hostState;
    if (state === undefined) throw new Error("QVM host has not bound checkpoint services");
    this.interpreter.restoreData(checkpoint.data);
    state.restore({ state: checkpoint.hostState, random: checkpoint.random, callbacks: checkpoint.callbacks });
  }

  retire(): void { this.memory.close(); this.retired = true; this.options.registration?.free(); }
}
