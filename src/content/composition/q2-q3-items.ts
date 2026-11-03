// SPDX-License-Identifier: GPL-2.0-or-later
/* Quake III items offered to a Quake II primary. Grants land in Q2 destinations through the shared Q3-to-Q2 supply profile. */
import type { OwnedActor } from "../../contracts/identity.ts";
import type { ItemId } from "../../contracts/gameplay.ts";
import { zero } from "../q2/foundation/fields.ts";
import type { Q2Entity, Q2GameServices } from "../q2/foundation/host.ts";
import type { Q2ForeignItemServices, Q2ItemDefinition } from "../q2/foundation/items.ts";
import { Holdable, ItemType, Powerup } from "../q3/base/shared/definitions.ts";
import { itemList as q3ItemList } from "../q3/base/shared/items.ts";
import { q3WeaponItem } from "../q3/foundation/arsenal.ts";
import { Q3_Q2_SUPPLY_PROFILE } from "./q3-q2-supply.ts";

/** Q3-authored items as Q2 definitions. The Q2 module keeps its native definition where a classname collides. */
export function q3ForeignItemDefinitions(services: Q2ForeignItemServices): readonly Q2ItemDefinition[] {
  const definitions: Q2ItemDefinition[] = [];
  for (const foreign of q3ItemList("missionpack")) {
    if (foreign.className === null || foreign.type === ItemType.IT_BAD) continue;
    const visual = {
      classname: foreign.className,
      model: foreign.worldModels[0] ?? "",
      icon: "i_fixme",
      name: foreign.pickupName ?? foreign.className,
      sound: (foreign.pickupSound ?? "sound/misc/am_pkup.wav").replace(/^sound\//, ""),
      rotate: true,
    };
    const quantity = foreign.quantity;
    switch (foreign.type) {
      case ItemType.IT_HEALTH:
        definitions.push({
          ...visual,
          kind: "health",
          respawn: 35,
          amount: quantity,
          ignoreMaximum: visual.classname === "item_health_mega" || visual.classname === "item_health_small",
          timed: visual.classname === "item_health_mega",
        });
        break;
      case ItemType.IT_ARMOR:
        definitions.push(
          visual.classname === "item_armor_shard"
            ? { ...visual, kind: "shard", respawn: 25 }
            : { ...visual, kind: "armor", respawn: 25, points: quantity, maximum: 200, normal: quantity >= 100 ? 0.8 : 0.6, energy: 0.3 },
        );
        break;
      case ItemType.IT_AMMO: {
        const weapon = q3WeaponItem(foreign.tag);
        if (weapon === null || weapon.ammo === null) break;
        const source = weapon.ammo;
        definitions.push({
          ...visual,
          kind: "custom",
          respawn: 40,
          capacity: 200,
          quantity,
          coopStay: false,
          droppable: false,
          use: null,
          pickup: (entity, game, player) => ammoPickup(services, entity, game, player, source, quantity),
        });
        break;
      }
      case ItemType.IT_WEAPON: {
        const weapon = q3WeaponItem(foreign.tag);
        if (weapon === null) break;
        const source = weapon.item;
        definitions.push({
          ...visual,
          kind: "custom",
          respawn: 30,
          capacity: 32767,
          quantity,
          coopStay: true,
          droppable: false,
          use: null,
          pickup: (entity, game, player) => weaponPickup(services, entity, game, player, source),
        });
        break;
      }
      case ItemType.IT_POWERUP:
      case ItemType.IT_PERSISTANT_POWERUP: {
        const tag = foreign.tag,
          persistent = foreign.type === ItemType.IT_PERSISTANT_POWERUP;
        definitions.push({
          ...visual,
          kind: "custom",
          respawn: persistent ? 0 : 120,
          capacity: 32767,
          quantity: 1,
          coopStay: false,
          droppable: false,
          use: null,
          pickup: (_entity, game, player) => powerupPickup(services, game, player, tag, persistent),
        });
        break;
      }
      case ItemType.IT_HOLDABLE: {
        const tag = foreign.tag;
        definitions.push({
          ...visual,
          kind: "custom",
          respawn: 60,
          capacity: 32767,
          quantity: 1,
          coopStay: false,
          droppable: false,
          use: null,
          pickup: (_entity, game, player) => holdablePickup(services, game, player, tag),
        });
        break;
      }
      case ItemType.IT_TEAM:
        definitions.push({
          ...visual,
          kind: "custom",
          respawn: 0,
          capacity: 32767,
          quantity: 1,
          coopStay: false,
          droppable: false,
          use: null,
          pickup: () => false,
        });
        break;
    }
  }
  return definitions;
}

function ammoPickup(services: Q2ForeignItemServices, entity: Q2Entity, game: Q2GameServices, player: OwnedActor, source: ItemId, quantity: number): boolean {
  const destination = Q3_Q2_SUPPLY_PROFILE.ammo.find(entry => entry.source === source)?.destinations[0];
  if (destination === undefined) return false;
  const native = services.item(destination.slice(3));
  services.ensure(player, game, destination, native?.kind === "ammo" ? native.capacity : 200);
  return game.host.inventory.give(player, destination, entity.count || quantity) !== 0;
}

function weaponPickup(services: Q2ForeignItemServices, entity: Q2Entity, game: Q2GameServices, player: OwnedActor, source: ItemId): boolean {
  const destination = Q3_Q2_SUPPLY_PROFILE.weapons.find(entry => entry.source === source)?.destinations[0];
  if (destination === undefined) return false;
  const native = services.item(destination.slice(3));
  if (native?.kind !== "weapon") return false;
  const previous = services.weaponOwned(game, player.id, native);
  services.ensure(player, game, destination, 32767);
  game.host.inventory.give(player, destination, 1);
  let ammoGiven = 0;
  for (const grant of services.weaponAmmo(entity, game, native)) {
    const ammo = services.item(grant.item.slice(3));
    if (ammo?.kind !== "ammo") continue;
    services.ensure(player, game, grant.item, ammo.capacity);
    ammoGiven += game.host.inventory.give(player, grant.item, entity.count || grant.amount);
  }
  if (previous === 0) services.weaponPicked(player.id, destination, true);
  return previous === 0 || ammoGiven > 0;
}

function powerupPickup(services: Q2ForeignItemServices, game: Q2GameServices, player: OwnedActor, tag: Powerup, persistent: boolean): boolean {
  const now = game.host.now(),
    state = services.powers(player.id),
    duration = persistent ? 3600 : 30;
  switch (tag) {
    case Powerup.PW_QUAD:
    case Powerup.PW_DOUBLER:
      state.quadUntil = Math.max(state.quadUntil, now) + duration;
      return true;
    case Powerup.PW_BATTLESUIT:
      state.enviroUntil = Math.max(state.enviroUntil, now) + duration;
      return true;
    case Powerup.PW_INVULNERABILITY:
      state.invulnerabilityUntil = Math.max(state.invulnerabilityUntil, now) + duration;
      game.host.combat.setTraits(player, { invulnerable: true });
      return true;
    case Powerup.PW_HASTE:
    case Powerup.PW_SCOUT:
      state.hasteUntil = Math.max(state.hasteUntil, now) + duration;
      return true;
    case Powerup.PW_INVIS:
      state.invisUntil = Math.max(state.invisUntil, now) + duration;
      return true;
    case Powerup.PW_FLIGHT:
      state.flightUntil = Math.max(state.flightUntil, now) + duration;
      return true;
    case Powerup.PW_REGEN:
    case Powerup.PW_GUARD: {
      state.regenUntil = Math.max(state.regenUntil, now) + duration;
      if (tag === Powerup.PW_GUARD) {
        const health = game.host.combat.read(player.id)?.health ?? 0;
        if (health < 100) game.host.combat.setHealth(player, 100);
      }
      const timer = game.create("regen_timer");
      timer.owner = player.id;
      game.schedule(timer, 1, services.regenThink);
      return true;
    }
    case Powerup.PW_AMMOREGEN: {
      for (const ammo of services.ammunition())
        if (ammo.kind === "ammo") {
          services.ensure(player, game, services.itemId(ammo), ammo.capacity);
          game.host.inventory.give(player, services.itemId(ammo), 999);
        }
      return true;
    }
    default:
      return false;
  }
}

function holdablePickup(services: Q2ForeignItemServices, game: Q2GameServices, player: OwnedActor, tag: Holdable): boolean {
  const playerEntity = game.entity(player.id);
  switch (tag) {
    case Holdable.HI_MEDKIT: {
      const health = game.host.combat.read(player.id)?.health ?? 0,
        maximum = playerEntity?.maxHealth || 100;
      if (health < 1 || health >= maximum) return false;
      game.host.combat.setHealth(player, maximum);
      return true;
    }
    case Holdable.HI_INVULNERABILITY: {
      const now = game.host.now(),
        state = services.powers(player.id);
      state.invulnerabilityUntil = Math.max(state.invulnerabilityUntil, now) + 30;
      game.host.combat.setTraits(player, { invulnerable: true });
      return true;
    }
    case Holdable.HI_KAMIKAZE: {
      if (playerEntity === null) return false;
      game.radiusDamage(playerEntity, player.id, 300, null, 300, 27);
      const body = game.body(playerEntity);
      game.damage(player.id, playerEntity, player.id, 10000, 0, zero, body.origin, zero, 0);
      return true;
    }
    case Holdable.HI_TELEPORTER:
    case Holdable.HI_PORTAL: {
      const spots = [...game.entities.values()].filter(
        candidate => candidate.classname === "info_player_deathmatch" || candidate.classname === "info_player_start",
      );
      const spot = spots[Math.floor(game.host.random() * spots.length)],
        body = game.host.bodies.read(player.id);
      if (spot === undefined || body === null) return false;
      game.host.bodies.unlink(player);
      game.host.bodies.write(player, { ...body, origin: game.body(spot).origin, velocity: zero, ground: null });
      game.host.bodies.link(player);
      return true;
    }
    default:
      return false;
  }
}
