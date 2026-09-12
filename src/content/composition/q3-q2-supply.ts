import type { ItemId } from "../../contracts/gameplay.ts";
import type { PickupSupplyProfile } from "../../contracts/pickups.ts";

/** Base Q3 pickup quantities feed the selected base Q2 arsenal and its shared equipment pools. */
export const Q3_Q2_SUPPLY_PROFILE: PickupSupplyProfile = {
  id: "composition:q3-base-q2-supply",
  weaponOwnership: "all-destinations",
  ammo: [
    { source: "q3:ammo/machinegun", destinations: ["q2:ammo_bullets"] },
    { source: "q3:ammo/shotgun", destinations: ["q2:ammo_shells"] },
    { source: "q3:ammo/grenadelauncher", destinations: ["q2:ammo_grenades"] },
    { source: "q3:ammo/rocketlauncher", destinations: ["q2:ammo_rockets"] },
    { source: "q3:ammo/lightning", destinations: ["q2:ammo_cells"] },
    { source: "q3:ammo/plasmagun", destinations: ["q2:ammo_cells"] },
    { source: "q3:ammo/bfg", destinations: ["q2:ammo_cells"] },
    { source: "q3:ammo/railgun", destinations: ["q2:ammo_slugs"] },
  ],
  weapons: [
    { source: "q3:weapon/gauntlet", destinations: ["q2:weapon_blaster"] },
    { source: "q3:weapon/machinegun", destinations: ["q2:weapon_machinegun", "q2:weapon_chaingun"] },
    { source: "q3:weapon/shotgun", destinations: ["q2:weapon_shotgun", "q2:weapon_supershotgun"] },
    { source: "q3:weapon/grenadelauncher", destinations: ["q2:weapon_grenadelauncher"] },
    { source: "q3:weapon/rocketlauncher", destinations: ["q2:weapon_rocketlauncher"] },
    { source: "q3:weapon/lightning", destinations: ["q2:weapon_hyperblaster"] },
    { source: "q3:weapon/plasmagun", destinations: ["q2:weapon_hyperblaster"] },
    { source: "q3:weapon/railgun", destinations: ["q2:weapon_railgun"] },
    { source: "q3:weapon/bfg", destinations: ["q2:weapon_bfg"] },
  ],
};

export function q3Q2SupplyLoadout(): { readonly weapon: ItemId; readonly inventory: readonly { readonly item: ItemId; readonly count: number }[] } {
  return { weapon: "q2:weapon_machinegun", inventory: [
    { item: "q2:weapon_blaster", count: 1 },
    { item: "q2:weapon_machinegun", count: 1 },
    { item: "q2:weapon_chaingun", count: 1 },
    { item: "q2:ammo_bullets", count: 100 },
  ] };
}
