/* Infantry callbacks from Q2 game/m_infantry.c and rerelease/m_infantry.cpp. GPL-2.0-or-later. */
import type { Vec3 } from "../../../../contracts/math.ts";
import type { DeathReaction, PainReaction } from "../../../../contracts/world.ts";
import { add, dot, normalize, scale, subtract } from "../fields.ts";
import { anglesVectors, clearShot, corpse, enemyBody, finishDodge, health, projectFlash, setDuck, targetDistance, walkMove } from "./ai.ts";
import { classic_infantryFrames, rerelease_infantryFrames } from "./frames.ts";
import { throwGib, throwHead } from "./gibs.ts";
import { muzzleIds, muzzleOffset } from "./muzzle.ts";
import type { MonsterContext } from "./types.ts";
import { recordAt } from "./types.ts";

function frames(context: MonsterContext) { return context.game.options.edition === "classic" ? classic_infantryFrames : rerelease_infantryFrames; }
function canRun(context: MonsterContext): boolean { return walkMove(context, context.game.body(context.entity).angles.y, 8, false); }
function jumping(context: MonsterContext): boolean { return context.state.move.name === "infantry_move_jump" || context.state.move.name === "infantry_move_jump2"; }
export function infantryStand(context: MonsterContext): undefined { return context.setMove("infantry_move_stand"); }
export function infantryWalk(context: MonsterContext): undefined { return context.setMove("infantry_move_walk"); }
export function infantryRun(context: MonsterContext): undefined {
  if (context.game.options.edition === "rerelease") finishDodge(context);
  return context.setMove(context.state.standGround ? "infantry_move_stand" : "infantry_move_run");
}

export function infantrySight(context: MonsterContext): undefined {
  const rerelease = context.game.options.edition === "rerelease";
  return context.game.sound(context.entity, !rerelease || context.game.host.random() < 0.5 ? "infantry/infsght1.wav" : "infantry/infsrch1.wav", rerelease ? 2 : 4);
}
export function infantryPain(context: MonsterContext, reaction: PainReaction): undefined {
  const { entity, state, game } = context;
  const rerelease = game.options.edition === "rerelease";
  if (health(game, entity.actor.id) < entity.maxHealth / 2) entity.skin = 1;
  else if (rerelease) entity.skin = 0;
  if (rerelease && jumping(context)) return undefined;
  if (rerelease) finishDodge(context);
  const dodge = (): undefined => { if (game.host.random() < 0.33 && reaction.attacker !== null) context.dodge(reaction.attacker, game.host.frameSeconds(), null); return undefined; };
  if (game.host.now() < state.painTime) { if (rerelease) dodge(); return undefined; }
  state.painTime = game.host.now() + 3;
  if (!rerelease && game.options.skill === 3) return undefined;
  const n = Math.floor(game.host.random() * 2);
  game.sound(entity, n === 0 ? "infantry/infpain1.wav" : "infantry/infpain2.wav", 2);
  const cause = entity.lastAttack?.cause;
  if (rerelease && (state.ducked || state.combatPoint || game.options.skill === 3 && !(cause?.kind === "q2" && cause.meansOfDeath === 41))) { dodge(); return undefined; }
  context.setMove(n === 0 ? "infantry_move_pain1" : "infantry_move_pain2");
  if (rerelease) setDuck(context, false);
  return undefined;
}

const deathAim: readonly Vec3[] = [
  { x: 0, y: 5, z: 0 }, { x: 10, y: 15, z: 0 }, { x: 20, y: 25, z: 0 }, { x: 25, y: 35, z: 0 },
  { x: 30, y: 40, z: 0 }, { x: 30, y: 45, z: 0 }, { x: 25, y: 50, z: 0 }, { x: 20, y: 40, z: 0 },
  { x: 15, y: 35, z: 0 }, { x: 40, y: 35, z: 0 }, { x: 70, y: 35, z: 0 }, { x: 90, y: 35, z: 0 },
];

