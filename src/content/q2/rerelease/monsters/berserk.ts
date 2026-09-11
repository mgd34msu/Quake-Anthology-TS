import type { Q2Monsters } from "../../foundation/monsters/index.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import type { Q2Touch } from "../../foundation/host.ts";
import { add, length, normalize, numberField, scale, subtract, zero } from "../../foundation/fields.ts";
import { anglesVectors, corpse, enemyBody, finishDodge, health, projectFlash, setDuck, targetDistance, vectorAngles } from "../../foundation/monsters/ai.ts";
import { throwGib } from "../../foundation/monsters/gibs.ts";
import { humanoidBounds, move, sound } from "../../base/monsters/common.ts";
import { blockedCheckJump, blockedCheckPlatform, checkGib, monsterJumpFinished, predictedDirection, reactsToPain } from "./common.ts";
import { berserkFrame, berserkMoves } from "./tables/berserk.ts";

function jumping(context: MonsterContext): boolean {
  return ["berserk_move_jump", "berserk_move_jump2", "berserk_move_attack_strike"].includes(context.state.move.name);
}
function run(context: MonsterContext): undefined {
  finishDodge(context);
  return context.setMove(context.state.standGround ? "berserk_move_stand" : "berserk_move_run1");
}
function melee(context: MonsterContext): undefined {
  const { state, game, entity } = context;
  if (state.meleeTime > game.host.now()) return undefined;
  if (state.move.name === "berserk_move_run_attack1" && entity.frame >= berserkFrame.r_att13) {
    state.attackState = "straight"; state.attackFinished = 0; return undefined;
  }
  finishDodge(context);
  return context.setMove(game.host.random() < 0.5 ? "berserk_move_attack_spike" : "berserk_move_attack_club");
}

export function slamRadiusDamage(context: MonsterContext, origin: { readonly x: number; readonly y: number; readonly z: number }, damage: number, kick: number, radius: number): undefined {
  const { game, entity } = context;
  let point = origin;
  for (const actor of game.host.nearby(game.body(entity).origin, radius * 2)) {
    if (actor.equals(entity.actor.id) || game.host.combat.read(actor)?.canTakeDamage !== true || !game.canDamage(actor, entity)) continue;
    const target = game.host.bodies.read(actor);
    if (target === null || game.host.isPlayer(actor) && target.ground === null) continue;
    const min = add(target.origin, target.bounds.min), max = add(target.origin, target.bounds.max);
    const closest = { x: Math.max(min.x, Math.min(max.x, point.x)), y: Math.max(min.y, Math.min(max.y, point.y)), z: Math.max(min.z, Math.min(max.z, point.z)) };
    const amount = Math.min(1, 1 - length(subtract(closest, point)) / radius);
    if (amount <= 0) continue;
    const direction = normalize(subtract(target.origin, point));
    point = { ...point, z: min.z };
    game.damage(actor, entity, entity.actor.id, Math.trunc(Math.max(1, damage * amount * amount)), Math.trunc(kick * amount * amount), direction, point, direction, 0, 1);
    const owned = game.host.actors.resolveOwned(actor);
    const after = game.host.bodies.read(actor);
    if (game.host.isPlayer(actor) && owned !== null && after !== null) game.host.bodies.write(owned, { ...after, velocity: { ...after.velocity, z: Math.max(270, after.velocity.z) } });
  }
  return undefined;
}

function slam(context: MonsterContext): undefined {
  const { entity, game } = context;
  game.sound(entity, "mutant/thud1.wav", 1);
  game.sound(entity, "world/explod2.wav", 0, 0.75);
  const start = projectFlash(context, { x: 20, y: -14.3, z: -21 });
  const trace = game.host.trace({ start: game.body(entity).origin, end: start, bounds: null, ignore: entity.actor.id, mask: 3 });
  game.host.emit({ kind: "effect", effect: "q2:berserk-slam", origin: trace.end, direction: { x: 0, y: 0, z: 1 }, count: 1, color: 0 });
  entity.gravity = 1;
  entity.flags |= 1 << 23;
  game.move(entity, { velocity: zero });
  game.motion(entity, entity.motion);
  return slamRadiusDamage(context, trace.end, 8, 300, 165);
}
function highGravity(context: MonsterContext): undefined {
  const world = context.game.entity(context.game.host.worldActor());
  const gravity = world === null ? 800 : numberField(world.spawn, "gravity", 800);
  context.entity.gravity = (context.game.body(context.entity).velocity.z < 0 ? 2.25 : 5.25) * (800 / gravity);
  return context.game.motion(context.entity, context.entity.motion);
}

