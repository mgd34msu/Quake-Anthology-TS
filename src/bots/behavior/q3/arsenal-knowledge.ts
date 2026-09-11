import type { BotArsenalData, BotArsenalKnowledge, BotWeaponKnowledge, BotWeaponTactics } from "./game-host.ts";
import type { BotLibrary } from "./library.ts";
import type { BotState } from "./ai-state.ts";
import { BotCharacteristic, BotInventory } from "./ai-definitions.ts";
import { Weapon } from "../../../content/q3/base/shared/definitions.ts";
import { DAMAGE_TYPE_RADIAL } from "../library/weapons.ts";

/** These roles choose learned fuzzy/personality profiles, never gameplay weapon identities. */
function personalityRole(candidate: BotWeaponKnowledge): number {
  if (candidate.personalityRole !== null) return candidate.personalityRole;
  const info = candidate.info;
  if (candidate.melee) return Weapon.WP_GAUNTLET;
  if (info.projectileInfo.gravity > 0) return Weapon.WP_GRENADE_LAUNCHER;
  if (info.speed > 0) return (info.projectileInfo.damageType & DAMAGE_TYPE_RADIAL) !== 0 ? Weapon.WP_ROCKET_LAUNCHER : Weapon.WP_PLASMAGUN;
  if (info.projectileCount >= 4) return Weapon.WP_SHOTGUN;
  if (info.horizontalSpread > 0 || info.verticalSpread > 0) return Weapon.WP_MACHINEGUN;
  return info.reload <= 0.2 ? Weapon.WP_LIGHTNING : Weapon.WP_RAILGUN;
}
function tactics(candidate: BotWeaponKnowledge | undefined): BotWeaponTactics {
  const role = candidate === undefined ? Weapon.WP_NONE : personalityRole(candidate);
  return { melee: candidate?.melee ?? false, maximumRange: candidate?.maximumRange ?? null,
    weakness: role === Weapon.WP_MACHINEGUN ? 90 : 0,
    predictOccludedSplash: role === Weapon.WP_BFG || role === Weapon.WP_ROCKET_LAUNCHER || role === Weapon.WP_GRENADE_LAUNCHER,
    aimAccuracy: role === Weapon.WP_MACHINEGUN ? BotCharacteristic.AIM_ACCURACY_MACHINEGUN
      : role === Weapon.WP_SHOTGUN ? BotCharacteristic.AIM_ACCURACY_SHOTGUN
      : role === Weapon.WP_GRENADE_LAUNCHER ? BotCharacteristic.AIM_ACCURACY_GRENADELAUNCHER
      : role === Weapon.WP_ROCKET_LAUNCHER ? BotCharacteristic.AIM_ACCURACY_ROCKETLAUNCHER
      : role === Weapon.WP_LIGHTNING ? BotCharacteristic.AIM_ACCURACY_LIGHTNING
      : role === Weapon.WP_RAILGUN ? BotCharacteristic.AIM_ACCURACY_RAILGUN
      : role === Weapon.WP_PLASMAGUN ? BotCharacteristic.AIM_ACCURACY_PLASMAGUN
      : role === Weapon.WP_BFG ? BotCharacteristic.AIM_ACCURACY_BFG10K : null,
    aimSkill: role === Weapon.WP_GRENADE_LAUNCHER ? BotCharacteristic.AIM_SKILL_GRENADELAUNCHER
      : role === Weapon.WP_ROCKET_LAUNCHER ? BotCharacteristic.AIM_SKILL_ROCKETLAUNCHER
      : role === Weapon.WP_PLASMAGUN ? BotCharacteristic.AIM_SKILL_PLASMAGUN
      : role === Weapon.WP_BFG ? BotCharacteristic.AIM_SKILL_BFG10K : null };
}
const aggressionProfiles: readonly (readonly [number, number, number])[] = [
  [Weapon.WP_BFG, 7, 100], [Weapon.WP_RAILGUN, 5, 95], [Weapon.WP_LIGHTNING, 50, 90],
  [Weapon.WP_ROCKET_LAUNCHER, 5, 90], [Weapon.WP_PLASMAGUN, 40, 85], [Weapon.WP_GRENADE_LAUNCHER, 10, 80], [Weapon.WP_SHOTGUN, 10, 50],
];
function profileInventory(role: number): { readonly weapon: number; readonly ammo: number | null } | null {
  switch (role) {
    case Weapon.WP_GAUNTLET: return { weapon: BotInventory.GAUNTLET, ammo: null };
    case Weapon.WP_MACHINEGUN: return { weapon: BotInventory.MACHINEGUN, ammo: BotInventory.BULLETS };
    case Weapon.WP_SHOTGUN: return { weapon: BotInventory.SHOTGUN, ammo: BotInventory.SHELLS };
    case Weapon.WP_GRENADE_LAUNCHER: return { weapon: BotInventory.GRENADELAUNCHER, ammo: BotInventory.GRENADES };
    case Weapon.WP_ROCKET_LAUNCHER: return { weapon: BotInventory.ROCKETLAUNCHER, ammo: BotInventory.ROCKETS };
    case Weapon.WP_LIGHTNING: return { weapon: BotInventory.LIGHTNING, ammo: BotInventory.LIGHTNINGAMMO };
    case Weapon.WP_RAILGUN: return { weapon: BotInventory.RAILGUN, ammo: BotInventory.SLUGS };
    case Weapon.WP_PLASMAGUN: return { weapon: BotInventory.PLASMAGUN, ammo: BotInventory.CELLS };
    case Weapon.WP_BFG: return { weapon: BotInventory.BFG10K, ammo: BotInventory.BFGAMMO };
    case Weapon.WP_GRAPPLING_HOOK: return { weapon: BotInventory.GRAPPLINGHOOK, ammo: null };
    case Weapon.WP_NAILGUN: return { weapon: BotInventory.NAILGUN, ammo: BotInventory.NAILS };
    case Weapon.WP_PROX_LAUNCHER: return { weapon: BotInventory.PROXLAUNCHER, ammo: BotInventory.MINES };
    case Weapon.WP_CHAINGUN: return { weapon: BotInventory.CHAINGUN, ammo: BotInventory.BELT };
    default: return null;
  }
}
function owned(state: BotState, candidate: BotWeaponKnowledge): boolean {
  const index = candidate.personalityRole === null ? candidate.info.weaponInventoryIndex : profileInventory(candidate.personalityRole)?.weapon;
  return index !== undefined && (state.inventory[index] ?? 0) > 0;
}
function ammunition(state: BotState, candidate: BotWeaponKnowledge): number {
  if (candidate.personalityRole === null) return candidate.info.ammoAmount === 0 ? 999 : state.inventory[candidate.info.ammoInventoryIndex] ?? 0;
  const index = profileInventory(candidate.personalityRole)?.ammo;
  return index === null ? 999 : index === undefined ? 0 : state.inventory[index] ?? 0;
}

