import { q2BaseWeaponDisplayName } from "../../../../content/q2/foundation/items.ts";
import { itemList } from "../../../../content/q3/base/shared/items.ts";
import { ItemType } from "../../../../content/q3/base/shared/definitions.ts";
import { isQ1BaseWeapon } from "../../../../content/q1/foundation/types.ts";
import type { Q1BaseWeapon } from "../../../../content/q1/foundation/types.ts";
import type { ProviderReference } from "../../../../contracts/content.ts";
import type { ItemId } from "../../../../contracts/gameplay.ts";
import type { ArsenalAmmoWarning, WeaponHudStatus } from "../../../../contracts/ui.ts";
import type { Q1EntityServices } from "../../../../content/q1/foundation/entity-services.ts";
import type { Q1PlayerState } from "../../../../content/q1/foundation/types.ts";
import type { Q2WeaponDefinition } from "../../../../content/q2/foundation/weapons/types.ts";
import { Q3_WEAPON_ITEMS } from "../../../../content/q3/foundation/arsenal.ts";
import { Weapon } from "../../../../movement/q3/constants.ts";

const q1DisplayNames: Readonly<Record<Q1BaseWeapon, string>> = {
  axe: "Axe", shotgun: "Shotgun", supershotgun: "Double-barrelled Shotgun", nailgun: "Nailgun",
  supernailgun: "Super Nailgun", grenadelauncher: "Grenade Launcher", rocketlauncher: "Rocket Launcher", lightning: "Thunderbolt",
};
function displayName(value: string): string {
  return value.replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, character => character.toUpperCase());
}

export function q1WeaponStatus(game: Q1EntityServices, player: Q1PlayerState, source: ProviderReference): WeaponHudStatus {
  const item = game.weaponItem(player.weapon), ammo = game.weaponAmmo(player.weapon);
  return { source, item, label: isQ1BaseWeapon(player.weapon) ? q1DisplayNames[player.weapon] : displayName(player.weapon), ammo: ammo === null ? { kind: "unmetered" } : {
    kind: "finite", item: ammo, count: game.host.inventory.count(player.actor.id, ammo),
    hasAmmoToStart: game.weaponAvailable(player, player.weapon, "fire"), low: false,
  } };
}

export function q2WeaponStatus(definition: Q2WeaponDefinition | null, count: (item: ItemId) => number, source: ProviderReference): WeaponHudStatus | null {
  if (definition === null) return null;
  const ammo = definition.ammo;
  return { source, item: definition.item, label: q2BaseWeaponDisplayName(definition.item) ?? displayName(definition.name), ammo: ammo === null ? { kind: "unmetered" } : {
    kind: "finite", item: ammo, count: count(ammo), hasAmmoToStart: count(ammo) >= definition.quantity,
    low: count(ammo) <= definition.warning,
  } };
}

export function q3WeaponStatus(item: ItemId | null, product: "baseq3" | "missionpack", count: (item: ItemId) => number, source: ProviderReference): WeaponHudStatus | null {
  const definition = Q3_WEAPON_ITEMS.find(entry => entry.item === item && (product === "missionpack" || entry.weapon <= 10));
  if (definition === undefined) return null;
  const ammo = definition.ammo;
  return { source, item: definition.item, label: itemList(product).find(item => item.type === ItemType.IT_WEAPON && item.tag === definition.weapon)?.pickupName ?? displayName(definition.item.slice("q3:weapon/".length)), ammo: ammo === null || count(ammo) === -1 ? { kind: "unmetered" } : {
    kind: "finite", item: ammo, count: count(ammo), hasAmmoToStart: count(ammo) > 0, low: false,
  } };
}

/** CG_CheckAmmo's aggregate five-second estimate, independent of the active weapon. */
export function q3ArsenalWarning(product: "baseq3" | "missionpack", count: (item: ItemId) => number): ArsenalAmmoWarning {
  let total = 0;
  for (const entry of Q3_WEAPON_ITEMS) {
    const weapon = entry.weapon;
    if (weapon < Weapon.WP_MACHINEGUN || (product === "baseq3" && weapon > 10) || count(entry.item) <= 0) continue;
    const slow = weapon === Weapon.WP_ROCKET_LAUNCHER || weapon === Weapon.WP_GRENADE_LAUNCHER
      || weapon === Weapon.WP_RAILGUN || weapon === Weapon.WP_SHOTGUN || (product === "missionpack" && weapon === Weapon.WP_PROX_LAUNCHER);
    total = (total + Math.imul(entry.ammo === null ? -1 : count(entry.ammo), slow ? 1000 : 200)) | 0;
    if (total >= 5000) return "none";
  }
  return total === 0 ? "empty" : "low";
}
