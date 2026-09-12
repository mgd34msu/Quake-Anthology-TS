import type { ActorId } from "../../../contracts/identity.ts";
import type { ItemId } from "../../../contracts/gameplay.ts";
import { Q3_WEAPON_ITEMS, q3WeaponItem } from "../../../content/q3/foundation/arsenal.ts";
import { Weapon, WeaponState } from "../../../content/q3/base/shared/definitions.ts";
import { BotInventory } from "../../../bots/behavior/q3/ai-definitions.ts";
import { updateQ3BotWeaponInventory } from "../../../bots/behavior/q3/ai-combat.ts";
import { createBotArsenalKnowledge } from "../../../bots/behavior/q3/arsenal-knowledge.ts";
import type { SharedSimulation } from "./runtime.ts";

export function createQ3BotKnowledge(options: {
  readonly simulation: Pick<SharedSimulation, "selectedQ3WeaponSource" | "inventory" | "combat">;
  readonly actorForClient: (client: number) => ActorId | null;
}) {
  const source = options.simulation.selectedQ3WeaponSource();
  if (source === null) throw new Error("Q3 bot weapon knowledge requires an actual selected Q3 arsenal");
  const inventory = options.simulation.inventory;
  const entries = Q3_WEAPON_ITEMS.filter(entry => entry.weapon <= Weapon.WP_GRAPPLING_HOOK);
  const actorsForHandle = new Map<number, ActorId>();
  const actorForClient = (client: number): ActorId | null => {
    const actor = options.actorForClient(client);
    return actor !== null && source.has(actor) ? actor : null;
  };
  const sourceState = (client: number) => {
    const actor = actorForClient(client);
    if (actor === null) return null;
    const arsenal = source.read(actor);
    if (arsenal.state.kind !== "q3") throw new Error("Selected Q3 source returned a foreign arsenal");
    return arsenal.state;
  };
  const knowledge = createBotArsenalKnowledge({
    updateInventory(state) {
      const actor = actorForClient(state.client);
      if (actor === null) actorsForHandle.delete(state.ws); else actorsForHandle.set(state.ws, actor);
      for (let index = 0; index < 200; index++) state.inventory[index] = 0;
      const combat = actor === null ? null : options.simulation.combat.read(actor);
      state.inventory[BotInventory.HEALTH] = combat?.health ?? 0;
      state.inventory[BotInventory.ARMOR] = combat === null || combat.armor.kind === "none" ? 0 : combat.armor.points;
      updateQ3BotWeaponInventory(state, weapon => {
        const entry = q3WeaponItem(weapon);
        return actor !== null && entry !== null && inventory.count(actor, entry.item) > 0;
      }, weapon => {
        const entry = q3WeaponItem(weapon);
        return actor === null || entry?.ammo == null ? 0 : inventory.count(actor, entry.ammo);
      });
    },
    candidates(library, handle) {
      const actor = actorsForHandle.get(handle);
      return entries.flatMap(entry => {
        const info = library.weapons.getWeaponInfo(handle, entry.weapon);
        return info === undefined || !info.valid ? [] : [{ info,
          maximumRange: entry.weapon === Weapon.WP_GAUNTLET ? 60 : null,
          melee: entry.weapon === Weapon.WP_GAUNTLET, personalityRole: entry.weapon,
          supply: { weapon: entry.item, owned: actor !== undefined && inventory.count(actor, entry.item) > 0,
            ammo: entry.ammo === null ? null : { item: entry.ammo, perShot: 1 } } }];
      });
    },
  });
  return { knowledge, uncoveredWeapons: [],
    resolveWeapon(client: number, decisionSlot: number): ItemId | null {
      const actor = actorForClient(client), entry = entries.find(entry => entry.weapon === decisionSlot);
      return actor !== null && entry !== undefined && inventory.count(actor, entry.item) > 0
        && (entry.ammo === null || inventory.count(actor, entry.ammo) !== 0) ? entry.item : null;
    },
    sourceWeapon(client: number): number { return sourceState(client)?.sourceWeapon ?? Weapon.WP_NONE; },
    sourceWeaponState(client: number): WeaponState {
      const phase = sourceState(client)?.state ?? WeaponState.WEAPON_READY;
      switch (phase) {
        case WeaponState.WEAPON_READY: return WeaponState.WEAPON_READY;
        case WeaponState.WEAPON_RAISING: return WeaponState.WEAPON_RAISING;
        case WeaponState.WEAPON_DROPPING: return WeaponState.WEAPON_DROPPING;
        case WeaponState.WEAPON_FIRING: return WeaponState.WEAPON_FIRING;
        default: throw new Error("Selected Q3 source has an invalid weapon phase");
      }
    },
  };
}
