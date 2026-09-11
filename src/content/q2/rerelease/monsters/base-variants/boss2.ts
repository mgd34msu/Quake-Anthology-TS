// Rerelease m_boss2.cpp, including the N64 attacks. ZeniMax Media, GPL-2.0.
import { boss2Definition } from "../../../base/monsters/boss2.ts";
import { stopLoop } from "../../../base/monsters/boss-common.ts";
import { add, length, normalize, scale, subtract, zero } from "../../../foundation/fields.ts";
import { anglesVectors, enemyBody, health, inFront, projectFlash, targetDistance } from "../../../foundation/monsters/ai.ts";
import { throwGib } from "../../../foundation/monsters/gibs.ts";
import { muzzleOffset } from "../../../foundation/monsters/muzzle.ts";
import { defaultCheckAttack } from "../../../foundation/monsters/perception.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../../foundation/monsters/types.ts";
import { bossExplode, bossExplodeThink } from "../boss.ts";
import { checkGib, monsterFlash, predictedDirection, reactsToPain } from "../common.ts";
import { boss2Moves } from "../tables/boss2.ts";
import { rereleaseFlash } from "../tables/flashes.ts";

function attackMachinegun(context: MonsterContext): undefined { return context.setMove((context.entity.spawnflags & 8) !== 0 ? "boss2_move_attack_hb" : "boss2_move_attack_mg"); }
function fireRocket(context: MonsterContext, predictive: boolean): undefined {
  const { entity, game } = context, enemy = enemyBody(context); if (enemy === null) return undefined;
  const right = anglesVectors(game.body(entity).angles).right;
  for (const shot of [{ flash: 78, lead: -0.1, spread: 0.4, lower: true }, { flash: 79, lead: -0.05, spread: 0.025, lower: false }, { flash: 80, lead: 0.05, spread: -0.025, lower: false }, { flash: 81, lead: 0.1, spread: -0.4, lower: true }]) {
    const start = projectFlash(context, muzzleOffset("rerelease", shot.flash));
    const direction = predictive ? predictedDirection(context, start, 750, false, shot.lead) : normalize(add(normalize(subtract({ ...enemy.origin, z: enemy.origin.z - (shot.lower ? 15 : 0) }, start)), scale(right, shot.spread)));
    if (direction === null) continue;
    context.weapons.fireRocket(entity, game, start, direction, 50, predictive ? 750 : 500, 70, 50); monsterFlash(context, shot.flash, start, direction);
  }
  return undefined;
}
function bullet(context: MonsterContext, flash: number): undefined {
  const start = projectFlash(context, muzzleOffset("rerelease", flash)), direction = predictedDirection(context, start, 0, true, -0.2);
  if (direction === null) return undefined;
  context.weapons.fireBullet(context.entity, context.game, start, direction, 6, 4, 900, 500, 0); return monsterFlash(context, flash, start, direction);
}
function gib(context: MonsterContext): undefined {
  const { entity, game, state } = context;
  game.host.emit({ kind: "effect", effect: "q2:explosion1-big", origin: game.body(entity).origin, direction: zero, count: 1, color: 0 }); stopLoop(context);
  entity.skin = Math.trunc(entity.skin / 2); entity.gravityVector = { ...entity.gravityVector, z: -1 };
  for (let i = 0; i < 2; i++) throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", 500);
  for (let i = 0; i < 2; i++) throwGib(entity, game, "models/objects/gibs/sm_metal/tris.md2", 500, { metallic: true });
  for (const part of ["chest", "engine", "spine"]) throwGib(entity, game, `models/monsters/boss2/gibs/${part}.md2`, 500, { skinned: true });
  for (const part of ["chaingun", "chaingun", "cpu", "rocket", "wing", "wing"]) throwGib(entity, game, `models/monsters/boss2/gibs/${part}.md2`, 500, { skinned: true, upright: true });
  for (const factor of [1, 2, 1.35]) for (const part of ["larm", "rarm"]) {
    const piece = throwGib(entity, game, `models/monsters/boss2/gibs/${part}.md2`, 500, { skinned: true, upright: true });
    if (piece !== null) { piece.scale = (entity.scale || 1) * factor; game.show(piece); }
  }
  throwGib(entity, game, "models/monsters/boss2/gibs/head.md2", 500, { skinned: true, metallic: true, head: true }); state.dead = true; state.gibbed = true; return undefined;
}
export const rereleaseBoss2Definition: Q2MonsterDefinition = {
  ...boss2Definition, moves: boss2Moves, yawSpeed: 50, sourceCallbacks: { think: { BossExplode_think: bossExplodeThink } },
  checkAttack: context => defaultCheckAttack(context, { standGround: 0.4, melee: 0.8, near: 0.8, mid: 0.8, far: 0, strafeScalar: 0 }),
  initialize(context) { context.state.ignoreShots = true; return boss2Definition.initialize?.(context); },
  attack(context) {
    if (enemyBody(context) === null) return undefined;
    const gun = targetDistance(context) <= 125 || context.game.host.random() <= 0.6, n64 = (context.entity.spawnflags & 8) !== 0;
    return context.setMove(gun ? n64 ? "boss2_move_attack_hb" : "boss2_move_attack_pre_mg" : n64 ? "boss2_move_attack_rocket2" : "boss2_move_attack_rocket");
  },
  pain(context, reaction) {
    const { entity, game, state } = context;
    entity.skin = health(game, entity.actor.id) < entity.maxHealth / 2 ? 1 : 0;
    if (game.host.now() < state.painTime) return undefined;
    state.painTime = game.host.now() + 3; game.sound(entity, reaction.damage < 10 ? "bosshovr/bhvpain3.wav" : reaction.damage < 30 ? "bosshovr/bhvpain1.wav" : "bosshovr/bhvpain2.wav", 2, 1, 0);
    if (!reactsToPain(context)) return undefined;
    return context.setMove(reaction.damage < 30 ? "boss2_move_pain_light" : "boss2_move_pain_heavy");
  },
  die(context) {
    const { entity, game, state } = context;
    if ((entity.spawnflags & 65536) !== 0) { if (checkGib(context)) return gib(context); if (state.dead) return undefined; }
    else {
      game.sound(entity, "bosshovr/bhvdeth1.wav", 2, 1, 0); state.dead = true; state.canTakeDamage = false; entity.count = 0;
      game.host.combat.setTraits(entity.actor, { canTakeDamage: false }); game.move(entity, { velocity: zero }); entity.gravityVector = { ...entity.gravityVector, z: entity.gravityVector.z * 0.3 };
    }
    return context.setMove("boss2_move_death");
  },
  callbacks: {
    ...boss2Definition.callbacks, BossExplode: bossExplode, boss2_attack_mg: attackMachinegun,
    boss2_reattack_mg(context) { return context.entity.enemy !== null && inFront(context, context.entity.enemy) && context.game.host.random() <= 0.7 ? attackMachinegun(context) : context.setMove("boss2_move_attack_post_mg"); },
    Boss2PredictiveRocket: context => fireRocket(context, true),
    Boss2Rocket(context) { return fireRocket(context, context.entity.enemy !== null && context.game.host.isPlayer(context.entity.enemy) && context.game.host.random() < 0.9); },
    Boss2Rocket64(context) {
      const { entity, game } = context, enemy = enemyBody(context); if (enemy === null) return undefined;
      const right = anglesVectors(game.body(entity).angles).right, size = entity.scale || 1;
      let start = projectFlash(context, muzzleOffset("rerelease", 78));
      start = subtract({ ...start, z: start.z + 10 * size }, scale(right, (2 + entity.count++ % 4 * 8) * size));
      const target = entity.enemy !== null && game.host.isPlayer(entity.enemy) && game.host.random() < 0.9
        ? add(enemy.origin, scale(enemy.velocity, length(subtract(enemy.origin, start)) / 750 - 0.3)) : { ...enemy.origin, z: enemy.origin.z - 15 };
      const direction = normalize(subtract(target, start)); context.weapons.fireRocket(entity, game, start, direction, 35, 750, 55, 35); return monsterFlash(context, 78, start, direction);
    },
    boss2_firebullet_left: context => bullet(context, 73), boss2_firebullet_right: context => bullet(context, 133),
    Boss2MachineGun(context) { bullet(context, 73); return bullet(context, 133); },
    Boss2HyperBlaster(context) {
      const enemy = enemyBody(context); if (enemy === null) return undefined;
      const id = (context.entity.frame & 1) !== 0 ? rereleaseFlash.BOSS2_MACHINEGUN_L2 : rereleaseFlash.BOSS2_MACHINEGUN_R2;
      const start = projectFlash(context, muzzleOffset("rerelease", id)), target = { ...enemy.origin, z: enemy.origin.z + (context.game.entity(context.entity.enemy)?.viewHeight ?? 22) }, direction = normalize(subtract(target, start));
      context.weapons.fireBlaster(context.entity, context.game, start, direction, 2, 1000, context.entity.frame % 4 === 0 ? 64 : 0); return monsterFlash(context, id, start, direction);
    },
    boss2_shrink(context) { const body = context.game.body(context.entity); return context.game.move(context.entity, { bounds: { ...body.bounds, max: { ...body.bounds.max, z: 50 } } }); },
    boss2_dead(context) {
      if ((context.entity.spawnflags & 65536) !== 0) { context.state.dead = false; context.state.canTakeDamage = true; return context.game.host.combat.setTraits(context.entity.actor, { canTakeDamage: true }); }
      return gib(context);
    },
  },
};
