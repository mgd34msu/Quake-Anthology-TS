// SPDX-License-Identifier: GPL-2.0-or-later
/* Q3 item pickups on a Q1 primary. GPL-2.0-or-later. */
import { itemList, type ItemDefinition } from "../../q3/base/shared/items.ts";
import { Holdable, ItemType, Powerup } from "../../q3/base/shared/definitions.ts";
import { q3WeaponItem } from "../../q3/foundation/arsenal.ts";
import type { Q1Actor } from "../../q1/foundation/entity.ts";
import type { Q1EntityServices } from "../../q1/foundation/entity-services.ts";
import type { ItemId } from "../../../contracts/gameplay.ts";
import type { Q1Powerup } from "../../q1/foundation/types.ts";
import { Q1_WEAPON_IDS, ZERO } from "../../q1/foundation/types.ts";
import { q1AmmoPickupSelection, takeWeapon, weaponEligibility } from "../../q1/foundation/pickups.ts";
import type { Pickup } from "../../q1/foundation/pickups.ts";
import { Q3_Q1_SUPPLY_PROFILE } from "../q3-q1-supply.ts";

let q3ItemsByClassname: ReadonlyMap<string, ItemDefinition> | null = null;
function q3ItemFor(classname: string): ItemDefinition | null {
  if (q3ItemsByClassname === null) {
    const entries: (readonly [string, ItemDefinition])[] = [];
    for (const item of itemList("missionpack")) if (item.className !== null) entries.push([item.className, item]);
    q3ItemsByClassname = new Map(entries);
  }
  return q3ItemsByClassname.get(classname) ?? null;
}

/** Q3-authored items on a Q1 primary: the authored Q3 definition drives
 * model, sound, quantity and respawn; grants land in Q1 destinations
 * through the shared Q3→Q1 supply profile (or the host pickup admission
 * when a selected arsenal owns pickups). */
