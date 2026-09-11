/* triggers.qc/misc.qc/world.qc/client.qc, Copyright (C) 1996-2022 id Software LLC. GPL-2.0-or-later. */
import type { Vec3 } from "../../../contracts/math.ts";
import type { ActorId } from "../../../contracts/identity.ts";
import { sameActor } from "../../../contracts/identity.ts";
import type { Q1Actor } from "./entity.ts";
import { moveDirection } from "./entity.ts";
import type { Q1EntityServices } from "./entity-services.ts";
import { ZERO, vadd, vsub, vscale, dot, yawFor } from "./types.ts";
import { precacheQ1World } from "./precache-world.ts";
import { spawnPickup } from "./pickups.ts";
import { spawnButton, spawnDoor, spawnPlat, spawnSecretDoor } from "./movers.ts";
import { spawnMonster } from "./monsters.ts";
export { linkDoors } from "./movers.ts";

function initTrigger(game: Q1EntityServices, entity: Q1Actor): undefined {
  const angles = game.body(entity).angles;
  entity.movedir = angles.x === 0 && angles.y === 0 && angles.z === 0 ? ZERO : moveDirection(angles, game);
  game.setBody(entity, { angles: ZERO }); entity.solid = "trigger"; entity.movement = "none"; entity.model = "";
  return undefined;
}
function spawnMulti(game: Q1EntityServices, entity: Q1Actor): undefined {
  initTrigger(game, entity);
  const secret = entity.classname === "trigger_secret";
  const once = secret || entity.classname === "trigger_once";
  entity.wait = once ? -1 : entity.wait || 0.2;
  if (secret) { game.totalSecrets++; entity.message ||= "$qc_found_secret"; entity.sounds ||= 1; }

  const sound = entity.sounds === 1 ? "misc/secret.wav" : entity.sounds === 2 ? "misc/talk.wav" : entity.sounds === 3 ? "misc/trigger1.wav" : null;
  if (game.usesId1Precaches && (secret && (entity.sounds === 1 || entity.sounds === 2) && sound !== null)) game.precacheSound(sound);
  if (game.usesId1Precaches && (sound !== null)) game.precacheSound(sound);
  entity.use = game.named.use(entity, "multi_use");
  if (entity.maxHealth > 0) {
    if ((entity.spawnflags & 1) !== 0) throw new Error("health and notouch do not make sense");
    entity.damageable = true; entity.solid = "bbox"; entity.die = game.named.die(entity, "multi_killed");
  } else if ((entity.spawnflags & 1) === 0) entity.touch = game.named.touch(entity, "multi_touch");
  return undefined;
}
function spawnCounter(game: Q1EntityServices, entity: Q1Actor): undefined {
  entity.model = "";
  entity.count ||= 2;
  entity.use = game.named.use(entity, "counter_use");
  return undefined;
}
function teleport(game: Q1EntityServices, entity: Q1Actor): undefined {
  initTrigger(game, entity);
  if (entity.target === "") throw new Error("trigger_teleport has no target");
  entity.use = game.named.use(entity, "teleport_use");
  if ((entity.spawnflags & 2) === 0) {
    if (game.usesId1Precaches) game.precacheSound("ambience/hum1.wav");
    const bounds = game.body(entity).bounds;
    game.host.emit({ kind: "ambient", origin: vscale(vadd(bounds.min, bounds.max), 0.5), path: "ambience/hum1.wav", volume: 0.5, attenuation: 3 });
  }
  entity.touch = game.named.touch(entity, "teleport_touch");
  return undefined;
}
function spawnLight(game: Q1EntityServices, entity: Q1Actor): undefined {
  if (entity.classname === "light" && entity.targetname === "") return game.remove(entity);
  const style = entity.number("style");
  if (style >= 32 && entity.classname !== "light_fluorospark") {
    entity.use = game.named.use(entity, "light_use");
    game.host.emit({ kind: "lightstyle", style, pattern: (entity.spawnflags & 1) !== 0 ? "a" : "m" });
  }
  if (game.usesId1Precaches && (entity.classname === "light_fluoro")) game.precacheSound("ambience/fl_hum1.wav");
  if (game.usesId1Precaches && (entity.classname === "light_fluorospark")) game.precacheSound("ambience/buzz1.wav");
  if (entity.classname === "light_fluoro" || entity.classname === "light_fluorospark") game.host.emit({ kind: "ambient", origin: game.body(entity).origin, path: entity.classname === "light_fluoro" ? "ambience/fl_hum1.wav" : "ambience/buzz1.wav", volume: 0.5, attenuation: 3 });
  return undefined;
}
function spawnBarrel(game: Q1EntityServices, entity: Q1Actor): undefined {
  entity.model = entity.classname === "misc_explobox2" ? "maps/b_exbox2.bsp" : "maps/b_explob.bsp";
  if (game.usesId1Precaches) game.precacheModel(entity.model); if (game.usesId1Precaches) game.precacheSound("weapons/r_exp3.wav");
  entity.solid = "bsp"; entity.movement = "push"; entity.damageable = true; entity.aimedDamage = true; game.host.combat.setHealth(entity.actor, 20);
  game.setBounds(entity, { min: ZERO, max: { x: 32, y: 32, z: entity.classname === "misc_explobox2" ? 32 : 64 } });
  entity.die = game.named.die(entity, "barrel_die");
  const body = game.body(entity), start = vadd(body.origin, { x: 0, y: 0, z: 2 });
  const trace = game.host.trace({ start, end: vadd(start, { x: 0, y: 0, z: -256 }), bounds: body.bounds, ignore: entity.actor.id, monsters: true });
  if (start.z - trace.end.z > 250) return game.remove(entity);
  return game.setOrigin(entity, trace.end);
}
export function spawnMapActor(game: Q1EntityServices, entity: Q1Actor): undefined {
  if (spawnPickup(game, entity)) return undefined;
  switch (entity.classname) {
    case "worldspawn": {
      game.world = entity; game.worldType = entity.number("worldtype"); entity.solid = "bsp"; if (game.usesId1Precaches) precacheQ1World(game);
      const styles = ["m", "mmnmmommommnonmmonqnmmo", "abcdefghijklmnopqrstuvwxyzyxwvutsrqponmlkjihgfedcba", "mmmmmaaaaammmmmaaaaaabcdefgabcdefg", "mamamamamama", "jklmnopqrstuvwxyzyxwvutsrqponmlkj", "nmonqnmomnmomomno", "mmmaaaabcdefgmmmmaaaammmaamm", "mmmaaammmaaammmabcdefaaaammmmabcdefmmmaaaa", "aaaaaaaazzzzzzzz", "mmamammmmammamamaaamammma", "abcdefghijklmnopqrrqponmlkjihgfedcba"];
      for (const [style, pattern] of styles.entries()) game.host.emit({ kind: "lightstyle", style, pattern }); return undefined;
    }
    case "func_door": return spawnDoor(game, entity);
    case "func_button": return spawnButton(game, entity);
    case "func_door_secret": return spawnSecretDoor(game, entity);
    case "func_plat": return spawnPlat(game, entity);
    case "func_wall": entity.solid = "bsp"; entity.movement = "push"; game.setBody(entity, { angles: ZERO }); entity.use = game.named.use(entity, "func_wall_use"); return undefined;
    case "trigger_once": case "trigger_multiple": case "trigger_secret": return spawnMulti(game, entity);
    case "trigger_counter": return spawnCounter(game, entity);
    case "trigger_relay": entity.use = game.named.use(entity, "trigger_relay_use"); return undefined;
    case "trigger_teleport": return teleport(game, entity);
    case "trigger_changelevel": {
      initTrigger(game, entity); const map = entity.text("map"); if (map === "") throw new Error("changelevel trigger has no map");
      entity.touch = game.named.touch(entity, "changelevel_touch"); return undefined;
    }
    case "trigger_hurt": initTrigger(game, entity); entity.damage ||= 5; entity.touch = game.named.touch(entity, "hurt_touch"); return undefined;
    case "trigger_push": if (game.usesId1Precaches) game.precacheSound("ambience/windfly.wav"); initTrigger(game, entity); entity.speed ||= 1000; entity.touch = game.named.touch(entity, "push_touch"); return undefined;
    case "info_teleport_destination": entity.mangle = game.body(entity).angles; game.setBody(entity, { angles: ZERO }); game.setOrigin(entity, vadd(game.body(entity).origin, { x: 0, y: 0, z: 27 })); if (entity.targetname === "") throw new Error("teleport destination has no targetname"); return undefined;
    case "testplayerstart": case "info_player_start": case "info_player_coop": case "info_player_deathmatch": case "info_player_start2": case "info_intermission": case "info_notnull": return undefined;
    case "path_corner": {
      if (entity.targetname === "") throw new Error("monster_movetarget has no targetname");
      entity.solid = "trigger"; game.setBounds(entity, { min: { x: -8, y: -8, z: -8 }, max: { x: 8, y: 8, z: 8 } });
      entity.touch = game.named.touch(entity, "movetarget_touch"); return undefined;
    }
    case "light": case "light_fluoro": case "light_fluorospark": return spawnLight(game, entity);
    case "ambient_comp_hum": case "ambient_drone": if (game.usesId1Precaches) game.precacheSound(entity.classname === "ambient_comp_hum" ? "ambience/comp1.wav" : "ambience/drone6.wav"); game.host.emit({ kind: "ambient", origin: game.body(entity).origin, path: entity.classname === "ambient_comp_hum" ? "ambience/comp1.wav" : "ambience/drone6.wav", volume: entity.classname === "ambient_comp_hum" ? 1 : 0.5, attenuation: 3 }); return undefined;
    case "misc_explobox": case "misc_explobox2": return spawnBarrel(game, entity);
    case "monster_army": case "monster_dog": return spawnMonster(game, entity);
    default: throw new Error(`Q1 official spawn not yet implemented: ${entity.classname} at source entity ${entity.sourceOrdinal}`);
  }
}