function machineGun(context: MonsterContext): undefined {
  const { entity, game } = context;
  const rerelease = game.options.edition === "rerelease", table = frames(context);
  const enemy = enemyBody(context);
  if (rerelease && enemy === null) return undefined;
  const running = rerelease && entity.frame >= rerelease_infantryFrames.run201 && entity.frame <= rerelease_infantryFrames.run208;
  const normal = rerelease ? entity.frame === rerelease_infantryFrames.attak103 || entity.frame === rerelease_infantryFrames.attak311 || entity.frame === rerelease_infantryFrames.attak416 || running : entity.frame === classic_infantryFrames.attak111;
  // The rerelease expression MZ2_14 + (frame - MZ2_14) intentionally resolves to frame.
  const flash = normal ? running ? entity.frame : rerelease && entity.frame === rerelease_infantryFrames.attak416 ? muzzleIds.INFANTRY_MACHINEGUN_22 : 26 : 27 + entity.frame - table.death211;
  const start = projectFlash(context, muzzleOffset(game.options.edition, flash));
  let forward = anglesVectors(game.body(entity).angles).forward;
  if (normal && enemy !== null) {
    const observed = game.monsterTarget(entity.enemy); if (observed === null) return undefined;
    const height = observed.viewHeight;
    if (!rerelease) forward = normalize(subtract(add(add(enemy.origin, scale(enemy.velocity, -0.2)), { x: 0, y: 0, z: height }), start));
    else {
      const eye = add(enemy.origin, { x: 0, y: 0, z: height });
      const trace = game.host.trace({ start, end: eye, bounds: null, ignore: entity.actor.id, mask: 0x46004003 });
      const useEye = trace.hit.kind === "actor" && trace.hit.actor === entity.enemy;
      const target = useEye ? eye : enemy.origin;
      let predicted = add(enemy.origin, scale(enemy.velocity, 0.2));
      if (dot(normalize(subtract(target, start)), normalize(subtract(predicted, start))) < 0 || game.host.trace({ start, end: predicted, bounds: null, ignore: null, mask: 3 }).fraction < 0.9) predicted = enemy.origin;
      if (useEye) predicted = { ...predicted, z: predicted.z + height };
      forward = normalize(subtract(predicted, start));
    }
  } else if (!normal) forward = anglesVectors(subtract(game.body(entity).angles, recordAt(deathAim, flash - 27))).forward;
  context.weapons.fireBullet(entity, game, start, forward, 3, 4, 300, 500, 0);
  game.host.emit({ kind: "monster-muzzleflash", actor: entity.actor.id, flash, origin: start, direction: forward });
  return undefined;
}

export function infantryAttack(context: MonsterContext): undefined {
  if (context.game.options.edition === "classic") return context.setMove(targetDistance(context) < 80 ? "infantry_move_attack2" : "infantry_move_attack1");
  finishDodge(context);
  if (targetDistance(context) <= 20 && context.state.meleeTime <= context.game.host.now()) return context.setMove("infantry_move_attack2");
  if (clearShot(context, muzzleOffset("rerelease", 26))) {
    if (context.state.cocked) context.setMove("infantry_move_attack1");
    else { context.setMove(context.game.host.random() <= 0.1 ? "infantry_move_attack5" : "infantry_move_attack3"); context.state.nextFrame = rerelease_infantryFrames.attak405; }
  }
  return undefined;
}

