import type { PickupSupplyProfile } from "../../contracts/pickups.ts";
import type { ProviderId } from "../../contracts/identity.ts";
import type { ArsenalState } from "../../contracts/movement.ts";
import { q3SpawnLoadout } from "../q3/foundation/arsenal.ts";
import type { Product } from "../q3/base/shared/definitions.ts";
import { Weapon } from "../../movement/q3/constants.ts";

/** Base Q1 authored pickups with Q1 progression and selected base Q3 weapons. */
export const Q1_Q3_SUPPLY_PROFILE: PickupSupplyProfile = {
  id: "composition:q1-base-q3-supply",
  weaponOwnership: "all-destinations",
  ammo: [
    { source: "q1:ammo/shells", destinations: ["q3:ammo/shotgun"] },
    { source: "q1:ammo/nails", destinations: ["q3:ammo/machinegun"] },
    { source: "q1:ammo/rockets", destinations: ["q3:ammo/rocketlauncher", "q3:ammo/grenadelauncher"] },
    { source: "q1:ammo/cells", destinations: ["q3:ammo/lightning"] },
  ],
  weapons: [
    { source: "q1:weapon/axe", destinations: ["q3:weapon/gauntlet"] },
    { source: "q1:weapon/shotgun", destinations: ["q3:weapon/shotgun"] },
    { source: "q1:weapon/supershotgun", destinations: ["q3:weapon/shotgun"] },
    { source: "q1:weapon/nailgun", destinations: ["q3:weapon/machinegun"] },
    { source: "q1:weapon/supernailgun", destinations: ["q3:weapon/machinegun"] },
    { source: "q1:weapon/grenadelauncher", destinations: ["q3:weapon/grenadelauncher"] },
    { source: "q1:weapon/rocketlauncher", destinations: ["q3:weapon/rocketlauncher"] },
    { source: "q1:weapon/lightning", destinations: ["q3:weapon/lightning"] },
  ],
};

export function q1Q3SupplyLoadout(provider: ProviderId, product: Product = "baseq3"): ArsenalState {
  const loadout = q3SpawnLoadout(provider, product, false);
  if (loadout.state.kind !== "q3") throw new Error("Q3 loadout returned a foreign weapon state");
  return { ...loadout, activeWeapon: "q3:weapon/shotgun", state: { ...loadout.state, sourceWeapon: Weapon.WP_SHOTGUN },
    ammo: loadout.ammo.map(entry => ({ ...entry, count: entry.item === "q3:weapon/gauntlet" || entry.item === "q3:weapon/shotgun" ? 1
      : entry.item === "q3:ammo/shotgun" ? 25 : 0 })) };
}
