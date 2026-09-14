import type { ActorId } from "../../contracts/identity.ts";
import type { ExecutionProfile, GuestCallContext, GuestCallResult, GuestCallValue, GuestCheckpoint, GuestExecutor, GuestLayout,
  GuestPrivateState, ModuleIdentity, QuakeCCheckpoint, RawEntityTable, SavedGuestCallbackBinding } from "../../contracts/execution.ts";
import type { RandomState } from "../../contracts/numeric.ts";
import { BinaryReader, BinaryWriter } from "../../core/binary/index.ts";
import type { QcMachine } from "./machine.ts";

export interface QcHostSavedState {
  readonly state: GuestPrivateState;
  readonly random: readonly RandomState[];
  readonly callbacks: readonly SavedGuestCallbackBinding[];
}
export interface QcExecutorHost {
  checkpoint(): QcHostSavedState;
  restore(saved: QcHostSavedState): undefined;
}
function sameModule(left: ModuleIdentity, right: ModuleIdentity): boolean {
  return left.id === right.id && left.artifactPath === right.artifactPath && left.digest === right.digest && left.revision === right.revision;
}
/** GuestExecutor bridge. Save hooks run only after the source callback returns. */
export class QuakeCExecutor implements GuestExecutor {
  constructor(readonly profile: Extract<ExecutionProfile, { readonly kind: "quakec" }>, readonly machine: QcMachine, private readonly host: QcExecutorHost) {
    if (profile.host.api.kind !== machine.program.api.kind || profile.numeric.id !== machine.numeric.profile.id
      || profile.module.digest !== machine.program.digest) machine.fail("execution profile disagrees with loaded program");
  }
  invoke(context: GuestCallContext, arguments_: readonly GuestCallValue[]): GuestCallResult {
    const callback = context.callback;
    if (callback.kind !== "quakec" || !sameModule(context.module, this.profile.module) || !sameModule(callback.module, this.profile.module)) this.machine.fail("callback belongs to another guest module");
    if (arguments_.length > 8) this.machine.fail("too many QuakeC arguments");
    if (context.self !== null) {
      if (!sameModule(context.self.module, this.profile.module)) this.machine.fail("self belongs to another guest module");
      this.machine.globals.setInt(this.machine.globalOffset("self"), this.machine.entities.reference(context.self.slot));
    }
    if (context.other !== null) {
      if (!sameModule(context.other.module, this.profile.module)) this.machine.fail("other belongs to another guest module");
      this.machine.globals.setInt(this.machine.globalOffset("other"), this.machine.entities.reference(context.other.slot));
    }
    for (let index = 0; index < arguments_.length; index++) {
      const value = arguments_[index];
      if (value === undefined) this.machine.fail("missing argument");
      const offset = 4 + index * 3;
      switch (value.kind) {
        case "int32": case "uint32": this.machine.globals.setInt(offset, value.value); break;
        case "float32": this.machine.globals.setFloat(offset, value.value); break;
        case "aggregate":
          if (value.bytes.length !== 12 || value.layout.byteLength !== 12) this.machine.fail("QuakeC aggregate argument must be three words");
          this.machine.globals.bytes.set(value.bytes, offset * 4); break;
        case "pointer": case "int64": case "uint64": case "float64": this.machine.fail(`QuakeC does not accept ${value.kind} arguments; encode a source word or vector`);
      }
    }
    this.machine.execute(callback.functionIndex, arguments_.length);
    const layout: GuestLayout = { id: "quakec:return-words", byteLength: 12, alignment: 4, pointerBytes: 4, byteOrder: "little-endian", fields: [] };
    return { kind: "aggregate", layout, bytes: this.machine.globals.bytes.slice(4, 16) };
  }
  checkpoint(): QuakeCCheckpoint { return captureQcCheckpoint(this.machine, this.profile.module, this.host); }
  restore(checkpoint: GuestCheckpoint): undefined { return restoreQcCheckpoint(this.machine, this.profile.module, this.host, checkpoint); }
}
export function captureQcCheckpoint(machine: QcMachine, module: ModuleIdentity, hostAdapter: QcExecutorHost): QuakeCCheckpoint {
    const snapshot = machine.snapshot();
    const host = hostAdapter.checkpoint();
    if (!sameModule(host.state.module, module)) machine.fail("host checkpoint belongs to another module");
    const format = new TextEncoder().encode(host.state.format);
    const writer = new BinaryWriter(24 + snapshot.profiling.length * 4 + format.length + host.state.bytes.length);
    writer.u32(0x31484351); writer.u32(snapshot.traceEnabled ? 1 : 0); writer.u32(snapshot.profiling.length);
    for (const count of snapshot.profiling) writer.u32(count >>> 0);
    writer.u32(format.length); writer.bytes(format); writer.u32(host.state.bytes.length); writer.bytes(host.state.bytes);
    writer.u32(machine.entities.layout.variablesOffsetBytes);
    return { kind: "quakec", module: module, api: machine.program.api, random: host.random, callbacks: host.callbacks,
      globals: snapshot.globals, entities: snapshot.entities, entityStrideBytes: machine.entities.layout.strideBytes, entityCount: snapshot.entityCount,
      strings: snapshot.strings, statement: snapshot.statement, functionIndex: snapshot.functionIndex, argumentCount: snapshot.argumentCount,
      callStack: [], locals: new Uint8Array(), hostState: { module: module, format: "quakec:host-v1", bytes: writer.finish() } };
  }

