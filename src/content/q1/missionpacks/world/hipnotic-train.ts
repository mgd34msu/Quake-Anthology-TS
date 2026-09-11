/* hiptrain.qc / hipwater.qc / hip_push.qc. Copyright id Software. GPL-2.0-or-later. */
import type { Q1Actor } from "../../foundation/entity.ts";
import type { Q1Foundation } from "../../foundation/runtime.ts";
import { ZERO, vadd, vscale, vsub, vectors } from "../../foundation/types.ts";
import { brush, later, number, targetEvent, vector } from "./common.ts";

function trainNext(game: Q1Foundation, entity: Q1Actor): undefined {
  const current = entity.number("cnt"), corner = game.find(entity.target)[0];
  if (corner === undefined) throw new Error(`hip_train_next: missing ${entity.target}`);
  number(entity, "cnt", corner.speed); entity.target = corner.target;
  if (entity.target === "") throw new Error("hip_train_next: no next target");
  game.sound(entity, entity.text("noise1")); entity.wait = corner.wait;
  const prior = game.entity(entity.references.get("goalentity") ?? null);
  if (prior !== null && prior.text("event") !== "") targetEvent(game, entity, prior.text("event"), prior.message);
  entity.references.set("goalentity", corner.actor.id);
  const next = corner.wait !== 0 ? "hip:train_wait" : "hip:train_next";
  const destination = vsub(game.body(corner).origin, game.body(entity).bounds.min);
  if (current === -1) { game.setOrigin(entity, destination); return later(game, entity, 0.01, next); }
  if (current > 0) entity.speed = current;
  return game.calcMove(entity, destination, entity.speed, game.named.action(entity, next));
}

export function registerHipnoticTrain(game: Q1Foundation): undefined {
  game.named.register("hip:train_next", { action: trainNext });
  game.named.register("hip:train_find", { action: (g, e) => {
    const corner = g.find(e.target)[0]; if (corner === undefined) throw new Error(`hip_func_train_find: missing ${e.target}`);
    e.references.set("goalentity", corner.actor.id); number(e, "cnt", corner.speed); e.target = corner.target;
    g.setOrigin(e, vsub(g.body(corner).origin, g.body(e).bounds.min));
    return e.targetname === "" ? later(g, e, 0.1, "hip:train_next") : undefined;
  } });
  game.named.register("hip:train_wait", { action: (g, e) => {
    if (e.wait !== 0) { g.sound(e, e.text("noise")); if (e.wait === -1) return undefined; const wait = e.wait; e.wait = 0; return later(g, e, wait, "hip:train_next"); }
    return later(g, e, 0.1, "hip:train_next");
  } });
  game.named.register("hip:train_use", { use: (g, e, _other, activator) => {
    const velocity = g.body(e).velocity; if (velocity.x !== 0 || velocity.y !== 0 || velocity.z !== 0) return undefined;
    e.activator = activator; return trainNext(g, e);
  } });
  game.named.register("hip:train_blocked", { blocked: (g, e, other) => {
    if (e.attackFinished > g.time) return undefined; e.attackFinished = g.time + 0.5;
    g.damage(other, e.actor.id, e.actor.id, e.damage, null, "direct", "crush"); return undefined;
  } });
  game.registerSpawn("func_train2", (g, e) => {
    if (e.target === "") throw new Error("func_train2 without a target");
    e.speed ||= 100; e.damage ||= 2; brush(g, e); number(e, "cnt", 1);
    if (e.text("noise") === "") e.fields.set("noise", e.sounds === 1 ? "plats/train2.wav" : "misc/null.wav");
    if (e.text("noise1") === "") e.fields.set("noise1", e.sounds === 1 ? "plats/train1.wav" : "misc/null.wav");
    e.use = g.named.use(e, "hip:train_use"); e.blocked = g.named.blocked(e, "hip:train_blocked"); return later(g, e, 0.1, "hip:train_find");
  });
  game.named.register("hip:bobbing_water", { action: (g, e) => {
    e.count = Math.fround(e.count + e.speed * (g.time - e.number("ltime"))); if (e.count > 360) e.count -= 360;
    g.setOrigin(e, { ...g.body(e).origin, z: Math.fround(vectors({ x: e.count, y: 0, z: 0 }).forward.z * e.number("cnt")) });
    number(e, "ltime", g.time); return later(g, e, 0.02, "hip:bobbing_water");
  } });
  game.registerSpawn("func_bobbingwater", (g, e) => {
    e.solid = "none"; e.movement = "step"; e.count = 0; e.speed = 360 / (e.speed || 4);
    number(e, "cnt", (g.body(e).bounds.max.z - g.body(e).bounds.min.z) / 2); number(e, "ltime", g.time);
    g.setBody(e, { angles: ZERO }); return later(g, e, 0.02, "hip:bobbing_water");
  });
  game.named.register("hip:pushable_touch", { touch: (g, e, other) => {
    const body = g.host.bodies.read(other), owner = g.entity(e.owner); if (body === null || owner === null) return undefined;
    const velocity = body.velocity;
    const yaw = Math.abs(velocity.x) > Math.abs(velocity.y) ? velocity.x > 0 ? 0 : 180 : velocity.y > 0 ? 90 : 270;
    g.host.walkMove(e.actor, yaw, 16 * g.frameSeconds);
    return g.setOrigin(owner, vadd(owner.vector("oldorigin"), vsub(g.body(e).origin, e.vector("oldorigin"))));
  } });
  game.registerSpawn("func_pushable", (g, e) => {
    brush(g, e); const body = g.body(e); vector(e, "oldorigin", body.origin);
    const proxy = g.create("pushablewallproxy"); proxy.owner = e.actor.id; proxy.solid = "bbox"; proxy.movement = "step";
    const size = vscale(vsub(body.bounds.max, body.bounds.min), 0.5), origin = vadd(vscale(vadd(body.bounds.min, body.bounds.max), 0.5), { x: 0, y: 0, z: 1 });
    vector(proxy, "oldorigin", origin); g.setBody(proxy, { origin, bounds: { min: vsub({ x: -1, y: -1, z: 0 }, size), max: vadd({ x: 1, y: 1, z: -2 }, size) } });
    proxy.touch = g.named.touch(proxy, "hip:pushable_touch"); return g.link(proxy);
  });
  return undefined;
}
