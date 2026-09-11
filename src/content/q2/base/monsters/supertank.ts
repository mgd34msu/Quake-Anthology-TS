/* Quake II m_supertank.c. id Software, GPL-2.0-or-later. */
import { anglesVectors, enemyEye, targetDistance, visible } from "../../foundation/monsters/ai.ts";
import { normalize, subtract } from "../../foundation/fields.ts";
import { muzzleOffset } from "../../foundation/monsters/muzzle.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { damagedSkin, finishCorpse, move, muzzle, shot, sound } from "./common.ts";
import { bossExplode } from "./boss-common.ts";
import { supertankFrame, supertankMoves } from "./tables/supertank.ts";

function run(context: MonsterContext): undefined { return context.setMove(context.state.standGround ? "supertank_move_stand" : "supertank_move_run"); }
export const supertankDefinition: Q2MonsterDefinition = {
  classname: "monster_supertank", kind: "supertank", model: "models/monsters/boss1/tris.md2", health: 1500, gibHealth: -500, mass: 800,
  bounds: { min: { x: -64, y: -64, z: 0 }, max: { x: 64, y: 64, z: 112 } }, scale: 1,
  initialMove: "supertank_move_stand", moves: supertankMoves, stand: move("supertank_move_stand"), walk: move("supertank_move_forward"), run,
  attack(context) { return context.setMove(targetDistance(context) <= 160 || context.game.host.random() < 0.3 ? "supertank_move_attack1" : "supertank_move_attack2"); },
  search(context) { return context.game.sound(context.entity, context.game.host.random() < 0.5 ? "bosstank/btkunqv1.wav" : "bosstank/btkunqv2.wav", 2); },
  pain(context, reaction) {
    damagedSkin(context);
    if (context.game.host.now() < context.state.painTime || reaction.damage <= 25 && context.game.host.random() < 0.2) return undefined;
    if (context.game.options.skill >= 2 && context.entity.frame >= supertankFrame.attak2_1 && context.entity.frame <= supertankFrame.attak2_14) return undefined;
    context.state.painTime = context.game.host.now() + 3;
    if (context.game.options.skill === 3) return undefined;
    context.game.sound(context.entity, reaction.damage <= 10 ? "bosstank/btkpain1.wav" : reaction.damage <= 25 ? "bosstank/btkpain3.wav" : "bosstank/btkpain2.wav", 2);
    return context.setMove(reaction.damage <= 10 ? "supertank_move_pain1" : reaction.damage <= 25 ? "supertank_move_pain2" : "supertank_move_pain3");
  },
  die(context) {
    context.game.sound(context.entity, "bosstank/btkdeth1.wav", 2);
    context.state.dead = true; context.state.canTakeDamage = false; context.entity.count = 0;
    context.game.host.combat.setTraits(context.entity.actor, { canTakeDamage: false });
    return context.setMove("supertank_move_death");
  },
  callbacks: {
    supertank_run: run, TreadSound: sound("bosstank/btkengn1.wav", 4), BossExplode: bossExplode,
    supertank_dead(context) { return finishCorpse(context, { min: { x: -60, y: -60, z: 0 }, max: { x: 60, y: 60, z: 72 } }); },
    supertank_reattack1(context) { return context.setMove(visible(context) && context.game.host.random() < 0.9 ? "supertank_move_attack1" : "supertank_move_end_attack1"); },
    supertankRocket(context) {
      const flash = context.entity.frame === supertankFrame.attak2_8 ? 70 : context.entity.frame === supertankFrame.attak2_11 ? 71 : 72;
      const aim = shot(context, flash); if (aim === null) return undefined;
      context.weapons.fireRocket(context.entity, context.game, aim.start, aim.direction, 50, 500, 70, 50);
      return muzzle(context, flash, aim.direction, aim.start);
    },
    supertankMachineGun(context) {
      const flash = 64 + context.entity.frame - supertankFrame.attak1_1, body = context.game.body(context.entity), yaw = body.angles.y;
      // Source ignores body pitch for these six gun offsets.
      const axes = anglesVectors({ x: 0, y: yaw, z: 0 }), offset = muzzleOffset(context.game.options.edition, flash);
      const start = { x: body.origin.x + axes.forward.x * offset.x + axes.right.x * offset.y, y: body.origin.y + axes.forward.y * offset.x + axes.right.y * offset.y, z: body.origin.z + offset.z };
      const eye = enemyEye(context), direction = eye === null ? axes.forward : normalize(subtract(eye, start));
      context.weapons.fireBullet(context.entity, context.game, start, direction, 6, 4, 300, 500, 0);
      return muzzle(context, flash, direction, start);
    },
  },
};
