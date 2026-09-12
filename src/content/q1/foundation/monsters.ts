/* ai.qc/fight.qc/monsters/grunt.qc/monsters/rottweiler.qc.
 * Copyright (C) 1996-2022 id Software LLC. GPL-2.0-or-later. */
import type { ActorId } from "../../../contracts/identity.ts";
import { sameActor } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { Q1Actor, Q1Monster } from "./entity.ts";
import type { Q1EntityServices } from "./entity-services.ts";
import { POINT, vadd, vsub, vscale, length, normalize, dot, yawFor } from "./types.ts";
import { fireBullets } from "./weapons.ts";

const armyWalk: readonly number[] = [1, 1, 1, 1, 2, 3, 4, 4, 2, 2, 2, 1, 0, 1, 1, 1, 3, 3, 3, 3, 2, 1, 1, 1];
const armyRun: readonly number[] = [11, 15, 10, 10, 8, 15, 10, 8];
const dogRun: readonly number[] = [16, 32, 32, 20, 64, 32, 16, 32, 32, 20, 64, 32];
function stationary(count: number): readonly number[] { return Array.from({ length: count }, () => 0); }
function setSequence(monster: Q1Monster, mode: Q1Monster["mode"], firstFrame: number, sequence: readonly number[]): undefined {
  monster.mode = mode; monster.firstFrame = firstFrame; monster.sequence = sequence; monster.frameIndex = 0; return undefined;
}
function stand(monster: Q1Monster): undefined { return setSequence(monster, "stand", monster.species === "army" ? 0 : 69, stationary(monster.species === "army" ? 8 : 9)); }
function walk(monster: Q1Monster): undefined { return setSequence(monster, "walk", monster.species === "army" ? 90 : 78, monster.species === "army" ? armyWalk : Array.from({ length: 8 }, () => 8)); }
function run(monster: Q1Monster): undefined { return setSequence(monster, "run", monster.species === "army" ? 73 : 48, monster.species === "army" ? armyRun : dogRun); }
export function pathEndTime(time: number): number { return Math.fround(Math.fround(time) + 999999); }
export function setMonsterRoute(game: Q1EntityServices, entity: Q1Actor, goal: ActorId | null, pauseUntil: number): undefined {
  const monster = requireMonster(entity);
  monster.pauseUntil = pauseUntil;
  const prefix = entity.fields.get("source.monsterCallbackPrefix");
  if (prefix !== undefined) game.named.action(entity, `${prefix}:monster_route`)();
  else if (goal === null || pauseUntil > game.time) stand(monster); else if (monster.mode === "stand") walk(monster);
  const target = goal === null ? null : game.host.bodies.read(goal);
  if (target !== null) entity.idealYaw = yawFor(vsub(target.origin, game.body(entity).origin));
  return undefined;
}
function face(game: Q1EntityServices, entity: Q1Actor, destination: Vec3): number {
  const body = game.body(entity), ideal = yawFor(vsub(destination, body.origin));
  let move = ideal - body.angles.y; if (move > 180) move -= 360; if (move < -180) move += 360;
  const speed = entity.number("yaw_speed") || 20;
  entity.idealYaw = ideal;
  const yaw = (body.angles.y + Math.max(-speed, Math.min(speed, move)) + 360) % 360;
  game.setBody(entity, { angles: { ...body.angles, y: yaw } }); return yaw;
}
function visible(game: Q1EntityServices, entity: Q1Actor, target: ActorId): boolean {
  const body = game.host.bodies.read(target); if (body === null) return false;
  const observed = game.monsterTarget(target); if (observed === null) return false;
  const trace = game.host.trace({ start: vadd(game.body(entity).origin, { x: 0, y: 0, z: 25 }), end: vadd(body.origin, { x: 0, y: 0, z: observed.viewHeight }), bounds: POINT, ignore: entity.actor.id, monsters: false });
  return trace.fraction === 1 && !(trace.inOpen && trace.inWater);
}
function foundTarget(game: Q1EntityServices, entity: Q1Actor, monster: Q1Monster, target: ActorId): undefined {
  monster.enemy = target; monster.searchUntil = game.time + 5; monster.attackFinished = game.time + 1; run(monster);
  game.monsterMissions.get(entity.actor.id)?.foundTarget();
  game.sightEntity = entity; game.sightTime = game.time;
  return game.sound(entity, monster.species === "army" ? "soldier/sight1.wav" : "dog/dsight.wav");
}
function findTarget(game: Q1EntityServices, entity: Q1Actor, monster: Q1Monster): boolean {
  let candidate: ActorId | null;
  if (game.sightEntity !== null && game.sightTime >= game.time - 0.1 && (entity.spawnflags & 3) === 0) candidate = game.sightEntity.monster?.enemy ?? null;
  else candidate = game.host.checkClient(entity.actor);
  if (candidate === null || game.health(candidate) <= 0) return false;
  const observed = game.monsterTarget(candidate);
  if (observed === null || observed.invisible || observed.notarget) return false;
  const target = game.host.bodies.read(candidate); if (target === null) return false;
  const delta = vsub(target.origin, game.body(entity).origin), distance = length(delta);
  if (distance >= 1000 || !visible(game, entity, candidate)) return false;
  const inFront = dot(normalize(delta), game.makeVectors(game.body(entity).angles).forward) > 0.3;
  if (distance >= 500 && !inFront || distance >= 120 && distance < 500 && (observed.hostileUntil === null || observed.hostileUntil < game.time) && !inFront) return false;
  foundTarget(game, entity, monster, candidate); return true;
}
function tryAttack(game: Q1EntityServices, entity: Q1Actor, monster: Q1Monster): boolean {
  const enemy = monster.enemy; if (enemy === null) return false;
  const target = game.host.bodies.read(enemy); if (target === null) return false;
  const body = game.body(entity), delta = vsub(target.origin, body.origin), distance = length(delta);
  if (monster.species === "dog") {
    if (distance < 120) { entity.attackState = "melee"; return true; }
    const vertical = body.origin.z + body.bounds.min.z <= target.origin.z + target.bounds.min.z + (target.bounds.max.z - target.bounds.min.z) * 0.75 &&
      body.origin.z + body.bounds.max.z >= target.origin.z + target.bounds.min.z + (target.bounds.max.z - target.bounds.min.z) * 0.25;
    const horizontal = Math.hypot(delta.x, delta.y);
    if (vertical && horizontal >= 80 && horizontal <= 150) { entity.attackState = "missile"; return true; }
    return false;
  }
  if (game.time < monster.attackFinished || distance >= 1000) return false;
  const observed = game.monsterTarget(enemy); if (observed === null) return false;
  const trace = game.host.trace({ start: vadd(body.origin, { x: 0, y: 0, z: 25 }), end: vadd(target.origin, { x: 0, y: 0, z: observed.viewHeight }), bounds: POINT, ignore: entity.actor.id, monsters: true });
  if (trace.actor === null || !sameActor(trace.actor, enemy) || trace.inOpen && trace.inWater) return false;
  if (game.host.random() >= (distance < 120 ? 0.9 : distance < 500 ? 0.4 : 0.05)) return false;
  setSequence(monster, "attack", 81, stationary(9)); monster.attackFinished = game.time + 1 + game.host.random(); monster.refired = false;
  game.host.random(); return true;
}
function monsterFrame(game: Q1EntityServices, entity: Q1Actor, monster: Q1Monster): undefined {
  const mode = monster.mode; const index = monster.frameIndex;
  const distance = monster.sequence[index] ?? 0; entity.frame = monster.firstFrame + index;
  if ((mode === "walk" || mode === "run") && index === 0 && game.host.random() < 0.2) game.sound(entity, monster.species === "army" ? "soldier/idle.wav" : "dog/idle.wav", "voice", 2);
  if (mode === "death") {
    if (monster.species === "army" && index === 2 && !monster.deathDrop) { entity.solid = "none"; game.link(entity); game.dropShells(game.body(entity).origin); monster.deathDrop = true; }
    if (distance !== 0) game.host.walkMove(entity.actor, game.body(entity).angles.y, distance);
  } else if (mode === "pain") {
    if (distance !== 0) game.host.walkMove(entity.actor, game.body(entity).angles.y, distance);
  } else if (mode === "stand" || mode === "walk") {
    if (findTarget(game, entity, monster)) return game.schedule(entity, 0.1, game.named.action(entity, "monster_frame"));
    if (mode === "stand" && game.time >= monster.pauseUntil && game.monsterMissions.get(entity.actor.id)?.route() != null) walk(monster);
    if (mode === "walk" && game.time >= monster.pauseUntil) {
      const mission = game.monsterMissions.get(entity.actor.id);
      const target = mission === undefined ? game.find(monster.path)[0]?.actor.id ?? null : mission.route();
      if (target === null) stand(monster);
      else game.host.moveToGoal(entity.actor, target, distance);
    }
  } else {
    let enemy = monster.enemy;
    if (enemy === null || game.health(enemy) <= 0) {
      if (monster.oldEnemy !== null && game.health(monster.oldEnemy) > 0) { monster.enemy = monster.oldEnemy; monster.oldEnemy = null; enemy = monster.enemy; }
      else { monster.enemy = null; if (game.monsterMissions.get(entity.actor.id)?.route() != null || monster.path !== "") walk(monster); else stand(monster); return game.schedule(entity, 0.1, game.named.action(entity, "monster_frame")); }
    }
    const target = game.host.bodies.read(enemy); if (target === null) return undefined;
    if (mode === "run") {
      const combatRoute = game.monsterMissions.get(entity.actor.id)?.combatRoute();
      if (combatRoute?.goal != null) {
        game.host.moveToGoal(entity.actor, combatRoute.goal, distance, "contact");
        monster.frameIndex = (monster.frameIndex + 1) % monster.sequence.length;
        return game.schedule(entity, 0.1, game.named.action(entity, "monster_frame"));
      }
      const seen = visible(game, entity, enemy); if (seen) monster.searchUntil = game.time + 5;
      if (game.options.coop && monster.searchUntil < game.time && findTarget(game, entity, monster)) return game.schedule(entity, 0.1, game.named.action(entity, "monster_frame"));
      if (entity.attackState !== "straight") {
        const yaw = face(game, entity, target.origin), ideal = yawFor(vsub(target.origin, game.body(entity).origin));
        const delta = (yaw - ideal + 360) % 360;
        if (delta <= 45 || delta >= 315) {
          if (entity.attackState === "melee") setSequence(monster, "attack", 0, Array.from({ length: 8 }, () => 10));
          else setSequence(monster, "leap", 60, stationary(9));
          entity.attackState = "straight"; return monsterFrame(game, entity, monster);
        }
        monster.frameIndex = (monster.frameIndex + 1) % monster.sequence.length;
        return game.schedule(entity, 0.1, game.named.action(entity, "monster_frame"));
      }
      if (seen && tryAttack(game, entity, monster)) {
        if (monster.mode !== mode) return monsterFrame(game, entity, monster);
        monster.frameIndex = (monster.frameIndex + 1) % monster.sequence.length;
        return game.schedule(entity, 0.1, game.named.action(entity, "monster_frame"));
      }
      if (combatRoute?.standGround !== true) game.host.moveToGoal(entity.actor, enemy, distance);
    } else if (mode === "attack") {
      face(game, entity, target.origin);
      if (monster.species === "army") {
        if (index === 4) {
          game.sound(entity, "soldier/sattck1.wav", "weapon");
          fireBullets(game, entity.actor, normalize(vsub(vsub(target.origin, vscale(target.velocity, 0.2)), game.body(entity).origin)), entity.vector("v_angle"), 4, 0.1, 0.1, null);
          game.effect("muzzleflash", game.body(entity).origin, entity.actor.id);
        }
        if (index === 6 && game.options.skill === 3 && !monster.refired && visible(game, entity, enemy)) {
          monster.refired = true; monster.frameIndex = 0; return game.schedule(entity, 0.1, game.named.action(entity, "monster_frame"));
        }
      } else {
        game.host.moveToGoal(entity.actor, enemy, distance);
        if (index === 3) {
          game.sound(entity, "dog/dattack1.wav");
          if (game.canDamage(enemy, entity.actor.id) && length(vsub(target.origin, game.body(entity).origin)) <= 100) game.damage(enemy, entity.actor.id, entity.actor.id, (game.host.random() + game.host.random() + game.host.random()) * 8);
        }
      }
    } else if (mode === "leap") {
      if (index < 2) face(game, entity, target.origin);
      if (index === 1) {
        const body = game.body(entity); entity.movement = "toss";
        game.setBody(entity, { origin: vadd(body.origin, { x: 0, y: 0, z: 1 }), velocity: vadd(vscale(game.makeVectors(body.angles).forward, 300), { x: 0, y: 0, z: 200 }), ground: null });
        entity.touch = game.named.touch(entity, "Dog_JumpTouch");
      }
    }
  }
  if (monster.mode === mode) {
    if (index + 1 < monster.sequence.length) monster.frameIndex++;
    else if (mode === "death") return undefined;
    else if (mode === "leap") monster.frameIndex = monster.sequence.length - 1;
    else if (mode === "attack" || mode === "pain") run(monster);
    else monster.frameIndex = 0;
  }
  return game.schedule(entity, 0.1, game.named.action(entity, "monster_frame"));
}
function gib(game: Q1EntityServices, entity: Q1Actor, monster: Q1Monster): undefined {
  const health = game.health(entity.actor.id); game.sound(entity, "player/udeath.wav");
  const velocity = (): Vec3 => vscale({ x: 100 * (game.host.random() * 2 - 1), y: 100 * (game.host.random() * 2 - 1), z: 200 + game.host.random() * 100 }, health > -50 ? 0.7 : 2);
  for (const model of monster.species === "army" ? ["gib1", "gib2", "gib3"] : ["gib3", "gib3", "gib3"]) {
    const piece = game.create("gib"); piece.model = `progs/${model}.mdl`; piece.movement = "bounce";
    game.setBody(piece, { origin: game.body(entity).origin, velocity: velocity() }); piece.angularVelocity = { x: game.host.random() * 600, y: game.host.random() * 600, z: game.host.random() * 600 };
    game.schedule(piece, 10 + game.host.random() * 10, game.named.action(piece, "SUB_Remove")); game.link(piece);
  }
  entity.model = monster.species === "army" ? "progs/h_guard.mdl" : "progs/h_dog.mdl"; entity.frame = 0; entity.movement = "bounce"; entity.solid = "none";
  game.setBody(entity, { velocity: velocity(), bounds: POINT, origin: vadd(game.body(entity).origin, { x: 0, y: 0, z: -24 }) });
  entity.angularVelocity = { x: 0, y: game.host.random() * 600, z: 0 }; return game.schedule(entity, 10 + game.host.random() * 10, game.named.action(entity, "SUB_Remove"));
}
export function spawnMonster(game: Q1EntityServices, entity: Q1Actor): undefined {
  const species = entity.classname === "monster_army" ? "army" : "dog";
  if (game.usesId1Precaches) {
    if (game.options.deathmatch !== 0) return game.remove(entity);
    if (species === "army") {
      game.precacheModel("progs/soldier.mdl");
      game.precacheModel("progs/h_guard.mdl");
      game.precacheModel("progs/gib1.mdl");
      game.precacheModel("progs/gib2.mdl");
      game.precacheModel("progs/gib3.mdl");
      game.precacheSound("soldier/death1.wav");
      game.precacheSound("soldier/idle.wav");
      game.precacheSound("soldier/pain1.wav");
      game.precacheSound("soldier/pain2.wav");
      game.precacheSound("soldier/sattck1.wav");
      game.precacheSound("soldier/sight1.wav");
      game.precacheSound("player/udeath.wav");
    } else {
      game.precacheModel("progs/h_dog.mdl");
      game.precacheModel("progs/dog.mdl");
      game.precacheSound("dog/dattack1.wav");
      game.precacheSound("dog/ddeath.wav");
      game.precacheSound("dog/dpain1.wav");
      game.precacheSound("dog/dsight.wav");
      game.precacheSound("dog/idle.wav");
    }
  }
  const monster: Q1Monster = { species, mode: "stand", frameIndex: 0, sequence: [], firstFrame: 0, enemy: null, oldEnemy: null, path: entity.target,
    pauseUntil: 0, attackFinished: 0, painFinished: 0, searchUntil: 0, deathDrop: false, refired: false };
  entity.monster = monster; stand(monster); entity.solid = "slidebox"; entity.movement = "step"; entity.aimedDamage = true;
  entity.pathEnd = game.named.action(entity, "monster_path_end");
  entity.model = species === "army" ? "progs/soldier.mdl" : "progs/dog.mdl"; entity.maxHealth = species === "army" ? 30 : 25;
  game.host.combat.setHealth(entity.actor, entity.maxHealth);
  game.setBounds(entity, { min: { x: species === "army" ? -16 : -32, y: species === "army" ? -16 : -32, z: -24 }, max: { x: species === "army" ? 16 : 32, y: species === "army" ? 16 : 32, z: 40 } });
  const mission = game.monsterMissions.get(entity.actor.id);
  if (mission === undefined) game.totalMonsters++; else mission.spawned();

  entity.use = game.named.use(entity, "monster_use");
  entity.pain = game.named.pain(entity, "monster_pain");
  entity.die = game.named.die(entity, "monster_die");
  return game.schedule(entity, 0.1 + game.host.random() * 0.5, game.named.action(entity, "walkmonster_start_go"));
}

