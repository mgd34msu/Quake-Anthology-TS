import type { PickupSupplyProfile } from "../../contracts/pickups.ts";

/** Q3 quantities feed Q1 capacities. Rail uses nails; plasma and BFG use lightning. */
export const Q3_Q1_SUPPLY_PROFILE: PickupSupplyProfile = {
  id: "composition:q3-base-q1-supply",
  weaponOwnership: "all-destinations",
  ammo: [
    { source: "q3:ammo/shotgun", destinations: ["q1:ammo/shells"] },
    { source: "q3:ammo/machinegun", destinations: ["q1:ammo/nails"] },
    { source: "q3:ammo/grenadelauncher", destinations: ["q1:ammo/rockets"] },
    { source: "q3:ammo/rocketlauncher", destinations: ["q1:ammo/rockets"] },
    { source: "q3:ammo/lightning", destinations: ["q1:ammo/cells"] },
    { source: "q3:ammo/railgun", destinations: ["q1:ammo/nails"] },
    { source: "q3:ammo/plasmagun", destinations: ["q1:ammo/cells"] },
    { source: "q3:ammo/bfg", destinations: ["q1:ammo/cells"] },
  ],
  weapons: [
    { source: "q3:weapon/gauntlet", destinations: ["q1:weapon/axe"] },
    { source: "q3:weapon/shotgun", destinations: ["q1:weapon/supershotgun"] },
    { source: "q3:weapon/machinegun", destinations: ["q1:weapon/nailgun"] },
    { source: "q3:weapon/grenadelauncher", destinations: ["q1:weapon/grenadelauncher"] },
    { source: "q3:weapon/rocketlauncher", destinations: ["q1:weapon/rocketlauncher"] },
    { source: "q3:weapon/lightning", destinations: ["q1:weapon/lightning"] },
    { source: "q3:weapon/railgun", destinations: ["q1:weapon/supernailgun"] },
    { source: "q3:weapon/plasmagun", destinations: ["q1:weapon/lightning"] },
    { source: "q3:weapon/bfg", destinations: ["q1:weapon/lightning"] },
  ],
};
