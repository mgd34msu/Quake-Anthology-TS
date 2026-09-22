/* quakec_mg1/horde.qc item and key functions. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { ItemId } from "../../../../contracts/gameplay.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import { ZERO, vadd, vsub } from "../../foundation/types.ts";
import type { Q1Horde } from "./index.ts";

interface HordeAmmo { readonly item: ItemId; readonly classname: string; readonly model: string; readonly label: string; readonly amount: number; readonly capacity: number }
function ammoDefinition(type: number, big: boolean): HordeAmmo {
  if (type === 1) return { item: "q1:ammo/shells", classname: "item_shells", model: "shell", label: "$qc_shells", amount: big ? 40 : 20, capacity: 100 };
  if (type === 2) return { item: "q1:ammo/nails", classname: "item_spikes", model: "nail", label: "$qc_nails", amount: big ? 50 : 25, capacity: 200 };
  if (type === 3) return { item: "q1:ammo/rockets", classname: "item_rockets", model: "rock", label: "$qc_rockets", amount: big ? 10 : 5, capacity: 100 };
  return { item: "q1:ammo/cells", classname: "item_cells", model: "batt", label: "$qc_cells", amount: big ? 12 : 6, capacity: 100 };
}

export function registerHordeLoot(horde: Q1Horde): undefined {
  const { game, context } = horde;
  const taken = (entity: Q1Actor, player: ActorId, sound: string): undefined => {
    const actor = game.host.actors.resolveOwned(player); if (actor !== null) game.sound(actor, sound, "item");
    game.effect("pickup", game.body(entity).origin, player); entity.solid = "none"; entity.model = ""; return game.link(entity);
  };
  game.named.register("mg1:horde:ammo_touch", { touch: (_game, entity, other) => {
    if (!game.isPlayer(other) || game.health(other) <= 0) return undefined;
    const definition = ammoDefinition(entity.number("weapon"), false);
    if (game.host.inventory.count(other, definition.item) >= definition.capacity) return undefined;
    const player = game.player(other); if (player !== null && player.weapon === game.chooseBest(player.actor)) game.selectWeapon(player.actor, game.chooseBest(player.actor));
    game.message(other, "$qc_got_item", false, [definition.label]); taken(entity, other, "weapons/lock4.wav");
    for (const id of horde.livingPlayers()) {
      const actor = game.host.actors.resolveOwned(id); if (actor === null) continue;
      game.host.inventory.give(actor, definition.item, entity.number("aflag"));
    }
    const owner = game.entity(entity.owner); if (owner !== null) horde.schedule(owner, "ammo", 20);
    return game.remove(entity);
  } });
  game.named.register("mg1:horde:health_touch", { touch: (_game, entity, other) => {
    const player = game.player(other); if (player === null) return undefined;
    const health = game.health(other); if (health <= 0 || health >= player.maxHealth) return undefined;
    if (context.services.cvar("horde") !== 0 && (context.base.campaign.readFlags() & 2) !== 0) context.setPlayerNumber(other, "hunger_time", game.time + 10);
    const amount = entity.number("healamount"); game.host.combat.setHealth(player.actor, Math.min(health + amount, player.maxHealth));
    game.message(other, "$qc_item_health", false, [amount]); taken(entity, other, entity.text("noise"));
    const owner = game.entity(entity.owner); if (owner !== null) owner.wait = 0; return game.remove(entity);
  } });
  game.named.register("mg1:horde:armor_touch", { touch: (_game, entity, other) => {
    if (!game.isPlayer(other) || game.health(other) <= 0) return undefined;
    const actor = game.host.actors.resolveOwned(other); if (actor === null) return undefined;
    const absorption = entity.classname === "item_armor1" ? 0.3 : entity.classname === "item_armor2" ? 0.6 : 0.8;
    const points = entity.classname === "item_armor1" ? 100 : entity.classname === "item_armor2" ? 150 : 200;
    const armor = game.host.combat.read(other)?.armor.regular;
    if (armor?.kind === "source") return undefined;
    const protection = armor === undefined || armor.kind === "none" ? 0 : armor.points * (armor.kind === "q1" ? armor.absorption : armor.kind === "q2" ? armor.normalProtection : armor.protection);
    if (protection >= absorption * points) return undefined;
    game.host.combat.setRegularArmor(actor, { kind: "q1", points, absorption, item: `q1:${entity.classname}` });
    game.message(other, "$qc_item_armor", false); taken(entity, other, "items/armor1.wav");
    const owner = game.entity(entity.owner); if (owner !== null) owner.wait = 0; return game.remove(entity);
  } });
  game.named.register("mg1:horde:key_touch", { touch: (_game, entity, other) => {
    if (!game.isPlayer(other) || game.health(other) <= 0 || horde.services.isBot(other)) return undefined;
    game.message(other, "$qc_got_item", false, [entity.text("netname")]); taken(entity, other, entity.text("noise"));
    horde.changeKeys(entity.text("horde.key") === "gold" ? "gold" : "silver", 1);
    const manager = horde.manager;
    if (manager !== null && manager.number("key_spawned") !== 0) { manager.wait = 1; horde.schedule(manager, "countdown", 0); }
    return game.remove(entity);
  } });
  game.named.register("mg1:horde:ammo", { action: (_game, entity) => {
    const big = game.host.random() * 4 <= 1, roll = game.host.random() * 20, type = roll <= 7 ? 1 : roll <= 14 ? 2 : roll <= 17 ? 3 : 4, definition = ammoDefinition(type, big);
    const item = game.create(definition.classname), offset = big ? 16 : 12, position = vsub(game.body(entity).origin, { x: offset, y: offset, z: 0 });
    item.model = `maps/b_${definition.model}${big ? 1 : 0}.bsp`; item.fields.set("netname", definition.label); context.setNumber(item, "weapon", type); context.setNumber(item, "aflag", definition.amount);
    item.owner = entity.actor.id; entity.wait = 1; item.movement = "toss"; item.solid = "trigger"; item.movementFlags = 256; item.touch = game.named.touch(item, "mg1:horde:ammo_touch");
    game.setBody(item, { origin: vadd(position, { x: 0, y: 0, z: 1 }), bounds: { min: ZERO, max: { x: 32, y: 32, z: 56 } } }); game.link(item);
    return game.effect("teleport", vadd(position, { x: 0, y: 0, z: 8 }));
  } });
  game.named.register("mg1:horde:item", { action: (_game, entity) => {
    const roll = game.host.random() * 6, health = roll < 5, item = game.create(health ? "item_health" : "item_armor1");
    // The two independent source if statements replace rotten health with ordinary health.
    const position = health ? vsub(game.body(entity).origin, { x: 16, y: 16, z: 0 }) : game.body(entity).origin;
    item.model = health ? "maps/b_bh25.bsp" : "progs/armor.mdl"; item.fields.set("noise", "items/health1.wav"); context.setNumber(item, "healamount", 25);
    item.touch = game.named.touch(item, health ? "mg1:horde:health_touch" : "mg1:horde:armor_touch"); item.owner = entity.actor.id;
    item.movement = "toss"; item.solid = "trigger"; item.movementFlags = 256; entity.wait = 1;
    game.setBody(item, { origin: vadd(position, { x: 0, y: 0, z: 1 }), bounds: health ? { min: ZERO, max: { x: 32, y: 32, z: 56 } } : { min: { x: -16, y: -16, z: 0 }, max: { x: 16, y: 16, z: 56 } } }); game.link(item);
    return game.effect("teleport", vadd(position, { x: 0, y: 0, z: 8 }));
  } });
  const key = (entity: Q1Actor, gold: boolean): undefined => {
    const name = gold ? "gold" : "silver", metal = game.worldType === 1, base = game.worldType === 2, label = `${name}_${metal ? "runekey" : base ? "keycard" : "key"}`;
    const item = game.create(gold ? "item_key2" : "item_key1"); item.fields.set("horde.key", name); item.fields.set("netname", `$qc_${label}`);
    item.fields.set("noise", metal ? "misc/runekey.wav" : base ? "misc/basekey.wav" : "misc/medkey.wav"); item.model = `progs/${metal ? "m" : base ? "b" : "w"}_${gold ? "g" : "s"}_key.mdl`;
    item.target = "horde_manager"; item.movement = "toss"; item.solid = "trigger"; item.movementFlags = 256; if (!metal) item.effects = 4;
    item.touch = game.named.touch(item, "mg1:horde:key_touch"); game.setBody(item, { origin: vadd(game.body(entity).origin, { x: 0, y: 0, z: 32 }), velocity: { x: 0, y: 0, z: 255 }, bounds: { min: { x: -16, y: -16, z: -25 }, max: { x: 16, y: 16, z: 32 } } }); game.link(item);
    context.broadcast(`$qc_horde_${label}_appears`); game.effect("teleport", game.body(item).origin);
    const manager = horde.manager; if (manager !== null) context.setNumber(manager, "key_spawned", 1); return undefined;
  };
  game.named.register("mg1:horde:silver", { action: (_game, entity) => key(entity, false) });
  game.named.register("mg1:horde:gold", { action: (_game, entity) => key(entity, true) });
  game.named.register("mg1:horde:powerup_fade", { action: (_game, entity) => {
    const alpha = entity.number("alpha"); if (alpha <= 0) return game.remove(entity);
    context.alpha(entity, Math.fround(alpha - 0.25 * context.frameTime)); return horde.schedule(entity, "powerup_fade", 0);
  } });
  game.named.register("mg1:horde:powerup_wait", { action: (_game, entity) => {
    if (game.body(entity).velocity.z < 0) return game.remove(entity);
    context.alpha(entity, 1); return horde.schedule(entity, "powerup_fade", 0);
  } });
  game.registerSpawn("info_horde_ammo", (_game, entity) => horde.schedule(entity, "ammo", 10 + game.host.random() * 3));
  game.registerSpawn("info_horde_item", (_game, entity) => { entity.wait = 0; return undefined; });
  game.registerSpawn("info_horde_key", (_game, entity) => { entity.wait = 0; return undefined; });
  return undefined;
}

export function spawnHordePowerup(horde: Q1Horde, dead: Q1Actor): undefined {
  const { game, context } = horde, manager = horde.manager; if (manager === null) return undefined;
  const chance = manager.number("powerup_chance") || 0.025;
  if (game.host.random() >= chance) return context.setNumber(manager, "powerup_chance", chance + 0.025);
  context.setNumber(manager, "powerup_chance", 0.025);
  const invulnerable = game.host.random() < 0.25, powerup = game.create(invulnerable ? "item_artifact_invulnerability" : "item_artifact_super_damage");
  game.spawnEntity(powerup); powerup.movementFlags = 256; powerup.solid = "trigger"; powerup.movement = "bounce";
  game.setBody(powerup, { origin: game.body(dead).origin, velocity: { x: 0, y: 0, z: 300 }, bounds: { min: { x: -12, y: -12, z: -12 }, max: { x: 12, y: 12, z: 12 } } }); game.link(powerup);
  return horde.schedule(powerup, "powerup_wait", 10);
}
