/* Soldier callbacks from id Software game/m_soldier.c and rerelease/m_soldier.cpp. GPL-2.0-or-later. */
import type { DeathReaction, PainReaction } from "../../../../contracts/world.ts";
import { add, dot, length, normalize, scale, subtract } from "../fields.ts";
import { anglesVectors, clearShot, corpse, enemyBody, enemyEye, finishDodge, health, proneShot, projectFlash, setDuck, targetDistance, vectorAngles, visible } from "./ai.ts";
import { classic_soldierFrames, rerelease_soldierFrames } from "./frames.ts";
import { throwGib, throwHead } from "./gibs.ts";
import { muzzleIds, muzzleOffset } from "./muzzle.ts";
import type { MonsterContext } from "./types.ts";
import { recordAt } from "./types.ts";

function frames(context: MonsterContext) { return context.game.options.edition === "classic" ? classic_soldierFrames : rerelease_soldierFrames; }
function aliveEnemy(context: MonsterContext): boolean { return enemyBody(context) !== null && health(context.game, context.entity.enemy) > 0; }
function needsCock(context: MonsterContext): boolean { return context.state.weapon === "shotgun" && !context.state.cocked; }
function meleeRange(context: MonsterContext): boolean { return targetDistance(context) <= (context.game.options.edition === "classic" ? 80 : 20); }
function refire(context: MonsterContext, force = false): boolean {
  return context.game.options.edition === "classic"
    ? context.game.options.skill === 3 && context.game.host.random() < 0.5 || meleeRange(context)
    : (force || context.game.host.random() < 0.5) && visible(context) || meleeRange(context);
}

export function soldierStand(context: MonsterContext): undefined {
  const { state, game, entity } = context;
  if (game.options.edition === "rerelease") {
    if ((entity.spawnflags & 8) !== 0) return context.setMove("soldier_move_blind");
    const r = game.host.random();
    return context.setMove(state.move.name !== "soldier_move_stand1" || r < 0.6 ? "soldier_move_stand1" : r < 0.8 ? "soldier_move_stand2" : "soldier_move_stand3");
  }
  return context.setMove(state.move.name === "soldier_move_stand3" || game.host.random() < 0.8 ? "soldier_move_stand1" : "soldier_move_stand3");
}
export function soldierWalk(context: MonsterContext): undefined { return context.setMove(context.game.host.random() < 0.5 ? "soldier_move_walk1" : "soldier_move_walk2"); }
export function soldierRun(context: MonsterContext): undefined {
  if (context.game.options.edition === "rerelease") finishDodge(context);
  if (context.state.standGround) return context.setMove("soldier_move_stand1");
  const move = context.state.move.name;
  return context.setMove(move === "soldier_move_walk1" || move === "soldier_move_walk2" || move === "soldier_move_start_run" || context.game.options.edition === "rerelease" && move === "soldier_move_run" ? "soldier_move_run" : "soldier_move_start_run");
}

export function soldierAttack(context: MonsterContext): undefined {
  const { game, state } = context;
  if (game.options.edition === "classic") return context.setMove(state.weapon === "machinegun" ? "soldier_move_attack4" : game.host.random() < 0.5 ? "soldier_move_attack1" : "soldier_move_attack2");
  finishDodge(context);
  if (state.attackState === "blind") {
    const chance = state.blindFireDelay < 1 ? 1 : state.blindFireDelay < 7.5 ? 0.4 : 0.1;
    const r = game.host.random();
    state.blindFireDelay += 4.1 + game.host.random() * 3;
    if (length(state.blindFireTarget) === 0 || r > chance) return undefined;
    state.manualSteering = true;
    context.setMove("soldier_move_attack1");
    state.attackFinished = game.host.now() + 1.5 + game.host.random();
    return undefined;
  }
  const r = game.host.random();
  if (!state.standGround && r < 0.25 && state.weapon !== "machinegun" && targetDistance(context) >= 220) return context.setMove("soldier_move_attack6");
  if (state.weapon !== "machinegun") {
    const first = !(state.weapon === "shotgun" && targetDistance(context) <= 286) && clearShot(context, muzzleOffset("rerelease", muzzleIds.SOLDIER_BLASTER_1));
    const second = clearShot(context, muzzleOffset("rerelease", muzzleIds.SOLDIER_BLASTER_2));
    if (first && (!second || game.host.random() < 0.5)) return context.setMove("soldier_move_attack1");
    if (second) return context.setMove("soldier_move_attack2");
  } else if (clearShot(context, muzzleOffset("rerelease", muzzleIds.SOLDIER_MACHINEGUN_4))) return context.setMove("soldier_move_attack4");
  return undefined;
}

