/* hipcount.qc / hiptrig.qc / hip_brk.qc. Copyright id Software. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import type { Q1EntityServices } from "../../foundation/entity-services.ts";
import { ZERO, vadd } from "../../foundation/types.ts";
import { brush, later, number, trigger } from "./common.ts";

function counterOff(game: Q1EntityServices, entity: Q1Actor): undefined {
  if (entity.number("cnt") !== 0 && (entity.spawnflags & 32) !== 0) return number(entity, "aflag", 1);
  entity.use = game.named.use(entity, "hip:counter_start"); number(entity, "aflag", 0); return game.cancel(entity);
}
function counterTick(game: Q1EntityServices, entity: Q1Actor): undefined {
  const count = entity.number("cnt") + 1; number(entity, "cnt", count);
  number(entity, "counter_state", (entity.spawnflags & 16) !== 0 ? Math.floor(game.host.random() * entity.count) + 1 : count);
  game.useTargets(entity, entity.activator);
  later(game, entity, entity.wait, "hip:counter_tick");
  if ((entity.spawnflags & 4) !== 0) counterOff(game, entity);
  if (count >= entity.count) {
    number(entity, "cnt", 0);
    if (entity.number("aflag") !== 0 || (entity.spawnflags & 2) === 0) {
      if ((entity.spawnflags & 1) !== 0) counterOff(game, entity); else game.remove(entity);
    }
  }
  return undefined;
}
function counterStart(game: Q1EntityServices, entity: Q1Actor, activator: ActorId | null): undefined {
  entity.activator = activator; number(entity, "aflag", 0);
  entity.use = (entity.spawnflags & 1) !== 0 ? game.named.use(entity, "hip:counter_stop") : null;
  if ((entity.spawnflags & 8) !== 0) { number(entity, "cnt", 0); number(entity, "counter_state", 0); }
  return entity.delay !== 0 ? later(game, entity, entity.delay, "hip:counter_tick") : counterTick(game, entity);
}
function onCount(game: Q1EntityServices, entity: Q1Actor, other: ActorId | null): undefined {
  const counter = game.entity(other);
  const count = counter?.classname === "func_counter" ? counter.number("counter_state") : 0;
  return count === entity.count ? game.useTargets(entity, other) : undefined;
}
function useKey(game: Q1EntityServices, entity: Q1Actor, activator: ActorId | null): undefined {
  if (activator === null || !game.isPlayer(activator) || entity.attackFinished > game.time) return undefined;
  entity.attackFinished = game.time + 2;
  const gold = (entity.spawnflags & 1) !== 0, key = gold ? "q1:key/gold" : "q1:key/silver";
  const owner = game.host.actors.resolveOwned(activator);
  const sound = game.worldType === 2 ? "base" : game.worldType === 1 ? "rune" : "med";
  if (owner === null || !game.host.inventory.consume(owner, key, 1)) {
    game.message(activator, entity.message || `$qc_need_${gold ? "gold" : "silver"}_${game.worldType === 2 ? "keycard" : game.worldType === 1 ? "runekey" : "key"}`);
    return game.sound(entity, `doors/${sound}try.wav`);
  }
  entity.touch = null; entity.use = null; entity.message = "";
  later(game, entity, 0.1, "SUB_Remove"); game.sound(entity, `doors/${sound}use.wav`);
  return game.useTargets(entity, activator);
}

export function registerHipnoticTriggers(game: Q1EntityServices): undefined {
  game.named.register("hip:counter_tick", { action: counterTick });
  game.named.register("hip:counter_start", { use: (g, e, _other, a) => counterStart(g, e, a), action: (g, e) => counterStart(g, e, null) });
  game.named.register("hip:counter_stop", { use: counterOff });
  game.named.register("hip:oncount", { use: onCount });
  game.registerSpawn("func_counter", (g, e) => {
    e.wait ||= 1; e.count = Math.floor(e.count); if (e.count <= 0) e.count = 10;
    number(e, "cnt", 0); number(e, "counter_state", 0); e.use = g.named.use(e, "hip:counter_start");
    if ((e.spawnflags & 64) !== 0) later(g, e, 0.1, "hip:counter_start"); return undefined;
  });
  game.registerSpawn("func_oncount", (g, e) => { e.count = Math.floor(e.count); if (e.count <= 0) e.count = 1; e.use = g.named.use(e, "hip:oncount"); return undefined; });
  game.named.register("hip:key", { use: (g, e, _other, a) => useKey(g, e, a), touch: useKey });
  game.registerSpawn("trigger_usekey", (g, e) => { trigger(g, e); e.use = g.named.use(e, "hip:key"); e.touch = g.named.touch(e, "hip:key"); return undefined; });
  game.named.register("hip:remove_touch", { touch: (g, e, other) => {
    if (g.isPlayer(other) && (e.spawnflags & 2) === 0 || g.host.classname(other).startsWith("monster_") && (e.spawnflags & 1) === 0) return undefined;
    const victim = g.entity(other); if (victim !== null) { victim.touch = null; victim.model = ""; }
    // The shipped QC removes self here, after hiding other.
    return g.remove(e);
  } });
  game.registerSpawn("trigger_remove", (g, e) => { trigger(g, e); e.touch = g.named.touch(e, "hip:remove_touch"); return undefined; });
  game.named.register("hip:set_gravity", { touch: (g, e, other) => g.isPlayer(other) ? g.setGravity(other, e.number("gravity") === -1 ? 1 : e.number("gravity")) : undefined });
  game.registerSpawn("trigger_setgravity", (g, e) => {
    trigger(g, e); number(e, "gravity", e.number("gravity") === 0 ? -1 : (e.number("gravity") - 1) / 100);
    e.touch = g.named.touch(e, "hip:set_gravity"); return undefined;
  });
  // Shipped trigger_command binds oncount_use; preserve the actual binding.
  game.registerSpawn("trigger_command", (g, e) => { e.use = g.named.use(e, "hip:oncount"); return undefined; });
  game.named.register("hip:decoy_trigger", { touch: (g, e, other) => {
    if (g.host.classname(other) !== "monster_decoy") return undefined;
    e.touch = null; later(g, e, 0.1, "SUB_Remove"); return g.useTargets(e, other);
  } });
  game.registerSpawn("trigger_decoy_use", (g, e) => { if (g.options.deathmatch !== 0) return g.remove(e); trigger(g, e); e.touch = g.named.touch(e, "hip:decoy_trigger"); return undefined; });
  game.named.register("hip:waterfall", { touch: (g, e, other) => {
    if (!g.isPlayer(other)) return undefined;
    const owner = g.host.actors.resolveOwned(other), body = g.host.bodies.read(other); if (owner === null || body === null) return undefined;
    const velocity = vadd(body.velocity, e.movedir);
    return g.host.bodies.write(owner, { ...body, velocity: { ...velocity, x: Math.fround(velocity.x + e.count * (g.host.random() - 0.5)), y: Math.fround(velocity.y + e.count * (g.host.random() - 0.5)) } });
  } });
  game.registerSpawn("trigger_waterfall", (g, e) => {
    trigger(g, e); e.count ||= 100; const speed = e.speed || 50;
    e.movedir = { x: Math.fround(e.movedir.x * speed), y: Math.fround(e.movedir.y * speed), z: Math.fround(e.movedir.z * speed) };
    e.touch = g.named.touch(e, "hip:waterfall"); return undefined;
  });
  game.named.register("hip:threshold_pain", { pain: (g, e) => g.host.combat.setHealth(e.actor, e.maxHealth) });
  game.named.register("hip:threshold_die", { die: (g, e, attacker) => {
    g.host.combat.setHealth(e.actor, e.maxHealth); e.damageable = false; g.useTargets(e, attacker); e.damageable = true;
    return (e.spawnflags & 1) === 0 ? g.remove(e) : undefined;
  } });
  game.registerSpawn("trigger_damagethreshold", (g, e) => {
    brush(g, e); if ((e.spawnflags & 2) !== 0) e.model = "";
    e.maxHealth ||= 60; g.host.combat.setHealth(e.actor, e.maxHealth); e.damageable = true;
    e.pain = g.named.pain(e, "hip:threshold_pain"); e.die = g.named.die(e, "hip:threshold_die"); return undefined;
  });
  game.named.register("hip:breakaway", { use: (g, e) => g.remove(e) });
  game.registerSpawn("func_breakawaywall", (g, e) => { brush(g, e); e.use = g.named.use(e, "hip:breakaway"); return g.setBody(e, { angles: ZERO }); });
  return undefined;
}
