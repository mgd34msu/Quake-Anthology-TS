// SPDX-License-Identifier: GPL-2.0-or-later
import type { ActorId } from "../../contracts/identity.ts";
import type {
  GuestCheckpoint,
  GuestLayout,
  GuestPrivateState,
  ModuleIdentity,
  QuakeCCheckpoint,
  RawEntityTable,
  SavedGuestCallbackBinding,
} from "../../contracts/execution.ts";
import type { RandomState } from "../../contracts/numeric.ts";
import { BinaryReader, BinaryWriter } from "../../core/binary/index.ts";
import type { QcMachine, QcMachineSnapshot } from "./machine.ts";

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
export function captureQcCheckpoint(machine: QcMachine, module: ModuleIdentity, hostAdapter: QcExecutorHost): QuakeCCheckpoint {
  const snapshot = machine.snapshot();
  const host = hostAdapter.checkpoint();
  if (!sameModule(host.state.module, module)) machine.fail("host checkpoint belongs to another module");
  const format = new TextEncoder().encode(host.state.format);
  const writer = new BinaryWriter(24 + snapshot.profiling.length * 4 + format.length + host.state.bytes.length);
  writer.u32(0x31484351);
  writer.u32(snapshot.traceEnabled ? 1 : 0);
  writer.u32(snapshot.profiling.length);
  for (const count of snapshot.profiling) writer.u32(count >>> 0);
  writer.u32(format.length);
  writer.bytes(format);
  writer.u32(host.state.bytes.length);
  writer.bytes(host.state.bytes);
  writer.u32(machine.entities.layout.variablesOffsetBytes);
  return {
    kind: "quakec",
    module: module,
    api: machine.program.api,
    random: host.random,
    callbacks: host.callbacks,
    globals: snapshot.globals,
    entities: snapshot.entities,
    entityStrideBytes: machine.entities.layout.strideBytes,
    entityCount: snapshot.entityCount,
    strings: snapshot.strings,
    statement: snapshot.statement,
    functionIndex: snapshot.functionIndex,
    argumentCount: snapshot.argumentCount,
    callStack: [],
    locals: new Uint8Array(),
    hostState: { module: module, format: "quakec:host-v1", bytes: writer.finish() },
  };
}

/** Validates and decodes a checkpoint without touching the machine or host, so a corrupt save fails before any state is released. */
export function preflightQcCheckpoint(
  machine: QcMachine,
  module: ModuleIdentity,
  checkpoint: GuestCheckpoint,
): { readonly snapshot: QcMachineSnapshot; readonly state: QcHostSavedState["state"] } {
  if (
    checkpoint.kind !== "quakec" ||
    !sameModule(checkpoint.module, module) ||
    checkpoint.api.kind !== machine.program.api.kind ||
    checkpoint.api.programVersion !== machine.program.api.programVersion ||
    checkpoint.api.systemCrc !== machine.program.api.systemCrc ||
    !sameModule(checkpoint.hostState.module, module)
  )
    machine.fail("incompatible QuakeC checkpoint");
  if (checkpoint.callStack.length !== 0 || checkpoint.locals.length !== 0 || checkpoint.functionIndex !== 0)
    machine.fail("checkpoint is not at an idle callback boundary");
  if (checkpoint.entityStrideBytes !== machine.entities.layout.strideBytes || checkpoint.hostState.format !== "quakec:host-v1")
    machine.fail("checkpoint layout mismatch");
  const reader = new BinaryReader(checkpoint.hostState.bytes, "QuakeC host checkpoint");
  if (reader.u32() !== 0x31484351) machine.fail("unknown QuakeC host checkpoint");
  const traceEnabled = reader.u32() !== 0;
  const count = reader.u32();
  const profiling: number[] = [];
  for (let index = 0; index < count; index++) profiling.push(reader.u32());
  const format = new TextDecoder("utf-8", { fatal: true }).decode(reader.bytes(reader.u32()));
  const stateBytes = reader.bytes(reader.u32());
  const variablesOffset = reader.u32();
  if (variablesOffset !== machine.entities.layout.variablesOffsetBytes || reader.remaining !== 0) machine.fail("checkpoint entity variable offset mismatch");
  const separator = format.indexOf(":");
  if (separator < 1 || separator === format.length - 1) machine.fail("invalid host state format");
  const stateFormat: `${string}:${string}` = `${format.slice(0, separator)}:${format.slice(separator + 1)}`;
  const snapshot: QcMachineSnapshot = {
    globals: checkpoint.globals,
    entities: checkpoint.entities,
    entityCount: checkpoint.entityCount,
    strings: checkpoint.strings,
    statement: checkpoint.statement,
    functionIndex: checkpoint.functionIndex,
    argumentCount: checkpoint.argumentCount,
    profiling,
    traceEnabled,
  };
  machine.validateSnapshot(snapshot);
  return { snapshot, state: { module: module, format: stateFormat, bytes: stateBytes } };
}
export function restoreQcCheckpoint(machine: QcMachine, module: ModuleIdentity, hostAdapter: QcExecutorHost, checkpoint: GuestCheckpoint): undefined {
  const { snapshot, state } = preflightQcCheckpoint(machine, module, checkpoint);
  machine.restore(snapshot);
  hostAdapter.restore({ random: checkpoint.random, callbacks: checkpoint.callbacks, state });
  return undefined;
}
/** Exposes complete live edict records and resolves actor authority on every access. */
export function createQcRawEntityTable(
  machine: QcMachine,
  module: ModuleIdentity,
  layout: GuestLayout,
  currentActor: (slot: number) => ActorId | null,
): RawEntityTable {
  const addressSpace = Symbol(`quakec:${module.id}`);
  const strideBytes = machine.entities.layout.strideBytes;
  if (layout.byteLength > strideBytes) machine.fail("public layout exceeds QuakeC entity record");
  function atSlot(slot: number) {
    const offset = machine.entities.reference(slot);
    return {
      module,
      slot,
      address: { kind: "guest-address", addressSpace, byteOffset: BigInt(offset) },
      strideBytes,
      publicLayout: layout,
      bytes: new DataView(machine.entities.bytes.buffer, machine.entities.bytes.byteOffset + offset, strideBytes),
      currentActor: () => currentActor(slot),
    } satisfies ReturnType<RawEntityTable["atSlot"]>;
  }
  return {
    module,
    base: { kind: "guest-address", addressSpace, byteOffset: 0n },
    strideBytes,
    get count() {
      return machine.entities.count;
    },
    capacity: machine.entities.capacity,
    layout,
    atSlot,
    fromPointer: address => {
      if (address.addressSpace !== addressSpace || address.byteOffset < 0n || address.byteOffset > 0x7fffffffn)
        machine.fail("entity address belongs to another address space");
      return atSlot(machine.entities.slot(Number(address.byteOffset)));
    },
  };
}
