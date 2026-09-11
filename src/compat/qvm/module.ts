import type { ExecutionProfile, GuestCallContext, GuestCallResult, GuestCallValue, GuestCheckpoint, GuestExecutor, GuestPrivateState, ModuleIdentity, Q3ApiIdentity, QvmCheckpoint, SavedGuestCallbackBinding } from "../../contracts/execution.ts";
import type { NumericProfile, RandomState } from "../../contracts/numeric.ts";
import { float32ToBits } from "../../core/numeric.ts";
import { CommonError } from "../../core/common-error.ts";
import { QvmUiExport } from "./abi.ts";
import type { ResolvedQvmArtifact } from "./artifacts.ts";
import type { QvmAllocationProfile } from "./allocation.ts";
import { QvmGuestMemory } from "./guest-memory.ts";
import { QvmInterpreter } from "./interpreter.ts";
import type { QvmArguments, QvmSyscall } from "./interpreter.ts";
import { parseQvmRestart } from "./image.ts";
import { QvmMemory } from "./memory.ts";
import type { VmRegistration } from "./registry.ts";
import { createQvmSystemCall } from "./syscalls.ts";
import type { QvmHost, QvmRole } from "./syscalls.ts";

export const qvmNumericProfile: NumericProfile = {
  id: "q3:qvm-interpreted", arithmetic: { kind: "binary32", round: "each-operation" },
  scalarStorage: "binary32", floatToInt: "qvm-indefinite", integerOverflow: "wrap32",
};
export function qvmApi(role: QvmRole): Q3ApiIdentity {
  switch (role) {
    case "qagame": return { kind: "q3-qagame", version: 8 };
    case "cgame": return { kind: "q3-cgame", version: 4 };
    case "ui": return { kind: "q3-ui", version: 6 };
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

/** One source VM instance. Reentry is scoped to the suspended host call. */
export class QvmModule implements GuestExecutor {
  readonly profile: Extract<ExecutionProfile, { readonly kind: "qvm" }>;
  readonly interpreter: QvmInterpreter;
  readonly memory: QvmMemory;
  readonly guestMemory: QvmGuestMemory;
  private currentSyscall: QvmSyscall | null = null;
  private currentCommandArguments: readonly string[] | null = null;
  private retired = false;

  constructor(private readonly options: QvmModuleOptions) {
    const artifact = options.artifact;
    this.profile = { kind: "qvm", module: artifact.module, api: qvmApi(artifact.role), magic: 0x12721444, numeric: qvmNumericProfile };
    const systemCall = createQvmSystemCall(artifact.role, options.host, () => this.currentCommandArguments);
    this.interpreter = new QvmInterpreter(artifact.image, call => {
      const previous = this.currentSyscall;
      this.currentSyscall = call;
      try { return systemCall(call); }
      finally { this.currentSyscall = previous; }
    }, options.allocation, options.registration);
    this.memory = new QvmMemory(this.interpreter.memory);
    this.guestMemory = new QvmGuestMemory(artifact.module, this.memory);
    if (artifact.role === "ui") {
      const version = this.call([QvmUiExport.UI_GETAPIVERSION]);
      if (version !== 4 && version !== 6) throw new CommonError("drop", `User Interface is version ${version}, expected 6`);
      this.profile = { ...this.profile, api: { kind: "q3-ui", version } };
    }
  }

  private live(): void {
    if (this.retired) throw new Error(`${this.options.artifact.role} QVM module has been retired`);
  }

  call(words: readonly number[], instructionIndex = 0): number {
    this.live();
    this.options.registration?.called();
    const arguments_ = qvmArguments(words);
    return this.currentSyscall === null ? this.interpreter.invoke(arguments_, instructionIndex) : this.currentSyscall.invoke(arguments_, instructionIndex);
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
      kind: "qvm", module: this.profile.module, api: this.profile.api,
      data: this.memory.bytes.slice(), instructionIndex: 0, programStack: this.interpreter.stackPointer,
      operandStack: [], random: host.random, callbacks: host.callbacks,
      hostState: { ...host.state, bytes: host.state.bytes.slice() },
    };
  }

  restore(checkpoint: GuestCheckpoint): undefined {
    this.live();
    if (this.interpreter.isActive) throw new Error("Cannot restore an active QVM");
    if (checkpoint.kind !== "qvm" || !sameModule(checkpoint.module, this.profile.module)
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

  retire(): void { this.retired = true; this.options.registration?.free(); }
}
