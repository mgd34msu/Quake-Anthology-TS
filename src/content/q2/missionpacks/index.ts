import type { Q2ItemModule } from "../foundation/items.ts";
import type { Q2Weapons } from "../foundation/weapons/index.ts";
import type { Q2MissionPack, Q2MissionPackProjectileHooks } from "./types.ts";
import { Q2MissionPackProjectiles } from "./projectiles/index.ts";
import { Q2MissionPackWeapons } from "./weapons/player.ts";
import { Q2MissionPackItems } from "./items.ts";
import { Q2MissionPackSpheres } from "./spheres.ts";
import type { Q2SphereHooks } from "./spheres.ts";
import type { Q2Edition } from "../foundation/host.ts";
import { Q2MissionPackDoppleganger } from "./doppleganger.ts";

export interface Q2MissionPackArmoryHooks extends Omit<Q2MissionPackProjectileHooks, "base">, Q2SphereHooks {
  readonly weapons: Q2Weapons;
  readonly items: Q2ItemModule;
}

/** Installs the selected source arsenal into the existing session weapon and item authorities. */
export function registerQ2MissionPackArmory(pack: Q2MissionPack, hooks: Q2MissionPackArmoryHooks, edition: Q2Edition = "classic") {
  const projectiles = new Q2MissionPackProjectiles({ ...hooks, base: hooks.weapons });
  const weapons = new Q2MissionPackWeapons(projectiles);
  const spheres = new Q2MissionPackSpheres(projectiles, hooks);
  const doppleganger = new Q2MissionPackDoppleganger(spheres, hooks.weapons);
  const items = new Q2MissionPackItems(hooks, pack, hooks.items);
  const packs: readonly Q2MissionPack[] = edition === "rerelease" ? ["xatrix", "rogue"] : [pack];
  for (const selected of packs) {
    weapons.register(hooks.weapons, selected, edition); items.register(hooks.items, hooks.weapons, selected, projectiles, spheres, doppleganger, edition);
  }
  if (edition === "rerelease") hooks.weapons.setFallbackOrder(["disintegrator", "railgun", "heatbeam", "ionripper", "hyperblaster", "etf_rifle", "chaingun", "machinegun", "supershotgun", "shotgun", "phalanx", "rocketlauncher", "grenadelauncher", "proxlauncher", "chainfist", "blaster"]);
  return { projectiles, weapons, spheres, items, doppleganger };
}

export { Q2MissionPackProjectiles, Q2MissionPackWeapons, Q2MissionPackItems, Q2MissionPackSpheres, Q2MissionPackDoppleganger };
export { canonicalCauseFromNative, nativeCauseFromCanonical, q2CanonicalCause } from "./damage.ts";
export { q2MissionPackDamage } from "./types.ts";
export type { Q2MissionPack, Q2MissionPackPlayerEffect, Q2MissionPackProjectileHooks } from "./types.ts";
export type { Q2MissionPackItemsCheckpoint, Q2MissionPackPowerups } from "./items.ts";
export type { Q2SphereKind, Q2SphereHooks } from "./spheres.ts";
export { Q2MissionPackEntities } from "./entities/index.ts";
export type { Q2MissionPackEntityHooks, Q2MissionPackEntityEvent, Q2RogueEntitiesCheckpoint } from "./entities/index.ts";
export { Q2Tag, Q2DeathBall, q2DeathBallRules } from "./modes/index.ts";
export type { Q2TagHooks, Q2TagCheckpoint, Q2DeathBallHooks, Q2DeathBallCheckpoint } from "./modes/index.ts";
export { Q2RoguePlayerSpawns } from "./players.ts";
export { q2RandomItem } from "./random-items.ts";
export type { Q2RandomItemSettings } from "./random-items.ts";
