import type { ItemId } from "../../contracts/gameplay.ts";
import type { PickupSupplyProfile } from "../../contracts/pickups.ts";

/** Hipnotic weapons a foreign weapon also grants: source weapon to the Hipnotic items stacked on it. */
export type HipnoticOverlay = ReadonlyMap<ItemId, readonly ItemId[]>;

export function hipnoticOverlay(entries: readonly (readonly [ItemId, readonly ItemId[]])[]): HipnoticOverlay { return new Map(entries); }

/** Adds each overlay item to the destinations of its source weapon. */
export function overlayWeapons(weapons: PickupSupplyProfile["weapons"], overlay: HipnoticOverlay): PickupSupplyProfile["weapons"] {
  return weapons.map(entry => ({ ...entry, destinations: [...entry.destinations, ...(overlay.get(entry.source) ?? [])] }));
}

/** The ownership pairs that let the source weapon count as owning each overlay item. */
export function overlayOwners(overlay: HipnoticOverlay): readonly { readonly item: ItemId; readonly source: ItemId }[] {
  return [...overlay].flatMap(([source, destinations]) => destinations.map(item => ({ item, source })));
}
