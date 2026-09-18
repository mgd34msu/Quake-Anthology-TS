import { q3PublicPowerupTimers } from "../powerup-timers.ts";
import type { Q3PlayerState } from "../../../../contracts/protocol.ts";
import type { ProviderReference } from "../../../../contracts/content.ts";
import type { ItemId } from "../../../../contracts/gameplay.ts";
import type { PlayerUi } from "../types.ts";
import { Q3_WEAPON_ITEMS, q3WeaponItem } from "../../../../content/q3/foundation/arsenal.ts";
import { q3ArsenalWarning, q3WeaponStatus } from "../arsenal/weapon-status.ts";

/** QVM authority exposes the same public player state as its native protocol clients. */
export function q3GuestPlayerUi(state: Q3PlayerState, source: ProviderReference, nowMilliseconds: number): PlayerUi {
  const definitions = Q3_WEAPON_ITEMS.filter(value => value.weapon <= 10), weapon = q3WeaponItem(state.weapon);
  const count = (item: ItemId): number => {
    const definition = definitions.find(value => value.item === item || value.ammo === item);
    return definition === undefined ? 0 : definition.item === item ? ((state.stats[2] ?? 0) & (1 << definition.weapon)) !== 0 ? 1 : 0 : state.ammo[definition.weapon] ?? 0;
  };
  if (state.weapon !== 0 && !definitions.some(definition => definition.weapon === state.weapon))
    throw new Error(`Q3 guest weapon ${state.weapon} has no registered shared item projection`);
  const knownWeapons = definitions.reduce((mask, definition) => mask | (1 << definition.weapon), 0);
  if (((state.stats[2] ?? 0) & ~knownWeapons) !== 0) throw new Error("Q3 guest inventory contains unregistered weapon identifiers");
  const armor = state.stats[3] ?? 0;
  return { powerups: q3PublicPowerupTimers(powerup => state.powerups[powerup] ?? 0, nowMilliseconds), health: state.stats[0] ?? 0, armor: armor === 0 ? { kind: "none" } : { kind: "q3", points: armor, protection: Math.fround(0.66) },
    activeWeapon: weapon?.item ?? null, ammo: weapon?.ammo === null || weapon === null ? null : { item: weapon.ammo, count: state.ammo[weapon.weapon] ?? 0 },
    inventory: definitions.flatMap(value => [{ item: value.item, count: count(value.item), capacity: 1 }, ...(value.ammo === null ? [] : [{ item: value.ammo, count: count(value.ammo), capacity: 200 }])]),
    weaponStatus: q3WeaponStatus(weapon?.item ?? null, "baseq3", count, source), arsenalWarning: q3ArsenalWarning("baseq3", count),
    items: definitions.map(value => ({ id: value.item, label: value.item.slice("q3:weapon/".length), kind: "weapon", sourceOrdinal: value.weapon,
      owned: count(value.item) > 0, hasAmmo: value.ammo === null || count(value.ammo) > 0, count: value.ammo === null ? null : count(value.ammo), warningCount: 0 })) };
}
