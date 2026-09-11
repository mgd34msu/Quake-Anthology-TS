/* Hipnotic/Rogue misc.qc projectile traps. GPL-2.0-or-later. */
import { sameActor } from "../../../../contracts/identity.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import { moveDirection } from "../../foundation/entity.ts";
import type { Q1EntityServices } from "../../foundation/entity-services.ts";
import { ZERO, normalize, vadd, vsub, vscale } from "../../foundation/types.ts";
import { createMissile, launchSpike, launchLaser } from "../../base/projectiles.ts";
import { launchRogueLavaSpike } from "../rogue-weapons.ts";
import { launchDragonFireball } from "../monsters/dragon.ts";
import type { Q1MissionPack } from "../types.ts";
import { later, number, trigger } from "./common.ts";

export function registerMissionShooters(game: Q1EntityServices, pack: Q1MissionPack): undefined {
  game.named.register("hip:shooter_laser_touch", { touch: (g, e, other) => {
    if (e.owner !== null && sameActor(other, e.owner)) return undefined; const body = g.body(e); if (g.host.contents(body.origin) === "sky") return g.remove(e);
    if ((e.spawnflags & 16) === 0) g.sound(e, "enforcer/enfstop.wav", "weapon", 3); const origin = vsub(body.origin, vscale(normalize(body.velocity), 8));
    if (g.health(other) !== 0) { g.effect("blood", origin, other, 15); g.damage(other, e.actor.id, e.owner, 15); } else g.effect("gunshot", origin); return g.remove(e);
  } });
  const fire = (g: Q1EntityServices, e: Q1Actor): undefined => {
    const origin = g.body(e).origin;
    if (pack === "rogue") {
      if ((e.spawnflags & 1) !== 0 || e.spawnflags === 0) { g.sound(e, "weapons/spike2.wav", "voice"); launchSpike(g, e.actor.id, origin, vscale(e.movedir, 500), (e.spawnflags & 1) !== 0 ? "superspike" : "spike"); }
      else if ((e.spawnflags & 2) !== 0) { g.sound(e, "enforcer/enfire.wav", "voice"); launchLaser(g, e.actor.id, origin, e.movedir); }
      else if ((e.spawnflags & 32) !== 0) launchDragonFireball(g, e.actor.id, origin, e.movedir);
      else { g.sound(e, "weapons/spike2.wav", "voice"); const spike = launchRogueLavaSpike(g, e.actor.id, origin, e.movedir, (e.spawnflags & 8) !== 0 || (e.spawnflags & 16) !== 0 && g.options.skill > 1); g.setBody(spike, { velocity: vscale(e.movedir, 500) }); }
      return undefined;
    }
    const audible = (e.spawnflags & 16) === 0;
    if ((e.spawnflags & 2) !== 0) { if (audible) g.sound(e, "enforcer/enfire.wav", "voice"); const laser = launchLaser(g, e.actor.id, origin, e.movedir); laser.movement = "fly"; laser.spawnflags = e.spawnflags; laser.touch = g.named.touch(laser, "hip:shooter_laser_touch"); }
    else if ((e.spawnflags & 4) !== 0) { if (audible) g.sound(e, "misc/spike.wav", "voice"); const ball = createMissile(g, e.actor.id, "lavaball", "lavarock", origin, vscale(e.movedir, 300)); ball.projectile = "rocket"; ball.touch = g.named.touch(ball, "projectile_touch"); ball.angularVelocity = { x: 0, y: 0, z: 400 }; g.setBounds(ball, { min: { x: -4, y: -4, z: -4 }, max: { x: 4, y: 4, z: 4 } }); }
    else if ((e.spawnflags & 8) !== 0) { if (audible) g.sound(e, "weapons/sgun1.wav", "voice"); g.sound(e, "weapons/sgun1.wav", "weapon"); const rocket = createMissile(g, e.actor.id, "missile", "missile", vadd(origin, vscale(e.movedir, 8)), vscale(e.movedir, 1000)); rocket.projectile = "rocket"; rocket.touch = g.named.touch(rocket, "projectile_touch"); }
    else { if (audible) g.sound(e, "weapons/spike2.wav", "voice"); launchSpike(g, e.actor.id, origin, vscale(e.movedir, 500), (e.spawnflags & 1) !== 0 ? "superspike" : "spike"); }
    return undefined;
  };
  game.named.register("mission:shooter_fire", { use: fire });
  game.named.register("mission:shooter_think", { action: (g, e) => { if (pack === "rogue" || e.number("shooter_state") !== 0) fire(g, e); return later(g, e, e.wait, "mission:shooter_think"); } });
  game.named.register("mission:shooter_switch", { use: (_g, e) => number(e, "shooter_state", 1 - e.number("shooter_state")) });
  const spawn = (g: Q1EntityServices, e: Q1Actor): undefined => {
    e.movedir = moveDirection(g.body(e).angles, g); g.setBody(e, { angles: ZERO }); e.use = g.named.use(e, "mission:shooter_fire");
    if (e.classname === "trap_spikeshooter") return undefined; e.wait ||= 1; number(e, "shooter_state", e.classname === "trap_shooter" ? 1 : e.number("state"));
    if (e.classname === "trap_switched_shooter") e.use = g.named.use(e, "mission:shooter_switch"); return later(g, e, e.number("nextthink") + e.wait + e.number("ltime") - g.time, "mission:shooter_think");
  };
  game.replaceSpawn("trap_spikeshooter", spawn); game.replaceSpawn("trap_shooter", spawn); if (pack === "hipnotic") game.registerSpawn("trap_switched_shooter", spawn);
  if (pack === "rogue") {
    game.named.register("rogue:push", { use: (_g, e) => { e.spawnflags ^= 4; return undefined; }, touch: (g, e, other) => {
      if ((e.spawnflags & 4) === 0) return undefined; const grenade = ["grenade", "MiniGrenade", "MultiGrenade"].includes(g.host.classname(other));
      if (grenade || g.health(other) > 0) { const owner = g.host.actors.resolveOwned(other), body = g.host.bodies.read(other); if (owner !== null && body !== null) g.host.bodies.write(owner, { ...body, velocity: vscale(e.movedir, e.speed * 10) });
        if (!grenade && g.isPlayer(other)) { const state = [...g.entities.values()].find(entity => entity.classname === "rogue_team_state" && entity.owner !== null && sameActor(entity.owner, other)); if (state !== undefined && state.number("fly_sound") < g.time && owner !== null) { number(state, "fly_sound", g.time + 1.5); g.sound(owner, "ambience/windfly.wav"); } }
      }
      return (e.spawnflags & 1) !== 0 ? g.remove(e) : undefined;
    } });
    game.registerSpawn("trigger_push", (g, e) => { if ((e.spawnflags & 2) !== 0) e.use = g.named.use(e, "rogue:push"); else e.spawnflags += 4; e.touch = g.named.touch(e, "rogue:push"); e.speed ||= 1000; return trigger(g, e); });
  }
  return undefined;
}