function multiFire(game: Q1EntityServices, entity: Q1Actor, activator: ActorId | null): undefined {
  const secret = entity.classname === "trigger_secret";
  const sound = entity.sounds === 1 ? "misc/secret.wav" : entity.sounds === 2 ? "misc/talk.wav" : entity.sounds === 3 ? "misc/trigger1.wav" : "";
    if (entity.nextThink > game.time || !game.live(entity)) return undefined;
    if (secret) {
      if (!game.isPlayer(activator)) return undefined;
      game.foundSecrets++; game.host.emit({ kind: "secret", actor: entity.actor.id, total: game.totalSecrets, found: game.foundSecrets });
      if (game.options.edition === "rerelease") game.host.emit({ kind: "achievement", player: activator, id: "ACH_FIND_SECRET" });
    }
    entity.activator = activator; entity.damageable = false;
    if (sound !== "") game.sound(entity, sound);
    game.useTargets(entity, activator);
    if (!game.live(entity)) return undefined;
    if (entity.wait > 0) return game.schedule(entity, entity.wait, game.named.action(entity, "multi_wait"));
    entity.touch = null; return game.schedule(entity, 0.1, game.named.action(entity, "SUB_Remove"));
}

function counterUse(game: Q1EntityServices, entity: Q1Actor, _other: ActorId | null, activator: ActorId | null): undefined {
    entity.count--; if (entity.count < 0) return undefined;
    if ((entity.spawnflags & 1) === 0) game.message(activator, entity.count >= 4 ? "$qc_more_go" : entity.count === 3 ? "$qc_three_more" : entity.count === 2 ? "$qc_two_more" : entity.count === 1 ? "$qc_one_more" : "$qc_sequence_completed");
    if (entity.count !== 0) return undefined;
    game.useTargets(entity, activator); return game.schedule(entity, 0.1, game.named.action(entity, "SUB_Remove"));
}

