import type { ItemId } from "../../contracts/gameplay.ts";
import type { PickupSupplyProfile } from "../../contracts/pickups.ts";

const ammoAliases: readonly (readonly [ItemId, ItemId])[] = [
  ["rogue:ammo/lava-nails", "q1:ammo/nails"], ["rogue:ammo/multi-rockets", "q1:ammo/rockets"], ["rogue:ammo/plasma", "q1:ammo/cells"],
  ["q2:ammo_magslug", "q2:ammo_slugs"], ["q2:ammo_flechettes", "q2:ammo_bullets"], ["q2:ammo_disruptor", "q2:ammo_cells"],
  ["q2:ammo_trap", "q2:ammo_grenades"], ["q2:ammo_tesla", "q2:ammo_grenades"], ["q2:ammo_prox", "q2:ammo_grenades"],
];
const weaponAliases: readonly (readonly [ItemId, ItemId])[] = [
  ["q1:weapon/hipnotic:laser", "q1:weapon/lightning"], ["q1:weapon/hipnotic:mjolnir", "q1:weapon/axe"], ["q1:weapon/hipnotic:proximity", "q1:weapon/grenadelauncher"],
  ["q1:weapon/mg3:laser", "q1:weapon/lightning"], ["q1:weapon/mg3:mjolnir", "q1:weapon/axe"],
  ["q1:weapon/rogue:lava-nailgun", "q1:weapon/nailgun"], ["q1:weapon/rogue:lava-supernailgun", "q1:weapon/supernailgun"],
  ["q1:weapon/rogue:multi-grenade", "q1:weapon/grenadelauncher"], ["q1:weapon/rogue:multi-rocket", "q1:weapon/rocketlauncher"], ["q1:weapon/rogue:plasma", "q1:weapon/lightning"],
  ["q2:weapon_boomer", "q2:weapon_hyperblaster"], ["q2:weapon_phalanx", "q2:weapon_railgun"], ["q2:weapon_plasmabeam", "q2:weapon_hyperblaster"],
  ["q2:weapon_etf_rifle", "q2:weapon_machinegun"], ["q2:weapon_proxlauncher", "q2:weapon_grenadelauncher"],
  ["q2:weapon_disintegrator", "q2:weapon_bfg"], ["q2:weapon_chainfist", "q2:weapon_shotgun"],
  ["q2:ammo_trap", "q2:ammo_grenades"], ["q2:ammo_tesla", "q2:ammo_grenades"],
];

/** Expansion pickups reuse the selected composition's explicit base supply groups, retaining original quantities. */
export function expansionSourceSupply(profile: PickupSupplyProfile): PickupSupplyProfile {
  const extend = (rows: PickupSupplyProfile["ammo"], aliases: readonly (readonly [ItemId, ItemId])[]): PickupSupplyProfile["ammo"] => [
    ...rows, ...aliases.flatMap(([source, base]) => {
      const mapping = rows.find(row => row.source === base);
      return mapping === undefined || rows.some(row => row.source === source) ? [] : [{ source, destinations: mapping.destinations }];
    }),
  ];
  return { ...profile, id: `${profile.id}/expansion-sources`, ammo: extend(profile.ammo, ammoAliases), weapons: extend(profile.weapons, weaponAliases) };
}
