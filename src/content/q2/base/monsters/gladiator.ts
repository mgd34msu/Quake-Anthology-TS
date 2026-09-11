/* Quake II m_gladiator.c. id Software, GPL-2.0-or-later. */
import { normalize, subtract } from "../../foundation/fields.ts";
import { enemyEye, projectFlash, targetDistance } from "../../foundation/monsters/ai.ts";
import { muzzleOffset } from "../../foundation/monsters/muzzle.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { beginDeath, damagedSkin, finishCorpse, move, muzzle, sound } from "./common.ts";
import { gladiatorMoves } from "./tables/gladiator.ts";

function run(context: MonsterContext): undefined { return context.setMove(context.state.standGround ? "gladiator_move_stand" : "gladiator_move_run"); }
export const gladiatorDefinition: Q2MonsterDefinition = {
  classname: "monster_gladiator", kind: "gladiator", model: "models/monsters/gladiatr/tris.md2", health: 400, gibHealth: -175, mass: 400,
  bounds: { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: 64 } }, scale: 1,
  initialMove: "gladiator_move_stand", moves: gladiatorMoves, stand: move("gladiator_move_stand"), walk: move("gladiator_move_walk"), run,
  melee: move("gladiator_move_attack_melee"),
  attack(context) {
    if (targetDistance(context) <= 112) return undefined;
    const eye = enemyEye(context); if (eye === null) return undefined;
    context.state.blindFireTarget = eye;
    context.game.sound(context.entity, "gladiator/railgun.wav", 1);
    return context.setMove("gladiator_move_attack_gun");
  },
  sight: sound("gladiator/sight.wav"), idle: sound("gladiator/gldidle1.wav", 2, 2), search: sound("gladiator/gldsrch1.wav", 2, 2),
  pain(context) {
    damagedSkin(context);
    const airborne = context.game.body(context.entity).velocity.z > 100;
    if (context.game.host.now() < context.state.painTime) {
      if (airborne && context.state.move.name === "gladiator_move_pain") context.setMove("gladiator_move_pain_air");
      return undefined;
    }
    context.state.painTime = context.game.host.now() + 3;
    context.game.sound(context.entity, context.game.host.random() < 0.5 ? "gladiator/pain.wav" : "gladiator/gldpain2.wav", 2);
    if (context.game.options.skill === 3) return undefined;
    return context.setMove(airborne ? "gladiator_move_pain_air" : "gladiator_move_pain");
  },
  die(context, reaction) { return beginDeath(context, reaction, "gladiator/glddeth2.wav", "gladiator_move_death"); },
  callbacks: {
    gladiator_run: run, gladiator_dead: finishCorpse, gladiator_cleaver_swing: sound("gladiator/melee1.wav", 1),
    GaldiatorMelee(context) {
      const hit = context.weapons.fireHit(context.entity, context.game, { x: 80, y: context.game.body(context.entity).bounds.min.x, z: -4 }, 20 + Math.floor(context.game.host.random() * 5), 300);
      return context.game.sound(context.entity, hit ? "gladiator/melee2.wav" : "gladiator/melee3.wav", 0);
    },
    GladiatorGun(context) {
      const start = projectFlash(context, muzzleOffset(context.game.options.edition, 61));
      const direction = normalize(subtract(context.state.blindFireTarget, start));
      context.weapons.fireRail(context.entity, context.game, start, direction, 50, 100);
      return muzzle(context, 61, direction, start);
    },
  },
};