export function infantryDie(context: MonsterContext, reaction: DeathReaction): undefined {
  const { entity, game, state } = context;
  const rerelease = game.options.edition === "rerelease";
  const cause = entity.lastAttack?.cause;
  if (health(game, entity.actor.id) <= state.gibHealth || rerelease && state.dead && cause?.kind === "q2" && cause.meansOfDeath === 20) {
    game.sound(entity, "misc/udeath.wav", 2);
    if (rerelease) {
      const head = state.move.name === "infantry_move_death3" ? "models/monsters/infantry/gibs/head.md2" : "models/objects/gibs/sm_meat/tris.md2";
      entity.skin = Math.trunc(entity.skin / 2);
      throwGib(entity, game, "models/objects/gibs/bone/tris.md2", reaction.damage);
      for (let i = 0; i < 3; i++) throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", reaction.damage);
      throwGib(entity, game, "models/monsters/infantry/gibs/chest.md2", reaction.damage, { skinned: true });
      throwGib(entity, game, "models/monsters/infantry/gibs/gun.md2", reaction.damage, { skinned: true, upright: true });
      for (let i = 0; i < 2; i++) throwGib(entity, game, "models/monsters/infantry/gibs/foot.md2", reaction.damage, { skinned: true });
      for (let i = 0; i < 2; i++) throwGib(entity, game, "models/monsters/infantry/gibs/arm.md2", reaction.damage, { skinned: true });
      throwGib(entity, game, head, reaction.damage, { skinned: true, head: true });
    } else {
      for (let i = 0; i < 2; i++) throwGib(entity, game, "models/objects/gibs/bone/tris.md2", reaction.damage);
      for (let i = 0; i < 4; i++) throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", reaction.damage);
      throwHead(entity, game, "models/objects/gibs/head2/tris.md2", reaction.damage);
    }
    state.dead = true; state.gibbed = true;
    return undefined;
  }
  if (state.dead) return undefined;
  state.dead = true;
  game.host.combat.setTraits(entity.actor, { canTakeDamage: true });
  const n = Math.floor(game.host.random() * 3);
  context.setMove(recordAt(["infantry_move_death1", "infantry_move_death2", "infantry_move_death3"], n));
  game.sound(entity, n === 1 ? "infantry/infdeth1.wav" : "infantry/infdeth2.wav", 2);
  if (rerelease && n !== 2 && game.host.random() <= 0.25) {
    const head = throwGib(entity, game, "models/monsters/infantry/gibs/head.md2", reaction.damage);
    if (head !== null) {
      const body = game.body(entity), inflictor = reaction.inflictor === null ? null : game.host.bodies.read(reaction.inflictor);
      const direction = scale(normalize(subtract(body.origin, inflictor?.origin ?? body.origin)), 100);
      head.angularVelocity = scale(head.angularVelocity, 0.15);
      game.move(head, { origin: { ...body.origin, z: body.origin.z + 32 }, angles: body.angles, velocity: { ...direction, z: 200 } });
      game.motion(head, "toss");
    }
  }
  return undefined;
}

export function infantryDuck(context: MonsterContext): boolean {
  if (jumping(context)) return false;
  if (context.entity.frame === rerelease_infantryFrames.attak103 || context.entity.frame === rerelease_infantryFrames.attak315 || context.state.move.name === "infantry_move_attack2") { setDuck(context, false); return false; }
  context.setMove("infantry_move_duck");
  return true;
}
export function infantrySidestep(context: MonsterContext): boolean {
  if (jumping(context)) return false;
  if (context.state.move.name === "infantry_move_run") return true;
  const frame = context.entity.frame;
  if (context.state.move.name !== "infantry_move_attack4" && context.state.nextMove?.name !== "infantry_move_attack4" && !context.state.cocked && (frame === rerelease_infantryFrames.attak103 || frame === rerelease_infantryFrames.attak311 || frame === rerelease_infantryFrames.attak416)) {
    context.state.fireWait += 0.3 + context.game.host.random() * 0.3;
    context.setMove("infantry_move_attack4", false);
  }
  return true;
}

function fire(context: MonsterContext): undefined {
  machineGun(context);
  const { state, game, entity } = context;
  if (game.options.edition === "classic") { state.holdFrame = game.host.now() < state.pauseTime; return undefined; }
  state.cocked = false;
  if (state.move.name === "infantry_move_attack4") {
    if (game.host.now() >= state.fireWait) { finishDodge(context); context.setMove("infantry_move_attack1", false); state.nextFrame = rerelease_infantryFrames.attak114; }
    else if (!canRun(context)) { context.setMove("infantry_move_attack1", false); state.nextFrame = rerelease_infantryFrames.attak103; finishDodge(context); state.attackState = "straight"; }
  } else {
    const f = rerelease_infantryFrames;
    if (entity.frame >= f.attak101 && entity.frame <= f.attak115 || entity.frame >= f.attak301 && entity.frame <= f.attak315 || entity.frame >= f.attak401 && entity.frame <= f.attak424) {
      state.holdFrame = game.host.now() < state.fireWait;
      if (!state.holdFrame && entity.frame === f.attak416) state.nextFrame = f.attak420;
    }
  }
  return undefined;
}

