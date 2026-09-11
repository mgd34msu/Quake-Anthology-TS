import type { GuestLayout, RawEntityTable, RawEntityView } from "../../contracts/execution.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { QvmGameData } from "./game-data.ts";
import type { QvmGuestMemory } from "./guest-memory.ts";
import type { QvmMemory } from "./memory.ts";

export const qvmSharedEntityLayout: GuestLayout = {
  id: "q3:shared-entity-qvm32", byteLength: 516, alignment: 4, pointerBytes: 4, byteOrder: "little-endian",
  fields: [
    { name: "s", byteOffset: 0, storage: "uint8", count: 208 },
    { name: "r.s", byteOffset: 208, storage: "uint8", count: 208 },
    { name: "r.linked", byteOffset: 416, storage: "int32", count: 1 },
    { name: "r.linkcount", byteOffset: 420, storage: "int32", count: 1 },
    { name: "r.svFlags", byteOffset: 424, storage: "int32", count: 1 },
    { name: "r.singleClient", byteOffset: 428, storage: "int32", count: 1 },
    { name: "r.bmodel", byteOffset: 432, storage: "int32", count: 1 },
    { name: "r.mins", byteOffset: 436, storage: "float32", count: 3 },
    { name: "r.maxs", byteOffset: 448, storage: "float32", count: 3 },
    { name: "r.contents", byteOffset: 460, storage: "int32", count: 1 },
    { name: "r.absmin", byteOffset: 464, storage: "float32", count: 3 },
    { name: "r.absmax", byteOffset: 476, storage: "float32", count: 3 },
    { name: "r.currentOrigin", byteOffset: 488, storage: "float32", count: 3 },
    { name: "r.currentAngles", byteOffset: 500, storage: "float32", count: 3 },
    { name: "r.ownerNum", byteOffset: 512, storage: "int32", count: 1 },
  ],
};

/** Capture a located source table; old pointer views retain their original storage after relocation. */
export function qvmRawEntityTable(options: {
  readonly data: QvmGameData;
  readonly memory: QvmMemory;
  readonly guest: QvmGuestMemory;
  readonly capacity: number;
  readonly currentActor: (slot: number, byteOffset: bigint) => ActorId | null;
}): RawEntityTable {
  const first = options.data.entityBytes(0), strideBytes = options.data.entityStrideBytes;
  const start = first.byteOffset - options.memory.bytes.byteOffset;
  const base = options.guest.pointer(BigInt(start === 0 ? options.memory.bytes.length : start));
  if (base === null) throw new Error("Located QVM entity table has a null base");
  const count = options.data.numEntities, capacity = options.capacity;
  if (!Number.isSafeInteger(capacity) || capacity < count || count < 0 || strideBytes < qvmSharedEntityLayout.byteLength
    || start + capacity * strideBytes > options.memory.bytes.length) throw new RangeError("Invalid QVM entity table capacity or stride");
  const atSlot = (slot: number): RawEntityView => {
    if (!Number.isSafeInteger(slot) || slot < 0 || slot >= capacity) throw new RangeError("QVM entity slot exceeds table capacity");
    const address = options.guest.offset(base, BigInt(slot * strideBytes));
    return { module: options.guest.module, slot, address, strideBytes, publicLayout: qvmSharedEntityLayout,
      bytes: options.guest.borrow(address, strideBytes), currentActor: () => options.currentActor(slot, address.byteOffset) };
  };
  return { module: options.guest.module, base, strideBytes, count, capacity, layout: qvmSharedEntityLayout, atSlot,
    fromPointer(address): RawEntityView {
      options.guest.borrow(address, 0);
      const displacement = address.byteOffset - base.byteOffset;
      if (displacement % BigInt(strideBytes) !== 0n) throw new RangeError("QVM pointer is not an entity record boundary");
      return atSlot(Number(displacement / BigInt(strideBytes)));
    },
  };
}