function teleportTouch(game: Q1EntityServices, entity: Q1Actor, other: ActorId): undefined {
    if (entity.targetname !== "" && entity.nextThink < game.time) return undefined;
    const player = game.isPlayer(other); if ((entity.spawnflags & 1) !== 0 && !player) return undefined;
    if (game.health(other) <= 0 || !player && game.entity(other)?.solid !== "slidebox") return undefined;
    const target = game.find(entity.target)[0]; if (target === undefined) throw new Error("could not find teleport target");
    const owner = game.host.actors.resolveOwned(other), body = game.host.bodies.read(other); if (owner === null || body === null) return undefined;
    game.useTargets(entity, other); spawnTeleportFog(game, body.origin);
    const destination = game.body(target).origin, forward = game.makeVectors(target.mangle).forward;
    spawnTeleportFog(game, vadd(destination, vscale(forward, 32)));
    spawnTeledeath(game, destination, other);
    game.host.bodies.write(owner, { ...body, origin: destination, angles: target.mangle, velocity: player ? vscale(forward, 300) : body.velocity, ground: null });
    game.host.bodies.link(owner);
    if (player) {
      const state = game.player(other); if (state !== null) state.teleportUntil = game.time + 0.7;
      game.host.emit({ kind: "teleport-player", player: other, angles: target.mangle, lockUntil: game.time + 0.7 });
    }
    return undefined;
}

