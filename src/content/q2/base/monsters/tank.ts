/* Quake II m_tank.c. id Software, GPL-2.0-or-later. */
import { subtract } from "../../foundation/fields.ts";
import { anglesVectors, enemyEye, health, projectFlash, targetDistance, vectorAngles, visible } from "../../foundation/monsters/ai.ts";
import { throwGib } from "../../foundation/monsters/gibs.ts";
import { muzzleOffset } from "../../foundation/monsters/muzzle.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { aliveEnemy, finishCorpse, move, muzzle, shot, sound } from "./common.ts";
import { tankFrame, tankMoves } from "./tables/tank.ts";

function run(context: MonsterContext): undefined {
  context.state.brutal = context.entity.enemy !== null && context.game.host.isPlayer(context.entity.enemy);
  return context.setMove(context.state.standGround ? "tank_move_stand" : ["tank_move_walk", "tank_move_start_run"].includes(context.state.move.name) ? "tank_move_run" : "tank_move_start_run");
}
export const tankDefinition: Q2MonsterDefinition = {
  classname: "monster_tank", kind: "tank", model: "models/monsters/tank/tris.md2", health: 750, gibHealth: -200, mass: 500,
  bounds: { min: { x: -32, y: -32, z: -16 }, max: { x: 32, y: 32, z: 72 } }, scale: 1,
  initialMove: "tank_move_stand", moves: tankMoves, stand: move("tank_move_stand"), walk: move("tank_move_walk"), run,
  sight: sound("tank/sight1.wav"), idle: sound("tank/tnkidle1.wav", 2, 2),
  attack(context) {
    if (health(context.game, context.entity.enemy) < 0) { context.state.brutal = false; return context.setMove("tank_move_attack_strike"); }
    const range = targetDistance(context), r = context.game.host.random();
    if (range <= 125) return context.setMove(r < 0.4 ? "tank_move_attack_chain" : "tank_move_attack_blast");
    if (range <= 250) return context.setMove(r < 0.5 ? "tank_move_attack_chain" : "tank_move_attack_blast");
    if (r < 0.33) return context.setMove("tank_move_attack_chain");
    if (r < 0.66) { context.state.painTime = context.game.host.now() + 5; return context.setMove("tank_move_attack_pre_rocket"); }
    return context.setMove("tank_move_attack_blast");
  },
  pain(context, reaction) {
    if (health(context.game, context.entity.actor.id) < context.entity.maxHealth / 2) context.entity.skin |= 1;
    if (reaction.damage <= 10 || context.game.host.now() < context.state.painTime) return undefined;
    if (reaction.damage <= 30 && context.game.host.random() > 0.2) return undefined;
    const frame = context.entity.frame;
    if (context.game.options.skill >= 2 && (frame >= tankFrame.attak301 && frame <= tankFrame.attak330 || frame >= tankFrame.attak101 && frame <= tankFrame.attak116)) return undefined;
    context.state.painTime = context.game.host.now() + 3;
    context.game.sound(context.entity, "tank/tnkpain2.wav", 2);
    if (context.game.options.skill === 3) return undefined;
    return context.setMove(reaction.damage <= 30 ? "tank_move_pain1" : reaction.damage <= 60 ? "tank_move_pain2" : "tank_move_pain3");
  },
  die(context, reaction) {
    const { entity, game, state } = context;
    if (health(game, entity.actor.id) <= state.gibHealth) {
      game.sound(entity, "misc/udeath.wav", 2);
      throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", reaction.damage);
      for (let i = 0; i < 4; i++) throwGib(entity, game, "models/objects/gibs/sm_metal/tris.md2", reaction.damage, { metallic: true });
      throwGib(entity, game, "models/objects/gibs/chest/tris.md2", reaction.damage);
      throwGib(entity, game, "models/objects/gibs/gear/tris.md2", reaction.damage, { metallic: true, head: true });
      state.dead = true; state.gibbed = true;
      return undefined;
    }
    if (state.dead) return undefined;
    game.sound(entity, "tank/death.wav", 2);
    state.dead = true; state.canTakeDamage = true; game.host.combat.setTraits(entity.actor, { canTakeDamage: true });
    return context.setMove("tank_move_death");
  },
  callbacks: {
    tank_stand: move("tank_move_stand"), tank_walk: move("tank_move_walk"), tank_run: run,
    tank_footstep: sound("tank/step.wav", 4), tank_thud: sound("tank/tnkdeth2.wav", 4), tank_windup: sound("tank/tnkatck4.wav", 1), TankStrike: sound("tank/tnkatck5.wav", 1),
    tank_dead(context) { return finishCorpse(context, { min: { x: -16, y: -16, z: -16 }, max: { x: 16, y: 16, z: 0 } }); },
    tank_poststrike(context) { context.entity.enemy = null; return run(context); },
    tank_doattack_rocket: move("tank_move_attack_fire_rocket"),
    tank_reattack_blaster(context) { return context.setMove(context.game.options.skill >= 2 && visible(context) && aliveEnemy(context) && context.game.host.random() <= 0.6 ? "tank_move_reattack_blast" : "tank_move_attack_post_blast"); },
    tank_refire_rocket(context) { return context.setMove(context.game.options.skill >= 2 && aliveEnemy(context) && visible(context) && context.game.host.random() <= 0.4 ? "tank_move_attack_fire_rocket" : "tank_move_attack_post_rocket"); },
    TankBlaster(context) {
      const flash = context.entity.frame === tankFrame.attak110 ? 1 : context.entity.frame === tankFrame.attak113 ? 2 : 3;
      const aim = shot(context, flash); if (aim === null) return undefined;
      context.weapons.fireBlaster(context.entity, context.game, aim.start, aim.direction, 30, 800, 8);
      return muzzle(context, flash, aim.direction, aim.start);
    },
    TankRocket(context) {
      const flash = context.entity.frame === tankFrame.attak324 ? 23 : context.entity.frame === tankFrame.attak327 ? 24 : 25;
      const aim = shot(context, flash); if (aim === null) return undefined;
      context.weapons.fireRocket(context.entity, context.game, aim.start, aim.direction, 50, 550, 70, 50);
      return muzzle(context, flash, aim.direction, aim.start);
    },
    TankMachineGun(context) {
      const frame = context.entity.frame, flash = 4 + frame - tankFrame.attak406;
      const start = projectFlash(context, muzzleOffset(context.game.options.edition, flash));
      const eye = enemyEye(context), angles = context.game.body(context.entity).angles;
      const direction = anglesVectors({ x: eye === null ? 0 : vectorAngles(subtract(eye, start)).x, y: frame <= tankFrame.attak415 ? angles.y - 8 * (frame - tankFrame.attak411) : angles.y + 8 * (frame - tankFrame.attak419), z: 0 }).forward;
      context.weapons.fireBullet(context.entity, context.game, start, direction, 20, 4, 300, 500, 0);
      return muzzle(context, flash, direction, start);
    },
  },
};

export const tankCommanderDefinition: Q2MonsterDefinition = { ...tankDefinition, classname: "monster_tank_commander", health: 1000, gibHealth: -225, initialize(context) { context.entity.skin = 2; return undefined; } };
