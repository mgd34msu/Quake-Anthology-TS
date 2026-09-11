/* hipitems.qc hazards. Copyright id Software / Hipnotic. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import { sameActor } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import type { Q1EntityServices } from "../../foundation/entity-services.ts";
import { POINT, ZERO, dot, length, normalize, vadd, vscale, vsub } from "../../foundation/types.ts";
import { later, number, vector } from "./common.ts";

export function isStruckByMjolnir(game: Q1EntityServices, actor: ActorId): boolean {
  return [...game.entities.values()].some(entity => (entity.classname === "hipnotic_mjolnir_lightning" || entity.classname === "hipnotic_tesla_lightning") && entity.count === 1 && (() => {
    const enemy = entity.references.get("hipnotic:enemy"); return enemy !== undefined && enemy !== null && sameActor(actor, enemy);
  })());
}
function visible(game: Q1EntityServices, entity: Q1Actor, actor: ActorId): boolean {
  const body = game.host.bodies.read(actor); if (body === null) return false;
  const trace = game.host.trace({ start: vadd(game.body(entity).origin, entity.vector("view_ofs")), end: vadd(body.origin, { x: 0, y: 0, z: game.isPlayer(actor) ? 22 : game.entity(actor)?.vector("view_ofs").z ?? 0 }), bounds: POINT, ignore: entity.actor.id, monsters: false });
  return trace.fraction === 1 && !(trace.inOpen && trace.inWater);
}
function scan(game: Q1EntityServices, entity: Q1Actor, radius: number, includeMonsters: boolean): readonly ActorId[] {
  const origin = game.body(entity).origin, found: ActorId[] = [];
  for (const observation of [...game.host.actors.observations()].reverse()) {
    const actor = observation.id, target = game.entity(actor), body = game.host.bodies.read(actor); if (body === null || ((target?.movementFlags ?? 0) & 128) !== 0 || !game.isPlayer(actor) && (!includeMonsters || ((target?.movementFlags ?? 0) & 32) === 0)) continue;
    if (length(vsub(vadd(body.origin, vscale(vadd(body.bounds.min, body.bounds.max), 0.5)), origin)) <= radius && game.health(actor) > 0 && visible(game, entity, actor)) found.push(actor);
  }
  return found;
}
function lightningDamage(game: Q1EntityServices, entity: Q1Actor, start: Vec3, end: Vec3, from: ActorId | null, amount: number): undefined {
  const inflictor = from ?? game.world?.actor.id; if (inflictor === undefined) throw new Error("Lightning damage requires worldspawn");
  const side = { x: -(end.y - start.y) * 16, y: -(end.y - start.y) * 16, z: 0 }, hit: ActorId[] = [];
  for (const offset of [ZERO, side, vscale(side, -1)]) {
    const trace = game.host.trace({ start: vadd(start, offset), end: vadd(end, offset), bounds: POINT, ignore: entity.actor.id, monsters: true }), actor = trace.actor;
    if (actor === null || hit.some(other => sameActor(actor, other))) continue; hit.push(actor);
    if (!game.host.combat.read(actor)?.canTakeDamage || (game.player(actor)?.powerups.get("hipnotic:wetsuit") ?? 0) !== 0) continue;
    game.host.emit({ kind: "particles", origin: trace.end, direction: { x: 0, y: 0, z: 100 }, color: 225, count: amount * 4 }); game.damage(actor, inflictor, from, amount, null, "direct", "electric");
  }
  return undefined;
}
function mineExplode(game: Q1EntityServices, entity: Q1Actor): undefined {
  game.radiusDamage(entity.actor.id, entity.actor.id, 110, null, null); game.sound(entity, "weapons/r_exp3.wav", "weapon"); game.effect("explosion", game.body(entity).origin);
  game.sound(entity, "misc/null.wav", "voice"); game.setBody(entity, { velocity: ZERO }); entity.touch = null; entity.model = "progs/s_explod.spr"; entity.solid = "none"; entity.frame = 0;
  game.link(entity); return later(game, entity, 0.1, "base:explosion_frame");
}
function mineHome(game: Q1EntityServices, entity: Q1Actor): undefined {
  entity.frame = (entity.frame + 1) % 9; later(game, entity, 0.2, "hip:mine_home");
  if (entity.number("search_time") < game.time) {
    let distance = 2000, selected: ActorId | null = null;
    for (const actor of scan(game, entity, 2000, false)) { const body = game.host.bodies.read(actor); if (body === null) continue; const next = length(vsub(body.origin, game.body(entity).origin)); if (next < distance) { distance = next; selected = actor; } }
    if (selected !== null) game.sound(entity, "hipitems/spikmine.wav", "voice"); entity.references.set("enemy", selected); number(entity, "search_time", game.time + 1.3);
  }
  const enemy = entity.references.get("enemy") ?? null, target = enemy === null ? null : game.host.bodies.read(enemy);
  if (target === null) { game.sound(entity, "misc/null.wav", "voice"); return game.setBody(entity, { velocity: ZERO }); }
  const direction = normalize(vsub(vadd(target.origin, { x: 0, y: 0, z: 10 }), game.body(entity).origin));
  const inFront = dot(normalize(vsub(target.origin, game.body(entity).origin)), game.makeVectors(game.body(entity).angles).forward) > 0.3;
  return game.setBody(entity, { velocity: vscale(direction, game.options.skill * 50 + (inFront ? 50 : 150)) });
}
function lightningThink(game: Q1EntityServices, entity: Q1Actor): undefined {
  if (game.time > entity.delay) return game.remove(entity);
  const start = game.body(entity).origin, end = entity.vector("oldorigin"); if (game.host.checkClient(entity.actor) !== null) game.host.emit({ kind: "beam", style: "lightning2", actor: entity.actor.id, start, end });
  lightningDamage(game, entity, start, end, entity.references.get("lastvictim") ?? null, entity.damage); return later(game, entity, 0.1, "hip:lightning_bolt");
}
function lightningUse(game: Q1EntityServices, entity: Q1Actor): undefined {
  if (game.time >= entity.number("pausetime")) { game.sound(entity, (entity.spawnflags & 2) !== 0 ? "weapons/lstart.wav" : "weapons/lhit.wav"); if (entity.classname === "trap_lightning_triggered") number(entity, "pausetime", game.time + 0.1); }
  let start = game.body(entity).origin, end: Vec3;
  if (entity.target !== "") { const enemy = game.entity(entity.references.get("enemy") ?? null) ?? game.world; if (enemy === null) throw new Error("Lightning requires worldspawn"); end = game.body(enemy).origin; }
  else { entity.movedir = game.makeVectors(game.body(entity).angles).forward; end = game.host.trace({ start, end: vadd(start, vscale(entity.movedir, 600)), bounds: POINT, ignore: entity.actor.id, monsters: false }).end; }
  const direction = normalize(vsub(end, start)), distance = length(vsub(end, start)) / 30, remainder = distance - Math.floor(distance);
  if (remainder > 0) { start = vadd(start, vscale(direction, (remainder - 1) * 15)); end = vsub(end, vscale(direction, (remainder - 1) * 15)); }
  if (entity.number("duration") > 0.1) {
    const bolt = game.create("hipnotic_lightning"); game.setOrigin(bolt, start); vector(bolt, "oldorigin", end); bolt.references.set("lastvictim", entity.actor.id); bolt.damage = entity.damage; bolt.delay = game.time + entity.number("duration"); return lightningThink(game, bolt);
  }
  if (game.host.checkClient(entity.actor) !== null) game.host.emit({ kind: "beam", style: "lightning2", actor: entity.actor.id, start, end }); return lightningDamage(game, entity, start, end, entity.actor.id, entity.damage);
}
function teslaScan(game: Q1EntityServices, entity: Q1Actor): readonly ActorId[] {
  const targets: ActorId[] = [];
  for (const actor of scan(game, entity, entity.number("distance"), (entity.spawnflags & 1) !== 0)) { if (isStruckByMjolnir(game, actor)) continue; targets.push(actor); if (targets.length === entity.count) break; }
  return targets;
}
function teslaBolt(game: Q1EntityServices, entity: Q1Actor): undefined {
  const owner = game.entity(entity.owner); if (owner !== null) number(owner, "attack_state", 2);
  const enemy = entity.references.get("hipnotic:enemy") ?? null, target = enemy === null ? null : game.host.bodies.read(enemy);
  if (game.time > entity.delay || target === null) return game.remove(entity);
  const start = game.body(entity).origin, trace = game.host.trace({ start, end: target.origin, bounds: POINT, ignore: entity.actor.id, monsters: false });
  if (trace.fraction !== 1 || enemy === null || game.health(enemy) <= 0 || length(vsub(start, target.origin)) > entity.number("distance") + 10) return game.remove(entity);
  game.host.emit({ kind: "beam", style: "lightning2", actor: entity.actor.id, start, end: trace.end }); lightningDamage(game, entity, start, trace.end, entity.references.get("lastvictim") ?? null, entity.damage);
  return later(game, entity, 0.1, "hip:tesla_bolt");
}
function teslaThink(game: Q1EntityServices, entity: Q1Actor): undefined {
  if (entity.number("hazard_state") === 0) return later(game, entity, 0.25, "hip:tesla_think");
  const state = entity.number("attack_state");
  if (state === 0) {
    if (teslaScan(game, entity).length > 0) { if (entity.wait > 0) game.sound(entity, "misc/tesla.wav"); number(entity, "attack_state", 1); return later(game, entity, entity.wait, "hip:tesla_think"); }
    if (entity.delay > 0 && game.time > entity.number("search_time")) number(entity, "attack_state", 3); return later(game, entity, 0.25, "hip:tesla_think");
  }
  if (state === 1) {
    for (const actor of teslaScan(game, entity)) {
      game.sound(entity, "hipweap/mjolhit.wav"); const bolt = game.create("hipnotic_tesla_lightning"); bolt.count = 1; bolt.owner = entity.actor.id; bolt.references.set("hipnotic:enemy", actor); bolt.references.set("lastvictim", entity.references.get("lastvictim") ?? null);
      bolt.delay = game.time + (entity.number("duration") > 0 ? entity.number("duration") : 9999); bolt.damage = entity.damage; number(bolt, "distance", entity.number("distance")); game.setOrigin(bolt, game.body(entity).origin); later(game, bolt, 0, "hip:tesla_bolt");
    }
    number(entity, "attack_state", 2); return later(game, entity, 1, "hip:tesla_think");
  }
  if (state === 2) { number(entity, "attack_state", 3); return later(game, entity, 0.2, "hip:tesla_think"); }
  number(entity, "attack_state", 0); return entity.classname === "trap_gods_wrath" ? game.cancel(entity) : later(game, entity, 0.1, "hip:tesla_think");
}
export function registerHipnoticHazards(game: Q1EntityServices): undefined {
  game.named.register("hip:mine_home", { action: mineHome });
  game.named.register("hip:mine_first", { action: (g, e) => { number(e, "search_time", 0); e.damageable = true; e.aimedDamage = true; e.use = g.named.use(e, "hip:mine_use"); return later(g, e, 0.1, "hip:mine_home"); } });
  game.named.register("hip:mine_use", { use: (g, e, _other, activator) => { if (activator !== null && g.isPlayer(activator) && (g.player(activator)?.powerups.get("invisibility") ?? 0) <= g.time) { e.references.set("enemy", activator); return later(g, e, 0.1, "hip:mine_home"); } return undefined; } });
  game.named.register("hip:mine_explode", { die: (g, e, attacker) => { e.damageable = false; g.killedMonsters++; g.host.emit({ kind: "monster-killed", actor: e.actor.id, total: g.totalMonsters, found: g.killedMonsters }); g.useTargets(e, attacker); return mineExplode(g, e); }, touch: (g, e, other) => {
    if (g.health(e.actor.id) > 0) { if (["trap_spike_mine", "missile", "grenade", "hiplaser", "proximity_grenade"].includes(g.host.classname(other))) return undefined; g.damage(e.actor.id, e.actor.id, e.actor.id, g.health(e.actor.id) + 10); } return mineExplode(g, e);
  } });
  game.registerSpawn("trap_spike_mine", (g, e) => { if (g.options.deathmatch !== 0) return g.remove(e); e.model = "progs/spikmine.mdl"; e.solid = "bbox"; e.movement = "flymissile"; e.angularVelocity = { x: -50, y: 100, z: 150 }; e.maxHealth = g.options.skill <= 1 ? 200 : 400; g.host.combat.setHealth(e.actor, e.maxHealth); e.frame = 0; e.movementFlags |= 32; g.totalMonsters++; e.touch = g.named.touch(e, "hip:mine_explode"); e.die = g.named.die(e, "hip:mine_explode"); return later(g, e, 0.2, "hip:mine_first"); });
  game.named.register("hip:lightning_bolt", { action: lightningThink }); game.named.register("hip:lightning_use", { use: lightningUse });
  game.named.register("hip:hazard_switch", { use: (g, e) => { number(e, "hazard_state", 1 - e.number("hazard_state")); if (e.number("hazard_state") === 1 && e.think !== null) return g.schedule(e, e.number("huntingcharmer") - g.time, e.think); return undefined; } });
  game.named.register("hip:lightning_think", { action: (g, e) => {
    if (e.number("hazard_state") !== 0) lightningUse(g, e);
    if (e.number("cnt") === 0) { let delay = (e.spawnflags & 1) !== 0 ? e.wait * g.host.random() : e.wait; number(e, "cnt", 1); number(e, "t_length", g.time + e.number("duration") - 0.1); number(e, "pausetime", Math.max(g.time + e.number("duration") - 0.1, g.time + 0.3)); delay = Math.max(delay, e.number("duration")); number(e, "t_width", g.time + delay); }
    if (g.time >= e.number("t_length")) { number(e, "cnt", 0); return later(g, e, e.number("t_width") - g.time, "hip:lightning_think"); } return later(g, e, 0.2, "hip:lightning_think");
  } });
  game.named.register("hip:lightning_first", { action: (g, e) => { if (e.target !== "") e.references.set("enemy", g.find(e.target)[0]?.actor.id ?? null); if (e.classname === "trap_lightning_triggered") return g.cancel(e); return later(g, e, e.number("huntingcharmer") + e.wait + e.number("ltime") - g.time, "hip:lightning_think"); } });
  for (const classname of ["trap_lightning", "trap_lightning_triggered", "trap_lightning_switched"]) game.registerSpawn(classname, (g, e) => { e.wait ||= 1; e.damage ||= 30; if (e.number("duration") === 0) number(e, "duration", 0.1); number(e, "cnt", 0); number(e, "hazard_state", classname === "trap_lightning" ? 1 : e.number("state")); number(e, "huntingcharmer", e.number("nextthink")); e.use = g.named.use(e, classname === "trap_lightning_switched" ? "hip:hazard_switch" : "hip:lightning_use"); return later(g, e, 0.25, "hip:lightning_first"); });
  game.named.register("hip:tesla_bolt", { action: teslaBolt }); game.named.register("hip:tesla_think", { action: teslaThink });
  game.named.register("hip:wrath_use", { use: (g, e, _other, activator) => { if (e.number("attack_state") !== 0) return undefined; number(e, "search_time", g.time + e.delay); e.references.set("lastvictim", activator); return teslaThink(g, e); } });
  for (const classname of ["trap_tesla_coil", "trap_gods_wrath"]) game.registerSpawn(classname, (g, e) => { e.wait ||= 2; e.damage ||= 2 + 5 * g.options.skill; if (e.number("duration") === 0) number(e, "duration", -1); if (e.number("distance") === 0) number(e, "distance", 600); e.delay ||= classname === "trap_gods_wrath" ? 5 : -1; number(e, "hazard_state", e.number("state")); number(e, "attack_state", 0); e.references.set("lastvictim", null); e.use = g.named.use(e, "hip:hazard_switch"); later(g, e, g.host.random(), "hip:tesla_think"); if (classname === "trap_gods_wrath") { e.wait = 0; number(e, "hazard_state", 1); g.cancel(e); e.use = g.named.use(e, "hip:wrath_use"); } return undefined; });
  game.named.register("hip:gravity_well", { action: (g, e) => { number(e, "ltime", g.time); for (const actor of teslaScan(g, e)) { const owner = g.host.actors.resolveOwned(actor), body = g.host.bodies.read(actor); if (owner === null || body === null) continue; const pull = vscale(normalize(vsub(g.body(e).origin, body.origin)), e.speed * ((e.spawnflags & 2) !== 0 && (g.player(actor)?.powerups.get("hipnotic:wetsuit") ?? 0) > g.time ? 0.6 : 1)); g.host.bodies.write(owner, { ...body, velocity: vadd(body.velocity, pull) }); } return later(g, e, 0.1, "hip:gravity_well"); }, touch: (g, e, other) => { if (e.attackFinished > g.time || !g.host.combat.read(other)?.canTakeDamage) return undefined; g.damage(other, e.actor.id, e.actor.id, e.damage); e.attackFinished = g.time + 0.2; return undefined; } });
  game.registerSpawn("trap_gravity_well", (g, e) => { e.solid = "trigger"; e.movement = "none"; e.damage ||= 10000; e.speed ||= 210; if (e.number("distance") === 0) number(e, "distance", 600); e.touch = g.named.touch(e, "hip:gravity_well"); g.setBounds(e, { min: { x: -16, y: -16, z: -16 }, max: { x: 16, y: 16, z: 16 } }); number(e, "ltime", g.time); return later(g, e, 0.1, "hip:gravity_well"); });
  return undefined;
}
