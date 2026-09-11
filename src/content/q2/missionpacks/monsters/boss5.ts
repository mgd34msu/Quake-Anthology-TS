/* Quake II xatrix/m_boss5.c. ZeniMax Media, GPL-2.0-or-later. */
import { bossExplode } from "../../base/monsters/boss-common.ts";
import { damagedSkin, finishCorpse, move, muzzle, shot, sound } from "../../base/monsters/common.ts";
import { normalize, subtract } from "../../foundation/fields.ts";
import { anglesVectors, enemyEye, projectFlash, targetDistance, visible } from "../../foundation/monsters/ai.ts";
import { muzzleOffset } from "../../foundation/monsters/muzzle.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { monsterPowerArmor, restoreMonsterPowerArmor } from "./power-armor.ts";
import { boss5Frame, boss5Moves } from "./tables/xatrix-boss5.ts";

function run(context: MonsterContext): undefined { return context.setMove(context.state.standGround ? "boss5_move_stand" : "boss5_move_run"); }
export const boss5Definition: Q2MonsterDefinition = {
  classname: "monster_boss5", kind: "boss5", model: "models/monsters/boss5/tris.md2", health: 1500, gibHealth: -500, mass: 800,
  bounds: { min: { x: -64, y: -64, z: 0 }, max: { x: 64, y: 64, z: 112 } }, scale: 1,
  initialMove: "boss5_move_stand", moves: boss5Moves, stand: move("boss5_move_stand"), walk: move("boss5_move_forward"), run,
  initialize(context) { return monsterPowerArmor(context, "shield", 400); },
  restore: restoreMonsterPowerArmor,
  search(context) { return context.game.sound(context.entity, context.game.host.random() < 0.5 ? "bosstank/btkunqv1.wav" : "bosstank/btkunqv2.wav", 2); },
  attack(context) { return context.setMove(targetDistance(context) <= 160 || context.game.host.random() < 0.3 ? "boss5_move_attack1" : "boss5_move_attack2"); },
  pain(context, reaction) {
    damagedSkin(context);
    if (context.game.host.now() < context.state.painTime || reaction.damage <= 25 && context.game.host.random() < 0.2) return undefined;
    if (context.game.options.skill >= 2 && context.entity.frame >= boss5Frame.attak2_1 && context.entity.frame <= boss5Frame.attak2_14) return undefined;
    context.state.painTime = context.game.host.now() + 3;
    context.game.sound(context.entity, reaction.damage <= 10 ? "bosstank/btkpain1.wav" : reaction.damage <= 25 ? "bosstank/btkpain3.wav" : "bosstank/btkpain2.wav", 2);
    return context.setMove(reaction.damage <= 10 ? "boss5_move_pain1" : reaction.damage <= 25 ? "boss5_move_pain2" : "boss5_move_pain3");
  },
  die(context) {
    context.game.sound(context.entity, "bosstank/btkdeth1.wav", 2); context.state.dead = true; context.state.canTakeDamage = false; context.entity.count = 0;
    context.game.host.combat.setTraits(context.entity.actor, { canTakeDamage: false });
    return context.setMove("boss5_move_death");
  },
  callbacks: {
    boss5_run: run, BossExplode2: bossExplode, TreadSound2: sound("bosstank/btkengn1.wav", 2),
    boss5_dead(context) { return finishCorpse(context, { min: { x: -60, y: -60, z: 0 }, max: { x: 60, y: 60, z: 72 } }); },
    boss5_reattack1(context) { return context.setMove(visible(context) && context.game.host.random() < 0.9 ? "boss5_move_attack1" : "boss5_move_end_attack1"); },
    boss5Rocket(context) {
      const flash = context.entity.frame === boss5Frame.attak2_8 ? 70 : context.entity.frame === boss5Frame.attak2_11 ? 71 : 72;
      const aim = shot(context, flash); if (aim === null) return undefined;
      context.weapons.fireRocket(context.entity, context.game, aim.start, aim.direction, 50, 500, 70, 50);
      return muzzle(context, flash, aim.direction, aim.start);
    },
    boss5MachineGun(context) {
      const flash = 64 + context.entity.frame - boss5Frame.attak1_1, body = context.game.body(context.entity);
      const start = projectFlash(context, muzzleOffset(context.game.options.edition, flash), { x: 0, y: body.angles.y, z: 0 });
      const eye = enemyEye(context), direction = eye === null ? anglesVectors({ x: 0, y: body.angles.y, z: 0 }).forward : normalize(subtract(eye, start));
      context.weapons.fireBullet(context.entity, context.game, start, direction, 6, 4, 300, 500, 0);
      return muzzle(context, flash, direction, start);
    },
  },
};