export function createRereleaseBerserkDefinition(monsters: Q2Monsters): Q2MonsterDefinition {
  const touch: Q2Touch = (entity, game) => {
    const context = monsters.context(entity.actor.id);
    if (context === null) return undefined;
    if (health(game, entity.actor.id) <= 0) { entity.touch = null; return undefined; }
    if (game.body(entity).ground !== null) { entity.frame = berserkFrame.slam18; if (entity.touch !== null) slam(context); entity.touch = null; }
    return undefined;
  };
  return {
    classname: "monster_berserk", kind: "berserk", model: "models/monsters/berserk/tris.md2", health: 240, gibHealth: -60, mass: 250,
    bounds: humanoidBounds, scale: 1, initialMove: "berserk_move_stand", moves: berserkMoves,
    stand: move("berserk_move_stand"), walk: move("berserk_move_walk"), run, melee,
    sight: sound("berserk/sight.wav"), search: sound("berserk/bersrch1.wav"),
    sourceCallbacks: { touch: { berserk_jump_touch: touch } },
    attack(context) {
      const { game, entity, state } = context, distance = targetDistance(context);
      if (state.meleeTime <= game.host.now() && distance < 80) return melee(context);
      if ((entity.spawnflags & 8) === 0 && entity.timestamp < game.host.now() && game.host.random() < 0.5 && distance > 150) {
        context.setMove("berserk_move_attack_strike"); entity.timestamp = game.host.now() + 5;
        return game.sound(entity, "berserk/jump.wav", 1);
      }
      if (state.move.name === "berserk_move_run1" && distance <= 500) {
        context.setMove("berserk_move_run_attack1"); state.nextFrame = berserkFrame.r_att1 + entity.frame - berserkFrame.run1 + 1;
      }
      return undefined;
    },
    pain(context, reaction) {
      if (jumping(context) || context.game.host.now() < context.state.painTime) return undefined;
      context.state.painTime = context.game.host.now() + 3;
      context.game.sound(context.entity, "berserk/berpain2.wav", 2);
      if (!reactsToPain(context)) return undefined;
      finishDodge(context);
      return context.setMove(reaction.damage <= 50 || context.game.host.random() < 0.5 ? "berserk_move_pain1" : "berserk_move_pain2");
    },
    die(context, reaction) {
      const { game, entity, state } = context;
      if (checkGib(context)) {
        game.sound(entity, "misc/udeath.wav", 2); entity.skin = 0;
        for (let i = 0; i < 2; i++) throwGib(entity, game, "models/objects/gibs/bone/tris.md2", reaction.damage);
        for (let i = 0; i < 3; i++) throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", reaction.damage);
        throwGib(entity, game, "models/objects/gibs/gear/tris.md2", reaction.damage);
        for (const part of ["chest", "hammer", "thigh", "head"]) throwGib(entity, game, `models/monsters/berserk/gibs/${part}.md2`, reaction.damage, { skinned: true, upright: part === "hammer", head: part === "head" });
        state.dead = true; state.gibbed = true; return undefined;
      }
      if (state.dead) return undefined;
      game.sound(entity, "berserk/berdeth2.wav", 2); state.dead = true; state.canTakeDamage = true;
      game.host.combat.setTraits(entity.actor, { canTakeDamage: true });
      return context.setMove(reaction.damage >= 50 ? "berserk_move_death1" : "berserk_move_death2");
    },
    duck(context) { if (context.game.host.random() >= 0.05 || ["berserk_move_jump", "berserk_move_jump2"].includes(context.state.move.name)) return false; context.setMove("berserk_move_duck2"); return true; },
    sidestep(context) { if (jumping(context) || context.state.move.name === "berserk_move_pain2") return false; if (context.state.move.name !== "berserk_move_run1") context.setMove("berserk_move_run1"); return true; },
    blocked(context, distance) {
      const jump = blockedCheckJump(context, distance, 256, 40, (context.entity.spawnflags & 8) === 0);
      if (jump !== "none") { if (jump !== "turn") context.setMove(jump === "up" ? "berserk_move_jump2" : "berserk_move_jump"); return true; }
      return blockedCheckPlatform(context, distance);
    },
    callbacks: {
      berserk_stand: move("berserk_move_stand"), berserk_run: run, berserk_dead: corpse,
      berserk_fidget(context) {
        if (context.state.standGround || context.entity.enemy !== null || context.game.host.random() > 0.15) return undefined;
        context.setMove("berserk_move_stand_fidget"); return context.game.sound(context.entity, "berserk/beridle1.wav", 1, 1, 2);
      },
      berserk_swing: sound("berserk/attack.wav", 1),
      berserk_attack_spike(context) { if (!context.weapons.fireHit(context.entity, context.game, { x: 80, y: 0, z: -24 }, 5 + Math.floor(context.game.host.random() * 6), 80)) context.state.meleeTime = context.game.host.now() + 1.2; return undefined; },
      berserk_attack_club(context) { if (!context.weapons.fireHit(context.entity, context.game, { x: 80, y: context.game.body(context.entity).bounds.min.x, z: -4 }, 15 + Math.floor(context.game.host.random() * 6), 400)) context.state.meleeTime = context.game.host.now() + 2.5; return undefined; },
      berserk_run_attack_speed(context) { if (context.entity.enemy !== null && targetDistance(context) < 80) { context.state.nextFrame = context.entity.frame + 6; finishDodge(context); } return undefined; },
      berserk_run_swing(context) { context.game.sound(context.entity, "berserk/attack.wav", 1); context.state.meleeTime = context.game.host.now() + 0.6; if (context.state.attackState === "sliding") finishDodge(context); return undefined; },
      berserk_high_gravity: highGravity,
      berserk_jump_takeoff(context) {
        const enemy = enemyBody(context); if (enemy === null) return undefined;
        const body = context.game.body(context.entity), speed = length(subtract(body.origin, enemy.origin)) * 1.95;
        const direction = predictedDirection(context, body.origin, speed, false); if (direction === null) return undefined;
        const angles = { ...body.angles, y: vectorAngles(direction).y }, forward = anglesVectors(angles).forward;
        context.game.move(context.entity, { origin: { ...body.origin, z: body.origin.z + 1 }, velocity: { ...scale(forward, speed), z: 450 }, angles, ground: null });
        context.state.ducked = true; context.state.attackFinished = context.game.host.now() + 3; context.entity.touch = touch;
        return highGravity(context);
      },
      berserk_check_landing(context) {
        highGravity(context);
        if (context.game.body(context.entity).ground !== null) {
          context.state.attackFinished = 0; setDuck(context, false); context.entity.frame = berserkFrame.slam18;
          if (context.entity.touch !== null) { slam(context); context.entity.touch = null; }
          context.entity.flags &= ~(1 << 23); return undefined;
        }
        context.state.nextFrame = context.game.host.now() > context.state.attackFinished ? berserkFrame.slam3 : berserkFrame.slam5;
        return undefined;
      },
      berserk_shrink(context) { context.entity.serverFlags |= 2; const body = context.game.body(context.entity); return context.game.move(context.entity, { bounds: { ...body.bounds, max: { ...body.bounds.max, z: 0 } } }); },
      berserk_jump_now(context) { const body = context.game.body(context.entity), axis = anglesVectors(body.angles); return context.game.move(context.entity, { velocity: add(body.velocity, add(scale(axis.forward, 100), scale(axis.up, 300))) }); },
      berserk_jump2_now(context) { const body = context.game.body(context.entity), axis = anglesVectors(body.angles); return context.game.move(context.entity, { velocity: add(body.velocity, add(scale(axis.forward, 150), scale(axis.up, 400))) }); },
      berserk_jump_wait_land(context) { context.state.nextFrame = context.entity.frame + (context.game.body(context.entity).ground !== null || monsterJumpFinished(context) ? 1 : 0); return undefined; },
    },
  };
}
