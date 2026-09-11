/* pendulum.qc source animation boxes and shared impactVelocity. GPL-2.0-or-later. */
import type { Q1EntityServices } from "../../foundation/entity-services.ts";
import { ZERO } from "../../foundation/types.ts";
import { later, number } from "./common.ts";

const swings: readonly (readonly [number, number, number, number, number, number, number, number])[] = [
  [0, -176, -120, 48, 128, 0.17, 1, 0], [1, -172, -112, 12, 88, 0.15, 0, 0], [2, -160, -96, -22, 50, 0.13, 0, 0],
  [3, -138, -70, -51, 17, 0.11, 0, 1], [4, -110, -38, -72, -8, 0.09, 0, 0], [5, -76, 0, -83, -23, 0.07, 0, 0],
  [6, -40, 40, -88, -32, 0.05, 0, 0], [7, 0, 76, -83, -23, 0.07, 0, 0], [8, 38, 100, -72, -8, 0.09, 0, 0],
  [9, 70, 138, -51, 17, 0.11, 0, 0], [10, 96, 160, -22, 50, 0.13, 0, 0], [11, 112, 172, 12, 88, 0.15, 0, 0],
  [12, 120, 176, 48, 128, 0.17, 0, 0], [12, 120, 176, 48, 128, 0.17, 0, 0], [11, 112, 172, 12, 88, 0.15, -1, 0],
  [10, 96, 160, -22, 50, 0.13, 0, 0], [9, 70, 138, -51, 17, 0.11, 0, 1], [8, 38, 100, -72, -8, 0.09, 0, 0],
  [7, 0, 76, -83, -23, 0.07, 0, 0], [6, -40, 40, -88, -32, 0.05, 0, 0], [5, -76, 0, -83, -23, 0.07, 0, 0],
  [4, -110, -28, -72, -8, 0.09, 0, 0], [3, -172, -70, -51, 17, 0.11, 0, 0], [2, -160, -96, -22, 50, 0.13, 0, 0],
  [1, -172, -112, 12, 88, 0.15, 0, 0], [0, -176, -120, 48, 128, 0.17, 0, 0],
];
export function registerRoguePendulum(game: Q1EntityServices): undefined {
  for (const [index, [frame, min, max, low, high, delay, impact, sound]] of swings.entries()) game.named.register(`rogue:pend_swing${index + 1}`, { action: (g, e) => {
    e.frame = frame;
    if (index !== 13) g.setBounds(e, (e.spawnflags & 2) !== 0 ? { min: { x: -8, y: min, z: low }, max: { x: 8, y: max, z: high } } : { min: { x: min, y: -8, z: low }, max: { x: max, y: 8, z: high } });
    if (impact !== 0 && g.world !== null) number(g.world, "rogue:impactVelocity", impact);
    if (sound !== 0) g.host.emit({ kind: "sound", actor: e.actor.id, path: "pendulum/swing.wav", channel: "auto", volume: 0.5, attenuation: 1 });
    return later(g, e, delay, `rogue:pend_swing${(index + 1) % swings.length + 1}`);
  } });
  game.named.register("rogue:pend_touch", { touch: (g, e, other) => {
    if (g.health(other) < 1 || !g.host.combat.read(other)?.canTakeDamage) return undefined;
    if (e.attackFinished < g.time) { g.sound(e, "pendulum/hit.wav", "voice"); e.attackFinished = g.time + 1; }
    g.damage(other, e.actor.id, e.actor.id, e.number("currentammo")); const body = g.host.bodies.read(other), owner = g.host.actors.resolveOwned(other); if (body === null || owner === null) return undefined;
    const impact = g.world?.number("rogue:impactVelocity") ?? 0, velocity = (e.spawnflags & 2) !== 0 ? { ...body.velocity, y: impact * -250, z: 200 } : { ...body.velocity, x: impact * 250, z: 200 };
    g.host.bodies.write(owner, { ...body, velocity }); g.effect("meat-spray", body.origin, other); return undefined;
  } });
  game.named.register("rogue:pend_use", { use: (g, e) => later(g, e, e.delay, "rogue:pend_swing1") });
  game.registerSpawn("pendulum", (g, e) => {
    e.model = "progs/pendulum.mdl"; e.spawnflags ||= 2; if ((e.spawnflags & 3) === 0) throw new Error("Unimplemented Pendulum Type (pendulum.qc)");
    g.setBody(e, { angles: (e.spawnflags & 2) !== 0 ? ZERO : { x: 0, y: 270, z: 0 }, bounds: (e.spawnflags & 2) !== 0 ? { min: { x: -8, y: -24, z: -100 }, max: { x: 8, y: 24, z: 100 } } : { min: { x: -24, y: -8, z: -100 }, max: { x: 24, y: 8, z: 100 } } });
    if (e.number("currentammo") === 0) number(e, "currentammo", 5); e.delay ||= 1; e.solid = "trigger"; e.damageable = false; e.touch = g.named.touch(e, "rogue:pend_touch");
    if (g.world !== null) number(g.world, "rogue:impactVelocity", 0); if ((e.spawnflags & 8) !== 0) e.use = g.named.use(e, "rogue:pend_use"); else later(g, e, e.delay, "rogue:pend_swing1"); return undefined;
  });
  return undefined;
}
