import { q3PublicPowerupTimers } from "../powerup-timers.ts";
import type { Q3PlayerState } from "../../../../contracts/protocol.ts";
import type { ProviderReference } from "../../../../contracts/content.ts";
import type { ItemId } from "../../../../contracts/gameplay.ts";
import type { PlayerUi } from "../types.ts";
import { baseQ3GuestWeapons, standardQ3GuestWeapons, type Q3GuestWeapon } from "../../../../content/q3/guest-items.ts";
import { statSchema } from "../../../../content/q3/base/shared/definitions.ts";
import { q3ArsenalWarning } from "../arsenal/weapon-status.ts";

/** QVM authority exposes the same public player state as its native protocol clients. */
export function q3GuestPlayerUi(state: Q3PlayerState, source: ProviderReference, nowMilliseconds: number,
  catalog?: readonly Q3GuestWeapon[], product: "baseq3" | "missionpack" = "baseq3"): PlayerUi {
  const definitions = catalog ?? (product === "missionpack" ? standardQ3GuestWeapons : baseQ3GuestWeapons), stats = statSchema(product);
  const weapon = definitions.find(value => value.weapon === state.weapon);
  const count = (item: ItemId): number => {
    const definition = definitions.find(value => value.item === item || value.ammo === item);
    return definition === undefined ? 0 : definition.item === item ? ((state.stats[stats.weapons] ?? 0) & (1 << definition.weapon)) !== 0 ? 1 : 0 : state.ammo[definition.weapon] ?? 0;
  };
  if (state.weapon !== 0 && !definitions.some(definition => definition.weapon === state.weapon))
    throw new Error(`Q3 guest weapon ${state.weapon} is missing from its item catalog; this mod needs a qvm-items.json declaration`);
  const armor = state.stats[stats.armor] ?? 0;
  return { powerups: q3PublicPowerupTimers(powerup => state.powerups[powerup] ?? 0, nowMilliseconds), health: state.stats[stats.health] ?? 0, armor: { powered: { kind: "none" }, regular: armor === 0 ? { kind: "none" } : { kind: "q3", points: armor, protection: Math.fround(0.66) } },
    activeWeapon: weapon?.item ?? null, ammo: weapon === undefined || weapon.ammo === null ? null : { item: weapon.ammo, count: state.ammo[weapon.weapon] ?? 0 },
    inventory: definitions.flatMap(value => [{ item: value.item, count: count(value.item), capacity: 1 }, ...(value.ammo === null ? [] : [{ item: value.ammo, count: count(value.ammo), capacity: 200 }])]),
    weaponStatus: weapon === undefined ? null : { source, item: weapon.item, label: weapon.label,
      ammo: weapon.ammo === null || count(weapon.ammo) === -1 ? { kind: "unmetered" } : { kind: "finite", item: weapon.ammo,
        count: count(weapon.ammo), hasAmmoToStart: count(weapon.ammo) > 0, low: false } },
    arsenalWarning: definitions === standardQ3GuestWeapons || definitions === baseQ3GuestWeapons ? q3ArsenalWarning(product, count) : "none",
    items: definitions.map(value => ({ id: value.item, label: value.label, kind: "weapon", sourceOrdinal: value.weapon,
      owned: count(value.item) > 0, hasAmmo: value.ammo === null || count(value.ammo) !== 0, count: value.ammo === null ? null : count(value.ammo), warningCount: 0 })) };
}
