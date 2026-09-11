/* misc.qc/plats.qc/triggers.qc/items.qc. Copyright (C) 1996-2022 id Software LLC. GPL-2.0-or-later. */
import type { Q1Actor } from "../foundation/entity.ts";
import { moveDirection } from "../foundation/entity.ts";
import type { Q1Foundation } from "../foundation/runtime.ts";
import { ZERO, vadd, vscale, vsub } from "../foundation/types.ts";
import { createMissile, launchLaser, launchSpike } from "./projectiles.ts";
import type { Q1Base } from "./provider.ts";

export const remainingMapClassnames: readonly string[] = [
  "func_train", "misc_teleporttrain", "func_illusionary", "func_episodegate", "func_bossgate", "item_sigil", "event_lightning", "testplayerstart", "trigger_changelevel",
  "trigger_setskill", "trigger_onlyregistered", "trigger_monsterjump", "trap_spikeshooter", "trap_shooter", "misc_fireball", "air_bubbles",
  "light_globe", "light_torch_small_walltorch", "light_flame_large_yellow", "light_flame_small_yellow", "light_flame_small_white",
  "ambient_suck_wind", "ambient_flouro_buzz", "ambient_drip", "ambient_thunder", "ambient_light_buzz", "ambient_swamp1", "ambient_swamp2", "viewthing", "misc_noisemaker",
];
function initTrigger(game: Q1Foundation, entity: Q1Actor): undefined {
  entity.movedir = moveDirection(game.body(entity).angles); entity.solid = "trigger"; entity.model = ""; game.setBody(entity, { angles: ZERO }); return undefined;
}
function train(game: Q1Foundation, entity: Q1Actor): undefined {
  const teleport = entity.classname === "misc_teleporttrain";
  if (entity.target === "") throw new Error(`${entity.classname} without a target`);
  entity.speed ||= 100; entity.damage ||= 2; entity.movement = "push"; entity.solid = teleport ? "none" : "bsp";
  if (teleport) { entity.model = "progs/teleport.mdl"; entity.angularVelocity = { x: 100, y: 200, z: 300 }; }
  let ready = false, running = false;
  const next = (): undefined => {
    running = true; const corner = game.find(entity.target)[0]; if (corner === undefined) throw new Error(`Train target not found: ${entity.target}`);
    entity.target = corner.target; if (entity.target === "") throw new Error("train_next: no next target");
    entity.wait = corner.wait; game.sound(entity, entity.sounds === 1 ? "plats/train1.wav" : "misc/null.wav");
    return game.calcMove(entity, vsub(game.body(corner).origin, game.body(entity).bounds.min), entity.speed, () => {
      if (entity.wait !== 0) game.sound(entity, entity.sounds === 1 ? "plats/train2.wav" : "misc/null.wav");
      return game.schedule(entity, entity.wait || 0.1, next);
    });
  };
  entity.use = () => ready && !running ? next() : undefined;
  entity.blocked = other => {
    if (game.time < entity.attackFinished) return undefined;
    entity.attackFinished = game.time + 0.5; game.damage(other, entity.actor.id, entity.actor.id, entity.damage, null, "direct", "crush"); return undefined;
  };
  return game.schedule(entity, 0.1, () => {
    const corner = game.find(entity.target)[0]; if (corner === undefined) throw new Error(`Train first target not found: ${entity.target}`);
    entity.target = corner.target; game.setOrigin(entity, vsub(game.body(corner).origin, game.body(entity).bounds.min)); ready = true;
    return entity.targetname === "" ? game.schedule(entity, 0.1, next) : undefined;
  });
}
function sigil(base: Q1Base, entity: Q1Actor): undefined {
  const { game } = base; const bits = entity.spawnflags & 15; if (bits === 0) throw new Error("item_sigil has no episode spawnflags");
  const number = (bits & 8) !== 0 ? 4 : (bits & 4) !== 0 ? 3 : (bits & 2) !== 0 ? 2 : 1;
  entity.model = `progs/end${number}.mdl`; entity.solid = "trigger"; entity.movement = "toss";
  game.setBounds(entity, { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } });
  entity.touch = other => {
    if (entity.solid !== "trigger" || !game.isPlayer(other) || game.health(other) <= 0) return undefined;
    game.message(other, "$qc_got_rune"); const player = game.host.actors.resolveOwned(other); if (player !== null) game.sound(player, "misc/runekey.wav", "item");
    game.effect("pickup", game.body(entity).origin, other); entity.solid = "none"; entity.model = ""; entity.touch = null; game.link(entity);
    base.campaign.writeFlags(base.campaign.readFlags() | bits); return game.useTargets(entity, other);
  };
  return game.schedule(entity, 0.2, () => {
    const body = game.body(entity), start = vadd(body.origin, { x: 0, y: 0, z: 6 });
    const floor = game.host.trace({ start, end: vadd(start, { x: 0, y: 0, z: -256 }), bounds: body.bounds, ignore: entity.actor.id, monsters: true });
    if (floor.allSolid) return game.remove(entity); game.setBody(entity, { origin: floor.end, velocity: ZERO, ground: floor.actor }); return game.link(entity);
  });
}
function shooter(game: Q1Foundation, entity: Q1Actor): undefined {
  entity.movedir = moveDirection(game.body(entity).angles); game.setBody(entity, { angles: ZERO });
  const fire = (): undefined => {
    if ((entity.spawnflags & 2) !== 0) { game.sound(entity, "enforcer/enfire.wav"); const laser = launchLaser(game, entity.actor.id, game.body(entity).origin, entity.movedir); if (entity.classname === "trap_shooter") game.setBody(laser, { velocity: vscale(entity.movedir, 500) }); }
    else { game.sound(entity, "weapons/spike2.wav"); launchSpike(game, entity.actor.id, game.body(entity).origin, vscale(entity.movedir, 500), (entity.spawnflags & 1) !== 0 ? "superspike" : "spike"); }
    return undefined;
  };
  entity.use = fire;
  if (entity.classname === "trap_spikeshooter") return undefined;
  entity.wait ||= 1; const think = (): undefined => { fire(); return game.schedule(entity, entity.wait, think); };
  return game.schedule(entity, entity.number("nextthink") + entity.wait, think);
}
export function spawnBubble(game: Q1Foundation, origin: import("../../../contracts/math.ts").Vec3, velocity = { x: 0, y: 0, z: 15 }, split = false): Q1Actor {
  const bubble = game.create("bubble"); bubble.model = "progs/s_bubble.spr"; bubble.movement = "noclip"; bubble.frame = split ? 1 : 0; bubble.count = split ? 10 : 0;
  game.setBody(bubble, { origin, velocity, bounds: { min: { x: -8, y: -8, z: -8 }, max: { x: 8, y: 8, z: 8 } } }); game.link(bubble);
  const bob = (): undefined => {
    const body = game.body(bubble); bubble.count++;
    if (bubble.count === 4) { spawnBubble(game, game.body(bubble).origin, body.velocity, true); bubble.frame = 1; bubble.count = 10; }
    const contents = game.host.contents(game.body(bubble).origin); if (bubble.count >= 20 || contents !== "water" && contents !== "slime" && contents !== "lava") return game.remove(bubble);
    const x = body.velocity.x - 10 + game.host.random() * 20, y = body.velocity.y - 10 + game.host.random() * 20, z = body.velocity.z + 10 + game.host.random() * 10;
    game.setBody(bubble, { velocity: { x: x > 10 ? 5 : x < -10 ? -5 : x, y: y > 10 ? 5 : y < -10 ? -5 : y, z: z > 30 ? 25 : z < 10 ? 15 : z } });
    return game.schedule(bubble, 0.5, bob);
  }; game.schedule(bubble, 0.5, bob); return bubble;
}
export function spawnRemainingMapActor(base: Q1Base, entity: Q1Actor): undefined {
  const { game } = base;
  switch (entity.classname) {
    case "testplayerstart": return undefined;
    case "trigger_changelevel": {
      initTrigger(game, entity); const map = entity.text("map"); if (map === "") throw new Error("changelevel trigger doesn't have map");
      entity.touch = other => {
        if (!game.isPlayer(other)) return undefined;
        if (game.options.noExit === 1 || game.options.noExit === 2 && game.mapName !== "start") { game.damage(other, entity.actor.id, entity.actor.id, 50000, null, "direct", "exit"); return undefined; }
        base.options.playerExited?.(other); game.useTargets(entity, other);
        if ((entity.spawnflags & 1) !== 0 && game.options.deathmatch === 0) return game.travel(base.options.sameLevel?.() ? game.mapName : map, other);
        entity.touch = null; return game.schedule(entity, 0.1, () => base.levelRules.begin(map, other));
      }; return undefined;
    }
    case "func_train": case "misc_teleporttrain": return train(game, entity);
    case "item_sigil": return sigil(base, entity);
    case "event_lightning": return base.spawnLightning(entity);
    case "func_episodegate": case "func_bossgate": {
      const flags = base.campaign.readFlags();
      if (entity.classname === "func_episodegate" ? (flags & entity.spawnflags) === 0 : (flags & 15) === 15) { entity.model = ""; return undefined; }
      entity.solid = "bsp"; entity.movement = "push"; game.setBody(entity, { angles: ZERO }); entity.use = () => { entity.frame = 1 - entity.frame; return undefined; }; return undefined;
    }
    case "func_illusionary": game.setBody(entity, { angles: ZERO }); entity.solid = "none"; entity.movement = "none"; return undefined;
    case "trigger_setskill":
      initTrigger(game, entity); entity.touch = other => {
        if (!game.isPlayer(other)) return undefined;
        const value = Math.max(0, Math.min(3, Math.floor(Number(entity.message))));
        if (value === 0 || value === 1 || value === 2 || value === 3) base.campaign.setSkill(value); return undefined;
      }; return undefined;
    case "trigger_onlyregistered":
      initTrigger(game, entity); entity.touch = other => {
        if (!game.isPlayer(other) || entity.attackFinished > game.time) return undefined;
        entity.attackFinished = game.time + 2;
        if (base.registered) { entity.message = ""; game.useTargets(entity, other); return game.remove(entity); }
        if (entity.message !== "") { game.message(other, entity.message); const player = game.host.actors.resolveOwned(other); if (player !== null) game.sound(player, "misc/talk.wav", "body"); } return undefined;
      }; return undefined;
    case "trigger_monsterjump": {
      if (game.body(entity).angles.y === 0) game.setBody(entity, { angles: { x: 0, y: 360, z: 0 } }); initTrigger(game, entity); entity.speed ||= 200;
      entity.touch = other => {
        const monster = game.entity(other), body = game.host.bodies.read(other); if (monster?.monster === null || monster === null || body === null || (monster.movementFlags & 3) !== 0) return undefined;
        game.setBody(monster, { velocity: { x: entity.movedir.x * entity.speed, y: entity.movedir.y * entity.speed, z: body.ground === null ? body.velocity.z : entity.number("height") || 200 }, ground: null });
        if (body.ground !== null) monster.movement = "toss"; return undefined;
      }; return undefined;
    }
    case "trap_spikeshooter": case "trap_shooter": return shooter(game, entity);
    case "misc_fireball": {
      entity.speed ||= 1000;
      const fly = (): undefined => {
        const missile = createMissile(game, entity.actor.id, "fireball", "lavaball", game.body(entity).origin, { x: game.host.random() * 100 - 50, y: game.host.random() * 100 - 50, z: entity.speed + game.host.random() * 200 });
        missile.solid = "trigger"; missile.movement = "toss"; missile.touch = other => { game.damage(other, missile.actor.id, missile.actor.id, 20); return game.remove(missile); };
        return game.schedule(entity, game.host.random() * 5 + 3, fly);
      }; return game.schedule(entity, game.host.random() * 5, fly);
    }
    case "air_bubbles": {
      if (game.options.deathmatch !== 0) return game.remove(entity);
      const make = (): undefined => { spawnBubble(game, game.body(entity).origin); return game.schedule(entity, game.host.random() + 0.5, make); }; return game.schedule(entity, 1, make);
    }
    case "light_globe": entity.model = "progs/s_light.spr"; return undefined;
    case "light_torch_small_walltorch": case "light_flame_large_yellow": case "light_flame_small_yellow": case "light_flame_small_white":
      entity.model = entity.classname === "light_torch_small_walltorch" ? "progs/flame.mdl" : "progs/flame2.mdl"; entity.frame = entity.classname === "light_flame_large_yellow" ? 1 : 0;
      return game.host.emit({ kind: "ambient", origin: game.body(entity).origin, path: "ambience/fire1.wav", volume: 0.5, attenuation: 3 });
    case "ambient_suck_wind": case "ambient_flouro_buzz": case "ambient_drip": case "ambient_thunder": case "ambient_light_buzz": case "ambient_swamp1": case "ambient_swamp2": {
      const name = entity.classname;
      const path = name === "ambient_suck_wind" ? "suck1" : name === "ambient_flouro_buzz" ? "buzz1" : name === "ambient_drip" ? "drip1" : name === "ambient_thunder" ? "thunder1" : name === "ambient_light_buzz" ? "fl_hum1" : name === "ambient_swamp1" ? "swamp1" : "swamp2";
      return game.host.emit({ kind: "ambient", origin: game.body(entity).origin, path: `ambience/${path}.wav`, volume: name === "ambient_suck_wind" || name === "ambient_flouro_buzz" ? 1 : 0.5, attenuation: 3 });
    }
    case "viewthing": entity.model = "progs/player.mdl"; return undefined;
    case "misc_noisemaker": {
      const noise = (): undefined => {
        for (const path of ["enfire", "enfstop", "sight1", "sight2", "sight3", "sight4", "pain1"]) game.sound(entity, `enforcer/${path}.wav`, "auto");
        return game.schedule(entity, 0.5, noise);
      }; return game.schedule(entity, 0.5, noise);
    }
    default: throw new Error(`Unknown base Q1 map class ${entity.classname}`);
  }
}