function requireMonster(entity: Q1Actor): Q1Monster {
  const monster = entity.monster; if (monster === null) throw new Error(`Missing saved monster state: ${entity.classname}`); return monster;
}
function dogLeapTouch(game: Q1EntityServices, entity: Q1Actor, other: ActorId): undefined {
  const monster = requireMonster(entity);
          if (game.health(entity.actor.id) <= 0) return undefined;
          if (game.host.combat.read(other)?.canTakeDamage && length(game.body(entity).velocity) > 300) game.damage(other, entity.actor.id, entity.actor.id, 10 + 10 * game.host.random());
          const grounded = game.host.checkBottom(entity.actor.id);
          if (grounded) { entity.touch = null; entity.movement = "step"; run(monster); return game.schedule(entity, 0.1, game.named.action(entity, "monster_frame")); }
          return undefined;
}

function retaliate(game: Q1EntityServices, entity: Q1Actor, attacker: ActorId | null): undefined {
  const monster = requireMonster(entity), species = monster.species;
    if (attacker === null || sameActor(attacker, entity.actor.id) || game.entity(attacker)?.classname === entity.classname && species !== "army") return undefined;
    if (monster.enemy !== null && game.isPlayer(monster.enemy)) monster.oldEnemy = monster.enemy;
    if (monster.enemy === null || !sameActor(monster.enemy, attacker)) foundTarget(game, entity, monster, attacker); return undefined;
}
function monsterUse(game: Q1EntityServices, entity: Q1Actor, _other: ActorId | null, activator: ActorId | null): undefined {
  if (game.monsterMissions.get(entity.actor.id)?.use(activator) === true) return undefined;
  const monster = requireMonster(entity);
    if (monster.enemy !== null || game.health(entity.actor.id) <= 0 || !game.isPlayer(activator) || activator === null) return undefined;
    const observed = game.monsterTarget(activator);
    if (observed === null || observed.invisible || observed.notarget) return undefined;
    monster.enemy = activator; return game.schedule(entity, 0.1, game.named.action(entity, "monster_found_target"));
}
function monsterPain(game: Q1EntityServices, entity: Q1Actor, attacker: ActorId | null): undefined {
  const monster = requireMonster(entity), species = monster.species;
    retaliate(game, entity, attacker);
    if (species === "army") {
      if (monster.painFinished > game.time) return undefined;
      const random = game.host.random(); monster.painFinished = game.time + (random < 0.2 ? 0.6 : 1.1);
      if (random < 0.2) setSequence(monster, "pain", 40, [0, 0, 0, 0, 0, -1]);
      else if (random < 0.6) setSequence(monster, "pain", 46, [0, 13, 9, 0, 0, 0, 0, 0, 0, 0, 0, -2, 0, 0]);
      else setSequence(monster, "pain", 60, [0, -1, 0, 0, 1, 1, 0, -1, 4, 3, 6, 8, 0]);
      game.sound(entity, random < 0.2 ? "soldier/pain1.wav" : "soldier/pain2.wav");
      if (game.options.skill === 3) monster.painFinished = game.time + 5;
    } else {
      game.sound(entity, "dog/dpain1.wav");
      if (game.host.random() > 0.5) setSequence(monster, "pain", 26, stationary(6));
      else setSequence(monster, "pain", 32, [0, 0, -4, -12, -12, -2, 0, -4, 0, -10, 0, 0, 0, 0, 0, 0]);
    }
    return monsterFrame(game, entity, monster);
}
function monsterDie(game: Q1EntityServices, entity: Q1Actor, attacker: ActorId | null): undefined {
  const monster = requireMonster(entity), species = monster.species;
    entity.damageable = false; entity.touch = null;
    const mission = game.monsterMissions.get(entity.actor.id);
    if (mission === undefined) {
      game.killedMonsters++;
      game.host.emit({ kind: "monster-killed", actor: entity.actor.id, total: game.totalMonsters, found: game.killedMonsters });
      game.useTargets(entity, monster.enemy ?? attacker);
    } else mission.killed(monster.enemy ?? attacker);
    if (game.health(entity.actor.id) < -35) return gib(game, entity, monster);
    if (species === "dog") {
      entity.solid = "none"; game.sound(entity, "dog/ddeath.wav"); setSequence(monster, "death", game.host.random() > 0.5 ? 8 : 17, stationary(9));
    } else {
      game.sound(entity, "soldier/death1.wav");
      if (game.host.random() < 0.5) setSequence(monster, "death", 8, stationary(10)); else setSequence(monster, "death", 18, [0, -5, -4, -13, -3, -4, 0, 0, 0, 0, 0]);
    }
    game.link(entity); return monsterFrame(game, entity, monster);
}
function monsterStart(game: Q1EntityServices, entity: Q1Actor): undefined {
  const monster = requireMonster(entity);
    const body = game.body(entity), start = vadd(body.origin, { x: 0, y: 0, z: 1 });
    game.setBody(entity, { origin: start });
    const floor = game.host.trace({ start, end: vadd(start, { x: 0, y: 0, z: -256 }), bounds: body.bounds, ignore: entity.actor.id, monsters: true });
    if (floor.fraction < 1 && !floor.allSolid) {
      game.setBody(entity, { origin: floor.end, ground: floor.actor }); entity.movementFlags |= 512;
    }
    game.host.walkMove(entity.actor, 0, 0);
    entity.movementFlags |= 32;
    entity.idealYaw = body.angles.y; entity.yawSpeed = entity.number("yaw_speed") || 20;
    entity.damageable = true; game.link(entity);
    const mission = game.monsterMissions.get(entity.actor.id);
    if (mission === undefined ? monster.path !== "" && game.find(monster.path)[0]?.classname === "path_corner" : mission.route() !== null) walk(monster);
    mission?.started();
    return game.schedule(entity, 0.1 + game.host.random() * 0.5, game.named.action(entity, "monster_frame"));
}

export function registerMonsterCallbacks(game: Q1EntityServices): undefined {
  game.named.register("monster_frame", { action: (runtime, entity) => monsterFrame(runtime, entity, requireMonster(entity)) });
  game.named.register("monster_path_end", { action: (runtime, entity) => { const monster = requireMonster(entity); monster.pauseUntil = pathEndTime(runtime.time); stand(monster); entity.frame = monster.firstFrame; return undefined; } });
  game.named.register("monster_found_target", { action: (runtime, entity) => { const monster = requireMonster(entity); if (monster.enemy === null) return undefined; foundTarget(runtime, entity, monster, monster.enemy); return monsterFrame(runtime, entity, monster); } });
  game.named.register("monster_use", { use: monsterUse });
  game.named.register("monster_pain", { pain: monsterPain });
  game.named.register("monster_die", { die: monsterDie });
  game.named.register("Dog_JumpTouch", { touch: dogLeapTouch });
  game.named.register("walkmonster_start_go", { action: monsterStart });
  return undefined;
}
