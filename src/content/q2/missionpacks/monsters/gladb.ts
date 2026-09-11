/* Quake II xatrix/m_gladb.c. ZeniMax Media, GPL-2.0-or-later. */
import { normalize, subtract } from "../../foundation/fields.ts";
import { enemyEye, projectFlash, targetDistance } from "../../foundation/monsters/ai.ts";
import { muzzleOffset } from "../../foundation/monsters/muzzle.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { beginDeath, damagedSkin, finishCorpse, move, sound } from "../../base/monsters/common.ts";
import { monsterPowerArmor, restoreMonsterPowerArmor } from "./power-armor.ts";
import { gladbMoves } from "./tables/xatrix-gladb.ts";
import type { Q2MissionPackMonsterWeapons } from "./types.ts";

export function createGladbDefinition(weapons: Q2MissionPackMonsterWeapons): Q2MonsterDefinition {
  const run = (context: MonsterContext): undefined => context.setMove(context.state.standGround ? "gladb_move_stand" : "gladb_move_run");
  function fire(context: MonsterContext): undefined {
    const start = projectFlash(context, muzzleOffset(context.game.options.edition, 61));
    weapons.firePlasma(context.entity, context.game, start, normalize(subtract(context.state.blindFireTarget, start)), 100, 725, 60, 60);
    return undefined;
  }
  return {
    classname: "monster_gladb", kind: "gladb", model: "models/monsters/gladb/tris.md2", health: 800, gibHealth: -175, mass: 350,
    bounds: { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: 64 } }, scale: 1,
    initialMove: "gladb_move_stand", moves: gladbMoves, stand: move("gladb_move_stand"), walk: move("gladb_move_walk"), run,
    initialize(context) { return monsterPowerArmor(context, "shield", 400); },
    restore: restoreMonsterPowerArmor,
    sight: sound("gladiator/sight.wav"), idle: sound("gladiator/gldidle1.wav", 2, 2), search: sound("gladiator/gldsrch1.wav"),
    melee: move("gladb_move_attack_melee"),
    attack(context) {
      const eye = enemyEye(context); if (eye === null || targetDistance(context) <= 112) return undefined;
      context.game.sound(context.entity, "weapons/plasshot.wav", 1); context.state.blindFireTarget = eye;
      return context.setMove("gladb_move_attack_gun");
    },
    pain(context) {
      damagedSkin(context);
      const airborne = context.game.body(context.entity).velocity.z > 100;
      if (context.game.host.now() < context.state.painTime) { if (airborne && context.state.move.name === "gladb_move_pain") context.setMove("gladb_move_pain_air"); return undefined; }
      context.state.painTime = context.game.host.now() + 3;
      context.game.sound(context.entity, context.game.host.random() < 0.5 ? "gladiator/pain.wav" : "gladiator/gldpain2.wav", 2);
      return context.setMove(airborne ? "gladb_move_pain_air" : "gladb_move_pain");
    },
    die(context, reaction) { return beginDeath(context, reaction, "gladiator/glddeth2.wav", "gladb_move_death"); },
    callbacks: {
      gladb_run: run, gladb_dead: finishCorpse, gladb_cleaver_swing: sound("gladiator/melee1.wav", 1),
      GladbMelee(context) {
        const hit = context.weapons.fireHit(context.entity, context.game, { x: 80, y: context.game.body(context.entity).bounds.min.x, z: -4 }, 20 + Math.floor(context.game.host.random() * 5), 300);
        return context.game.sound(context.entity, hit ? "gladiator/melee2.wav" : "gladiator/melee3.wav", 0);
      },
      gladbGun: fire, gladbGun_check(context) { return context.game.options.skill === 3 ? fire(context) : undefined; },
    },
  };
}
