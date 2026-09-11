/* Original Rogue Berserk, Mutant and Parasite movement callbacks. GPL-2.0-or-later. */
import { add, scale } from "../../foundation/fields.ts";
import { anglesVectors, enemyBody, finishDodge } from "../../foundation/monsters/ai.ts";
import { defaultCheckAttack } from "../../foundation/monsters/perception.ts";
import type { Q2Monsters } from "../../foundation/monsters/index.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { berserkDefinition } from "../../base/monsters/berserk.ts";
import { mutantDefinition } from "../../base/monsters/mutant.ts";
import { parasiteDefinition } from "../../base/monsters/parasite.ts";
import { damagedSkin } from "../../base/monsters/common.ts";
import { blockedCheckJump, blockedCheckPlatform, monsterJumpFinished } from "../../rerelease/monsters/common.ts";
import { rogueBlockedCheckShot, rogueMonsterDodge, rogueParasiteDrainTrace } from "./rogue-common.ts";
import type { Q2MissionPackMonsterState } from "./state.ts";
import { berserkMoves } from "./tables/rogue-berserk.ts";
import { mutantMoves } from "./tables/rogue-mutant.ts";
import { parasiteMoves } from "./tables/rogue-parasite.ts";

function jumpImpulse(context: MonsterContext, forwardSpeed: number, upSpeed: number, timed: boolean): undefined {
  const { game, entity } = context, body = game.body(entity), axes = anglesVectors(body.angles);
  if (timed) entity.timestamp = game.host.now();
  return game.move(entity, { velocity: add(body.velocity, add(scale(axes.forward, forwardSpeed), scale(axes.up, upSpeed))) });
}
function jumpWait(context: MonsterContext, timed: boolean): undefined {
  context.state.nextFrame = context.entity.frame + (context.game.body(context.entity).ground !== null || timed && monsterJumpFinished(context) ? 1 : 0);
  return undefined;
}
function jump(context: MonsterContext, up: string, down: string, dodge: boolean): undefined {
  const enemy = enemyBody(context);
  if (enemy === null) return undefined;
  if (dodge) finishDodge(context);
  return context.setMove(enemy.origin.z > context.game.body(context.entity).origin.z ? up : down);
}

export function createRogueJumpingMonsters(monsters: Q2Monsters, source: Q2MissionPackMonsterState): readonly Q2MonsterDefinition[] {
  function berserkRun(context: MonsterContext): undefined { finishDodge(context); return berserkDefinition.run(context); }
  function berserkMelee(context: MonsterContext): undefined { finishDodge(context); return context.setMove((Math.floor(context.game.host.random() * 0x8000) & 1) === 0 ? "berserk_move_attack_spike" : "berserk_move_attack_club"); }
  function berserkSidestep(context: MonsterContext): undefined {
    if (context.state.move.name === "berserk_move_jump" || context.state.move.name === "berserk_move_jump2" || context.state.move.name === "berserk_move_run1") return undefined;
    return context.setMove("berserk_move_run1");
  }
  const berserk: Q2MonsterDefinition = {
    ...berserkDefinition, moves: berserkMoves, run: berserkRun, melee: berserkMelee, attack: berserkMelee,
    dodge(context, attacker, eta, trace) { return rogueMonsterDodge(context, monsters, attacker, eta, trace, null, berserkSidestep); },
    blocked(context, distance) {
      if (blockedCheckJump(context, distance, 256, 40) !== "none") { jump(context, "berserk_move_jump2", "berserk_move_jump", true); return true; }
      return blockedCheckPlatform(context, distance);
    },
    pain(context, reaction) {
      damagedSkin(context);
      if (context.game.host.now() < context.state.painTime) return undefined;
      context.state.painTime = context.game.host.now() + 3; context.game.sound(context.entity, "berserk/berpain2.wav", 2);
      if (context.game.options.skill === 3) return undefined;
      finishDodge(context);
      return context.setMove(reaction.damage < 20 || context.game.host.random() < 0.5 ? "berserk_move_pain1" : "berserk_move_pain2");
    },
    callbacks: { ...berserkDefinition.callbacks, berserk_run: berserkRun, monster_done_dodge: finishDodge,
      berserk_jump_now(context) { return jumpImpulse(context, 100, 300, true); },
      berserk_jump2_now(context) { return jumpImpulse(context, 150, 400, true); },
      berserk_jump_wait_land(context) { return jumpWait(context, true); },
    },
  };
  const mutant: Q2MonsterDefinition = {
    ...mutantDefinition, moves: mutantMoves,
    blocked(context, distance) {
      if (blockedCheckJump(context, distance, 256, 68) !== "none") { jump(context, "mutant_move_jump_up", "mutant_move_jump_down", false); return true; }
      return blockedCheckPlatform(context, distance);
    },
    callbacks: { ...mutantDefinition.callbacks,
      mutant_jump_up(context) { return jumpImpulse(context, 200, 450, false); },
      mutant_jump_down(context) { return jumpImpulse(context, 100, 300, false); },
      mutant_jump_wait_land(context) { return jumpWait(context, false); },
    },
  };
  const parasite: Q2MonsterDefinition = {
    ...parasiteDefinition, moves: parasiteMoves,
    blocked(context, distance) {
      if (rogueBlockedCheckShot(context, 0.25 + 0.05 * context.game.options.skill, source)) return true;
      if (blockedCheckJump(context, distance, 256, 68) !== "none") { jump(context, "parasite_move_jump_up", "parasite_move_jump_down", false); return true; }
      return blockedCheckPlatform(context, distance);
    },
    checkAttack(context) {
      if (!defaultCheckAttack(context)) return false;
      const trace = rogueParasiteDrainTrace(context);
      if (trace === null) return false;
      if (trace.hit.kind !== "actor" || context.entity.enemy === null || !trace.hit.actor.equals(context.entity.enemy)) {
        source.get(context.entity).blocked = true; context.attack(); source.get(context.entity).blocked = false;
      }
      // The original C falls off its successful trace branch; retain its accepted M_CheckAttack result.
      return true;
    },
    callbacks: { ...parasiteDefinition.callbacks,
      parasite_jump_up(context) { return jumpImpulse(context, 200, 450, true); },
      parasite_jump_down(context) { return jumpImpulse(context, 100, 300, true); },
      parasite_jump_wait_land(context) { return jumpWait(context, true); },
    },
  };
  return [berserk, mutant, parasite];
}