export function soldierSight(context: MonsterContext): undefined {
  const { game, state } = context;
  game.sound(context.entity, game.host.random() < 0.5 ? "soldier/solsght1.wav" : "soldier/solsrch1.wav", 2);
  if (game.options.edition === "classic") {
    if (game.options.skill > 0 && targetDistance(context) >= 500 && game.host.random() > 0.5) context.setMove("soldier_move_attack6");
  } else if (visible(context) && targetDistance(context) >= 440 && game.host.random() > 0.75) {
    if (state.weapon !== "machinegun") context.setMove("soldier_move_attack6");
    else if (clearShot(context, muzzleOffset("rerelease", muzzleIds.SOLDIER_MACHINEGUN_4))) context.setMove("soldier_move_attack4");
  }
  return undefined;
}

export function soldierPain(context: MonsterContext, _reaction: PainReaction): undefined {
  const { game, entity, state } = context;
  const rerelease = game.options.edition === "rerelease";
  if (health(game, entity.actor.id) < entity.maxHealth / 2) entity.skin |= 1;
  else if (rerelease) entity.skin &= ~1;
  if (rerelease) { finishDodge(context); state.charging = false; state.manualSteering = false; }
  const velocity = game.body(entity).velocity;
  if (game.host.now() < state.painTime) {
    if (velocity.z > 100 && ["soldier_move_pain1", "soldier_move_pain2", "soldier_move_pain3"].includes(state.move.name)) {
      if (rerelease) setDuck(context, false);
      context.setMove("soldier_move_pain4");
    }
    return undefined;
  }
  state.painTime = game.host.now() + 3;
  game.sound(entity, state.weapon === "blaster" ? "soldier/solpain2.wav" : state.weapon === "shotgun" ? "soldier/solpain1.wav" : "soldier/solpain3.wav", 2);
  if (velocity.z > 100) { if (rerelease) setDuck(context, false); return context.setMove("soldier_move_pain4"); }
  const cause = entity.lastAttack?.cause;
  if (rerelease && (state.ducked || state.combatPoint) || game.options.skill === 3 && !(rerelease && cause?.kind === "q2" && cause.meansOfDeath === 41)) return undefined;
  const r = game.host.random();
  context.setMove(r < 0.33 ? "soldier_move_pain1" : r < 0.66 ? "soldier_move_pain2" : "soldier_move_pain3");
  if (rerelease) setDuck(context, false);
  return undefined;
}

const blasterFlash = [39, 40, 83, 86, 89, 92, 95, 98, muzzleIds.SOLDIER_BLASTER_9];
const shotgunFlash = [41, 42, 84, 87, 90, 93, 96, 99, muzzleIds.SOLDIER_SHOTGUN_9];
const machinegunFlash = [43, 44, 85, 88, 91, 94, 97, 100, muzzleIds.SOLDIER_MACHINEGUN_9];

function fire(context: MonsterContext, flashNumber: number, angleLimited = false): undefined {
  const { entity, state, game, weapons } = context;
  const rerelease = game.options.edition === "rerelease";
  const flash = recordAt(state.weapon === "blaster" ? blasterFlash : state.weapon === "shotgun" ? shotgunFlash : machinegunFlash, flashNumber);
  const start = projectFlash(context, muzzleOffset(game.options.edition, flash));
  let aim = anglesVectors(game.body(entity).angles).forward;
  if (flashNumber === 5 || flashNumber === 6) {
    if (rerelease && (entity.spawnflags & 65536) !== 0) return undefined;
  } else {
    const enemy = enemyEye(context);
    if (enemy === null) { state.holdFrame = false; return undefined; }
    const end = state.attackState === "blind" ? { ...state.blindFireTarget, z: state.blindFireTarget.z + (game.entity(entity.enemy)?.viewHeight ?? 22) } : enemy;
    const direction = subtract(end, start);
    if (rerelease && angleLimited && dot(normalize(direction), aim) < 0.5) { state.holdFrame = game.host.now() < state.fireWait; return undefined; }
    const basis = anglesVectors(vectorAngles(direction));
    const r = (game.host.random() * 2 - 1) * 1000, u = (game.host.random() * 2 - 1) * 500;
    aim = normalize(add(scale(basis.forward, 8192), add(scale(basis.right, r), scale(basis.up, u))));
  }
  if (state.weapon === "blaster") weapons.fireBlaster(entity, game, start, aim, 5, 600, 8);
  else if (state.weapon === "shotgun") {
    weapons.fireShotgun(entity, game, start, aim, 2, 1, rerelease ? 1500 : 1000, rerelease ? 750 : 500, rerelease ? 9 : 12, 0);
    if (rerelease) state.cocked = false;
  } else {
    if (!state.holdFrame) {
      if (rerelease) state.fireWait = game.host.now() + 0.3 + game.host.random() * 0.8;
      else state.pauseTime = game.host.now() + (3 + Math.floor(game.host.random() * 8)) * 0.1;
    }
    weapons.fireBullet(entity, game, start, aim, 2, 4, 300, 500, 0);
    state.holdFrame = game.host.now() < (rerelease ? state.fireWait : state.pauseTime);
  }
  game.host.emit({ kind: "monster-muzzleflash", actor: entity.actor.id, flash, origin: start, direction: aim });
  return undefined;
}