function changelevelTouch(game: Q1EntityServices, entity: Q1Actor, other: ActorId): undefined {
  const map = entity.text("map");
        if (!game.isPlayer(other)) return undefined;
        if (game.options.noExit === 1 || game.options.noExit === 2 && game.mapName !== "start") { game.damage(other, entity.actor.id, entity.actor.id, 50000, null, "direct", "exit"); return undefined; }
        game.useTargets(entity, other); entity.touch = null;
        if ((entity.spawnflags & 1) !== 0 && game.options.deathmatch === 0) return game.travel(map, other);
        entity.activator = other; return game.schedule(entity, 0.1, game.named.action(entity, "execute_changelevel"));
}

function pathTouch(game: Q1EntityServices, entity: Q1Actor, other: ActorId): undefined {
        const actor = game.entity(other), monster = actor?.monster;
        if (actor !== null && game.sourcePathTouch(entity, actor)) return undefined;
        if (actor === null || actor === undefined || monster === null || monster === undefined || monster.path !== entity.targetname || monster.enemy !== null) return undefined;
        monster.path = entity.target;
        const target = game.find(monster.path)[0];
        if (target === undefined) { monster.path = ""; actor.pathEnd?.(); }
        else actor.idealYaw = yawFor(vsub(game.body(target).origin, game.body(actor).origin));
        return undefined;
}
export function registerSpawnCallbacks(game: Q1EntityServices): undefined {
  game.named.register("multi_use", { use: (runtime, entity, _other, activator) => multiFire(runtime, entity, activator) });
  game.named.register("multi_killed", { die: multiFire });
  game.named.register("multi_touch", { touch: (runtime, entity, other) => {
    if (!runtime.isPlayer(other)) return undefined;
    const body = runtime.host.bodies.read(other); if (body === null || dot(runtime.makeVectors(body.angles).forward, entity.movedir) < 0) return undefined;
    return multiFire(runtime, entity, other);
  } });
  game.named.register("multi_wait", { action: (runtime, entity) => {
    if (entity.maxHealth > 0) { runtime.host.combat.setHealth(entity.actor, entity.maxHealth); entity.damageable = true; entity.solid = "bbox"; } return undefined;
  } });
  game.named.register("counter_use", { use: counterUse });
  game.named.register("teleport_use", { use: (runtime, entity) => { runtime.forceRetouch = 2; return runtime.schedule(entity, 0.2, runtime.named.action(entity, "SUB_Null")); } });
  game.named.register("teleport_touch", { touch: teleportTouch });
  game.named.register("play_teleport", { action: (runtime, entity) => {
    const index = Math.min(4, Math.floor(Math.fround(runtime.host.random() * 5)));
    runtime.sound(entity, `misc/r_tele${index + 1}.wav`); return runtime.remove(entity);
  } });
  game.named.register("tdeath_touch", { touch: (runtime, entity, victim) => {
    const owner = entity.owner; if (owner === null || sameActor(victim, owner)) return undefined;
    if (runtime.isPlayer(victim)) {
      if ((runtime.player(victim)?.powerups.get("invulnerability") ?? 0) > runtime.time) entity.classname = "teledeath2";
      if (!runtime.isPlayer(owner)) { runtime.damage(owner, entity.actor.id, entity.actor.id, 50000, null, "direct", entity.classname); return undefined; }
    }
    if (runtime.health(victim) !== 0) runtime.damage(victim, entity.actor.id, entity.actor.id, 50000, null, "direct", entity.classname); return undefined;
  } });
  game.named.register("light_use", { use: (runtime, entity) => { entity.spawnflags ^= 1; return runtime.host.emit({ kind: "lightstyle", style: entity.number("style"), pattern: (entity.spawnflags & 1) !== 0 ? "a" : "m" }); } });
  game.named.register("barrel_die", { die: (runtime, entity, attacker) => { entity.classname = "explo_box"; entity.damageable = false; entity.activator = attacker; return runtime.schedule(entity, 0.3, runtime.named.action(entity, "barrel_explode")); } });
  game.named.register("barrel_explode", { action: (runtime, entity) => {
    runtime.radiusDamage(entity.actor.id, entity.activator, 160, null, null); runtime.sound(entity, "weapons/r_exp3.wav");
    runtime.effect("explosion", vadd(runtime.body(entity).origin, { x: 0, y: 0, z: 32 })); return runtime.remove(entity);
  } });
  game.named.register("func_wall_use", { use: (_runtime, entity) => { entity.frame = 1 - entity.frame; return undefined; } });
  game.named.register("trigger_relay_use", { use: (runtime, entity, _other, activator) => runtime.useTargets(entity, activator) });
  game.named.register("changelevel_touch", { touch: changelevelTouch });
  game.named.register("execute_changelevel", { action: (runtime, entity) => runtime.beginIntermission(entity.text("map"), entity.activator) });
  game.named.register("hurt_touch", { touch: (runtime, entity, other) => {
    if (entity.solid !== "trigger" || !runtime.host.combat.read(other)?.canTakeDamage) return undefined;
    entity.solid = "none"; runtime.damage(other, entity.actor.id, entity.actor.id, entity.damage, null, "direct", "trigger");
    return runtime.schedule(entity, 1, runtime.named.action(entity, "hurt_on"));
  } });
  game.named.register("hurt_on", { action: (runtime, entity) => { entity.solid = "trigger"; return runtime.link(entity); } });
  game.named.register("push_touch", { touch: (runtime, entity, other) => {
    if (runtime.health(other) <= 0 && runtime.entity(other)?.classname !== "grenade") return undefined;
    const actor = runtime.host.actors.resolveOwned(other), body = runtime.host.bodies.read(other); if (actor === null || body === null) return undefined;
    runtime.host.bodies.write(actor, { ...body, velocity: vscale(entity.movedir, entity.speed * 10) });
    if ((entity.spawnflags & 1) !== 0) runtime.remove(entity); return undefined;
  } });
  game.named.register("movetarget_touch", { touch: pathTouch });
  return undefined;
}

/** spawn_tfog: broadcast immediately, then choose/play the sound on its source think. */
export function spawnTeleportFog(game: Q1EntityServices, origin: Vec3): Q1Actor {
  const fog = game.create("teleport_fog"); fog.classname = "";
  game.setBody(fog, { origin });
  game.schedule(fog, 0.2, game.named.action(fog, "play_teleport"));
  game.effect("teleport", origin); return fog;
}
/** spawn_tdeath: force_retouch makes stationary actors participate through shared source linking. */
export function spawnTeledeath(game: Q1EntityServices, origin: Vec3, owner: ActorId): Q1Actor {
  const body = game.host.bodies.read(owner); if (body === null) throw new Error("Teledeath owner has no shared body");
  const death = game.create("teledeath"); death.solid = "trigger"; death.owner = owner;
  game.setBody(death, { origin, bounds: { min: vsub(body.bounds.min, { x: 1, y: 1, z: 1 }), max: vadd(body.bounds.max, { x: 1, y: 1, z: 1 }) } });
  death.touch = game.named.touch(death, "tdeath_touch");
  game.schedule(death, 0.2, game.named.action(death, "SUB_Remove"));
  game.link(death); game.forceRetouch = 2; return death;
}
