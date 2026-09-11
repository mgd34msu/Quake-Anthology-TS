/* ED_ClearEdict / ED_Free from Quake pr_edict.c. GPL-2.0-or-later. */
import type { SourceSlotStorage, SourceActorSlots, SessionActorRegistry } from "../../world/actors/index.ts";
import type { QcBuiltinServices, QcHostBuiltinName } from "./builtins.ts";
import type { QcBuiltin, QcMachine } from "./machine.ts";
import type { QcEntityMemory } from "./memory.ts";
import { QcProgramError } from "./program.ts";

export interface QcEdictMetadataLayout { readonly freeOffsetBytes: number; readonly freeTimeOffsetBytes: number; }
/** Metadata offsets are explicit because native host edict prefixes differ by ABI. */
export function createQcSourceSlotStorage(machine: Pick<QcMachine, "program" | "entities">, metadata: QcEdictMetadataLayout): SourceSlotStorage {
  for (const offset of [metadata.freeOffsetBytes, metadata.freeTimeOffsetBytes]) {
    if (!Number.isInteger(offset) || offset < 0 || offset + 4 > machine.entities.layout.variablesOffsetBytes || offset % 4 !== 0) throw new RangeError("QC edict metadata must reside in the source prefix");
  }
  const bytes = machine.entities.bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const free = (slot: number): number => machine.entities.reference(slot) + metadata.freeOffsetBytes;
  const freeTime = (slot: number): number => machine.entities.reference(slot) + metadata.freeTimeOffsetBytes;
  function fieldOffset(name: string): number {
    const field = machine.program.fieldsByName.get(name);
    if (field === undefined) throw new QcProgramError(`missing entity field ${name}`);
    return field.offset;
  }
  const cleared = ["model", "takedamage", "modelindex", "colormap", "skin", "frame", "solid"].map(fieldOffset);
  const origin = fieldOffset("origin"); const angles = fieldOffset("angles"); const nextthink = fieldOffset("nextthink");
  return {
    count: () => machine.entities.count,
    setCount: count => { machine.entities.setCount(count); },
    read: slot => ({ free: view.getInt32(free(slot), true) !== 0, freedAt: { kind: "seconds", value: view.getFloat32(freeTime(slot), true) } }),
    initialize: slot => { machine.entities.at(slot).bytes.fill(0); view.setInt32(free(slot), 0, true); },
    clearFreed: (slot, now) => {
      if (now.kind !== "seconds") throw new QcProgramError("QC source free time must use seconds");
      view.setInt32(free(slot), 1, true);
      const fields = machine.entities.at(slot);
      for (const field of cleared) fields.setInt(field, 0);
      fields.setVector(origin, { x: 0, y: 0, z: 0 });
      fields.setVector(angles, { x: 0, y: 0, z: 0 });
      fields.setFloat(nextthink, -1);
      view.setFloat32(freeTime(slot), now.value, true);
    },
    canFree: () => true,
  };
}
/** Builtins share the registry's actor ownership, while QC continues to hold source slot offsets. */
export function createQcActorBindings(entities: QcEntityMemory, actors: SessionActorRegistry, slots: SourceActorSlots): Pick<QcBuiltinServices, "host" | "isFreeEntity"> {
  if (slots.options.capacity !== entities.capacity) throw new QcProgramError("actor slot capacity disagrees with QC storage");
  const host = new Map<QcHostBuiltinName, QcBuiltin>();
  host.set("spawn", called => {
    if (called.entities !== entities) called.fail("actor builtin belongs to another machine");
    const actor = slots.allocate("quakec:dynamic");
    const source = actors.sourceOf(actor.id);
    if (source === null || source.provider !== slots.options.provider) return called.fail("allocated actor has no QC source slot");
    called.returnInt(called.entities.reference(source.slot));
  });
  host.set("remove", called => {
    if (called.entities !== entities) called.fail("actor builtin belongs to another machine");
    const slot = called.entities.slot(called.argInt(0));
    const actor = slots.at(slot);
    if (actor !== null) slots.free(actor);
    else slots.options.storage.clearFreed(slot, slots.options.now());
  });
  return { host, isFreeEntity: slot => slots.options.storage.read(slot).free };
}