function foreignQ3Pickup(entity: Q1Actor): Pickup | null {
  const item = q3ItemFor(entity.classname);
  if (item === null || item.type === ItemType.IT_BAD) return null;
  const model = item.worldModels[0] ?? "",
    sound = item.pickupSound ?? "items/health1.wav";
  const quantity = entity.count !== 0 ? entity.count : item.quantity;
  const base: { readonly model: string; readonly sound: string; readonly bounds: Pickup["bounds"]; readonly skin: number } = {
    model,
    sound,
    bounds: "weapon",
    skin: 0,
  };
  switch (item.type) {
    case ItemType.IT_HEALTH: {
      const cap = entity.classname === "item_health_mega" || entity.classname === "item_health_small" ? 200 : null;
      return {
        ...base,
        respawn: 35,
        take: (runtime, _item, player) => {
          const health = runtime.health(player.actor.id),
            limit = cap ?? player.maxHealth;
          if (health <= 0 || health >= limit) return "refused";
          runtime.host.combat.setHealth(player.actor, Math.min(limit, health + quantity));
          return "taken";
        },
      };
    }
    case ItemType.IT_ARMOR: {
      const shard = entity.classname === "item_armor_shard";
      return {
        ...base,
        respawn: 25,
        take: (runtime, _item, player) => {
          const armor = runtime.host.combat.read(player.actor.id)?.armor.regular;
          if (armor?.kind === "source") return "refused";
          const current = armor === undefined || armor.kind === "none" ? 0 : armor.points;
          const points = shard ? Math.min(200, current + quantity) : Math.max(current, quantity);
          if (points <= current) return "refused";
          runtime.host.combat.setRegularArmor(player.actor, { kind: "q3", points, protection: 2 / 3 });
          return "taken";
        },
      };
    }
    case ItemType.IT_AMMO: {
      const weapon = q3WeaponItem(item.tag);
      if (weapon === null || weapon.ammo === null) return null;
      const offer = { item: weapon.ammo, amount: quantity };
      return {
        ...base,
        supply: { kind: "ammo", offer },
        respawn: 40,
        take: (runtime, _item, player) => {
          if (runtime.pickupAdmission !== null) return runtime.pickupAdmission.ammo(player.actor, offer) ? "taken" : "refused";
          const destination = Q3_Q1_SUPPLY_PROFILE.ammo.find(entry => entry.source === offer.item)?.destinations[0] ?? offer.item;
          const best = runtime.chooseBest(player.actor);
          if (runtime.host.inventory.give(player.actor, destination, offer.amount) === 0) return "refused";
          q1AmmoPickupSelection(runtime, player, best, player.autoSwitch !== "never");
          return "taken";
        },
      };
    }
    case ItemType.IT_WEAPON: {
      const weapon = q3WeaponItem(item.tag);
      if (weapon === null) return null;
      const offer = { item: weapon.item, ammo: weapon.ammo === null ? [] : [{ item: weapon.ammo, amount: quantity }] };
      return {
        ...base,
        supply: { kind: "weapon", offer },
        respawn: 30,
        take: (runtime, _item, player) => {
          const { leave, owned } = weaponEligibility(runtime, player, offer.item);
          if (leave && owned) return "refused";
          if (runtime.pickupAdmission !== null) {
            const accepted = runtime.pickupAdmission.weapon(
              player.actor,
              offer,
              player.autoSwitch === "never" ? "never" : runtime.options.deathmatch === 0 ? "always" : "better",
            );
            return !accepted ? "refused" : leave ? "leave" : "taken";
          }
          const destination = Q3_Q1_SUPPLY_PROFILE.weapons.find(entry => entry.source === offer.item)?.destinations[0];
          const mapped = destination?.startsWith("q1:weapon/") === true ? destination.slice("q1:weapon/".length) : null;
          const weapon = Q1_WEAPON_IDS.find(candidate => candidate === mapped);
          if (weapon === undefined) return "refused";
          return takeWeapon(runtime, player, weapon);
        },
      };
    }
    case ItemType.IT_POWERUP:
    case ItemType.IT_PERSISTANT_POWERUP: {
      const persistent = item.type === ItemType.IT_PERSISTANT_POWERUP;
      const kind: Q1Powerup | null =
        item.tag === Powerup.PW_QUAD || item.tag === Powerup.PW_DOUBLER
          ? "quad"
          : item.tag === Powerup.PW_BATTLESUIT
            ? "suit"
            : item.tag === Powerup.PW_INVIS
              ? "invisibility"
              : item.tag === Powerup.PW_HASTE || item.tag === Powerup.PW_SCOUT
                ? "q3:haste"
                : item.tag === Powerup.PW_REGEN || item.tag === Powerup.PW_GUARD
                  ? "q3:regen"
                  : item.tag === Powerup.PW_FLIGHT
                    ? "q3:flight"
                    : item.tag === Powerup.PW_INVULNERABILITY
                      ? "invulnerability"
                      : null;
      if (kind === null && item.tag !== Powerup.PW_AMMOREGEN) return null;
      return {
        ...base,
        bounds: "artifact",
        respawn: persistent ? -1 : 120,
        take: (runtime, _item, player) => {
          if (item.tag === Powerup.PW_AMMOREGEN) {
            const ammos: readonly ItemId[] = ["q1:ammo/shells", "q1:ammo/nails", "q1:ammo/rockets", "q1:ammo/cells"];
            for (const ammo of ammos) runtime.host.inventory.give(player.actor, ammo, 999);
            return "taken";
          }
          if (kind === null) return "refused";
          runtime.givePowerup(player, kind, persistent ? 3600 : 30);
          if (kind === "q3:flight" && runtime.host.setGravity !== undefined) runtime.setGravity(player.actor.id, 0.1);
          if (item.tag === Powerup.PW_GUARD) runtime.host.combat.setHealth(player.actor, Math.max(runtime.health(player.actor.id), 100));
          return "taken";
        },
      };
    }
    case ItemType.IT_HOLDABLE: {
      return {
        ...base,
        respawn: 60,
        take: (runtime, _item, player) => {
          switch (item.tag) {
            case Holdable.HI_MEDKIT: {
              const health = runtime.health(player.actor.id);
              if (health <= 0 || health >= player.maxHealth) return "refused";
              runtime.host.combat.setHealth(player.actor, player.maxHealth);
              return "taken";
            }
            case Holdable.HI_INVULNERABILITY:
              runtime.givePowerup(player, "invulnerability", 30);
              return "taken";
            case Holdable.HI_KAMIKAZE: {
              runtime.radiusDamage(player.actor.id, player.actor.id, 300, null, null);
              runtime.damage(player.actor.id, player.actor.id, player.actor.id, 10000, null, "direct", "kamikaze");
              return "taken";
            }
            case Holdable.HI_TELEPORTER:
            case Holdable.HI_PORTAL: {
              const spots = [...runtime.entities.values()].filter(
                candidate => candidate.classname === "info_player_deathmatch" || candidate.classname === "info_player_start",
              );
              const spot = spots[Math.floor(runtime.host.random() * spots.length)];
              const body = runtime.host.bodies.read(player.actor.id);
              if (spot === undefined || body === null) return "refused";
              runtime.host.bodies.write(player.actor, { ...body, origin: runtime.body(spot).origin, velocity: ZERO, ground: null });
              runtime.host.bodies.link(player.actor);
              return "taken";
            }
            default:
              return "refused";
          }
        },
      };
    }
    case ItemType.IT_TEAM: {
      // Team objective markers (flags/cubes) have no objective lifecycle on
      // a non-team Q1 primary; they stay visible in place.
      return { ...base, respawn: -1, take: () => "refused" };
    }
  }
  return null;
}

/** Q3-authored items on a Q1 primary are an arsenal concern, so the Q1 foundation reaches them through this hook. */
export function registerQ3PickupHook(game: Q1EntityServices): undefined {
  game.foreignPickup = foreignQ3Pickup;
  return undefined;
}
