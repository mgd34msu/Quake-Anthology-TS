/* Quake II Xatrix base monster variants. ZeniMax Media, GPL-2.0-or-later. */
import type { Vec3 } from "../../../../contracts/math.ts";
import { add, length, normalize, scale, subtract, zero } from "../../foundation/fields.ts";
import { anglesVectors, enemyBody, health, projectFlash, targetDistance, vectorAngles, visible } from "../../foundation/monsters/ai.ts";
import { infantryAttack, infantryCallbacks, infantryDie, infantryPain, infantryRun, infantrySight, infantryStand, infantryWalk } from "../../foundation/monsters/infantry.ts";
import type { Q2Monsters } from "../../foundation/monsters/index.ts";
import { muzzleOffset } from "../../foundation/monsters/muzzle.ts";
import { recordAt } from "../../foundation/monsters/types.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { brainDefinition } from "../../base/monsters/brain.ts";
import { damagedSkin, humanoidBounds, move } from "../../base/monsters/common.ts";
import { supertankDefinition } from "../../base/monsters/supertank.ts";
import { withBossExplosionCallbacks } from "../../base/monsters/boss-common.ts";
import { monsterFlash } from "../../rerelease/monsters/common.ts";
import { monsterDabeam, monsterDabeamCallbacks } from "./dabeam.ts";
import { monsterPowerArmor, restoreMonsterPowerArmor } from "./power-armor.ts";
import { brainFrame, brainMoves } from "./tables/xatrix-brain.ts";
import { infantryFrame, infantryMoves } from "./tables/xatrix-infantry.ts";

export const xatrixBrainRightEye: readonly Vec3[] = [
  {x:0.7467,y:0.23837,z:34.16769},{x:-1.07639,y:0.23837,z:33.386372},{x:-1.3355,y:5.3343,z:32.17717},
  {x:-0.17536,y:8.84637,z:30.635479},{x:-2.75759,y:7.80461,z:30.15086},{x:-5.57509,y:5.15284,z:30.05616},
  {x:-7.01755,y:3.26247,z:30.552521},{x:-7.91574,y:0.6388,z:33.176189},{x:-3.91539,y:8.28573,z:33.976349},
  {x:-0.91354,y:10.93303,z:34.141811},{x:-0.3699,y:8.9239,z:34.189079},
];
export const xatrixBrainLeftEye: readonly Vec3[] = [
  {x:-3.36471,y:0.32775,z:33.938381},{x:-5.14045,y:0.49348,z:32.659851},{x:-5.34198,y:5.64698,z:31.277901},
  {x:-4.13448,y:9.27744,z:29.925621},{x:-6.59834,y:6.81509,z:29.32262},{x:-8.61084,y:2.52965,z:29.251591},
  {x:-9.23136,y:0.09328,z:29.747959},{x:-11.00411,y:1.93693,z:32.39526},{x:-7.87831,y:7.64819,z:33.148151},
  {x:-4.94737,y:11.43005,z:33.31361},{x:-4.33282,y:9.44457,z:33.52634},
];
function tongueAllowed(start: Vec3, end: Vec3): boolean {
  const direction = subtract(start, end); if (length(direction) > 512) return false;
  let pitch = vectorAngles(direction).x; if (pitch < -180) pitch += 360;
  return Math.abs(pitch) <= 30;
}

