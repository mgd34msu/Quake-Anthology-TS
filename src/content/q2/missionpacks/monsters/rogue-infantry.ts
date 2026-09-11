/* Original Rogue m_infantry.c behavior. ZeniMax Media, GPL-2.0-or-later. */
import { add, scale } from "../../foundation/fields.ts";
import { anglesVectors, enemyBody, finishDodge } from "../../foundation/monsters/ai.ts";
import { infantryAttack, infantryCallbacks, infantryDie, infantryRun, infantrySight, infantryStand, infantryWalk } from "../../foundation/monsters/infantry.ts";
import type { Q2Monsters } from "../../foundation/monsters/index.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { damagedSkin, humanoidBounds, shot } from "../../base/monsters/common.ts";
import { blockedCheckJump, blockedCheckPlatform, monsterFlash, monsterJumpFinished } from "../../rerelease/monsters/common.ts";
import { rogueBlockedCheckShot, rogueDuckDown, rogueDuckHold, rogueDuckUp, rogueMonsterDodge } from "./rogue-common.ts";
import type { Q2MissionPackMonsterState } from "./state.ts";
import { infantryFrame, infantryMoves } from "./tables/rogue-infantry.ts";

function run(context: MonsterContext): undefined { finishDodge(context); return infantryRun(context); }
function jumping(context: MonsterContext): boolean { return context.state.move.name === "infantry_move_jump" || context.state.move.name === "infantry_move_jump2"; }
function shooting(context: MonsterContext): boolean { return context.state.move.name === "infantry_move_attack1" || context.state.move.name === "infantry_move_attack2"; }
function duck(context: MonsterContext, eta: number): undefined {
  if (jumping(context)) return undefined;
  if (shooting(context) && context.game.options.skill !== 0) { context.state.ducked = false; return undefined; }
  context.state.duckWait = context.game.host.now() + eta + (context.game.options.skill === 0 ? 1 : 0.1 * (3 - context.game.options.skill));
  rogueDuckDown(context);
  context.state.nextFrame = infantryFrame.duck01;
  return context.setMove("infantry_move_duck");
}
function sidestep(context: MonsterContext): undefined {
  if (jumping(context)) return undefined;
  if (shooting(context) && context.game.options.skill !== 0) { context.state.dodging = false; return undefined; }
  return context.state.move.name === "infantry_move_run" ? undefined : context.setMove("infantry_move_run");
}
function machineGun(context: MonsterContext): undefined {
  if (enemyBody(context) === null) return undefined;
  if (context.entity.frame !== infantryFrame.attak104) return infantryCallbacks.InfantryMachineGun(context);
  const aim = shot(context, 26, -0.2);
  if (aim === null) return undefined;
  context.weapons.fireBullet(context.entity, context.game, aim.start, aim.direction, 3, 4, 300, 500, 0);
  return monsterFlash(context, 26, aim.start, aim.direction);
}
function jumpNow(context: MonsterContext, high: boolean): undefined {
  const { entity, game } = context, body = game.body(entity), axes = anglesVectors(body.angles);
  entity.timestamp = game.host.now();
  return game.move(entity, { velocity: add(body.velocity, add(scale(axes.forward, high ? 150 : 100), scale(axes.up, high ? 400 : 300))) });
}

export function createRogueInfantryDefinition(monsters: Q2Monsters, source: Q2MissionPackMonsterState): Q2MonsterDefinition {
  return {
    classname: "monster_infantry", kind: "infantry", model: "models/monsters/infantry/tris.md2", health: 100, gibHealth: -40, mass: 200,
    bounds: humanoidBounds, scale: 1, initialMove: "infantry_move_stand", moves: infantryMoves,
    stand: infantryStand, walk: infantryWalk, run, sight: infantrySight, die: infantryDie,
    attack(context) { finishDodge(context); return infantryAttack(context); },
    idle(context) { context.game.sound(context.entity, "infantry/infidle1.wav", 2, 1, 2); return context.setMove("infantry_move_fidget"); },
    pain(context) {
      damagedSkin(context);
      const { entity, game, state } = context;
      if (game.body(entity).ground === null) return undefined;
      finishDodge(context);
      if (game.host.now() < state.painTime) return undefined;
      state.painTime = game.host.now() + 3;
      if (game.options.skill === 3) return undefined;
      const second = (Math.floor(game.host.random() * 0x8000) & 1) !== 0;
      context.setMove(second ? "infantry_move_pain2" : "infantry_move_pain1");
      game.sound(entity, second ? "infantry/infpain2.wav" : "infantry/infpain1.wav", 2);
      if (state.ducked) rogueDuckUp(context);
      return undefined;
    },
    dodge(context, attacker, eta, trace) { return rogueMonsterDodge(context, monsters, attacker, eta, trace, duck, sidestep); },
    duck(context, eta) { duck(context, eta); return true; },
    blocked(context, distance) {
      if (rogueBlockedCheckShot(context, 0.25 + 0.05 * context.game.options.skill, source)) return true;
      if (blockedCheckJump(context, distance, 192, 40) !== "none") {
        const enemy = enemyBody(context);
        if (enemy !== null) { finishDodge(context); context.setMove(enemy.origin.z > context.game.body(context.entity).origin.z ? "infantry_move_jump2" : "infantry_move_jump"); }
        return true;
      }
      return blockedCheckPlatform(context, distance);
    },
    callbacks: {
      ...infantryCallbacks, infantry_run: run, InfantryMachineGun: machineGun, monster_done_dodge: finishDodge,
      monster_duck_down: rogueDuckDown, monster_duck_hold: rogueDuckHold, monster_duck_up: rogueDuckUp,
      infantry_cock_gun(context) { return context.game.sound(context.entity, "infantry/infatck3.wav", 1); },
      infantry_fire_prep(context) { context.state.pauseTime = context.game.host.now() + ((Math.floor(context.game.host.random() * 0x8000) & 15) + 4) * 0.1; return undefined; },
      infantry_fire(context) { machineGun(context); context.state.holdFrame = context.game.host.now() < context.state.pauseTime; return undefined; },
      infantry_jump_now(context) { return jumpNow(context, false); },
      infantry_jump2_now(context) { return jumpNow(context, true); },
      infantry_jump_wait_land(context) { context.state.nextFrame = context.entity.frame + (context.game.body(context.entity).ground !== null || monsterJumpFinished(context) ? 1 : 0); return undefined; },
    },
  };
}
