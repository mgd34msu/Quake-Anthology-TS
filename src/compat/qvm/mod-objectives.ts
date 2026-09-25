import type { QvmModObjectiveAddress } from "../../contracts/qvm-mod-callbacks.ts";
import type { QvmMemory } from "./memory.ts";

function word(end: number, address: number): number {
  if (!Number.isSafeInteger(address) || address < 0 || address % 4 !== 0 || address + 4 > end)
    throw new Error("Objective address exceeds original QVM data or is not aligned");
  return address;
}
export function validateQvmObjectiveAddress(end: number, address: QvmModObjectiveAddress): void {
  if (typeof address === "number") { word(end, address); return; }
  word(end, address.address); word(end, address.offset);
  for (const offset of address.indirections) word(end, offset);
}

/** Persistent objectives use the existing source global-pointer encoding, never a transient call argument. */
export function resolveQvmObjectiveAddress(memory: Pick<QvmMemory, "dataView">, end: number,
  address: QvmModObjectiveAddress, current: () => void): number {
  current();
  if (typeof address === "number") return word(end, address);
  let pointer = memory.dataView(word(end, address.address), 4).getInt32(0, true);
  for (const offset of address.indirections) {
    current();
    if (pointer === 0) throw new Error("Objective selector follows a null source pointer");
    pointer = memory.dataView(word(end, word(end, pointer) + offset), 4).getInt32(0, true);
  }
  current();
  if (pointer === 0) throw new Error("Objective selector follows a null source pointer");
  return word(end, word(end, pointer) + address.offset);
}
