import type { PickupSelection, PickupSupplyProfile } from "../../contracts/pickups.ts";
import type { ItemId } from "../../contracts/gameplay.ts";
import { Q2_BASE_WEAPONS } from "../q2/foundation/weapons/definitions.ts";

/** Cross-game pickup preference uses base weapon progression, not native Q2 pickup autoswitch rules. */
export function q1Q2PickupSelect(current: ItemId | null, incoming: ItemId, selection: PickupSelection): boolean {
  if (selection !== "better") return selection === "always";
  const next = Q2_BASE_WEAPONS.findIndex(weapon => weapon.item === incoming);
  const previous = current === null ? -1 : Q2_BASE_WEAPONS.findIndex(weapon => weapon.item === current);
  if (next < 0 || current !== null && previous < 0) throw new Error("Cross-game Q2 pickup ranking requires base weapons");
  return next > previous;
}

/** Cross-game supply policy from base Q1 pickups to the recipient's base Q2 pools. */
export const Q1_Q2_SUPPLY_PROFILE: PickupSupplyProfile = {
  id: "composition:q1-base-q2-supply",
  weaponOwnership: "all-destinations",
  ammo: [
    { source: "q1:ammo/shells", destinations: ["q2:ammo_shells"] },
    { source: "q1:ammo/nails", destinations: ["q2:ammo_bullets"] },
    { source: "q1:ammo/rockets", destinations: ["q2:ammo_rockets", "q2:ammo_grenades"] },
    { source: "q1:ammo/cells", destinations: ["q2:ammo_cells"] },
  ],
  weapons: [
    { source: "q1:weapon/axe", destinations: ["q2:weapon_blaster"] },
    { source: "q1:weapon/shotgun", destinations: ["q2:weapon_shotgun"] },
    { source: "q1:weapon/supershotgun", destinations: ["q2:weapon_supershotgun"] },
    { source: "q1:weapon/nailgun", destinations: ["q2:weapon_machinegun"] },
    { source: "q1:weapon/supernailgun", destinations: ["q2:weapon_chaingun"] },
    { source: "q1:weapon/grenadelauncher", destinations: ["q2:weapon_grenadelauncher"] },
    { source: "q1:weapon/rocketlauncher", destinations: ["q2:weapon_rocketlauncher"] },
    { source: "q1:weapon/lightning", destinations: ["q2:weapon_hyperblaster"] },
  ],
};
