/* Quake II rogue/m_stalker.c. ZeniMax Media, GPL-2.0-or-later. */
import type { Vec3 } from "../../../../contracts/math.ts";
import type { TraceResult } from "../../../../contracts/scene.ts";
import { add, length, normalize, scale, subtract } from "../../foundation/fields.ts";
import { anglesVectors, attackTraceMask, changeYaw, enemyBody, finishDodge, health, monsterSolidMask, projectFlash, vectorAngles, visible } from "../../foundation/monsters/ai.ts";
import type { Q2Monsters } from "../../foundation/monsters/index.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { aliveEnemy, beginDeath, damagedSkin, finishCorpse, move, sound } from "../../base/monsters/common.ts";
import { blockedCheckJump, blockedCheckPlatform, monsterFlash, monsterJumpFinished } from "../../rerelease/monsters/common.ts";
import { stalkerFrame, stalkerMoves } from "./tables/rogue-stalker.ts";
import type { Q2MissionPackMonsterState } from "./state.ts";
import type { Q2MissionPackMonsterWeapons } from "./types.ts";
import { rogueBlockedCheckShot } from "./rogue-common.ts";

function ceiling(context: MonsterContext): boolean { return context.entity.gravityVector.z > 0; }
function solid(trace: TraceResult): boolean { return trace.kind !== "q1" && (trace.contents & 1) !== 0; }
function world(trace: TraceResult, context: MonsterContext): boolean {
  return trace.hit.kind === "none" || trace.hit.kind === "world" || trace.hit.actor.equals(context.game.host.worldActor());
}

export function stalkerTransitionOK(context: MonsterContext, spawnedByWidow: boolean): boolean {
  const { entity, game } = context, body = game.body(entity), onCeiling = ceiling(context);
  const margin = onCeiling ? body.bounds.min.z - 8 : body.bounds.max.z + 8;
  const end = { ...body.origin, z: body.origin.z + (onCeiling ? -384 : spawnedByWidow ? 256 : 180) };
  const trace = game.host.trace({ start: body.origin, end, bounds: body.bounds, ignore: entity.actor.id, mask: monsterSolidMask(game) });
  if (trace.fraction === 1 || !solid(trace) || !world(trace, context)) {
    const normalZ = trace.contact.kind === "plane" ? trace.contact.plane.normal.z : 0;
    if (onCeiling ? normalZ < 0.9 : normalZ > -0.9) return false;
  }
  const endHeight = trace.end.z + margin;
  const corners = [
    { x: body.bounds.min.x, y: body.bounds.min.y }, { x: body.bounds.max.x, y: body.bounds.min.y },
    { x: body.bounds.max.x, y: body.bounds.max.y }, { x: body.bounds.min.x, y: body.bounds.max.y },
  ];
  for (const corner of corners) {
    const start = { x: body.origin.x + corner.x - (corner.x < 0 ? 1 : -1), y: body.origin.y + corner.y - (corner.y < 0 ? 1 : -1), z: body.origin.z };
    const cornerTrace = game.host.trace({ start, end: { ...start, z: endHeight }, bounds: null, ignore: entity.actor.id, mask: monsterSolidMask(game) });
    if (cornerTrace.fraction === 1 || !solid(cornerTrace) || !world(cornerTrace, context) || Math.abs(Math.trunc(endHeight - cornerTrace.end.z)) > 8) return false;
  }
  return true;
}

/** The original solver deliberately uses FAUX_GRAVITY rather than sv_gravity. */
export function stalkerJumpAngles(start: Vec3, end: Vec3, velocity: number): readonly [number, number] {
  const delta = subtract(end, start), horizontal = Math.hypot(delta.x, delta.y), vertical = Math.abs(delta.z), distance = Math.hypot(horizontal, vertical);
  const angle = vertical === 0 ? 0 : Math.atan(vertical / horizontal) * (delta.z > 0 ? -1 : 1);
  const first = Math.asin(distance * 800 * Math.cos(angle) ** 2 / velocity ** 2 - Math.sin(angle));
  return [(first - angle) / 2, (Math.PI - first - angle) / 2];
}

