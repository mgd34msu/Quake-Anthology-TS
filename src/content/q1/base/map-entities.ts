/* misc.qc/plats.qc/triggers.qc/items.qc. Copyright (C) 1996-2022 id Software LLC. GPL-2.0-or-later. */
import type { Q1Actor } from "../foundation/entity.ts";
import { moveDirection } from "../foundation/entity.ts";
import type { ActorId } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { Q1Foundation } from "../foundation/runtime.ts";
import { ZERO, vadd, vscale, vsub } from "../foundation/types.ts";
import type { Q1SoundChannel } from "../foundation/types.ts";
import { createMissile, launchLaser, launchSpike } from "./projectiles.ts";
import { q1Base } from "./provider.ts";
import type { Q1Base } from "./provider.ts";

export const remainingMapClassnames: readonly string[] = [
  "func_train", "misc_teleporttrain", "func_illusionary", "func_episodegate", "func_bossgate", "item_sigil", "event_lightning", "testplayerstart", "trigger_changelevel",
  "trigger_setskill", "trigger_onlyregistered", "trigger_monsterjump", "trap_spikeshooter", "trap_shooter", "misc_fireball", "air_bubbles",
  "light_globe", "light_torch_small_walltorch", "light_flame_large_yellow", "light_flame_small_yellow", "light_flame_small_white",
  "ambient_suck_wind", "ambient_flouro_buzz", "ambient_drip", "ambient_thunder", "ambient_light_buzz", "ambient_swamp1", "ambient_swamp2", "viewthing", "misc_noisemaker",
];
function initTrigger(game: Q1Foundation, entity: Q1Actor): undefined {
  entity.movedir = moveDirection(game.body(entity).angles, game); entity.solid = "trigger"; entity.model = ""; game.setBody(entity, { angles: ZERO }); return undefined;
}
function later(game: Q1Foundation, entity: Q1Actor, delay: number, name: string): undefined { return game.schedule(entity, delay, game.named.action(entity, name)); }
function trainNext(game: Q1Foundation, entity: Q1Actor): undefined {
  entity.activated = true; const corner = game.find(entity.target)[0]; if (corner === undefined) throw new Error(`Train target not found: ${entity.target}`);
  entity.target = corner.target; if (entity.target === "") throw new Error("train_next: no next target");
  entity.wait = corner.wait; game.sound(entity, entity.sounds === 1 ? "plats/train1.wav" : "misc/null.wav");
  return game.calcMove(entity, vsub(game.body(corner).origin, game.body(entity).bounds.min), entity.speed, game.named.action(entity, "base:train_wait"));
}
function train(game: Q1Foundation, entity: Q1Actor): undefined {
  const teleport = entity.classname === "misc_teleporttrain";
  if (entity.target === "") throw new Error(`${entity.classname} without a target`);
  const sounds = teleport || entity.sounds === 0 ? ["misc/null.wav", "misc/null.wav"] : entity.sounds === 1 ? ["plats/train2.wav", "plats/train1.wav"] : [];
  for (const path of sounds) if (game.usesId1Precaches) game.precacheSound(path);
  if (game.usesId1Precaches && (teleport)) game.precacheModel("progs/teleport.mdl");
  entity.speed ||= 100; entity.damage ||= 2; entity.movement = "push"; entity.solid = teleport ? "none" : "bsp";
  if (teleport) { entity.model = "progs/teleport.mdl"; entity.angularVelocity = { x: 100, y: 200, z: 300 }; }
  else entity.classname = "train";
  entity.state = "bottom"; entity.activated = false;
  entity.use = game.named.use(entity, "base:train_use"); entity.blocked = game.named.blocked(entity, "base:train_blocked");
  return later(game, entity, 0.1, "base:train_find");
}
function sigilTouch(game: Q1Foundation, entity: Q1Actor, other: ActorId): undefined {
  if (entity.solid !== "trigger" || !game.isPlayer(other) || game.health(other) <= 0) return undefined;
  game.message(other, game.options.edition === "classic" ? "You got the rune!" : "$qc_got_rune"); const player = game.host.actors.resolveOwned(other); if (player !== null) game.sound(player, "misc/runekey.wav", "item");
  game.effect("pickup", game.body(entity).origin, other); entity.solid = "none"; entity.model = ""; entity.touch = null; game.link(entity);
  const campaign = q1Base(game).campaign; campaign.writeFlags(campaign.readFlags() | (entity.spawnflags & 15)); entity.classname = ""; return game.useTargets(entity, other);
}
function sigil(game: Q1Foundation, entity: Q1Actor): undefined {
  const bits = entity.spawnflags & 15; if (bits === 0) throw new Error("item_sigil has no episode spawnflags");
  if (game.usesId1Precaches) game.precacheSound("misc/runekey.wav");
  for (let episode = 1; episode <= 4; episode++) if (game.usesId1Precaches && ((bits & (1 << (episode - 1))) !== 0)) game.precacheModel(`progs/end${episode}.mdl`);
  const number = (bits & 8) !== 0 ? 4 : (bits & 4) !== 0 ? 3 : (bits & 2) !== 0 ? 2 : 1;
  entity.model = `progs/end${number}.mdl`; entity.solid = "trigger"; entity.movement = "toss";
  game.setBounds(entity, { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } });
  entity.touch = game.named.touch(entity, "base:sigil_touch"); return later(game, entity, 0.2, "base:sigil_place");
}
function shooterFire(game: Q1Foundation, entity: Q1Actor): undefined {
  if ((entity.spawnflags & 2) !== 0) { game.sound(entity, "enforcer/enfire.wav"); const laser = launchLaser(game, entity.actor.id, game.body(entity).origin, entity.movedir); if (entity.classname === "trap_shooter") game.setBody(laser, { velocity: vscale(entity.movedir, 500) }); }
  else { game.sound(entity, "weapons/spike2.wav"); launchSpike(game, entity.actor.id, game.body(entity).origin, vscale(entity.movedir, 500), (entity.spawnflags & 1) !== 0 ? "superspike" : "spike"); }
  return undefined;
}
function shooter(game: Q1Foundation, entity: Q1Actor): undefined {
  entity.fields.set("killstring", "$qc_ks_spiked");
  entity.movedir = moveDirection(game.body(entity).angles, game); game.setBody(entity, { angles: ZERO }); entity.use = game.named.use(entity, "base:shooter_fire");
  if ((entity.spawnflags & 2) !== 0) {
    if (game.usesId1Precaches) game.precacheModel("progs/laser.mdl"); if (game.usesId1Precaches) game.precacheSound("enforcer/enfire.wav"); if (game.usesId1Precaches) game.precacheSound("enforcer/enfstop.wav");
  } else if (game.usesId1Precaches) game.precacheSound("weapons/spike2.wav");
  if (entity.classname === "trap_spikeshooter") return undefined;
  entity.wait ||= 1; return later(game, entity, entity.number("nextthink") + entity.wait, "base:shooter_think");
}
export function spawnBubble(game: Q1Foundation, origin: Vec3, velocity = { x: 0, y: 0, z: 15 }, split = false): Q1Actor {
  const bubble = game.create("bubble"); bubble.model = "progs/s_bubble.spr"; bubble.movement = "noclip"; bubble.frame = split ? 1 : 0; bubble.count = split ? 10 : 0;
  game.setBody(bubble, { origin, velocity, bounds: { min: { x: -8, y: -8, z: -8 }, max: { x: 8, y: 8, z: 8 } } }); game.link(bubble);
  later(game, bubble, 0.5, "base:bubble_bob"); return bubble;
}
function bubbleBob(game: Q1Foundation, bubble: Q1Actor): undefined {
  const body = game.body(bubble); bubble.count++;
  if (bubble.count === 4) { spawnBubble(game, body.origin, body.velocity, true); bubble.frame = 1; bubble.count = 10; }
  const contents = game.host.contents(body.origin); if (bubble.count >= 20 || contents !== "water" && contents !== "slime" && contents !== "lava") return game.remove(bubble);
  const x = body.velocity.x - 10 + game.host.random() * 20, y = body.velocity.y - 10 + game.host.random() * 20, z = body.velocity.z + 10 + game.host.random() * 10;
  game.setBody(bubble, { velocity: { x: x > 10 ? 5 : x < -10 ? -5 : x, y: y > 10 ? 5 : y < -10 ? -5 : y, z: z > 30 ? 25 : z < 10 ? 15 : z } }); return later(game, bubble, 0.5, "base:bubble_bob");
}
function changelevelTouch(game: Q1Foundation, entity: Q1Actor, other: ActorId): undefined {
  if (!game.isPlayer(other)) return undefined;
  if (game.options.noExit === 1 || game.options.noExit === 2 && game.mapName !== "start") { game.damage(other, entity.actor.id, entity.actor.id, 50000, null, "direct", "exit"); return undefined; }
  const base = q1Base(game), map = entity.text("map"); base.levelRules.changelevelTouched(entity, other); base.options.playerExited?.(other); game.useTargets(entity, other);
  if ((entity.spawnflags & 1) !== 0 && game.options.deathmatch === 0) return base.levelRules.travelTo(base.options.sameLevel?.() ? game.mapName : map, other);
  entity.touch = null; entity.activator = other; return later(game, entity, 0.1, "base:execute_changelevel");
}
function fireballFly(game: Q1Foundation, entity: Q1Actor): undefined {
  const missile = createMissile(game, entity.actor.id, "fireball", "lavaball", game.body(entity).origin, { x: game.host.random() * 100 - 50, y: game.host.random() * 100 - 50, z: entity.speed + game.host.random() * 200 });
  missile.solid = "trigger"; missile.movement = "toss"; missile.touch = game.named.touch(missile, "base:fireball_touch");
  return later(game, entity, game.host.random() * 5 + 3, "base:fireball_fly");
}
export function registerMapCallbacks(game: Q1Foundation): undefined {
  game.named.register("base:train_next", { action: trainNext });
  game.named.register("base:train_wait", { action: (runtime, entity) => { if (entity.wait !== 0) runtime.sound(entity, entity.sounds === 1 ? "plats/train2.wav" : "misc/null.wav"); return later(runtime, entity, entity.wait || 0.1, "base:train_next"); } });
  game.named.register("base:train_use", { use: (runtime, entity) => entity.state === "top" && !entity.activated ? trainNext(runtime, entity) : undefined });
  game.named.register("base:train_blocked", { blocked: (runtime, entity, other) => { if (runtime.time < entity.attackFinished) return undefined; entity.attackFinished = runtime.time + 0.5; runtime.damage(other, entity.actor.id, entity.actor.id, entity.damage, null, "direct", "crush"); return undefined; } });
  game.named.register("base:train_find", { action: (runtime, entity) => {
    const corner = runtime.find(entity.target)[0]; if (corner === undefined) throw new Error(`Train first target not found: ${entity.target}`);
    entity.target = corner.target; runtime.setOrigin(entity, vsub(runtime.body(corner).origin, runtime.body(entity).bounds.min)); entity.state = "top";
    return entity.targetname === "" ? later(runtime, entity, 0.1, "base:train_next") : undefined;
  } });
  game.named.register("base:sigil_touch", { touch: sigilTouch });
  game.named.register("base:sigil_place", { action: (runtime, entity) => {
    const body = runtime.body(entity), start = vadd(body.origin, { x: 0, y: 0, z: 6 });
    const floor = runtime.host.trace({ start, end: vadd(start, { x: 0, y: 0, z: -256 }), bounds: body.bounds, ignore: entity.actor.id, monsters: true });
    if (floor.allSolid || floor.fraction === 1) return runtime.remove(entity); runtime.setBody(entity, { origin: floor.end, velocity: ZERO, ground: floor.actor }); return runtime.link(entity);
  } });
  game.named.register("base:shooter_fire", { use: shooterFire });
  game.named.register("base:shooter_think", { action: (runtime, entity) => { shooterFire(runtime, entity); return later(runtime, entity, entity.wait, "base:shooter_think"); } });
  game.named.register("base:bubble_bob", { action: bubbleBob });
  game.named.register("base:changelevel_touch", { touch: changelevelTouch });
  game.named.register("base:execute_changelevel", { action: (runtime, entity) => q1Base(runtime).levelRules.begin(entity.text("map"), entity.activator) });
  game.named.register("base:wall_use", { use: (_runtime, entity) => { entity.frame = 1 - entity.frame; return undefined; } });
  game.named.register("base:setskill_touch", { touch: (runtime, entity, other) => {
    if (!runtime.isPlayer(other)) return undefined; const value = Math.max(0, Math.min(3, Math.floor(Number(entity.message))));
    if (value === 0 || value === 1 || value === 2 || value === 3) q1Base(runtime).campaign.setSkill(value); return undefined;
  } });
  game.named.register("base:registered_touch", { touch: (runtime, entity, other) => {
    if (!runtime.isPlayer(other) || entity.attackFinished > runtime.time) return undefined; entity.attackFinished = runtime.time + 2;
    if (q1Base(runtime).registered) { entity.message = ""; runtime.useTargets(entity, other); return runtime.remove(entity); }
    if (entity.message !== "") { runtime.message(other, entity.message); const player = runtime.host.actors.resolveOwned(other); if (player !== null) runtime.sound(player, "misc/talk.wav", "body"); } return undefined;
  } });
  game.named.register("base:monsterjump_touch", { touch: (runtime, entity, other) => {
    const monster = runtime.entity(other), body = runtime.host.bodies.read(other); if (monster === null || monster.monster === null || body === null || (monster.movementFlags & 3) !== 0) return undefined;
    runtime.setBody(monster, { velocity: { x: entity.movedir.x * entity.speed, y: entity.movedir.y * entity.speed, z: body.ground === null ? body.velocity.z : entity.number("height") || 200 }, ground: null });
    if (body.ground !== null) monster.movementFlags &= ~512; return undefined;
  } });
  game.named.register("base:fireball_fly", { action: fireballFly });
  game.named.register("base:fireball_touch", { touch: (runtime, entity, other) => { runtime.damage(other, entity.actor.id, entity.actor.id, 20); return runtime.remove(entity); } });
  game.named.register("base:make_bubbles", { action: (runtime, entity) => { spawnBubble(runtime, runtime.body(entity).origin); return later(runtime, entity, runtime.host.random() + 0.5, "base:make_bubbles"); } });
  game.named.register("base:noisemaker", { action: (runtime, entity) => {
    const sounds: readonly { readonly path: string; readonly channel: Q1SoundChannel }[] = [{ path: "enfire", channel: "weapon" }, { path: "enfstop", channel: "voice" }, { path: "sight1", channel: "item" }, { path: "sight2", channel: "body" }, { path: "sight3", channel: 5 }, { path: "sight4", channel: 6 }, { path: "pain1", channel: 7 }];
    for (const sound of sounds) runtime.sound(entity, `enforcer/${sound.path}.wav`, sound.channel); return later(runtime, entity, 0.5, "base:noisemaker");
  } });
  return undefined;
}
export function spawnRemainingMapActor(base: Q1Base, entity: Q1Actor): undefined {
  const { game } = base;
  switch (entity.classname) {
    case "testplayerstart": return undefined;
    case "trigger_changelevel": if (entity.text("map") === "") throw new Error("changelevel trigger doesn't have map"); entity.fields.set("killstring", "$qc_ks_tried_leave"); initTrigger(game, entity); entity.touch = game.named.touch(entity, "base:changelevel_touch"); return undefined;
    case "func_train": case "misc_teleporttrain": return train(game, entity);
    case "item_sigil": return sigil(game, entity);
    case "event_lightning": return base.spawnLightning(entity);
    case "func_episodegate": case "func_bossgate": {
      const flags = base.campaign.readFlags();
      if (entity.classname === "func_episodegate" ? (flags & entity.spawnflags) === 0 : (flags & 15) === 15) { entity.model = ""; return undefined; }
      entity.solid = "bsp"; entity.movement = "push"; game.setBody(entity, { angles: ZERO }); entity.use = game.named.use(entity, "base:wall_use"); return undefined;
    }
    case "func_illusionary": game.setBody(entity, { angles: ZERO }); entity.solid = "none"; entity.movement = "none"; return undefined;
    case "trigger_setskill": initTrigger(game, entity); entity.touch = game.named.touch(entity, "base:setskill_touch"); return undefined;
    case "trigger_onlyregistered": if (game.usesId1Precaches) game.precacheSound("misc/talk.wav"); initTrigger(game, entity); entity.touch = game.named.touch(entity, "base:registered_touch"); return undefined;
    case "trigger_monsterjump": if (game.body(entity).angles.y === 0) game.setBody(entity, { angles: { x: 0, y: 360, z: 0 } }); initTrigger(game, entity); entity.speed ||= 200; entity.touch = game.named.touch(entity, "base:monsterjump_touch"); return undefined;
    case "trap_spikeshooter": case "trap_shooter": return shooter(game, entity);
    case "misc_fireball": if (game.usesId1Precaches) game.precacheModel("progs/lavaball.mdl"); entity.classname = "fireball"; entity.fields.set("killstring", "$qc_ks_lavaball"); entity.speed ||= 1000; return later(game, entity, game.host.random() * 5, "base:fireball_fly");
    case "air_bubbles": if (game.options.deathmatch !== 0) return game.remove(entity); if (game.usesId1Precaches) game.precacheModel("progs/s_bubble.spr"); return later(game, entity, 1, "base:make_bubbles");
    case "light_globe": if (game.usesId1Precaches) game.precacheModel("progs/s_light.spr"); entity.model = "progs/s_light.spr"; return undefined;
    case "light_torch_small_walltorch": case "light_flame_large_yellow": case "light_flame_small_yellow": case "light_flame_small_white":
      entity.model = entity.classname === "light_torch_small_walltorch" ? "progs/flame.mdl" : "progs/flame2.mdl"; entity.frame = entity.classname === "light_flame_large_yellow" ? 1 : 0;
      if (game.usesId1Precaches) game.precacheModel(entity.model); if (game.usesId1Precaches) game.precacheSound("ambience/fire1.wav");
      return game.host.emit({ kind: "ambient", origin: game.body(entity).origin, path: "ambience/fire1.wav", volume: 0.5, attenuation: 3 });
    case "ambient_suck_wind": case "ambient_flouro_buzz": case "ambient_drip": case "ambient_thunder": case "ambient_light_buzz": case "ambient_swamp1": case "ambient_swamp2": {
      const name = entity.classname;
      const path = name === "ambient_suck_wind" ? "suck1" : name === "ambient_flouro_buzz" ? "buzz1" : name === "ambient_drip" ? "drip1" : name === "ambient_thunder" ? "thunder1" : name === "ambient_light_buzz" ? "fl_hum1" : name === "ambient_swamp1" ? "swamp1" : "swamp2";
      if (game.usesId1Precaches) game.precacheSound(`ambience/${path}.wav`);
      return game.host.emit({ kind: "ambient", origin: game.body(entity).origin, path: `ambience/${path}.wav`, volume: name === "ambient_suck_wind" || name === "ambient_flouro_buzz" ? 1 : 0.5, attenuation: 3 });
    }
    case "viewthing": if (game.usesId1Precaches) game.precacheModel("progs/player.mdl"); entity.model = "progs/player.mdl"; return undefined;
    case "misc_noisemaker":
      for (const path of ["enfire", "enfstop", "sight1", "sight2", "sight3", "sight4", "pain1", "pain2", "death1", "idle1"]) if (game.usesId1Precaches) game.precacheSound(`enforcer/${path}.wav`);
      return later(game, entity, 0.1 + game.host.random(), "base:noisemaker");
    default: throw new Error(`Unknown base Q1 map class ${entity.classname}`);
  }
}