export const xatrixBrainDefinition: Q2MonsterDefinition = {
  ...brainDefinition, moves: brainMoves, hasRangedAttack: true, sourceCallbacks: monsterDabeamCallbacks,
  attack(context) {
    if (context.game.host.random() >= 0.8) return undefined;
    const distance = targetDistance(context);
    if (distance >= 80 && distance < 500) return context.setMove(context.game.host.random() < 0.5 ? "brain_move_attack3" : "brain_move_attack4");
    return distance >= 500 ? context.setMove("brain_move_attack4") : undefined;
  },
  pain(context) {
    damagedSkin(context);
    if (context.game.host.now() < context.state.painTime) return undefined;
    context.state.painTime = context.game.host.now() + 3;
    const random = context.game.host.random();
    context.game.sound(context.entity, random < 0.33 || random >= 0.66 ? "brain/brnpain1.wav" : "brain/brnpain2.wav", 2);
    return context.setMove(random < 0.33 ? "brain_move_pain1" : random < 0.66 ? "brain_move_pain2" : "brain_move_pain3");
  },
  callbacks: {
    ...brainDefinition.callbacks,
    brain_tounge_attack(context) {
      const { game, entity } = context, enemy = enemyBody(context);
      if (enemy === null || entity.enemy === null) return undefined;
      const start = projectFlash(context, { x: 24, y: 0, z: 16 });
      if (!tongueAllowed(start, enemy.origin) && !tongueAllowed(start, { ...enemy.origin, z: enemy.origin.z + enemy.bounds.max.z - 8 }) && !tongueAllowed(start, { ...enemy.origin, z: enemy.origin.z + enemy.bounds.min.z + 8 })) return undefined;
      const trace = game.host.trace({ start, end: enemy.origin, bounds: null, ignore: entity.actor.id, mask: 0x6000003 });
      if (trace.hit.kind !== "actor" || trace.hit.actor !== entity.enemy) return undefined;
      game.sound(entity, "brain/brnatck3.wav", 1);
      game.host.emit({ kind: "monster-beam", effect: "parasite", actor: entity.actor.id, start, end: enemy.origin });
      game.damage(entity.enemy, entity, entity.actor.id, 5, 0, subtract(start, enemy.origin), enemy.origin, zero, 36, 8);
      const body = game.body(entity); game.move(entity, { origin: { ...body.origin, z: body.origin.z + 1 } }, false);
      const target = game.host.actors.resolveOwned(entity.enemy);
      if (target !== null) game.host.bodies.write(target, { ...enemy, velocity: scale(anglesVectors(body.angles).forward, -1200) });
      return undefined;
    },
    brain_laserbeam(context) {
      const { game, entity } = context;
      if (game.host.random() > 0.8) game.sound(entity, "misc/lasfly.wav", 0, 1, 3);
      const enemy = enemyBody(context); if (enemy === null) return undefined;
      const origin = game.body(entity).origin, angles = vectorAngles(subtract(enemy.origin, origin)), basis = anglesVectors(angles);
      for (const eye of [xatrixBrainRightEye, xatrixBrainLeftEye]) {
        const offset = recordAt(eye, entity.frame - brainFrame.walk101);
        const start = add(origin, add(scale(basis.right, offset.x), add(scale(basis.forward, offset.y), scale(basis.up, offset.z))));
        monsterDabeam(entity, game, entity.enemy, start, angles, 1, false);
      }
      return undefined;
    },
    brain_laserbeam_reattack(context) {
      if (context.game.host.random() < 0.5 && visible(context) && health(context.game, context.entity.enemy) > 0) context.entity.frame = brainFrame.walk101;
      return undefined;
    },
  },
};

function xatrixInfantryFire(context: MonsterContext): undefined {
  if (context.entity.frame !== infantryFrame.attak103) return infantryCallbacks.InfantryMachineGun(context);
  const { entity, game } = context, enemy = enemyBody(context), start = projectFlash(context, muzzleOffset(game.options.edition, 26));
  const direction = enemy === null ? anglesVectors(game.body(entity).angles).forward : normalize(subtract(add(add(enemy.origin, scale(enemy.velocity, -0.2)), { x: 0, y: 0, z: game.entity(entity.enemy)?.viewHeight ?? 22 }), start));
  context.weapons.fireBullet(entity, game, start, direction, 3, 4, 300, 500, 0);
  return monsterFlash(context, 26, start, direction);
}
export const xatrixInfantryDefinition: Q2MonsterDefinition = {
  classname: "monster_infantry", kind: "infantry", model: "models/monsters/infantry/tris.md2", health: 100, gibHealth: -40, mass: 200,
  bounds: humanoidBounds, scale: 1, initialMove: "infantry_move_stand", moves: infantryMoves,
  stand: infantryStand, walk: infantryWalk, run: infantryRun, attack: infantryAttack, sight: infantrySight, pain: infantryPain, die: infantryDie,
  idle(context) { context.game.sound(context.entity, "infantry/infidle1.wav", 2, 1, 2); return context.setMove("infantry_move_fidget"); },
  dodge(context, attacker) { if (context.game.host.random() > 0.25) return undefined; context.entity.enemy ??= attacker; return context.setMove("infantry_move_duck"); },
  callbacks: {
    ...infantryCallbacks, InfantryMachineGun: xatrixInfantryFire,
    infantry_set_firetime(context) { context.state.pauseTime = context.game.host.now() + (Math.floor(context.game.host.random() * 16) + 5) * 0.1; return undefined; },
    infantry_cock_gun(context) { return context.game.sound(context.entity, "infantry/infatck3.wav", 1); },
    infantry_fire(context) { xatrixInfantryFire(context); context.state.holdFrame = context.game.host.now() < context.state.pauseTime; return undefined; },
  },
};
export function createXatrixBaseVariants(monsters: Q2Monsters): readonly Q2MonsterDefinition[] {
  return [xatrixBrainDefinition, xatrixInfantryDefinition, withBossExplosionCallbacks({
    ...supertankDefinition,
    initialize(context) { return (context.entity.spawnflags & 8) !== 0 ? monsterPowerArmor(context, "shield", 400) : undefined; },
    restore(context) { return (context.entity.spawnflags & 8) !== 0 ? restoreMonsterPowerArmor(context) : undefined; },
    stand: move("supertank_move_stand"),
  }, monsters)];
}
