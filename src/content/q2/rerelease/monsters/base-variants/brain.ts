// Rerelease m_brain.cpp. ZeniMax Media, GPL-2.0.
import type { Vec3 } from "../../../../../contracts/math.ts";
import { brainDefinition } from "../../../base/monsters/brain.ts";
import { add, length, numberField, scale, subtract, zero } from "../../../foundation/fields.ts";
import type { Q2Think } from "../../../foundation/host.ts";
import { anglesVectors, corpse, enemyBody, health, projectFlash, setDuck, targetDistance, vectorAngles, visible } from "../../../foundation/monsters/ai.ts";
import { throwGib } from "../../../foundation/monsters/gibs.ts";
import type { Q2Monsters } from "../../../foundation/monsters/index.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../../foundation/monsters/types.ts";
import { monsterPowerArmor, restoreMonsterPowerArmor } from "../../../missionpacks/monsters/power-armor.ts";
import { xatrixBrainLeftEye, xatrixBrainRightEye } from "../../../missionpacks/monsters/xatrix-variants.ts";
import { fireMonsterBeam, freeMonsterBeam, updateMonsterBeam } from "../beam.ts";
import { checkGib, predictedDirection, reactsToPain } from "../common.ts";
import { brainFrame, brainMoves } from "../tables/brain.ts";

