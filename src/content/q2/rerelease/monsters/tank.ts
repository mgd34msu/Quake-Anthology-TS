// Rerelease m_tank.cpp, including the Quake II 64 commander. ZeniMax Media, GPL-2.0.
import type { Vec3 } from "../../../../contracts/math.ts";
import { add, length, normalize, numberField, scale, subtract, zero } from "../../foundation/fields.ts";
import type { Q2SpawnModule, Q2Think, Q2Use } from "../../foundation/host.ts";
import { anglesVectors, clearShot, corpse, enemyBody, enemyEye, health, projectFlash, vectorAngles, visible } from "../../foundation/monsters/ai.ts";
import { throwGib } from "../../foundation/monsters/gibs.ts";
import { muzzleOffset } from "../../foundation/monsters/muzzle.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import type { Q2MissionPackMonsterWeapons } from "../../missionpacks/monsters/types.ts";
import { tankDefinition } from "../../base/monsters/tank.ts";
import { blockedCheckPlatform, chainfist, checkGib, monsterFlash, predictAim, predictedDirection, reactsToPain } from "./common.ts";
import { tankFrame as frame, tankMoves } from "./tables/tank.ts";

function blindAim(context: MonsterContext, start: Vec3, target: Vec3, right: Vec3): Vec3 | null {
  for (const side of [0, -20, 20]) {
    const end = add(target, scale(right, side));
    const trace = context.game.host.trace({ start, end, bounds: null, ignore: context.entity.actor.id, mask: 0x46004003 });
    if (!trace.startSolid && !trace.allSolid && trace.fraction >= 0.5) return normalize(subtract(end, start));
  }
  return null;
}

