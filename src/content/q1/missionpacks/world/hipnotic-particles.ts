/* hip_part.qc / hipholes.qc. Copyright id Software. GPL-2.0-or-later. */
import type { Q1Actor } from "../../foundation/entity.ts";
import type { Q1EntityServices } from "../../foundation/entity-services.ts";
import { ZERO, vadd, vsub, vscale, vectors } from "../../foundation/types.ts";
import { number } from "./common.ts";

function fieldUse(game: Q1EntityServices, entity: Q1Actor, other: Parameters<NonNullable<Q1Actor["use"]>>[0]): undefined {
  const counter = game.entity(other);
  if ((entity.spawnflags & 1) !== 0 && (counter?.classname === "func_counter" ? counter.number("counter_state") : 0) !== entity.number("cnt")) return undefined;
  number(entity, "ltime", game.time + 0.25);
  if (entity.text("noise") !== "") game.sound(entity, entity.text("noise"), "voice");
  if (game.host.checkClient(entity.actor) === null) return undefined;
  const start = vadd(entity.dest1, game.body(entity).origin), end = vadd(entity.dest2, game.body(entity).origin);
  const emit = (x: number, y: number, z: number): undefined => game.host.emit({ kind: "particles", origin: { x, y, z }, direction: ZERO, color: entity.number("color"), count: entity.count });
  if (entity.number("particle_plane") === 0) { for (let x = start.x; x <= end.x; x += 16) for (let z = start.z; z <= end.z; z += 16) emit(x, start.y, z); }
  else if (entity.number("particle_plane") === 1) { for (let y = start.y; y < end.y; y += 16) for (let z = start.z; z < end.z; z += 16) emit(start.x, y, z); }
  else { for (let x = start.x; x < end.x; x += 16) for (let y = start.y; y < end.y; y += 16) emit(x, y, start.z); }
  return undefined;
}
export function registerHipnoticParticles(game: Q1EntityServices): undefined {
  game.named.register("hip:particlefield", { use: fieldUse, touch: (g, e, other) => {
    if (e.damage === 0 || g.time > e.number("ltime") || g.time < e.attackFinished) return undefined;
    e.attackFinished = g.time + 0.5; g.damage(other, e.actor.id, e.actor.id, e.damage); return undefined;
  } });
  game.registerSpawn("func_particlefield", (g, e) => {
    const bounds = g.body(e).bounds, origin = vscale(vadd(bounds.min, bounds.max), 0.5), size = vsub(vsub(bounds.max, bounds.min), { x: 16, y: 16, z: 16 });
    e.dest1 = vsub(vadd(bounds.min, { x: 8, y: 8, z: 8 }), origin); e.dest2 = vsub(vadd(bounds.max, { x: 7.9, y: 7.9, z: 7.9 }), origin);
    if (size.x > size.z && size.y > size.z) { number(e, "particle_plane", 2); e.dest1 = { ...e.dest1, z: (e.dest1.z + e.dest2.z) / 2 }; }
    else if (size.x <= size.z && size.y > size.x) { number(e, "particle_plane", 1); e.dest1 = { ...e.dest1, x: (e.dest1.x + e.dest2.x) / 2 }; }
    else { number(e, "particle_plane", 0); e.dest1 = { ...e.dest1, y: (e.dest1.y + e.dest2.y) / 2 }; }
    e.model = ""; e.solid = "none"; e.movement = "none"; e.count ||= 2; if (e.number("color") === 0) number(e, "color", 192);
    e.use = g.named.use(e, "hip:particlefield"); e.touch = g.named.touch(e, "hip:particlefield"); return g.setOrigin(e, origin);
  });
  game.named.register("hip:togglewall", { use: (g, e) => {
    const active = e.number("toggle_state") === 0; number(e, "toggle_state", active ? 1 : 0);
    const displacement = active ? -8000 : 8000; g.setOrigin(e, vadd(g.body(e).origin, { x: displacement, y: displacement, z: displacement }));
    return g.sound(e, e.text(active ? "noise1" : "noise"), "voice");
  }, touch: (g, e, other) => {
    if (e.damage === 0 || g.time < e.attackFinished) return undefined; e.attackFinished = g.time + 0.5;
    g.damage(other, e.actor.id, e.actor.id, e.damage); return undefined;
  } });
  game.registerSpawn("func_togglewall", (g, e) => {
    e.movement = "push"; e.solid = "bsp"; e.model = ""; e.use = g.named.use(e, "hip:togglewall"); e.touch = g.named.touch(e, "hip:togglewall");
    if (e.text("noise") === "") e.fields.set("noise", "misc/null.wav"); if (e.text("noise1") === "") e.fields.set("noise1", "misc/null.wav");
    if ((e.spawnflags & 1) !== 0) { number(e, "toggle_state", 0); return g.setOrigin(e, vadd(g.body(e).origin, { x: 8000, y: 8000, z: 8000 })); }
    number(e, "toggle_state", 1); return g.sound(e, e.text("noise1"), "voice");
  });
  game.registerSpawn("wallsprite", (g, e) => {
    e.model ||= "progs/s_blood1.spr"; e.solid = "none"; e.movement = "none";
    let angles = g.body(e).angles; if (angles.y === -1) angles = { x: -90, y: 0, z: 0 }; else if (angles.y === -2) angles = { x: 90, y: 0, z: 0 };
    return g.setBody(e, { angles, origin: vsub(g.body(e).origin, vscale(vectors(angles).forward, 0.2)) });
  });
  return undefined;
}
