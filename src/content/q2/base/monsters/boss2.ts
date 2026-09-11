/* Quake II m_boss2.c. id Software, GPL-2.0-or-later. */
import { inFront, targetDistance } from "../../foundation/monsters/ai.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { damagedSkin, finishCorpse, loopSound, move, muzzle, shot, sound } from "./common.ts";
import { bossCheckAttack, bossExplode } from "./boss-common.ts";
import { boss2Moves } from "./tables/boss2.ts";

function run(context: MonsterContext): undefined { return context.setMove(context.state.standGround ? "boss2_move_stand" : "boss2_move_run"); }
export const boss2Definition: Q2MonsterDefinition = {
  classname: "monster_boss2", kind: "boss2", model: "models/monsters/boss2/tris.md2", health: 2000, gibHealth: -200, mass: 1000,
  bounds: { min: { x: -56, y: -56, z: 0 }, max: { x: 56, y: 56, z: 80 } }, scale: 1, locomotion: "fly",
  initialMove: "boss2_move_stand", moves: boss2Moves, stand: move("boss2_move_stand"), walk: move("boss2_move_walk"), run,
  attack(context) { return context.setMove(targetDistance(context) <= 125 || context.game.host.random() <= 0.6 ? "boss2_move_attack_pre_mg" : "boss2_move_attack_rocket"); },
  checkAttack(context) { return bossCheckAttack(context, true); }, search: sound("bosshovr/bhvunqv1.wav"),
  initialize(context) { context.entity.laserImmune = true; return loopSound(context, "bosshovr/bhvengn1.wav"); },
  pain(context, reaction) {
    damagedSkin(context);
    if (context.game.host.now() < context.state.painTime) return undefined;
    context.state.painTime = context.game.host.now() + 3;
    context.game.sound(context.entity, reaction.damage < 10 ? "bosshovr/bhvpain3.wav" : reaction.damage < 30 ? "bosshovr/bhvpain1.wav" : "bosshovr/bhvpain2.wav", 2, 1, 0);
    return context.setMove(reaction.damage < 30 ? "boss2_move_pain_light" : "boss2_move_pain_heavy");
  },
  die(context) {
    context.game.sound(context.entity, "bosshovr/bhvdeth1.wav", 2, 1, 0);
    context.state.dead = true; context.state.canTakeDamage = false; context.entity.count = 0;
    context.game.host.combat.setTraits(context.entity.actor, { canTakeDamage: false });
    return context.setMove("boss2_move_death");
  },
  callbacks: {
    boss2_run: run, boss2_attack_mg: move("boss2_move_attack_mg"), BossExplode: bossExplode,
    boss2_dead(context) { return finishCorpse(context, { min: { x: -56, y: -56, z: 0 }, max: { x: 56, y: 56, z: 80 } }); },
    boss2_reattack_mg(context) { return context.setMove(context.entity.enemy !== null && inFront(context, context.entity.enemy) && context.game.host.random() <= 0.7 ? "boss2_move_attack_mg" : "boss2_move_attack_post_mg"); },
    Boss2MachineGun(context) {
      for (const flash of [73, 133]) {
        const aim = shot(context, flash, -0.2); if (aim === null) return undefined;
        context.weapons.fireBullet(context.entity, context.game, aim.start, aim.direction, 6, 4, 300, 500, 0);
        muzzle(context, flash, aim.direction, aim.start);
      }
      return undefined;
    },
    Boss2Rocket(context) {
      for (const flash of [78, 79, 80, 81]) {
        const aim = shot(context, flash); if (aim === null) return undefined;
        context.weapons.fireRocket(context.entity, context.game, aim.start, aim.direction, 50, 500, 70, 50);
        muzzle(context, flash, aim.direction, aim.start);
      }
      return undefined;
    },
  },
};
