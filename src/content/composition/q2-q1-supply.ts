import type { PickupSupplyProfile } from "../../contracts/pickups.ts";

/** Q2 quantities feed Q1 capacities. Slugs become nails; energy weapons use lightning. */
export const Q2_Q1_SUPPLY_PROFILE: PickupSupplyProfile = {
  id: "composition:q2-base-q1-supply",
  weaponOwnership: "all-destinations",
  ammo: [
    { source: "q2:ammo_shells", destinations: ["q1:ammo/shells"] },
    { source: "q2:ammo_bullets", destinations: ["q1:ammo/nails"] },
    { source: "q2:ammo_cells", destinations: ["q2:ammo_cells", "q1:ammo/cells"] },
    { source: "q2:ammo_rockets", destinations: ["q1:ammo/rockets"] },
    { source: "q2:ammo_slugs", destinations: ["q1:ammo/nails"] },
    { source: "q2:ammo_grenades", destinations: ["q2:ammo_grenades", "q1:ammo/rockets"] },
  ],
  weapons: [
    { source: "q2:weapon_shotgun", destinations: ["q1:weapon/shotgun"] },
    { source: "q2:weapon_supershotgun", destinations: ["q1:weapon/supershotgun"] },
    { source: "q2:weapon_machinegun", destinations: ["q1:weapon/nailgun"] },
    { source: "q2:weapon_chaingun", destinations: ["q1:weapon/supernailgun"] },
    { source: "q2:ammo_grenades", destinations: ["q1:weapon/grenadelauncher"] },
    { source: "q2:weapon_grenadelauncher", destinations: ["q1:weapon/grenadelauncher"] },
    { source: "q2:weapon_rocketlauncher", destinations: ["q1:weapon/rocketlauncher"] },
    { source: "q2:weapon_hyperblaster", destinations: ["q1:weapon/lightning"] },
    { source: "q2:weapon_railgun", destinations: ["q1:weapon/supernailgun"] },
    { source: "q2:weapon_bfg", destinations: ["q1:weapon/lightning"] },
  ],
};
