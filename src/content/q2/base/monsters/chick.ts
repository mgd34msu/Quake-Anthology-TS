/* Quake II m_chick.c. id Software, GPL-2.0-or-later. */
import { setDuck, targetDistance, visible } from "../../foundation/monsters/ai.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { aliveEnemy, beginDeath, damagedSkin, finishCorpse, move, muzzle, shot, sound, standardGib } from "./common.ts";
import { chickMoves } from "./tables/chick.ts";

const stand = move("chick_move_stand");
function run(context: MonsterContext): undefined {
  return context.setMove(context.state.standGround ? "chick_move_stand" : ["chick_move_walk", "chick_move_start_run"].includes(context.state.move.name) ? "chick_move_run" : "chick_move_start_run");
}
export const chickDefinition: Q2MonsterDefinition = {
  classname: "monster_chick", kind: "chick", model: "models/monsters/bitch/tris.md2", health: 175, gibHealth: -70, mass: 200,
  bounds: { min: { x: -16, y: -16, z: 0 }, max: { x: 16, y: 16, z: 56 } }, scale: 1,
  initialMove: "chick_move_stand", moves: chickMoves, stand, walk: move("chick_move_walk"), run,
  attack: move("chick_move_start_attack1"), melee: move("chick_move_start_slash"), sight: sound("chick/chksght1.wav"),
  pain(context, reaction) {
    damagedSkin(context);
    if (context.game.host.now() < context.state.painTime) return undefined;
    context.state.painTime = context.game.host.now() + 3;
    const r = context.game.host.random();
    context.game.sound(context.entity, r < 0.33 ? "chick/chkpain1.wav" : r < 0.66 ? "chick/chkpain2.wav" : "chick/chkpain3.wav", 2);
    if (context.game.options.skill === 3) return undefined;
    return context.setMove(reaction.damage <= 10 ? "chick_move_pain1" : reaction.damage <= 25 ? "chick_move_pain2" : "chick_move_pain3");
  },
  die(context, reaction) {
    if (standardGib(context, reaction) || context.state.dead) return undefined;
    const first = context.game.host.random() < 0.5;
    return beginDeath(context, reaction, first ? "chick/chkdeth1.wav" : "chick/chkdeth2.wav", first ? "chick_move_death1" : "chick_move_death2");
  },
  dodge(context, attacker) {
    if (context.game.host.random() > 0.25) return undefined;
    context.entity.enemy ??= attacker;
    return context.setMove("chick_move_duck");
  },
  callbacks: {
    chick_stand: stand, chick_run: run, chick_dead: finishCorpse,
    ChickMoan(context) { return context.game.sound(context.entity, context.game.host.random() < 0.5 ? "chick/chkidle1.wav" : "chick/chkidle2.wav", 2, 1, 2); },
    chick_fidget(context) { if (!context.state.standGround && context.game.host.random() <= 0.3) context.setMove("chick_move_fidget"); return undefined; },
    chick_duck_down(context) { if (context.state.ducked) return undefined; setDuck(context, true); context.state.pauseTime = context.game.host.now() + 1; return undefined; },
    chick_duck_hold(context) { context.state.holdFrame = context.game.host.now() < context.state.pauseTime; return undefined; },
    chick_duck_up(context) { return setDuck(context, false); },
    Chick_PreAttack1: sound("chick/chkatck1.wav"), ChickReload: sound("chick/chkatck5.wav"),
    ChickRocket(context) {
      const aim = shot(context, 57); if (aim === null) return undefined;
      context.weapons.fireRocket(context.entity, context.game, aim.start, aim.direction, 50, 500, 70, 50);
      return muzzle(context, 57, aim.direction, aim.start);
    },
    ChickSlash(context) {
      context.game.sound(context.entity, "chick/chkatck3.wav", 1);
      context.weapons.fireHit(context.entity, context.game, { x: 80, y: context.game.body(context.entity).bounds.min.x, z: 10 }, 10 + Math.floor(context.game.host.random() * 6), 100);
      return undefined;
    },
    chick_attack1: move("chick_move_attack1"), chick_slash: move("chick_move_slash"),
    chick_rerocket(context) { return context.setMove(aliveEnemy(context) && targetDistance(context) >= 80 && visible(context) && context.game.host.random() <= 0.6 ? "chick_move_attack1" : "chick_move_end_attack1"); },
    chick_reslash(context) { return context.setMove(aliveEnemy(context) && targetDistance(context) < 80 && context.game.host.random() <= 0.9 ? "chick_move_slash" : "chick_move_end_slash"); },
  },
};
