/* hipmisc.qc / hip_expl.qc / hiprubbl.qc / hipquake.qc. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import type { Q1Foundation } from "../../foundation/runtime.ts";
import type { Q1Event } from "../../foundation/types.ts";
import { POINT, ZERO, vadd } from "../../foundation/types.ts";
import { later, number } from "./common.ts";

function sound(game: Q1Foundation, entity: Q1Actor, path: string, channel: Extract<Q1Event, { kind: "sound" }>["channel"] = "auto"): undefined {
  return game.host.emit({ kind: "sound", actor: entity.actor.id, path, channel, volume: entity.number("volume", 1), attenuation: entity.speed });
}
function playSound(game: Q1Foundation, entity: Q1Actor): undefined {
  let path = entity.text("noise");
  if ((entity.spawnflags & 1) !== 0) { const active = entity.number("sound_state") === 0; number(entity, "sound_state", active ? 1 : 0); if (!active) path = "misc/null.wav"; }
  const channel = entity.number("impulse");
  return sound(game, entity, path, channel === 0 ? "auto" : channel === 1 ? "weapon" : channel === 2 ? "voice" : channel === 3 ? "item" : channel === 4 ? "body" : channel === 5 ? 5 : channel === 6 ? 6 : 7);
}
function soundSpawn(game: Q1Foundation, entity: Q1Actor, periodic: boolean): undefined {
  if (entity.number("volume") === 0) number(entity, "volume", 1);
  entity.speed = entity.speed === 0 ? 1 : entity.speed === -1 ? 0 : entity.speed;
  if ((entity.spawnflags & 1) !== 0 && entity.number("impulse") === 0) number(entity, "impulse", 7);
  entity.use = game.named.use(entity, "hip:play_sound");
  if (periodic) { entity.wait ||= 20; entity.delay ||= 2; later(game, entity, Math.max(entity.delay, entity.wait * game.host.random()), "hip:play_sound"); }
  return undefined;
}
function becomeExplosion(game: Q1Foundation, entity: Q1Actor): undefined {
  entity.solid = "none"; entity.movement = "none"; entity.touch = null; entity.model = "progs/s_explod.spr"; entity.frame = 0;
  game.setBody(entity, { velocity: ZERO }); game.link(entity); return later(game, entity, 0.1, "base:explosion_frame");
}
function explode(game: Q1Foundation, entity: Q1Actor): undefined {
  game.useTargets(entity, entity.activator); sound(game, entity, entity.damage < 120 ? "misc/shortexp.wav" : "misc/longexpl.wav");
  game.radiusDamage(entity.actor.id, entity.owner, entity.damage, entity.actor.id, null);
  if ((entity.spawnflags & 1) !== 0) game.effect("explosion", game.body(entity).origin);
  return becomeExplosion(game, entity);
}
function multiExplode(game: Q1Foundation, entity: Q1Actor): undefined {
  later(game, entity, entity.wait, "hip:multi_explode");
  if (entity.number("explosion_state") === 0) { number(entity, "explosion_state", 1); number(entity, "duration", game.time + entity.number("duration")); game.useTargets(entity, entity.activator); }
  if (game.time > entity.number("duration")) return game.remove(entity);
  const body = game.body(entity), min = vadd(body.origin, body.bounds.min), max = vadd(body.origin, body.bounds.max);
  const explosion = game.create("hip_explosion"); explosion.owner = entity.owner; explosion.damage = entity.damage;
  game.setOrigin(explosion, { x: min.x + game.host.random() * (max.x - min.x), y: min.y + game.host.random() * (max.y - min.y), z: min.z + game.host.random() * (max.z - min.z) });
  game.host.emit({ kind: "sound", actor: explosion.actor.id, path: "misc/shortexp.wav", channel: "voice", volume: entity.number("volume"), attenuation: entity.speed });
  game.radiusDamage(explosion.actor.id, entity.owner, entity.damage, entity.actor.id, null);
  if ((entity.spawnflags & 1) !== 0) game.effect("explosion", game.body(explosion).origin);
  return becomeExplosion(game, explosion);
}
export function multiExplosion(game: Q1Foundation, _source: Q1Actor, origin: Vec3, radius: number, damage: number, duration: number, pause: number, volume: number): Q1Actor {
  const entity = game.create("hip_multi_explosion"); entity.damage = damage; entity.wait = pause; entity.owner = game.world?.actor.id ?? null;
  number(entity, "duration", duration); number(entity, "volume", volume);
  game.setBody(entity, { origin, bounds: { min: { x: -radius, y: -radius, z: -radius }, max: { x: radius, y: radius, z: radius } } });
  multiExplode(game, entity); return entity;
}
export function earthquakeAfterPhysics(game: Q1Foundation, actor: ActorId): undefined {
  const world = game.world; if (world === null) return undefined;
  const owner = game.host.actors.resolveOwned(actor), body = game.host.bodies.read(actor); if (owner === null || body === null) return undefined;
  if (world.number("hip:earthquake") > game.time) {
    if (world.number("hip:quakeactive") === 0) { game.sound(owner, "misc/quake.wav", "voice", 0); number(world, "hip:quakeactive", 1); }
    if (body.ground !== null) game.host.bodies.write(owner, { ...body, velocity: vadd(body.velocity, { x: 0, y: 0, z: game.host.random() * 150 }) });
  } else if (world.number("hip:quakeactive") === 1) { game.sound(owner, "misc/quakeend.wav", "voice", 0); number(world, "hip:quakeactive", 0); }
  return undefined;
}
export function registerHipnoticMisc(game: Q1Foundation): undefined {
  game.named.register("hip:play_sound", { use: playSound, action: (g, e) => { later(g, e, Math.max(e.delay, e.wait * g.host.random()), "hip:play_sound"); return playSound(g, e); } });
  for (const classname of ["play_sound", "play_sound_triggered", "random_thunder", "random_thunder_triggered"]) game.registerSpawn(classname, (g, e) => {
    const thunder = classname.startsWith("random_thunder"); if (thunder) e.fields.set("noise", "ambience/thunder1.wav");
    soundSpawn(g, e, !classname.endsWith("_triggered")); if (thunder) number(e, "impulse", 6); return undefined;
  });
  const ambient: readonly (readonly [string, string])[] = [["ambient_humming", "humming"], ["ambient_rushing", "rushing"], ["ambient_running_water", "runwater"], ["ambient_fan_blowing", "fanblow"], ["ambient_waterfall", "waterfal"], ["ambient_riftpower", "riftpowr"]];
  for (const [classname, path] of ambient) game.registerSpawn(classname, (g, e) => g.host.emit({ kind: "ambient", origin: g.body(e).origin, path: `ambient/${path}.wav`, volume: e.number("volume") || 0.5, attenuation: 3 }));
  game.registerSpawn("info_command", (g, e) => e.message === "" ? undefined : g.host.emit({ kind: "server-command", text: e.message }));
  game.named.register("hip:teleport_effect", { use: (g, e) => { g.effect("teleport", g.body(e).origin); return g.sound(e, "misc/r_tele1.wav"); } });
  game.registerSpawn("effect_teleport", (g, e) => { e.use = g.named.use(e, "hip:teleport_effect"); return undefined; });
  game.named.register("hip:explode", { action: explode, use: (g, e, _other, a) => {
    e.activator = a; if (e.delay === 0) return explode(g, e); const delay = e.delay; e.delay = 0; return later(g, e, delay, "hip:explode");
  } });
  game.named.register("hip:multi_explode", { action: multiExplode, use: (g, e, _other, a) => {
    e.activator = a; if (e.delay === 0) return multiExplode(g, e); const delay = e.delay; e.delay = 0; return later(g, e, delay, "hip:multi_explode");
  } });
  for (const classname of ["func_exploder", "func_multi_exploder"]) game.registerSpawn(classname, (g, e) => {
    const multi = classname === "func_multi_exploder"; e.damage = e.damage === 0 ? 120 : Math.max(0, e.damage); e.speed ||= 1;
    if (e.number("volume") === 0) number(e, "volume", multi ? 0.5 : 1);
    if (multi) { e.model = ""; e.movement = "none"; e.wait ||= 0.25; if (e.number("duration") === 0) number(e, "duration", 1); number(e, "explosion_state", 0); }
    e.use = g.named.use(e, multi ? "hip:multi_explode" : "hip:explode"); return undefined;
  });
  game.named.register("hip:rubble_touch", { touch: (g, e, other) => {
    if (e.number("ltime") < e.number("pausetime") || !g.host.combat.read(other)?.canTakeDamage) return undefined;
    g.damage(other, e.actor.id, e.owner, 10); g.sound(e, "zombie/z_hit.wav", "weapon"); return number(e, "pausetime", e.number("ltime") + 0.1);
  } });
  game.named.register("hip:rubble_use", { use: (g, e) => {
    for (let index = 0; index < Math.max(1, e.count); index++) {
      const which = e.number("cnt") || Math.floor(1 + 3 * g.host.random()), piece = g.create("hip_rubble");
      piece.model = `progs/rubble${which === 1 ? 1 : which === 2 ? 3 : 2}.mdl`; piece.movement = "bounce"; piece.solid = "bbox";
      g.setBody(piece, { origin: g.body(e).origin, bounds: POINT, velocity: { x: 70 * (g.host.random() * 2 - 1), y: 70 * (g.host.random() * 2 - 1), z: 140 + 70 * g.host.random() } });
      piece.angularVelocity = { x: g.host.random() * 600, y: g.host.random() * 600, z: g.host.random() * 600 };
      piece.touch = g.named.touch(piece, "hip:rubble_touch"); number(piece, "ltime", g.time); number(e, "pausetime", g.time);
      later(g, piece, 13 + g.host.random() * 10, "SUB_Remove"); g.link(piece);
    }
    return undefined;
  } });
  for (const [index, classname] of ["func_rubble", "func_rubble1", "func_rubble2", "func_rubble3"].entries()) game.registerSpawn(classname, (g, e) => { number(e, "cnt", index); e.use = g.named.use(e, "hip:rubble_use"); return undefined; });
  game.named.register("hip:earthquake", { use: (g, e) => { const world = g.world; return world === null ? undefined : number(world, "hip:earthquake", Math.max(world.number("hip:earthquake"), g.time + e.damage)); } });
  game.registerSpawn("func_earthquake", (g, e) => { e.damage ||= 0.8; e.use = g.named.use(e, "hip:earthquake"); if (g.world !== null) number(g.world, "hip:quakeactive", 0); return undefined; });
  return undefined;
}
