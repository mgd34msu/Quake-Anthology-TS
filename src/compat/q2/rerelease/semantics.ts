// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress } from "../../../contracts/execution.ts";
import type { RereleaseGuestModule } from "./module.ts";
import { guestPointer } from "./module.ts";
import type { RereleaseInventoryItem } from "./source-state.ts";

/** Resolve declared item identities through the original API or explicit source slots. */
export function rereleaseInventoryItems(module: RereleaseGuestModule, string: (value: string) => GuestAddress): readonly RereleaseInventoryItem[] {
  const profile = module.requireWorldProfile(), indices = new Set<number>(), items: RereleaseInventoryItem[] = [];
  for (const row of profile.inventory) {
    if (row.source.kind === "remaining") continue;
    const result = row.source.kind === "index" ? { kind: "int32", value: row.source.index }
      : module.callGame("Bot_GetItemID", [guestPointer(string(row.source.name))]);
    if (result.kind !== "int32" || result.value < 0 || result.value >= profile.client.inventoryCount || indices.has(result.value)) throw new Error(`Native item roster mismatch: ${row.item}`);
    indices.add(result.value); items.push({ item: row.item, sourceIndex: result.value, capacity: row.capacity });
  }
  const remaining = profile.inventory.find(row => row.source.kind === "remaining");
  if (remaining !== undefined) {
    const unnamed = Array.from({ length: profile.client.inventoryCount }, (_, index) => index).filter(index => !indices.has(index));
    if (unnamed.length !== 1 || unnamed[0] === undefined) throw new Error("Source inventory declaration requires exactly one remaining slot");
    items.push({ item: remaining.item, sourceIndex: unnamed[0], capacity: remaining.capacity });
  }
  if (items.length !== profile.client.inventoryCount || items.find(row => row.item === profile.armor.cells)?.sourceIndex !== profile.armor.cellsIndex)
    throw new Error("Native inventory roster differs from the declared source storage");
  return Object.freeze(items.sort((a, b) => a.sourceIndex - b.sourceIndex).map(item => Object.freeze(item)));
}
