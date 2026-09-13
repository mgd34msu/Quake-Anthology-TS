import type { ItemId } from "../../contracts/gameplay.ts";
import type { PickupSupplyProfile } from "../../contracts/pickups.ts";
import { Q1_Q3_SUPPLY_PROFILE } from "./q1-q3-supply.ts";

const hipnoticWeapons = new Map<ItemId, readonly ItemId[]>([["q1:weapon/lightning", ["q1:weapon/hipnotic:laser", "q1:weapon/hipnotic:mjolnir"]], ["q1:weapon/grenadelauncher", ["q1:weapon/hipnotic:proximity"]]]);

export const Q1_HIPNOTIC_SUPPLY_PROFILE: PickupSupplyProfile = {
  id: "composition:q1-hipnotic-supply", weaponOwnership: "all-destinations",
  ammo: Q1_Q3_SUPPLY_PROFILE.ammo.map(entry => ({ source: entry.source, destinations: [entry.source] })),
  weapons: Q1_Q3_SUPPLY_PROFILE.weapons.map(entry => ({ source: entry.source, destinations: [entry.source,
    ...(hipnoticWeapons.get(entry.source) ?? [])] })),
};
