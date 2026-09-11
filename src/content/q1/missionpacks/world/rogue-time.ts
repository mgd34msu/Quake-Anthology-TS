/* timemach.qc. Copyright id Software / Rogue. GPL-2.0-or-later. */
import type { Q1Actor } from "../../foundation/entity.ts";
import type { Q1Foundation } from "../../foundation/runtime.ts";
import { POINT, ZERO, vadd, vsub, vscale, vectors } from "../../foundation/types.ts";
import { later, number } from "./common.ts";

function chunk(game: Q1Foundation, explosion: Q1Actor, machine: Q1Actor): undefined {
  const basis = vectors(game.body(machine).angles), gib = game.create("time_machine_gib"); gib.solid = "none"; gib.movement = "toss"; gib.model = "progs/timegib.mdl";
  game.setBody(gib, { origin: vsub(vadd(game.body(machine).origin, vscale(basis.forward, 84)), vscale(basis.up, 136)), velocity: vscale(basis.up, -50), angles: game.body(machine).angles });
  gib.angularVelocity = { x: 300, y: 300, z: 300 }; game.sound(explosion, "weapons/r_exp3.wav", "weapon", 0); game.effect("explosion", game.body(gib).origin);
  machine.frame = 1; later(game, gib, 5, "SUB_Remove"); return game.link(gib);
}
function pain(game: Q1Foundation, machine: Q1Actor): undefined {
  const health = game.health(machine.actor.id); if (health > 1100 && machine.number("pain_finished") > game.time) return undefined;
  if (game.host.random() < 0.4) {
    number(machine, "pain_finished", game.time + 2); const random = game.host.random(), basis = vectors(game.body(machine).angles), explosion = game.create("time_machine_pain");
    explosion.owner = machine.actor.id; explosion.target = machine.target;
    const offset = random < 0.33 ? vsub(vscale(basis.forward, 80), vscale(basis.up, 64)) : random < 0.66 ? vsub(vscale(basis.right, 80), vscale(basis.up, 24)) : vsub(vsub(vscale(basis.forward, 64), vscale(basis.up, 48)), vscale(basis.right, 48));
    game.setOrigin(explosion, vadd(game.body(machine).origin, offset)); later(game, explosion, 0.2 + game.host.random() * 0.3, "rogue:time_boom");
  }
  if (health < 1000) { number(machine, "pain_finished", 0); machine.pain = null; machine.die = null; if (game.world !== null) number(game.world, "rogue:cutscene_running", 1); }
  return undefined;
}
export function crashTimeMachine(game: Q1Foundation): undefined {
  const machine = game.entity(game.world?.references.get("rogue:theMachine") ?? null); if (machine === null) throw new Error("Rogue time_crash requires item_time_machine");
  machine.damageable = false; machine.movement = "fly"; machine.solid = "none"; machine.angularVelocity = { x: 15, y: 0, z: 5 };
  game.setBody(machine, { velocity: { x: 0, y: 0, z: -50 }, bounds: POINT }); later(game, machine, 0.1, "rogue:time_fall"); machine.target = "timeramp"; return game.useTargets(machine, machine.activator);
}
export function registerRogueTime(game: Q1Foundation): undefined {
  game.named.register("rogue:time_pain", { pain, die: pain });
  game.named.register("rogue:time_stop_shake", { action: (g, e) => { g.useTargets(e, e.activator); return g.remove(e); } });
  game.named.register("rogue:time_boom", { action: (g, e) => {
    g.useTargets(e, e.activator); const machine = g.entity(e.owner); if (machine === null) throw new Error("Time machine explosion lost its machine");
    if (g.health(machine.actor.id) < 1250 && machine.frame > 0) { if (machine.skin < 2) { machine.frame = 2; machine.skin = 2; } }
    else if (g.health(machine.actor.id) < 1500 && machine.frame === 0) { chunk(g, e, machine); machine.frame = 1; machine.skin = 1; }
    g.sound(e, "weapons/r_exp3.wav", "weapon", 0);
    if (g.host.random() < 0.5) g.effect("explosion", g.body(e).origin); else g.host.emit({ kind: "colored-explosion", origin: g.body(e).origin, colorStart: 244, colorLength: 3 });
    e.model = "progs/s_explod.spr"; e.frame = 0; e.solid = "none"; e.movement = "none"; e.touch = null; g.setBody(e, { velocity: ZERO }); later(g, e, 0.1, "base:explosion_frame"); g.link(e);
    const stop = g.create("time_stop_shake"); stop.target = e.target; return later(g, stop, 0.7, "rogue:time_stop_shake");
  } });
  game.named.register("rogue:time_fall", { action: (g, e) => {
    const body = g.body(e); if (e.number("pain_finished") === 0) { if (body.origin.z < -20) { g.effect("lava-splash", vadd(body.origin, { x: 0, y: 0, z: -80 })); number(e, "pain_finished", 1); } }
    else if (g.host.random() < 0.3) g.effect("explosion", body.origin);
    g.setBody(e, { velocity: { ...body.velocity, z: body.velocity.z - 5 } }); return later(g, e, 0.1, "rogue:time_fall");
  } });
  game.named.register("rogue:time_crash", { action: g => crashTimeMachine(g), use: g => crashTimeMachine(g), pain: g => crashTimeMachine(g), die: g => crashTimeMachine(g) });
  game.registerSpawn("item_time_machine", (g, e) => {
    if (g.options.deathmatch !== 0) return g.remove(e); e.model = "progs/timemach.mdl"; e.solid = "slidebox"; e.movement = "fly"; e.maxHealth = 1600; e.damageable = true; e.movementFlags |= 32;
    e.angularVelocity = { x: 0, y: 60, z: 0 }; g.host.combat.setHealth(e.actor, 1600); e.pain = g.named.pain(e, "rogue:time_pain"); e.die = g.named.die(e, "rogue:time_pain");
    if (g.world !== null) g.world.references.set("rogue:theMachine", e.actor.id); return g.setBounds(e, { min: { x: -64, y: -64, z: -144 }, max: { x: 64, y: 64, z: 0 } });
  });
  game.registerSpawn("item_time_core", (g, e) => { if (g.options.deathmatch !== 0) return g.remove(e); e.model = "progs/timecore.mdl"; e.solid = "none"; e.movement = "fly"; e.angularVelocity = { x: 60, y: 60, z: 60 }; return undefined; });
  return undefined;
}