function jump(context: MonsterContext, high: boolean): undefined {
  const body = context.game.body(context.entity), basis = anglesVectors(body.angles);
  context.game.move(context.entity, { velocity: add(body.velocity, add(scale(basis.forward, high ? 150 : 100), scale(basis.up, high ? 400 : 300))), ground: null });
  context.game.motion(context.entity, "step");
  return undefined;
}

export const infantryCallbacks = {
  infantry_stand: infantryStand,
  infantry_run: infantryRun,
  InfantryMachineGun: machineGun,
  infantry_fire: fire,
  infantry_dead: corpse,
  infantry_cock_gun(context: MonsterContext): undefined {
    context.game.sound(context.entity, "infantry/infatck3.wav", 1);
    if (context.game.options.edition === "classic") context.state.pauseTime = context.game.host.now() + (Math.floor(context.game.host.random() * 16) + 10) * 0.1;
    else context.state.cocked = true;
    return undefined;
  },
  infantry_set_firetime(context: MonsterContext): undefined {
    context.state.fireWait = context.game.host.now() + 0.7 + context.game.host.random() * 1.3;
    if (!context.state.standGround && context.entity.enemy !== null && targetDistance(context) >= 330 && canRun(context)) context.setMove("infantry_move_attack4", false);
    return undefined;
  },
  infantry_swing(context: MonsterContext): undefined { return context.game.sound(context.entity, "infantry/infatck2.wav", 1); },
  infantry_smack(context: MonsterContext): undefined {
    if (context.weapons.fireHit(context.entity, context.game, { x: 80, y: 0, z: 0 }, 5 + Math.floor(context.game.host.random() * 5), 50)) context.game.sound(context.entity, "infantry/melee2.wav", 1);
    else if (context.game.options.edition === "rerelease") context.state.meleeTime = context.game.host.now() + 1.5;
    return undefined;
  },
  infantry_duck_down(context: MonsterContext): undefined { if (context.state.ducked) return undefined; setDuck(context, true); context.state.pauseTime = context.game.host.now() + 1; return undefined; },
  infantry_duck_hold(context: MonsterContext): undefined { context.state.holdFrame = context.game.host.now() < context.state.pauseTime; return undefined; },
  infantry_duck_up(context: MonsterContext): undefined { return setDuck(context, false); },
  infantry_shrink(context: MonsterContext): undefined { const body = context.game.body(context.entity); context.entity.serverFlags |= 2; return context.game.move(context.entity, { bounds: { ...body.bounds, max: { ...body.bounds.max, z: 0 } } }); },
  infantry_attack4_refire(context: MonsterContext): undefined {
    if (context.game.host.now() >= context.state.fireWait) { finishDodge(context); context.setMove("infantry_move_attack1", false); context.state.nextFrame = rerelease_infantryFrames.attak114; }
    else if (context.state.standGround || context.entity.enemy !== null && (targetDistance(context) < 330 || !canRun(context))) { context.setMove("infantry_move_attack1", false); context.state.nextFrame = rerelease_infantryFrames.attak103; finishDodge(context); context.state.attackState = "straight"; }
    else context.state.nextFrame = rerelease_infantryFrames.run201;
    return fire(context);
  },
  infantry_jump_now(context: MonsterContext): undefined { return jump(context, false); },
  infantry_jump2_now(context: MonsterContext): undefined { return jump(context, true); },
  infantry_jump_wait_land(context: MonsterContext): undefined {
    const { game, entity, state } = context, body = game.body(entity);
    if (body.ground !== null) { state.nextFrame = entity.frame + 1; return undefined; }
    state.nextFrame = entity.frame;
    const forward = anglesVectors(body.angles).forward;
    if (Math.hypot(body.velocity.x * forward.x, body.velocity.y * forward.y, body.velocity.z * forward.z) < 150) { game.move(entity, { velocity: { ...scale(forward, 150), z: body.velocity.z } }); game.motion(entity, "step"); }
    if (state.jumpTime < game.host.now()) state.nextFrame = entity.frame + 1;
    return undefined;
  },
};
