/* earthq.qc / buzzsaw.qc / lightnin.qc. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import { sameActor } from "../../../../contracts/identity.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import type { Q1Foundation } from "../../foundation/runtime.ts";
import { POINT, ZERO, normalize, vadd, vsub, vscale } from "../../foundation/types.ts";
import { later, number, trigger } from "./common.ts";

export function rogueEarthquake(game: Q1Foundation, actor: ActorId, intensity: number): undefined {
  const owner = game.host.actors.resolveOwned(actor), body = game.host.bodies.read(actor); if (owner === null || body === null || body.ground === null) return undefined;
  game.host.bodies.write(owner, { ...body, velocity: vadd(body.velocity, { x: game.host.random() * intensity * 2 - intensity, y: game.host.random() * intensity * 2 - intensity, z: game.host.random() * intensity * 2 - intensity }) }); return undefined;
}
function quakeStop(game: Q1Foundation, entity: Q1Actor): undefined { if (game.world !== null) number(game.world, "rogue:earthquake_active", 0); return later(game, entity, (entity.spawnflags & 1) !== 0 ? game.host.random() * entity.wait : entity.wait, "rogue:quake_start"); }
function quakeRumble(game: Q1Foundation, entity: Q1Actor): undefined { if (entity.attackFinished < game.time) return quakeStop(game, entity); game.sound(entity, "equake/rumble.wav", "voice", 0); return later(game, entity, 1, "rogue:quake_rumble"); }
function sawStart(game: Q1Foundation, entity: Q1Actor): undefined { entity.touch = game.named.touch(entity, "rogue:saw_touch"); entity.use = null; const target = game.find(entity.target)[0]?.actor.id ?? null; entity.references.set("goalentity", target); entity.references.set("movetarget", target); return later(game, entity, 0.1, entity.target === "" ? "rogue:saw_stand" : "rogue:saw_fly"); }
function trailFire(game: Q1Foundation, entity: Q1Actor): undefined {
  if (entity.classname !== "ltrail_end") {
    game.sound(entity, "weapons/lhit.wav", "voice"); const target = game.find(entity.target)[0] ?? game.world; if (target === null) throw new Error("Lightning trail requires worldspawn");
    const start = game.body(entity).origin, end = game.body(target).origin; game.host.emit({ kind: "beam", style: "lightning2", actor: entity.actor.id, start, end });
    const side = { x: -(end.y - start.y) * 16, y: -(end.y - start.y) * 16, z: 0 }, hit: ActorId[] = [];
    for (const offset of [ZERO, side, vscale(side, -1)]) { const trace = game.host.trace({ start: vadd(start, offset), end: vadd(end, offset), bounds: POINT, ignore: entity.actor.id, monsters: true }), actor = trace.actor; if (actor === null || hit.some(prior => sameActor(prior, actor))) continue; hit.push(actor); if (game.host.combat.read(actor)?.canTakeDamage) { game.host.emit({ kind: "particles", origin: trace.end, direction: { x: 0, y: 0, z: 100 }, color: 225, count: entity.number("currentammo") * 4 }); game.damage(actor, entity.actor.id, entity.actor.id, entity.number("currentammo")); } }
  }
  return entity.number("items") < game.time ? later(game, entity, entity.number("frags"), "rogue:ltrail_chain") : later(game, entity, 0.05, "rogue:ltrail_fire");
}
export function registerRogueHazards(game: Q1Foundation): undefined {
  game.named.register("rogue:quake_stop", { action: quakeStop }); game.named.register("rogue:quake_rumble", { action: quakeRumble });
  game.named.register("rogue:quake_start", { action: (g, e) => { if (g.world !== null) number(g.world, "rogue:earthquake_active", 1); e.attackFinished = g.time + ((e.spawnflags & 1) !== 0 ? g.host.random() * e.delay : e.delay); return quakeRumble(g, e); } });
  game.registerSpawn("earthquake", (g, e) => { e.delay ||= 20; e.wait ||= 60; if (e.number("weapon") === 0) number(e, "weapon", 40); if (g.world !== null) { number(g.world, "rogue:earthquake_active", 0); number(g.world, "rogue:earthquake_intensity", e.number("weapon") * 0.5); } g.setBounds(e, POINT); return later(g, e, 1, "rogue:quake_stop"); });
  game.named.register("rogue:earthquake_field", { use: (_g, e) => { e.delay = e.delay === 0 ? 1 : 0; return undefined; }, touch: (g, e, other) => { if (e.delay === 0) return undefined; if (e.attackFinished < g.time) { g.sound(e, "equake/rumble.wav", "voice"); e.attackFinished = g.time + 1; } return g.isPlayer(other) ? rogueEarthquake(g, other, e.number("weapon")) : undefined; } });
  game.registerSpawn("trigger_earthquake", (g, e) => { number(e, "weapon", (e.number("weapon") || 40) * 0.5); e.delay = e.targetname === "" ? 1 : 0; e.touch = g.named.touch(e, "rogue:earthquake_field"); if (e.targetname !== "") e.use = g.named.use(e, "rogue:earthquake_field"); return trigger(g, e); });
  game.named.register("rogue:earthquake_kill", { touch: (g, _e, other) => { if (!g.isPlayer(other)) return undefined; const quake = [...g.entities.values()].find(entity => entity.classname === "earthquake"); if (quake !== undefined) { if (g.world !== null) number(g.world, "rogue:earthquake_active", 0); g.remove(quake); } return undefined; } });
  game.registerSpawn("trigger_earthquake_kill", (g, e) => { e.touch = g.named.touch(e, "rogue:earthquake_kill"); return trigger(g, e); });
  for (const flying of [false, true]) game.named.register(flying ? "rogue:saw_fly" : "rogue:saw_stand", { action: (g, e) => {
    e.frame = flying ? 1 : 0; if (e.number("pain_finished") < g.time) { g.host.emit({ kind: "sound", actor: e.actor.id, path: "buzz/buzz1.wav", channel: "voice", volume: 0.2, attenuation: 1 }); number(e, "pain_finished", g.time + 1); }
    const body = g.body(e); if (flying) { const goal = g.entity(e.references.get("goalentity") ?? null) ?? g.world; if (goal === null) throw new Error("Buzzsaw requires worldspawn"); g.setOrigin(e, vadd(body.origin, vscale(normalize(vsub(g.body(goal).origin, body.origin)), e.speed))); }
    g.setBody(e, { angles: { ...body.angles, x: body.angles.x - 60 } }); e.angularVelocity = { ...e.angularVelocity, x: 60 }; return later(g, e, 0.1, flying ? "rogue:saw_fly" : "rogue:saw_stand");
  } });
  game.named.register("rogue:saw_start", { action: sawStart, use: sawStart });
  game.named.register("rogue:saw_touch", { touch: (g, e, other) => { if (!g.isPlayer(other) && ((g.entity(other)?.movementFlags ?? 0) & 32) === 0) return undefined; if (e.attackFinished < g.time) { g.sound(e, "buzz/buzz.wav", "weapon"); e.attackFinished = g.time + 2; } g.damage(other, e.actor.id, e.actor.id, e.number("currentammo"));
    const goal = g.entity(e.references.get("goalentity") ?? null) ?? g.world, body = g.host.bodies.read(other), owner = g.host.actors.resolveOwned(other); if (goal === null || body === null || owner === null) return undefined;
    const direction = vscale(normalize(vsub(g.body(goal).origin, g.body(e).origin)), 200); g.effect("meat-spray", g.body(e).origin, other); g.host.bodies.write(owner, { ...body, velocity: { ...direction, z: 200 } }); return undefined;
  } });
  game.registerSpawn("buzzsaw", (g, e) => { e.model = "progs/buzzsaw.mdl"; e.damageable = false; e.solid = "trigger"; e.movement = "fly"; const yaw = g.body(e).angles.y;
    if (yaw === 0 || yaw === 180) g.setBounds(e, { min: { x: -18, y: 0, z: -18 }, max: { x: 18, y: 0, z: 18 } }); else if (yaw === 90 || yaw === 270) g.setBounds(e, { min: { x: 0, y: -18, z: -18 }, max: { x: 0, y: 18, z: 18 } }); else throw new Error("Buzzsaw: Not at 90 degree angle!");
    e.speed ||= 10; if (e.number("currentammo") === 0) number(e, "currentammo", 10); number(e, "pain_finished", g.time + g.host.random() * 2); if (e.targetname === "") return later(g, e, 0.2, "rogue:saw_start"); e.use = g.named.use(e, "rogue:saw_start"); return undefined;
  });
  game.named.register("rogue:ltrail_chain", { action: (g, e) => { g.useTargets(e, e.activator); e.think = g.named.action(e, "SUB_Null"); return undefined; } }); game.named.register("rogue:ltrail_fire", { action: trailFire });
  game.named.register("rogue:ltrail_use", { use: (g, e, other, a) => { e.activator = a;
    if ((e.spawnflags & 1) !== 0) { if (g.entity(other)?.classname !== "ltrail_end") { if ((e.spawnflags & 2) !== 0) { e.spawnflags -= 2; return undefined; } e.spawnflags += 2; } else if ((e.spawnflags & 2) === 0) return undefined; }
    if (e.classname === "ltrail_end") return later(g, e, e.number("frags"), "rogue:ltrail_chain"); number(e, "items", g.time + e.number("weapon")); trailFire(g, e); if (e.classname === "ltrail_start") number(e, "ltrailLastUsed", g.time); return undefined;
  } });
  for (const classname of ["ltrail_start", "ltrail_relay", "ltrail_end"]) game.registerSpawn(classname, (g, e) => { e.movement = "none"; e.solid = "bbox"; e.use = g.named.use(e, "rogue:ltrail_use"); if (e.number("currentammo") === 0) number(e, "currentammo", 25); if (e.number("weapon") === 0) number(e, "weapon", 0.3); if (e.number("frags") === 0) number(e, "frags", 0.3); if (classname === "ltrail_start") { number(e, "ltrailLastUsed", g.time); if ((e.spawnflags & 2) !== 0) { number(e, "items", g.time + 99999999); later(g, e, 0.1, "rogue:ltrail_fire"); } } return undefined; });
  return undefined;
}
