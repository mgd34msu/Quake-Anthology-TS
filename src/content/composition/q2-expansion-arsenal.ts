import type { ItemId } from "../../contracts/gameplay.ts";
import type { Q2GameServices } from "../q2/foundation/host.ts";
import { q2BaseWeaponInventory } from "../q2/foundation/items.ts";
import type { Q2Weapons } from "../q2/foundation/weapons/player.ts";
import { Q2MissionPackProjectiles } from "../q2/missionpacks/projectiles/index.ts";
import { Q2MissionPackWeapons } from "../q2/missionpacks/weapons/player.ts";
import { q2MissionWeaponInventory } from "../q2/missionpacks/items.ts";
import type { Q2MissionPackProjectileHooks } from "../q2/missionpacks/types.ts";

export type SelectedQ2Program = "baseq2" | "xatrix" | "rogue" | "mg2";

/** Shared pickup preference, weakest first. This is a composition policy, not native Q2 autoswitch. */
const pickupOrder: readonly ItemId[] = [
  "q2:weapon_blaster", "q2:weapon_chainfist", "q2:weapon_shotgun", "q2:weapon_supershotgun",
  "q2:weapon_machinegun", "q2:weapon_etf_rifle", "q2:weapon_chaingun", "q2:ammo_grenades", "q2:ammo_trap", "q2:ammo_tesla",
  "q2:weapon_grenadelauncher", "q2:weapon_proxlauncher", "q2:weapon_rocketlauncher", "q2:weapon_hyperblaster",
  "q2:weapon_boomer", "q2:weapon_plasmabeam", "q2:weapon_railgun", "q2:weapon_phalanx", "q2:weapon_disintegrator", "q2:weapon_bfg",
];

export function registerSelectedQ2MissionWeapons(game: Q2GameServices, weapons: Q2Weapons, program: SelectedQ2Program,
  hooks: Omit<Q2MissionPackProjectileHooks, "base">): {
    readonly inventoryDefinitions: readonly { readonly item: ItemId; readonly capacity: number }[];
    readonly pickupOrder: readonly ItemId[];
  } {
  const packs = game.options.edition === "rerelease" ? ["xatrix", "rogue"] satisfies readonly ("xatrix" | "rogue")[]
    : program === "xatrix" || program === "rogue" ? [program] : [];
  const projectiles = new Q2MissionPackProjectiles({ ...hooks, base: weapons });
  const extensions = new Q2MissionPackWeapons(projectiles);
  for (const pack of packs) extensions.register(weapons, pack, game.options.edition);
  game.sourceCallbacks.register(projectiles.callbacks);
  if (game.options.edition === "rerelease") weapons.setFallbackOrder(["disintegrator", "railgun", "heatbeam", "ionripper", "hyperblaster", "etf_rifle", "chaingun", "machinegun", "supershotgun", "shotgun", "phalanx", "rocketlauncher", "grenadelauncher", "proxlauncher", "chainfist", "blaster"]);
  const definitions = weapons.registeredDefinitions();
  return { inventoryDefinitions: [...q2BaseWeaponInventory(), ...packs.flatMap(q2MissionWeaponInventory)],
    pickupOrder: pickupOrder.filter(item => definitions.some(definition => definition.item === item)) };
}
