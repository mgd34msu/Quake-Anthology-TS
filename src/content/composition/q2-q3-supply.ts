import type { PickupSupplyProfile } from "../../contracts/pickups.ts";

/** Base Q2 supply quantities feed the selected Q3 arsenal's capacities. */
export const Q2_Q3_SUPPLY_PROFILE: PickupSupplyProfile = {
  id: "composition:q2-base-q3-supply",
  weaponOwnership: "all-destinations",
  ammo: [
    { source: "q2:ammo_shells", destinations: ["q3:ammo/shotgun"] },
    { source: "q2:ammo_bullets", destinations: ["q3:ammo/machinegun"] },
    { source: "q2:ammo_cells", destinations: ["q2:ammo_cells", "q3:ammo/plasmagun", "q3:ammo/lightning", "q3:ammo/bfg"] },
    { source: "q2:ammo_rockets", destinations: ["q3:ammo/rocketlauncher"] },
    { source: "q2:ammo_slugs", destinations: ["q3:ammo/railgun"] },
    { source: "q2:ammo_grenades", destinations: ["q3:ammo/grenadelauncher"] },
  ],
  weapons: [
    { source: "q2:weapon_shotgun", destinations: ["q3:weapon/shotgun"] },
    { source: "q2:weapon_supershotgun", destinations: ["q3:weapon/shotgun"] },
    { source: "q2:weapon_machinegun", destinations: ["q3:weapon/machinegun"] },
    { source: "q2:weapon_chaingun", destinations: ["q3:weapon/machinegun"] },
    { source: "q2:ammo_grenades", destinations: ["q3:weapon/grenadelauncher"] },
    { source: "q2:weapon_grenadelauncher", destinations: ["q3:weapon/grenadelauncher"] },
    { source: "q2:weapon_rocketlauncher", destinations: ["q3:weapon/rocketlauncher"] },
    { source: "q2:weapon_hyperblaster", destinations: ["q3:weapon/plasmagun", "q3:weapon/lightning"] },
    { source: "q2:weapon_railgun", destinations: ["q3:weapon/railgun"] },
    { source: "q2:weapon_bfg", destinations: ["q3:weapon/bfg"] },
  ],
};
