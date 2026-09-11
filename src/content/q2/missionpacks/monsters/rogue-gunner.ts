/* Original Rogue m_gunner.c weapon, jump and dodge behavior. GPL-2.0-or-later. */
import { add, length, normalize, scale, subtract } from "../../foundation/fields.ts";
import { anglesVectors, enemyBody, finishDodge, projectFlash, targetDistance, vectorAngles, visible } from "../../foundation/monsters/ai.ts";
import { muzzleOffset } from "../../foundation/monsters/muzzle.ts";
import type { Q2Monsters } from "../../foundation/monsters/index.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { gunnerDefinition } from "../../base/monsters/gunner.ts";
import { damagedSkin, shot } from "../../base/monsters/common.ts";
import { blockedCheckJump, blockedCheckPlatform, monsterFlash, monsterJumpFinished } from "../../rerelease/monsters/common.ts";
import { rogueBlockedCheckShot, rogueDuckDown, rogueDuckHold, rogueDuckUp, rogueMonsterDodge } from "./rogue-common.ts";
import type { Q2MissionPackMonsterState } from "./state.ts";
import { gunnerFrame, gunnerMoves } from "./tables/rogue-gunner.ts";

function grenadeCheck(context: MonsterContext): boolean {
  const { entity, game, state } = context, enemy = enemyBody(context);
  if (enemy === null) return false;
  const body = game.body(entity);
  if (state.manualSteering ? body.origin.z + entity.viewHeight < state.blindFireTarget.z : body.origin.z + body.bounds.max.z <= enemy.origin.z + enemy.bounds.min.z) return false;
  const target = state.manualSteering ? state.blindFireTarget : enemy.origin;
  if (length(subtract(body.origin, target)) < 100) return false;
  const start = projectFlash(context, muzzleOffset(game.options.edition, 53));
  const trace = game.host.trace({ start, end: target, bounds: null, ignore: entity.actor.id, mask: 0x6000003 });
  return trace.fraction === 1 || trace.hit.kind === "actor" && trace.hit.actor === entity.enemy;
}
function grenade(context: MonsterContext): undefined {
  const { entity, game, state } = context, enemy = enemyBody(context);
  if (enemy === null) return undefined;
  const blind = state.manualSteering, body = game.body(entity);
  const index = entity.frame === gunnerFrame.attak105 ? 0 : entity.frame === gunnerFrame.attak108 ? 1 : entity.frame === gunnerFrame.attak111 ? 2 : 3;
  if (index === 3) state.manualSteering = false;
  const blindTarget = blind && !visible(context), point = blindTarget ? state.blindFireTarget : body.origin;
  if (blindTarget && point.x === 0 && point.y === 0 && point.z === 0) return undefined;
  const flash = 53 + index, axes = anglesVectors(body.angles), start = projectFlash(context, muzzleOffset(game.options.edition, flash));
  let aim = subtract(point, body.origin);
  const distance = length(aim);
  if (distance > 512 && aim.z < 64 && aim.z > -64) aim = { ...aim, z: aim.z + distance - 512 };
  const pitch = Math.max(-0.5, Math.min(0.4, normalize(aim).z));
  const direction = add(add(axes.forward, scale(axes.right, 0.02 + index * 0.03)), scale(axes.up, pitch));
  context.weapons.fireGrenade(entity, game, start, direction, 50, 600, 2.5, 90, false, false, true);
  return monsterFlash(context, flash, start, direction);
}
function duckDown(context: MonsterContext): undefined {
  context.state.ducked = true;
  if (context.game.options.skill >= 2 && context.game.host.random() > 0.5) grenade(context);
  return rogueDuckDown(context);
}
function jumping(context: MonsterContext): boolean { return context.state.move.name === "gunner_move_jump" || context.state.move.name === "gunner_move_jump2"; }
function shooting(context: MonsterContext): boolean { return context.state.move.name === "gunner_move_attack_chain" || context.state.move.name === "gunner_move_fire_chain" || context.state.move.name === "gunner_move_attack_grenade"; }
function duck(context: MonsterContext, eta: number): undefined {
  if (jumping(context)) return undefined;
  if (shooting(context) && context.game.options.skill !== 0) { context.state.ducked = false; return undefined; }
  context.state.duckWait = context.game.host.now() + eta + (context.game.options.skill === 0 ? 1 : 0.1 * (3 - context.game.options.skill));
  duckDown(context); context.state.nextFrame = gunnerFrame.duck01;
  return context.setMove("gunner_move_duck");
}
function sidestep(context: MonsterContext): undefined {
  if (jumping(context)) return undefined;
  if (shooting(context) && context.game.options.skill !== 0) { context.state.dodging = false; return undefined; }
  return context.state.move.name === "gunner_move_run" ? undefined : context.setMove("gunner_move_run");
}
function run(context: MonsterContext): undefined { finishDodge(context); return gunnerDefinition.run(context); }
function jumpNow(context: MonsterContext, up: boolean): undefined {
  const { entity, game } = context, body = game.body(entity), axes = anglesVectors(body.angles);
  entity.timestamp = game.host.now();
  return game.move(entity, { velocity: add(body.velocity, add(scale(axes.forward, up ? 150 : 100), scale(axes.up, up ? 400 : 300))) });
}

