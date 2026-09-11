/* newmisc.qc. Copyright id Software / Rogue. GPL-2.0-or-later. */
import type { Q1EntityServices } from "../../foundation/entity-services.ts";
import { length, normalize, vscale, vsub } from "../../foundation/types.ts";
import { later, trigger } from "./common.ts";

export function registerRogueMisc(game: Q1EntityServices): undefined {
  for (const model of ["lantern", "candle"]) game.registerSpawn(`light_${model}`, (_g, e) => { e.model = `progs/${model}.mdl`; e.solid = "none"; e.movement = "none"; return undefined; });
  game.named.register("rogue:rubble_touch", { touch: (g, e, other) => {
    if ((g.isPlayer(other) || ((g.entity(other)?.movementFlags ?? 0) & 32) !== 0) && length(g.body(e).velocity) > 0) g.damage(other, e.actor.id, e.actor.id, 10); return undefined;
  } });
  game.named.register("rogue:rubble_throw", { action: (g, e) => {
    const destination = g.find(e.target)[0] ?? g.world; if (destination === null) throw new Error("Rubble generator requires worldspawn");
    const direction = normalize(vsub(g.body(destination).origin, g.body(e).origin)), rubble = g.create("rubble");
    rubble.owner = e.actor.id; rubble.model = "progs/rubble.mdl"; rubble.solid = "bbox"; rubble.movement = "bounce"; rubble.skin = (e.spawnflags & 1) !== 0 ? 1 : 0;
    g.setBody(rubble, { origin: g.body(e).origin, velocity: vscale({ x: direction.x + g.host.random() * 0.2 - 0.1, y: direction.y + g.host.random() * 0.2 - 0.1, z: direction.z + g.host.random() * 0.2 - 0.1 }, 300), bounds: { min: { x: -16, y: -16, z: -16 }, max: { x: 16, y: 16, z: 16 } } });
    rubble.touch = g.named.touch(rubble, "rogue:rubble_touch"); later(g, rubble, 30, "SUB_Remove"); g.link(rubble); return later(g, e, e.delay, "rogue:rubble_throw");
  } });
  game.named.register("rogue:rubble_use", { use: (g, e) => { if (e.wait === 0) { e.wait = 1; return later(g, e, e.delay, "rogue:rubble_throw"); } e.wait = 0; return g.cancel(e); } });
  game.registerSpawn("rubble_generator", (g, e) => { if (e.target === "") throw new Error("rubble_generator has no target!"); e.delay ||= 5; e.solid = "none"; e.use = g.named.use(e, "rogue:rubble_use"); if ((e.spawnflags & 2) !== 0) e.use(null, null); return undefined; });
  game.named.register("rogue:explosion_trigger_die", { die: (g, e, attacker) => { g.useTargets(e, attacker); e.touch = null; return later(g, e, 0.1, "SUB_Remove"); } });
  game.registerSpawn("trigger_explosion", (g, e) => { trigger(g, e); e.maxHealth = g.health(e.actor.id) || 20; g.host.combat.setHealth(e.actor, e.maxHealth); e.die = g.named.die(e, "rogue:explosion_trigger_die"); e.damageable = true; e.solid = "bbox"; return g.link(e); });
  game.registerDamageSourceEffects("rogue:explosion-trigger", { beforeQuad: (request, amount) => game.entity(request.target)?.classname === "trigger_explosion" && request.delivery !== "radius" ? { kind: "cancel" } : { kind: "continue", amount } });
  return undefined;
}