/** One decision implementation consumes native and foreign source facts through the same fuzzy profiles. */
export function createBotArsenalKnowledge(data: BotArsenalData): BotArsenalKnowledge {
  let candidates: readonly BotWeaponKnowledge[] = [];
  const refresh = (library: BotLibrary, handle: number): readonly BotWeaponKnowledge[] => { candidates = data.candidates(library, handle); return candidates; };
  return {
    updateInventory: state => data.updateInventory(state),
    weaponInfo(library, handle, weapon) { return refresh(library, handle).find(candidate => candidate.info.number === weapon)?.info; },
    tactics: weapon => tactics(candidates.find(candidate => candidate.info.number === weapon)),
    chooseWeapon(library, state) {
      let bestWeight = Math.fround(0), bestWeapon = 0, bestRole: number | null = null, bestRate = 0;
      const consider = (candidate: BotWeaponKnowledge, role: number, weight: number | null): void => {
        if (weight === null) return;
        const info = candidate.info, rate = info.reload > 0 ? info.projectileInfo.damage * info.projectileCount / info.reload : 0;
        if (weight > bestWeight || weight > 0 && weight === bestWeight && role === bestRole && rate > bestRate) {
          bestWeight = weight; bestWeapon = info.number; bestRole = role; bestRate = rate;
        }
      };
      for (const candidate of refresh(library, state.ws)) {
        const role = personalityRole(candidate);
        if (candidate.personalityRole !== null) {
          const weight = library.weapons.evaluateFightWeapon(state.ws, role, state.inventory);
          consider(candidate, role, weight);
          continue;
        }
        if (!owned(state, candidate) || ammunition(state, candidate) < candidate.info.ammoAmount) continue;
        const distance = Math.hypot(state.inventory[BotInventory.ENEMY_HORIZONTAL_DIST] ?? 0, state.inventory[BotInventory.ENEMY_HEIGHT] ?? 0);
        if (candidate.maximumRange !== null && distance > candidate.maximumRange) continue;
        const profile = profileInventory(role);
        if (profile === null) continue;
        const projected = state.inventory.slice();
        projected[profile.weapon] = 1;
        if (profile.ammo !== null) projected[profile.ammo] = ammunition(state, candidate);
        const weight = library.weapons.evaluateFightWeapon(state.ws, role, projected);
        consider(candidate, role, weight);
      }
      return bestWeapon;
    },
    aggression(state) {
      const current = candidates.find(candidate => candidate.info.number === state.weaponNum);
      if ((state.inventory[BotInventory.QUAD] ?? 0) !== 0 && (current?.melee !== true || (state.inventory[BotInventory.ENEMY_HORIZONTAL_DIST] ?? 0) < 80)) return 70;
      const health = state.inventory[BotInventory.HEALTH] ?? 0, armor = state.inventory[BotInventory.ARMOR] ?? 0;
      if ((state.inventory[BotInventory.ENEMY_HEIGHT] ?? 0) > 200 || health < 60 || health < 80 && armor < 40) return 0;
      for (const [role, minimum, value] of aggressionProfiles) {
        if (candidates.some(candidate => personalityRole(candidate) === role && owned(state, candidate) && ammunition(state, candidate) > minimum)) return value;
      }
      return 0;
    },
  };
}