export function createStalkerDefinition(monsters: Q2Monsters, weapons: Q2MissionPackMonsterWeapons, source: Q2MissionPackMonsterState, gravity: () => number): Q2MonsterDefinition {
  const transition = (context: MonsterContext): boolean => stalkerTransitionOK(context, context.state.spawnedBy === "widow");
  const stand = (context: MonsterContext): undefined => context.setMove(context.game.host.random() < 0.25 ? "stalker_move_stand" : "stalker_move_idle2");
  const run = (context: MonsterContext): undefined => context.setMove(context.state.standGround ? "stalker_move_stand" : "stalker_move_run");
  function detach(context: MonsterContext): undefined {
    const { entity, game } = context, body = game.body(entity), roll = body.angles.z + 180;
    entity.gravityVector = { ...entity.gravityVector, z: -1 };
    return game.move(entity, { angles: { ...body.angles, z: roll > 360 ? roll - 360 : roll }, ground: null });
  }
  function jumpStraightUp(context: MonsterContext): undefined {
    const { entity, game, state } = context, body = game.body(entity);
    if (state.dead) return undefined;
    if (ceiling(context)) { if (transition(context)) detach(context); return undefined; }
    if (body.ground === null) return undefined;
    game.move(entity, { velocity: { x: body.velocity.x + game.host.random() * 10 - 5, y: body.velocity.y + game.host.random() * 10 - 5, z: body.velocity.z - 400 * entity.gravityVector.z } });
    if (transition(context)) {
      entity.gravityVector = { ...entity.gravityVector, z: 1 };
      game.move(entity, { angles: { ...body.angles, z: 180 }, ground: null });
    }
    return undefined;
  }
  function pounce(context: MonsterContext, destination: Vec3): boolean {
    const { entity, game } = context, enemy = enemyBody(context), body = game.body(entity);
    if (ceiling(context) || enemy === null || entity.enemy === null || enemy.ground === null || (game.host.pointContents(destination) & 56) !== 0) return false;
    const enemyState = monsters.context(entity.enemy)?.state;
    if (enemyState !== undefined ? enemyState.waterLevel > 0 : (game.host.pointContents({ ...enemy.origin, z: enemy.origin.z + enemy.bounds.min.z + 1 }) & 56) !== 0) return false;
    // Original Rogue queries the target's local bounds, without adding its origin.
    for (const corner of [{ x: enemy.bounds.min.x, y: enemy.bounds.min.y }, { x: enemy.bounds.max.x, y: enemy.bounds.min.y }, { x: enemy.bounds.max.x, y: enemy.bounds.max.y }, { x: enemy.bounds.min.x, y: enemy.bounds.max.y }]) {
      if ((game.host.pointContents({ ...corner, z: enemy.bounds.min.z - 0.25 }) & 3) === 0) return false;
    }
    const delta = subtract(destination, body.origin), angles = vectorAngles(delta);
    if (Math.abs(Math.trunc(angles.y - body.angles.y)) > 45) return false;
    context.state.idealYaw = angles.y; changeYaw(context);
    if (length(delta) > 450) return false;
    let high = delta.z >= 32;
    const target = { ...destination, z: destination.z + (high ? 32 : 0) };
    const trace = game.host.trace({ start: body.origin, end: destination, bounds: null, ignore: entity.actor.id, mask: monsterSolidMask(game) });
    if (trace.fraction < 1 && (trace.hit.kind !== "actor" || !trace.hit.actor.equals(entity.enemy))) high = true;
    let velocity = 400.1, jump: readonly [number, number] = [NaN, NaN];
    while (velocity <= 800) {
      jump = stalkerJumpAngles(body.origin, target, velocity);
      if (!Number.isNaN(jump[0]) || !Number.isNaN(jump[1])) break;
      velocity += 200;
    }
    const chosen = !high && !Number.isNaN(jump[0]) ? jump[0] : jump[1];
    if (Number.isNaN(chosen)) return false;
    const forward = normalize(anglesVectors(game.body(entity).angles).forward);
    game.move(entity, { velocity: { ...scale(forward, velocity * Math.cos(chosen)), z: velocity * Math.sin(chosen) + 0.5 * gravity() * 0.1 } });
    return true;
  }
  function shoot(context: MonsterContext): undefined {
    if (!aliveEnemy(context)) return undefined;
    const { entity, game } = context, enemy = enemyBody(context);
    if (enemy === null || entity.enemy === null) return undefined;
    if (game.body(entity).ground !== null && game.host.random() < 0.33) {
      if (length(subtract(enemy.origin, game.body(entity).origin)) > 256 || game.host.random() < 0.5) pounce(context, enemy.origin);
      else jumpStraightUp(context);
    }
    const start = projectFlash(context, { x: 24, y: 0, z: 6 });
    let direction = subtract(enemy.origin, start), end = enemy.origin;
    if (game.host.random() < 0.2 + 0.1 * game.options.skill) { end = add(enemy.origin, scale(enemy.velocity, length(direction) / 1000)); direction = subtract(end, start); }
    const trace = game.host.trace({ start, end, bounds: null, ignore: entity.actor.id, mask: attackTraceMask(game) });
    if (world(trace, context) || trace.hit.kind === "actor" && trace.hit.actor.equals(entity.enemy)) {
      weapons.fireBlaster2(entity, game, start, direction, 15, 800, 8); monsterFlash(context, 144, start, direction);
    }
    return undefined;
  }
  function reactivate(context: MonsterContext): undefined { context.state.standGround = false; return context.setMove("stalker_move_false_death_end"); }
  function jumpImpulse(context: MonsterContext, forwardSpeed: number, upSpeed: number): undefined {
    const { entity, game } = context, body = game.body(entity), axes = anglesVectors(body.angles);
    entity.timestamp = game.host.now();
    return game.move(entity, { velocity: add(add(body.velocity, scale(axes.forward, forwardSpeed)), scale(axes.up, upSpeed)) });
  }
  return {
    classname: "monster_stalker", kind: "stalker", model: "models/monsters/stalker/tris.md2", health: 250, gibHealth: -50, mass: 250,
    bounds: { min: { x: -28, y: -28, z: -18 }, max: { x: 28, y: 28, z: 18 } }, scale: 1,
    moves: stalkerMoves, initialMove: "stalker_move_stand", stand, walk: move("stalker_move_walk"), run,
    initialize(context) {
      if ((context.entity.spawnflags & 8) !== 0) {
        context.entity.gravityVector = { ...context.entity.gravityVector, z: 1 };
        context.game.move(context.entity, { angles: { ...context.game.body(context.entity).angles, z: 180 } });
      }
      return undefined;
    },
    idle(context) { return context.setMove(context.game.host.random() < 0.35 ? "stalker_move_idle" : "stalker_move_idle2"); },
    sight: sound("stalker/sight.wav", 1),
    attack(context) {
      if (!aliveEnemy(context)) return undefined;
      if (context.game.host.random() > 1 - 0.5 / context.game.options.skill) context.state.attackState = "straight";
      else { if (context.game.host.random() <= 0.5) context.state.lefty = !context.state.lefty; context.state.attackState = "sliding"; }
      return context.setMove("stalker_move_shoot");
    },
    melee(context) { return aliveEnemy(context) ? context.setMove(context.game.host.random() < 0.5 ? "stalker_move_swing_l" : "stalker_move_swing_r") : undefined; },
    pain(context, reaction) {
      const { entity, game, state } = context;
      if (state.dead) return undefined;
      damagedSkin(context);
      if (game.options.skill === 3 || game.body(entity).ground === null || state.move.name === "stalker_move_false_death_end" || state.move.name === "stalker_move_false_death_start") return undefined;
      if (state.move.name === "stalker_move_false_death") return reactivate(context);
      const hp = health(game, entity.actor.id);
      if (hp > 0 && hp < entity.maxHealth / 4 && game.host.random() < 0.2 * game.options.skill && (!ceiling(context) || transition(context))) {
        entity.gravityVector = { x: 0, y: 0, z: -1 }; game.move(entity, { angles: { ...game.body(entity).angles, z: 0 } }); state.standGround = true;
        return context.setMove("stalker_move_false_death_start");
      }
      if (game.host.now() < state.painTime) return undefined;
      state.painTime = game.host.now() + 3;
      if (reaction.damage > 10) {
        context.setMove(game.body(entity).ground !== null && game.host.random() < 0.5 ? "stalker_move_jump_straightup" : "stalker_move_pain");
        game.sound(entity, "stalker/pain.wav", 1);
      }
      return undefined;
    },
    die(context, reaction) {
      context.game.motion(context.entity, "toss");
      context.game.move(context.entity, { angles: { ...context.game.body(context.entity).angles, z: 0 } });
      context.entity.gravityVector = { x: 0, y: 0, z: -1 };
      return beginDeath(context, reaction, "stalker/death.wav", "stalker_move_death");
    },
    dodge(context, attacker, eta) {
      if (context.game.body(context.entity).ground === null || health(context.game, context.entity.actor.id) <= 0) return undefined;
      if (context.entity.enemy === null) { context.entity.enemy = attacker; return monsters.foundTarget(context); }
      return eta < 0.1 || eta > 5 ? undefined : context.setMove("stalker_move_jump_straightup");
    },
    blocked(context, distance) {
      const enemy = enemyBody(context);
      if (!aliveEnemy(context) || enemy === null) return false;
      if (rogueBlockedCheckShot(context, 0.25 + 0.05 * context.game.options.skill, source)) return true;
      if (ceiling(context)) { if (!transition(context)) return false; detach(context); return true; }
      if (visible(context)) { pounce(context, enemy.origin); return true; }
      if (blockedCheckJump(context, distance, 256, 68) !== "none") {
        context.setMove(enemy.origin.z >= context.game.body(context.entity).origin.z ? "stalker_move_jump_up" : "stalker_move_jump_down"); return true;
      }
      return blockedCheckPlatform(context, distance);
    },
    callbacks: {
      stalker_stand: stand, stalker_walk: move("stalker_move_walk"), stalker_run: run,
      stalker_idle_noise(context) { return context.game.sound(context.entity, "stalker/idle.wav", 1, 0.5, 2); },
      stalker_false_death: move("stalker_move_false_death"),
      stalker_heal(context) {
        const hp = health(context.game, context.entity.actor.id) + (context.game.options.skill === 2 ? 2 : context.game.options.skill === 3 ? 3 : 1);
        if (hp > context.entity.maxHealth / 2) context.entity.skin = 0;
        context.game.host.combat.setHealth(context.entity.actor, Math.min(hp, context.entity.maxHealth));
        return hp >= context.entity.maxHealth ? reactivate(context) : undefined;
      },
      stalker_shoot_attack: shoot,
      stalker_shoot_attack2(context) { return context.game.host.random() < 0.4 + 0.1 * context.game.options.skill ? shoot(context) : undefined; },
      stalker_swing_attack(context) {
        if (context.weapons.fireHit(context.entity, context.game, { x: 80, y: 0, z: 0 }, 5 + Math.floor(context.game.host.random() * 5), 50)) {
          context.game.sound(context.entity, context.entity.frame < stalkerFrame.attack08 ? "stalker/melee2.wav" : "stalker/melee1.wav", 1);
        }
        return undefined;
      },
      stalker_jump_straightup: jumpStraightUp,
      stalker_jump_wait_land(context) {
        const { game, entity, state } = context;
        if (game.host.random() < 0.3 + 0.1 * game.options.skill && game.host.now() >= state.attackFinished) { state.attackFinished = game.host.now() + 0.3; shoot(context); }
        if (game.body(entity).ground === null) {
          entity.gravity = 1.3; state.nextFrame = entity.frame;
          if (monsterJumpFinished(context)) { entity.gravity = 1; state.nextFrame = entity.frame + 1; }
        } else { entity.gravity = 1; state.nextFrame = entity.frame + 1; }
        return undefined;
      },
      stalker_jump_up(context) { return jumpImpulse(context, 200, 450); }, stalker_jump_down(context) { return jumpImpulse(context, 100, 300); },
      monster_done_dodge: finishDodge,
      stalker_dead(context) { return finishCorpse(context, { min: { x: -28, y: -28, z: -18 }, max: { x: 28, y: 28, z: -4 } }); },
    },
  };
}