export function createRereleaseTankDefinitions(weapons: Q2MissionPackMonsterWeapons): readonly Q2MonsterDefinition[] {
  const tank: Q2MonsterDefinition = {
    ...tankDefinition, moves: tankMoves, blindFire: true,
    initialize(context) {
      const { game, entity, state } = context;
      if ((entity.spawnflags & 8) !== 0) {
        entity.maxHealth = 1500 * numberField(entity.spawn, "health_multiplier", 1); game.host.combat.setHealth(entity.actor, entity.maxHealth);
        if (numberField(entity.spawn, "scale", 0) === 0) {
          entity.scale = 1.5; state.scale = 1.5;
          game.move(entity, { bounds: { min: { x: -48, y: -48, z: -24 }, max: { x: 48, y: 48, z: 108 } } });
          state.normalHeight = 108; entity.viewHeight = 100; game.host.combat.setTraits(entity.actor, { mass: 750 });
        }
      }
      return undefined;
    },
    blocked: blockedCheckPlatform,
    attack(context) {
      const { game, entity, state } = context, enemy = enemyBody(context); if (enemy === null) return undefined;
      if (health(game, entity.enemy) <= 0) { state.brutal = false; return context.setMove("tank_move_attack_strike"); }
      if (state.attackState === "blind") {
        const chance = state.blindFireDelay < 1 ? 1 : state.blindFireDelay < 7.5 ? 0.4 : 0.1, choice = game.host.random();
        state.blindFireDelay += 5.2 + game.host.random() * 3;
        if (length(state.blindFireTarget) === 0 || choice > chance) return undefined;
        const rocket = clearShot(context, muzzleOffset("rerelease", 23)), blaster = clearShot(context, muzzleOffset("rerelease", 1));
        if (!rocket && !blaster) return undefined;
        state.manualSteering = true;
        if (rocket && blaster ? game.host.random() < 0.5 : rocket) context.setMove("tank_move_attack_fire_rocket");
        else { context.setMove("tank_move_attack_blast"); state.nextFrame = frame.attak108; }
        state.attackFinished = game.host.now() + 3 + game.host.random() * 2; state.painTime = game.host.now() + 5; return undefined;
      }
      const range = length(subtract(enemy.origin, game.body(entity).origin)), choice = game.host.random();
      if (range <= 250) {
        const machinegun = game.entity(entity.enemy)?.classname !== "tesla_mine" && clearShot(context, muzzleOffset("rerelease", 8));
        if (machinegun && choice < (range <= 125 ? 0.5 : 0.25)) return context.setMove("tank_move_attack_chain");
      } else {
        const machinegun = clearShot(context, muzzleOffset("rerelease", 8)), rocket = clearShot(context, muzzleOffset("rerelease", 23));
        if (machinegun && choice < 0.33) return context.setMove("tank_move_attack_chain");
        if (rocket && choice < 0.66) { state.painTime = game.host.now() + 5; return context.setMove("tank_move_attack_pre_rocket"); }
      }
      if (clearShot(context, muzzleOffset("rerelease", 1))) context.setMove("tank_move_attack_blast");
      return undefined;
    },
    pain(context, reaction) {
      const { game, entity, state } = context;
      entity.skin = health(game, entity.actor.id) < entity.maxHealth / 2 ? entity.skin | 1 : entity.skin & ~1;
      if (!chainfist(context) && reaction.damage <= 10 || game.host.now() < state.painTime) return undefined;
      if (!chainfist(context)) {
        if (reaction.damage <= 30 && game.host.random() > 0.2) return undefined;
        if (entity.frame >= frame.attak301 && entity.frame <= frame.attak330 || entity.frame >= frame.attak101 && entity.frame <= frame.attak116) return undefined;
      }
      state.painTime = game.host.now() + 3; game.sound(entity, entity.count !== 0 ? "tank/pain.wav" : "tank/tnkpain2.wav", 2);
      if (!reactsToPain(context)) return undefined;
      state.manualSteering = false; return context.setMove(reaction.damage <= 30 ? "tank_move_pain1" : reaction.damage <= 60 ? "tank_move_pain2" : "tank_move_pain3");
    },
    die(context, reaction) {
      const { entity, game, state } = context;
      if (checkGib(context)) {
        game.sound(entity, "misc/udeath.wav", 2); entity.skin = Math.trunc(entity.skin / 2);
        throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", reaction.damage);
        for (let i = 0; i < 3; i++) throwGib(entity, game, "models/objects/gibs/sm_metal/tris.md2", reaction.damage, { metallic: true });
        throwGib(entity, game, "models/objects/gibs/gear/tris.md2", reaction.damage, { metallic: true });
        for (const part of ["foot", "thigh"]) for (let i = 0; i < 2; i++) throwGib(entity, game, `models/monsters/tank/gibs/${part}.md2`, reaction.damage, { skinned: true, metallic: true });
        throwGib(entity, game, "models/monsters/tank/gibs/chest.md2", reaction.damage, { skinned: true });
        throwGib(entity, game, "models/monsters/tank/gibs/head.md2", reaction.damage, { skinned: true, head: true });
        if (entity.style === 0) throwGib(entity, game, "models/monsters/tank/gibs/barm.md2", reaction.damage, { skinned: true, upright: true });
        state.dead = true; state.gibbed = true; return undefined;
      }
      if (state.dead) return undefined;
      if (entity.style === 0) {
        entity.style = 1; const body = game.body(entity), axes = anglesVectors(body.angles), arm = throwGib(entity, game, "models/monsters/tank/gibs/barm.md2", reaction.damage, { skinned: true, upright: true });
        if (arm !== null) { arm.angularVelocity = { x: (game.host.random() * 2 - 1) * 15, y: (game.host.random() * 2 - 1) * 15, z: 180 }; arm.skin = Math.trunc(arm.skin / 2); game.move(arm, { origin: add(body.origin, add(scale(axes.right, -16), scale(axes.up, 23))), velocity: add(scale(axes.up, 100), scale(axes.right, -120)), angles: { ...body.angles, z: -90 } }); }
      }
      game.sound(entity, "tank/death.wav", 2); state.dead = true; state.canTakeDamage = true;
      game.host.combat.setTraits(entity.actor, { canTakeDamage: true }); return context.setMove("tank_move_death");
    },
    callbacks: {
      ...tankDefinition.callbacks,
      tank_blind_check(context) { if (context.state.manualSteering) context.state.idealYaw = vectorAngles(subtract(context.state.blindFireTarget, context.game.body(context.entity).origin)).y; return undefined; },
      tank_dead(context) { corpse(context); return context.game.move(context.entity, { bounds: { min: { x: -16, y: -16, z: -16 }, max: { x: 16, y: 16, z: 0 } } }); },
      tank_shrink(context) { context.entity.serverFlags |= 2; const bounds = context.game.body(context.entity).bounds; return context.game.move(context.entity, { bounds: { min: bounds.min, max: { ...bounds.max, z: 0 } } }); },
      tank_reattack_blaster(context) { if (context.state.manualSteering) { context.state.manualSteering = false; return context.setMove("tank_move_attack_post_blast"); } return context.setMove(visible(context) && health(context.game, context.entity.enemy) > 0 && context.game.host.random() <= 0.6 ? "tank_move_reattack_blast" : "tank_move_attack_post_blast"); },
      tank_refire_rocket(context) { if (context.state.manualSteering) { context.state.manualSteering = false; return context.setMove("tank_move_attack_post_rocket"); } return context.setMove(health(context.game, context.entity.enemy) > 0 && visible(context) && context.game.host.random() <= 0.4 ? "tank_move_attack_fire_rocket" : "tank_move_attack_post_rocket"); },
      TankBlaster(context) {
        if (enemyBody(context) === null) return undefined;
        const { game, entity } = context, id = entity.frame === frame.attak110 ? 1 : entity.frame === frame.attak113 ? 2 : 3, start = projectFlash(context, muzzleOffset("rerelease", id));
        const direction = context.state.manualSteering ? blindAim(context, start, context.state.blindFireTarget, anglesVectors(game.body(entity).angles).right) : predictedDirection(context, start, 0, false);
        if (direction === null) return undefined;
        context.weapons.fireBlaster(entity, game, start, direction, 30, 800, 8); return monsterFlash(context, id, start, direction);
      },
      TankRocket(context) {
        const { game, entity, state } = context, enemy = enemyBody(context); if (enemy === null) return undefined;
        const id = entity.frame === frame.attak324 ? 23 : entity.frame === frame.attak327 ? 24 : 25, start = projectFlash(context, muzzleOffset("rerelease", id)), heat = (entity.spawnflags & 16) !== 0, speed = entity.speed || (heat ? 500 : 650);
        let target = state.manualSteering ? state.blindFireTarget : game.host.random() < 0.66 || start.z < enemy.origin.z + enemy.bounds.min.z ? enemyEye(context) ?? enemy.origin : { ...enemy.origin, z: enemy.origin.z + enemy.bounds.min.z + 1 };
        if (!state.manualSteering && game.host.random() < 0.2 + (3 - game.options.skill) * 0.15) target = predictAim(context, start, speed, false, 0)?.point ?? target;
        const direction = state.manualSteering ? blindAim(context, start, target, anglesVectors(game.body(entity).angles).right) : normalize(subtract(target, start));
        if (direction === null) return undefined;
        if (!state.manualSteering) { const trace = game.host.trace({ start, end: target, bounds: null, ignore: entity.actor.id, mask: 0x46004003 }); if (trace.fraction <= 0.5 && trace.hit.kind === "world") return undefined; }
        if (heat) weapons.fireHeatRocket(entity, game, start, direction, 50, speed, 70, 50, entity.accel || 0.075); else context.weapons.fireRocket(entity, game, start, direction, 50, speed, 70, 50);
        return monsterFlash(context, id, start, direction);
      },
      TankMachineGun(context) {
        const eye = enemyEye(context); if (eye === null) return undefined;
        const { entity, game } = context, id = 4 + entity.frame - frame.attak406, start = projectFlash(context, muzzleOffset("rerelease", id)), angles = game.body(entity).angles;
        const direction = anglesVectors({ x: vectorAngles(subtract(eye, start)).x, y: entity.frame <= frame.attak415 ? angles.y - 8 * (entity.frame - frame.attak411) : angles.y + 8 * (entity.frame - frame.attak419), z: 0 }).forward;
        context.weapons.fireBullet(entity, game, start, direction, 20, 4, 300, 500, 0); return monsterFlash(context, id, start, direction);
      },
    },
  };
  return [tank, { ...tank, classname: "monster_tank_commander", health: 1000, gibHealth: -225, initialize(context) { tank.initialize?.(context); context.entity.skin = 2; context.entity.count = 1; return undefined; } }];
}