function screen(context: MonsterContext, active: boolean): undefined {
  const { entity, game } = context, cells = game.host.inventory.count(entity.actor.id, "q2:monster-power");
  return game.host.combat.setArmor(entity.actor, { kind: "q2", points: 0, normalProtection: 0, energyProtection: 0, item: "q2:monster-power", powerArmor: active ? { kind: "screen", cells } : { kind: "none" } });
}
function run(context: MonsterContext): undefined { screen(context, true); return context.setMove(context.state.standGround ? "brain_move_stand" : "brain_move_run"); }
function tongueAllowed(start: Vec3, end: Vec3): boolean {
  const direction = subtract(start, end); if (length(direction) > 512) return false;
  let pitch = vectorAngles(direction).x; if (pitch < -180) pitch += 360;
  return Math.abs(pitch) <= 30;
}
function hit(context: MonsterContext, right: boolean): undefined {
  const { entity, game } = context, bounds = game.body(entity).bounds;
  if (context.weapons.fireHit(entity, game, { x: 80, y: right ? bounds.max.x : bounds.min.x, z: 8 }, 15 + Math.floor(game.host.random() * 5), 40)) game.sound(entity, "brain/melee3.wav", 1);
  else context.state.meleeTime = game.host.now() + 3;
  return undefined;
}
export function createRereleaseBrainDefinition(monsters: Q2Monsters): Q2MonsterDefinition {
  function eye(positions: readonly Vec3[], update: boolean): Q2Think {
    return (beam, game) => {
      const context = beam.owner === null ? null : monsters.context(beam.owner);
      if (context === null) return freeMonsterBeam(beam, game);
      const position = positions[context.entity.frame - brainFrame.walk101];
      if (position === undefined) return freeMonsterBeam(beam, game);
      const body = game.body(context.entity), axes = anglesVectors(body.angles), start = add(add(add(body.origin, scale(axes.right, position.x)), scale(axes.forward, position.y)), scale(axes.up, position.z));
      const direction = predictedDirection(context, start, 0, false, 0.1 + game.host.random() * 0.1);
      if (direction === null) return undefined;
      game.move(beam, { origin: start }); beam.movedir = direction;
      return update ? updateMonsterBeam(beam, game, false) : undefined;
    };
  }
  const rightEye = eye(xatrixBrainRightEye, false), leftEye = eye(xatrixBrainLeftEye, true);
  return {
    classname: brainDefinition.classname, kind: brainDefinition.kind, model: brainDefinition.model, health: 300, gibHealth: -150, mass: 400, bounds: brainDefinition.bounds, scale: 1,
    initialMove: brainDefinition.initialMove, moves: brainMoves, stand: brainDefinition.stand, walk: brainDefinition.walk, run,
    sight: context => context.game.sound(context.entity, "brain/brnsght1.wav", 2), search: context => context.game.sound(context.entity, "brain/brnsrch1.wav", 2),
    idle(context) { context.game.sound(context.entity, "brain/brnlens1.wav", 0, 1, 2); return context.setMove("brain_move_idle"); },
    melee: context => context.setMove(context.game.host.random() <= 0.5 ? "brain_move_attack1" : "brain_move_attack2"), hasRangedAttack: true,
    sourceCallbacks: { think: { "rerelease.brain.right_eye_update": rightEye, "rerelease.brain.left_eye_update": leftEye, beam_think: freeMonsterBeam } },
    initialize(context) {
      const type = numberField(context.entity.spawn, "power_armor_type", 1), cells = numberField(context.entity.spawn, "power_armor_power", 100);
      monsterPowerArmor(context, type === 2 ? "shield" : "screen", cells); return type === 0 ? screen(context, false) : undefined;
    },
    restore: restoreMonsterPowerArmor,
    attack(context) {
      if (targetDistance(context) <= 440) {
        if (context.game.host.random() < 0.5) return context.setMove("brain_move_attack3");
        if ((context.entity.spawnflags & 8) === 0) return context.setMove("brain_move_attack4");
      } else if ((context.entity.spawnflags & 8) === 0) return context.setMove("brain_move_attack4");
      return undefined;
    },
    duck(context) { context.setMove("brain_move_duck"); return true; },
    pain(context) {
      const { game, entity, state } = context;
      entity.skin = health(game, entity.actor.id) < entity.maxHealth / 2 ? 1 : 0;
      if (game.host.now() < state.painTime) return undefined;
      state.painTime = game.host.now() + 3; const choice = game.host.random();
      game.sound(entity, choice < 0.33 || choice >= 0.66 ? "brain/brnpain1.wav" : "brain/brnpain2.wav", 2);
      if (!reactsToPain(context)) return undefined;
      context.setMove(choice < 0.33 ? "brain_move_pain1" : choice < 0.66 ? "brain_move_pain2" : "brain_move_pain3");
      if (state.ducked) setDuck(context, false); return undefined;
    },
    die(context, reaction) {
      const { entity, game, state } = context; entity.effects = 0; screen(context, false);
      if (checkGib(context)) {
        game.sound(entity, "misc/udeath.wav", 2); entity.skin = Math.trunc(entity.skin / 2);
        const first = game.entity(entity.beam), second = game.entity(entity.beam2); if (first !== null) freeMonsterBeam(first, game); if (second !== null) freeMonsterBeam(second, game);
        throwGib(entity, game, "models/objects/gibs/bone/tris.md2", reaction.damage);
        for (let i = 0; i < 2; i++) throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", reaction.damage);
        for (const part of ["arm", "arm", "boot", "door", "door"]) throwGib(entity, game, `models/monsters/brain/gibs/${part}.md2`, reaction.damage, { skinned: true, upright: true });
        for (const part of ["pelvis", "chest"]) throwGib(entity, game, `models/monsters/brain/gibs/${part}.md2`, reaction.damage, { skinned: true });
        throwGib(entity, game, "models/monsters/brain/gibs/head.md2", reaction.damage, { skinned: true, head: true }); state.dead = true; state.gibbed = true; return undefined;
      }
      if (state.dead) return undefined;
      game.sound(entity, "brain/brndeth1.wav", 2); state.dead = true; state.canTakeDamage = true; game.host.combat.setTraits(entity.actor, { canTakeDamage: true });
      return context.setMove(game.host.random() <= 0.5 ? "brain_move_death1" : "brain_move_death2");
    },
    callbacks: {
      ...brainDefinition.callbacks, brain_run: run, brain_dead: corpse,
      brain_hit_right: context => hit(context, true), brain_hit_left: context => hit(context, false),
      brain_chest_open(context) { context.entity.count = 0; screen(context, false); return context.game.sound(context.entity, "brain/brnatck1.wav", 4); },
      brain_tentacle_attack(context) {
        if (context.weapons.fireHit(context.entity, context.game, { x: 80, y: 0, z: 8 }, 10 + Math.floor(context.game.host.random() * 5), -600)) context.entity.count = 1;
        else context.state.meleeTime = context.game.host.now() + 3;
        return context.game.sound(context.entity, "brain/brnatck3.wav", 1);
      },
      brain_chest_closed(context) { screen(context, true); if (context.entity.count !== 0) { context.entity.count = 0; context.setMove("brain_move_attack1"); } return undefined; },
      brain_tounge_attack(context) {
        const { game, entity } = context, enemy = enemyBody(context); if (enemy === null || entity.enemy === null) return undefined;
        const start = projectFlash(context, { x: 24, y: 0, z: 16 });
        if (![enemy.origin, { ...enemy.origin, z: enemy.origin.z + enemy.bounds.max.z - 8 }, { ...enemy.origin, z: enemy.origin.z + enemy.bounds.min.z + 8 }].some(end => tongueAllowed(start, end))) return undefined;
        const end = enemy.origin, trace = game.host.trace({ start, end, bounds: null, ignore: entity.actor.id, mask: 0x46004003 });
        if (trace.hit.kind !== "actor" || !trace.hit.actor.equals(entity.enemy)) return undefined;
        game.sound(entity, "brain/brnatck3.wav", 1); game.host.emit({ kind: "monster-beam", effect: "parasite", actor: entity.actor.id, start, end });
        game.damage(entity.enemy, entity, entity.actor.id, 5, 0, subtract(start, end), end, zero, 36, 8);
        const body = game.body(entity), target = game.host.actors.resolveOwned(entity.enemy); game.move(entity, { origin: { ...body.origin, z: body.origin.z + 1 } });
        if (target !== null) game.host.bodies.write(target, { ...enemy, velocity: scale(anglesVectors(body.angles).forward, -1200) });
        return undefined;
      },
      brain_laserbeam(context) { fireMonsterBeam(context, 1, false, rightEye); return fireMonsterBeam(context, 1, true, leftEye); },
      brain_laserbeam_reattack(context) { if (context.game.host.random() < 0.5 && visible(context) && health(context.game, context.entity.enemy) > 0) context.entity.frame = brainFrame.walk101; return undefined; },
      brain_shrink(context) { const bounds = context.game.body(context.entity).bounds; context.entity.serverFlags |= 2; return context.game.move(context.entity, { bounds: { ...bounds, max: { ...bounds.max, z: 0 } } }); },
    },
  };
}