export function restoreQcCheckpoint(machine: QcMachine, module: ModuleIdentity, hostAdapter: QcExecutorHost, checkpoint: GuestCheckpoint): undefined {
    if (checkpoint.kind !== "quakec" || !sameModule(checkpoint.module, module) || checkpoint.api.kind !== machine.program.api.kind || checkpoint.api.programVersion !== machine.program.api.programVersion || checkpoint.api.systemCrc !== machine.program.api.systemCrc || !sameModule(checkpoint.hostState.module, module)) machine.fail("incompatible QuakeC checkpoint");
    if (checkpoint.callStack.length !== 0 || checkpoint.locals.length !== 0 || checkpoint.functionIndex !== 0) machine.fail("checkpoint is not at an idle callback boundary");
    if (checkpoint.entityStrideBytes !== machine.entities.layout.strideBytes || checkpoint.hostState.format !== "quakec:host-v1") machine.fail("checkpoint layout mismatch");
    const reader = new BinaryReader(checkpoint.hostState.bytes, "QuakeC host checkpoint");
    if (reader.u32() !== 0x31484351) machine.fail("unknown QuakeC host checkpoint");
    const traceEnabled = reader.u32() !== 0; const count = reader.u32(); const profiling: number[] = [];
    for (let index = 0; index < count; index++) profiling.push(reader.u32());
    const format = new TextDecoder("utf-8", { fatal: true }).decode(reader.bytes(reader.u32()));
    const stateBytes = reader.bytes(reader.u32());
    const variablesOffset = reader.u32();
    if (variablesOffset !== machine.entities.layout.variablesOffsetBytes || reader.remaining !== 0) machine.fail("checkpoint entity variable offset mismatch");
    const separator = format.indexOf(":");
    if (separator < 1 || separator === format.length - 1) machine.fail("invalid host state format");
    const stateFormat: `${string}:${string}` = `${format.slice(0, separator)}:${format.slice(separator + 1)}`;
    machine.restore({ globals: checkpoint.globals, entities: checkpoint.entities, entityCount: checkpoint.entityCount, strings: checkpoint.strings,
      statement: checkpoint.statement, functionIndex: checkpoint.functionIndex, argumentCount: checkpoint.argumentCount, profiling, traceEnabled });
    hostAdapter.restore({ random: checkpoint.random, callbacks: checkpoint.callbacks,
      state: { module: module, format: stateFormat, bytes: stateBytes } });
  }
/** Exposes complete live edict records and resolves actor authority on every access. */
export function createQcRawEntityTable(machine: QcMachine, module: ModuleIdentity, layout: GuestLayout, currentActor: (slot: number) => ActorId | null): RawEntityTable {
  const addressSpace = Symbol(`quakec:${module.id}`);
  const strideBytes = machine.entities.layout.strideBytes;
  if (layout.byteLength > strideBytes) machine.fail("public layout exceeds QuakeC entity record");
  function atSlot(slot: number) {
    const offset = machine.entities.reference(slot);
    return { module, slot, address: { kind: "guest-address", addressSpace, byteOffset: BigInt(offset) }, strideBytes, publicLayout: layout,
      bytes: new DataView(machine.entities.bytes.buffer, machine.entities.bytes.byteOffset + offset, strideBytes), currentActor: () => currentActor(slot) } satisfies ReturnType<RawEntityTable["atSlot"]>;
  }
  return { module, base: { kind: "guest-address", addressSpace, byteOffset: 0n }, strideBytes,
    get count() { return machine.entities.count; }, capacity: machine.entities.capacity, layout, atSlot,
    fromPointer: address => {
      if (address.addressSpace !== addressSpace || address.byteOffset < 0n || address.byteOffset > 0x7fffffffn) machine.fail("entity address belongs to another address space");
      return atSlot(machine.entities.slot(Number(address.byteOffset)));
    } };
}
