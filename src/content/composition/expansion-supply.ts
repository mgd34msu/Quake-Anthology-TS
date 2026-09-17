import type { ItemId } from "../../contracts/gameplay.ts";
import type { PickupSupplyProfile } from "../../contracts/pickups.ts";

export type ExpansionSupply = "q1-rogue" | "q1-mg3" | "q2-xatrix" | "q2-rogue";
type Expansion = ReadonlyMap<ItemId, readonly ItemId[]>;
const ammo: Readonly<Record<ExpansionSupply, Expansion>> = {
  "q1-rogue": new Map([
    ["q1:ammo/nails", ["rogue:ammo/lava-nails"]], ["q1:ammo/rockets", ["rogue:ammo/multi-rockets"]], ["q1:ammo/cells", ["rogue:ammo/plasma"]],
  ]),
  "q1-mg3": new Map<ItemId, readonly ItemId[]>(),
  "q2-xatrix": new Map([
    ["q2:ammo_grenades", ["q2:ammo_trap"]], ["q2:ammo_cells", ["q2:ammo_magslug"]], ["q2:ammo_slugs", ["q2:ammo_magslug"]],
  ]),
  "q2-rogue": new Map([
    ["q2:ammo_bullets", ["q2:ammo_flechettes"]], ["q2:ammo_grenades", ["q2:ammo_prox", "q2:ammo_tesla"]],
    ["q2:ammo_cells", ["q2:ammo_disruptor"]], ["q2:ammo_slugs", ["q2:ammo_disruptor"]],
  ]),
};
const weapons: Readonly<Record<ExpansionSupply, Expansion>> = {
  "q1-rogue": new Map([
    ["q1:weapon/nailgun", ["q1:weapon/rogue:lava-nailgun"]], ["q1:weapon/supernailgun", ["q1:weapon/rogue:lava-supernailgun"]],
    ["q1:weapon/grenadelauncher", ["q1:weapon/rogue:multi-grenade"]], ["q1:weapon/rocketlauncher", ["q1:weapon/rogue:multi-rocket"]],
    ["q1:weapon/lightning", ["q1:weapon/rogue:plasma"]],
  ]),
  "q1-mg3": new Map([["q1:weapon/lightning", ["q1:weapon/mg3:laser", "q1:weapon/mg3:mjolnir"]]]),
  "q2-xatrix": new Map([
    ["q2:weapon_hyperblaster", ["q2:weapon_boomer", "q2:weapon_phalanx"]], ["q2:weapon_railgun", ["q2:weapon_phalanx"]],
  ]),
  "q2-rogue": new Map([
    ["q2:weapon_shotgun", ["q2:weapon_chainfist"]], ["q2:weapon_machinegun", ["q2:weapon_etf_rifle"]],
    ["q2:weapon_grenadelauncher", ["q2:weapon_proxlauncher"]], ["q2:weapon_hyperblaster", ["q2:weapon_plasmabeam", "q2:weapon_disintegrator"]],
    ["q2:weapon_railgun", ["q2:weapon_disintegrator"]],
  ]),
};

/** Explicit mixed-game supply policy: retain each base grant and add the selected expansion's related equipment. */
export function expansionSupply(profile: PickupSupplyProfile, expansions: readonly ExpansionSupply[]): PickupSupplyProfile {
  const extend = (rows: PickupSupplyProfile["ammo"], catalogs: Readonly<Record<ExpansionSupply, Expansion>>): PickupSupplyProfile["ammo"] => rows.map(row => {
    const [first, ...rest] = row.destinations;
    const additional = expansions.flatMap(expansion => row.destinations.flatMap(item => catalogs[expansion].get(item) ?? []));
    return { source: row.source, destinations: [first, ...new Set([...rest, ...additional].filter(item => item !== first))] };
  });
  return { ...profile, id: `${profile.id}/${expansions.join("+")}`, ammo: extend(profile.ammo, ammo), weapons: extend(profile.weapons, weapons) };
}