export function createRogueGunnerDefinition(monsters: Q2Monsters, source: Q2MissionPackMonsterState): Q2MonsterDefinition {
  return {
    ...gunnerDefinition, moves: gunnerMoves, blindFire: true, run,
    attack(context) {
      finishDodge(context);
      const { state, game } = context;
      if (state.attackState === "blind") {
        const chance = state.blindFireDelay < 1 ? 1 : state.blindFireDelay < 7.5 ? 0.4 : 0.1, random = game.host.random();
        state.blindFireDelay += 4.1 + game.host.random() * 3;
        if (state.blindFireTarget.x === 0 && state.blindFireTarget.y === 0 && state.blindFireTarget.z === 0 || random > chance) return undefined;
        state.manualSteering = true;
        if (grenadeCheck(context)) { context.setMove("gunner_move_attack_grenade"); state.attackFinished = game.host.now() + 2 * game.host.random(); }
        state.manualSteering = false;
        return undefined;
      }
      return context.setMove(targetDistance(context) < 80 || source.get(context.entity).badArea !== null ? "gunner_move_attack_chain" : game.host.random() <= 0.5 && grenadeCheck(context) ? "gunner_move_attack_grenade" : "gunner_move_attack_chain");
    },
    pain(context, reaction) {
      damagedSkin(context); finishDodge(context);
      const { entity, game, state } = context;
      if (game.body(entity).ground === null || game.host.now() < state.painTime) return undefined;
      state.painTime = game.host.now() + 3;
      game.sound(entity, (Math.floor(game.host.random() * 0x8000) & 1) !== 0 ? "gunner/gunpain2.wav" : "gunner/gunpain1.wav", 2);
      if (game.options.skill === 3) return undefined;
      context.setMove(reaction.damage <= 10 ? "gunner_move_pain3" : reaction.damage <= 25 ? "gunner_move_pain2" : "gunner_move_pain1");
      state.manualSteering = false;
      if (state.ducked) rogueDuckUp(context);
      return undefined;
    },
    dodge(context, attacker, eta, trace) { return rogueMonsterDodge(context, monsters, attacker, eta, trace, duck, sidestep); },
    duck(context, eta) { duck(context, eta); return true; },
    blocked(context, distance) {
      if (rogueBlockedCheckShot(context, 0.25 + 0.05 * context.game.options.skill, source) || blockedCheckPlatform(context, distance)) return true;
      if (blockedCheckJump(context, distance, 192, 40) === "none") return false;
      const enemy = enemyBody(context);
      if (enemy !== null) { finishDodge(context); context.setMove(enemy.origin.z > context.game.body(context.entity).origin.z ? "gunner_move_jump2" : "gunner_move_jump"); }
      return true;
    },
    callbacks: { ...gunnerDefinition.callbacks, gunner_run: run, monster_done_dodge: finishDodge, gunner_duck_down: duckDown, monster_duck_hold: rogueDuckHold, monster_duck_up: rogueDuckUp,
      GunnerGrenade: grenade,
      GunnerFire(context) {
        if (enemyBody(context) === null) return undefined;
        const flash = 45 + context.entity.frame - gunnerFrame.attak216, aim = shot(context, flash, -0.2);
        if (aim === null) return undefined;
        context.weapons.fireBullet(context.entity, context.game, aim.start, aim.direction, 3, 4, 300, 500, 0);
        return monsterFlash(context, flash, aim.start, aim.direction);
      },
      gunner_blind_check(context) { if (context.state.manualSteering) context.state.idealYaw = vectorAngles(subtract(context.state.blindFireTarget, context.game.body(context.entity).origin)).y; return undefined; },
      gunner_jump_now(context) { return jumpNow(context, false); }, gunner_jump2_now(context) { return jumpNow(context, true); },
      gunner_jump_wait_land(context) { context.state.nextFrame = context.entity.frame + (context.game.body(context.entity).ground !== null || monsterJumpFinished(context) ? 1 : 0); return undefined; },
    },
  };
}