export function soldierDie(context: MonsterContext, reaction: DeathReaction): undefined {
  const { entity, game, state } = context;
  const rerelease = game.options.edition === "rerelease";
  const cause = entity.lastAttack?.cause;
  if (health(game, entity.actor.id) <= state.gibHealth || rerelease && state.dead && cause?.kind === "q2" && cause.meansOfDeath === 20) {
    game.sound(entity, "misc/udeath.wav", 2);
    if (rerelease) {
      entity.skin = Math.trunc(entity.skin / 2);
      for (let i = 0; i < 3; i++) throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", reaction.damage);
      throwGib(entity, game, "models/objects/gibs/bone2/tris.md2", reaction.damage);
      throwGib(entity, game, "models/objects/gibs/bone/tris.md2", reaction.damage);
      throwGib(entity, game, "models/monsters/soldier/gibs/arm.md2", reaction.damage, { skinned: true });
      throwGib(entity, game, "models/monsters/soldier/gibs/gun.md2", reaction.damage, { skinned: true, upright: true });
      throwGib(entity, game, "models/monsters/soldier/gibs/chest.md2", reaction.damage, { skinned: true });
      throwGib(entity, game, "models/monsters/soldier/gibs/head.md2", reaction.damage, { head: true, skinned: true });
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
  game.sound(entity, state.weapon === "blaster" ? "soldier/soldeth2.wav" : state.weapon === "shotgun" ? "soldier/soldeth1.wav" : "soldier/soldeth3.wav", 2);
  const body = game.body(entity);
  if (Math.abs(body.origin.z + entity.viewHeight - reaction.point.z) <= 4 && (!rerelease || body.velocity.z < 65)) return context.setMove("soldier_move_death3");
  if (rerelease && (state.move.name === "soldier_move_trip" || state.move.name === "soldier_move_attack5")) {
    context.setMove("soldier_move_death4"); state.nextFrame = rerelease_soldierFrames.death413; return soldierCallbacks.soldier_death_shrink(context);
  }
  const n = Math.floor(game.host.random() * (rerelease && body.velocity.z <= 65 && length(body.velocity) <= 150 ? 4 : 5));
  return context.setMove(recordAt(["soldier_move_death1", "soldier_move_death2", "soldier_move_death4", "soldier_move_death5", "soldier_move_death6"], n));
}

export function soldierSidestep(context: MonsterContext): boolean {
  const name = context.state.move.name;
  if (name === "soldier_move_trip" || name === "soldier_move_attack5" || name === "soldier_move_pain4") return false;
  if (context.state.weapon !== "machinegun") {
    if (name !== "soldier_move_attack6") context.setMove("soldier_move_attack6");
  } else if (name !== "soldier_move_start_run" && name !== "soldier_move_run") context.setMove("soldier_move_start_run");
  return true;
}
export function soldierDuck(context: MonsterContext): boolean {
  context.state.holdFrame = false;
  context.setMove(context.state.move.name === "soldier_move_attack6" ? "soldier_move_trip" : needsCock(context) || context.game.host.random() < 0.5 ? "soldier_move_duck" : "soldier_move_attack3");
  return true;
}

/** Expansion-only callbacks retain their source skin guards in shared base moves. */
function hyperRipper(context: MonsterContext, flash: number, limited = false): undefined {
  if (context.entity.skin >= 6 && context.state.weapon !== "machinegun") return fire(context, flash, limited);
  return undefined;
}
function laserSound(context: MonsterContext, start: boolean): undefined {
  if (context.entity.skin >= 6 && context.state.weapon === "machinegun") {
    context.game.host.emit({ kind: "sound", actor: context.entity.actor.id, origin: context.game.body(context.entity).origin, path: "weapons/laser2.wav", channel: 1, volume: 1, attenuation: 1, reliable: false, loop: start ? "start" : "stop" });
  }
  return undefined;
}

export const soldierCallbacks = {
  soldier_stand: soldierStand,
  soldier_run: soldierRun,
  soldier_idle(context: MonsterContext): undefined { if (context.game.host.random() > 0.8) context.game.sound(context.entity, "soldier/solidle1.wav", 2, 1, 2); return undefined; },
  soldier_cock(context: MonsterContext): undefined { context.game.sound(context.entity, "infantry/infatck3.wav", 1, 1, context.entity.frame === frames(context).stand322 ? 2 : 1); context.state.cocked = true; return undefined; },
  soldier_walk1_random(context: MonsterContext): undefined { if (context.game.host.random() > 0.1) context.state.nextFrame = frames(context).walk101; return undefined; },
  soldier_fire1(context: MonsterContext): undefined { return fire(context, 0); },
  soldier_fire2(context: MonsterContext): undefined { return fire(context, 1); },
  soldier_fire3(context: MonsterContext): undefined { if (context.game.options.edition === "classic") soldierCallbacks.soldier_duck_down(context); return fire(context, 2); },
  soldier_fire4(context: MonsterContext): undefined { return fire(context, 3); },
  soldier_fire5(context: MonsterContext): undefined { return fire(context, 8, true); },
  soldier_fire6(context: MonsterContext): undefined { fire(context, 5); if (context.game.options.edition === "rerelease" && needsCock(context)) context.state.nextFrame = frames(context).death126; return undefined; },
  soldier_fire7(context: MonsterContext): undefined { return fire(context, 6); },
  soldier_fire8(context: MonsterContext): undefined { return fire(context, 7, true); },
  soldier_attack1_refire1(context: MonsterContext): undefined {
    if (context.game.options.edition === "rerelease" && context.state.weapon === "blaster") context.state.nextFrame = frames(context).attak110;
    if (context.state.manualSteering) { context.state.manualSteering = false; return undefined; }
    if (context.state.weapon !== "blaster" || !aliveEnemy(context)) return undefined;
    context.state.nextFrame = refire(context) ? frames(context).attak102 : frames(context).attak110;
    return undefined;
  },
  soldier_attack1_refire2(context: MonsterContext): undefined { if (context.state.weapon !== "blaster" && aliveEnemy(context) && refire(context, context.state.forceRefire)) { context.state.nextFrame = frames(context).attak102; context.state.forceRefire = false; } return undefined; },
  soldier_attack1_shotgun_check(context: MonsterContext): undefined { if (needsCock(context)) { context.state.nextFrame = frames(context).attak106; context.state.forceRefire = true; } return undefined; },
  soldier_attack2_refire1(context: MonsterContext): undefined {
    if (context.game.options.edition === "rerelease" && context.state.weapon === "blaster") context.state.nextFrame = frames(context).attak216;
    if (context.state.weapon !== "blaster" || !aliveEnemy(context)) return undefined;
    if (refire(context)) context.state.nextFrame = frames(context).attak204;
    else if (context.game.options.edition === "classic") context.state.nextFrame = frames(context).attak216;
    return undefined;
  },
  soldier_attack2_refire2(context: MonsterContext): undefined { if (context.state.weapon !== "blaster" && aliveEnemy(context) && refire(context, context.state.forceRefire)) { context.state.nextFrame = frames(context).attak204; context.state.forceRefire = false; } return undefined; },
  soldier_attack2_shotgun_check(context: MonsterContext): undefined { if (needsCock(context)) { context.state.nextFrame = frames(context).attak210; context.state.forceRefire = true; } return undefined; },
  soldier_attack3_refire(context: MonsterContext): undefined {
    if (context.game.options.edition === "rerelease" && needsCock(context)) context.state.holdFrame = context.game.host.now() < context.state.duckWait;
    else if (context.game.host.now() + 0.4 < (context.game.options.edition === "classic" ? context.state.pauseTime : context.state.duckWait)) context.state.nextFrame = frames(context).attak303;
    return undefined;
  },
  soldier_attack6_refire(context: MonsterContext): undefined { if (aliveEnemy(context) && targetDistance(context) >= 500 && context.game.options.skill === 3) context.state.nextFrame = frames(context).runs03; return undefined; },
  soldier_attack6_refire1(context: MonsterContext): undefined {
    finishDodge(context); context.state.charging = false;
    if (context.entity.enemy === null || context.state.weapon !== "blaster") return undefined;
    if (!aliveEnemy(context) || targetDistance(context) < 440 || !visible(context)) return soldierRun(context);
    if (context.game.host.random() < 0.25) context.state.nextFrame = frames(context).runs03;
    else soldierRun(context);
    return undefined;
  },
  soldier_attack6_refire2(context: MonsterContext): undefined {
    finishDodge(context); context.state.charging = false;
    if (context.entity.enemy === null || context.state.weapon === "blaster" || !aliveEnemy(context) || !context.state.forceRefire && targetDistance(context) < 440 || !visible(context)) return undefined;
    if (context.state.forceRefire || context.game.host.random() < 0.25) { context.state.nextFrame = frames(context).runs03; context.state.forceRefire = false; }
    return undefined;
  },
  soldier_attack6_shotgun_check(context: MonsterContext): undefined { if (needsCock(context)) { context.state.nextFrame = frames(context).runs09; context.state.forceRefire = true; } return undefined; },
  soldier_duck_down(context: MonsterContext): undefined { if (context.state.ducked) return undefined; setDuck(context, true); context.state.pauseTime = context.game.host.now() + 1; return undefined; },
  soldier_duck_hold(context: MonsterContext): undefined { context.state.holdFrame = context.game.host.now() < context.state.pauseTime; return undefined; },
  soldier_duck_up(context: MonsterContext): undefined { return setDuck(context, false); },
  soldier_start_charge(context: MonsterContext): undefined { context.state.charging = true; return undefined; },
  soldier_blind(context: MonsterContext): undefined { return context.setMove("soldier_move_blind"); },
  soldier_blind_check(context: MonsterContext): undefined { if (context.state.manualSteering) context.state.idealYaw = vectorAngles(subtract(context.state.blindFireTarget, context.game.body(context.entity).origin)).y; return undefined; },
  soldier_stand_up(context: MonsterContext): undefined { context.setMove("soldier_move_trip", false); context.state.nextFrame = rerelease_soldierFrames.runt08; return undefined; },
  monster_check_prone(context: MonsterContext): undefined { if (!needsCock(context) && proneShot(context)) context.setMove("soldier_move_attack5", false); return undefined; },
  soldier_dead: corpse,
  soldier_death_shrink(context: MonsterContext): undefined { const body = context.game.body(context.entity); context.entity.serverFlags |= 2; context.game.move(context.entity, { bounds: { ...body.bounds, max: { ...body.bounds.max, z: 0 } } }); return undefined; },
  soldierh_hyper_laser_sound_start(context: MonsterContext): undefined { return laserSound(context, true); },
  soldierh_hyper_laser_sound_end(context: MonsterContext): undefined { return laserSound(context, false); },
  soldierh_hyperripper1(context: MonsterContext): undefined { return fire(context, 0); },
  soldierh_hyperripper2(context: MonsterContext): undefined { if (context.state.weapon !== "machinegun") return fire(context, 1); return undefined; },
  soldierh_hyperripper3(context: MonsterContext): undefined { return hyperRipper(context, 2); },
  soldierh_hyperripper5(context: MonsterContext): undefined { return hyperRipper(context, 8, true); },
  soldierh_hyperripper8(context: MonsterContext): undefined { return hyperRipper(context, 7, true); },
  soldierh_hyper_refire1(context: MonsterContext): undefined { if (context.state.weapon === "shotgun" && context.game.host.random() < 0.7 && visible(context)) context.entity.frame = frames(context).attak103; return undefined; },
  soldierh_hyper_refire2(context: MonsterContext): undefined { if (context.state.weapon === "shotgun" && context.game.host.random() < 0.7 && visible(context)) context.entity.frame = frames(context).attak205; return undefined; },
};
