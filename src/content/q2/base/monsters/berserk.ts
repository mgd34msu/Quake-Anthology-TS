/* Quake II m_berserk.c. id Software, GPL-2.0-or-later. */
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { beginDeath, damagedSkin, finishCorpse, humanoidBounds, move, sound } from "./common.ts";
import { berserkMoves } from "./tables/berserk.ts";

const stand = move("berserk_move_stand");
function run(context: MonsterContext): undefined { return context.setMove(context.state.standGround ? "berserk_move_stand" : "berserk_move_run1"); }
function melee(context: MonsterContext): undefined { return context.setMove(context.game.host.random() < 0.5 ? "berserk_move_attack_spike" : "berserk_move_attack_club"); }
export const berserkDefinition: Q2MonsterDefinition = {
  classname: "monster_berserk", kind: "berserk", model: "models/monsters/berserk/tris.md2", health: 240, gibHealth: -60, mass: 250, bounds: humanoidBounds, scale: 1,
  initialMove: "berserk_move_stand", moves: berserkMoves, stand, walk: move("berserk_move_walk"), run, attack: melee, melee, hasRangedAttack: false,
  sight: sound("berserk/sight.wav"), search: sound("berserk/bersrch1.wav"),
  pain(context, reaction) {
    damagedSkin(context);
    if (context.game.host.now() < context.state.painTime) return undefined;
    context.state.painTime = context.game.host.now() + 3;
    context.game.sound(context.entity, "berserk/berpain2.wav", 2);
    if (context.game.options.skill === 3) return undefined;
    return context.setMove(reaction.damage < 20 || context.game.host.random() < 0.5 ? "berserk_move_pain1" : "berserk_move_pain2");
  },
  die(context, reaction) { return beginDeath(context, reaction, "berserk/berdeth2.wav", reaction.damage >= 50 ? "berserk_move_death1" : "berserk_move_death2"); },
  callbacks: {
    berserk_stand: stand, berserk_run: run, berserk_dead: finishCorpse,
    berserk_fidget(context) {
      if (context.state.standGround || context.game.host.random() > 0.15) return undefined;
      context.setMove("berserk_move_stand_fidget");
      return context.game.sound(context.entity, "berserk/beridle1.wav", 1, 1, 2);
    },
    berserk_swing: sound("berserk/attack.wav", 1),
    berserk_attack_spike(context) {
      context.weapons.fireHit(context.entity, context.game, { x: 80, y: 0, z: -24 }, 15 + Math.floor(context.game.host.random() * 6), 400);
      return undefined;
    },
    berserk_attack_club(context) {
      context.weapons.fireHit(context.entity, context.game, { x: 80, y: context.game.body(context.entity).bounds.min.x, z: -4 }, 5 + Math.floor(context.game.host.random() * 6), 400);
      return undefined;
    },
    // The original callback is empty; this unused source animation is retained.
    berserk_strike() { return undefined; },
  },
};