const thinkTankStand: Q2Think = (entity, game) => { entity.frame = entity.frame === frame.stand30 ? frame.stand01 : entity.frame + 1; game.show(entity); return game.schedule(entity, 0.1, thinkTankStand); };
const useTankStand: Q2Use = (entity, game) => { game.host.emit({ kind: "effect", effect: "q2:boss-teleport", origin: game.body(entity).origin, direction: zero, count: 1, color: 0 }); return game.remove(entity); };
export const rereleaseTankStandModule: Q2SpawnModule = {
  callbacks: { think: { "rerelease.tank_stand.Think_TankStand": thinkTankStand }, use: { "rerelease.tank_stand.Use_Boss3": useTankStand } },
  spawn(entity, game) {
    if (entity.classname !== "monster_tank_stand") return false;
    if (game.options.mode === "deathmatch") { game.remove(entity); return true; }
    entity.scale = numberField(entity.spawn, "scale", 0) || 1.5; entity.model = "models/monsters/tank/tris.md2"; entity.frame = frame.stand01; entity.skin = 2;
    game.move(entity, { bounds: { min: scale({ x: -32, y: -32, z: -16 }, entity.scale), max: scale({ x: 32, y: 32, z: 64 }, entity.scale) } });
    game.motion(entity, "step"); game.solid(entity, "box"); game.show(entity); entity.use = useTankStand;
    game.schedule(entity, 0.1, thinkTankStand); return true;
  },
};
