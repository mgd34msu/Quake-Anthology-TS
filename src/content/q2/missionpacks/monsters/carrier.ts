/* Quake II rogue/m_carrier.c. ZeniMax Media, GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Bounds } from "../../../../contracts/math.ts";
import { add, dot, normalize, scale, subtract } from "../../foundation/fields.ts";
import { anglesVectors, enemyBody, enemyEye, health, inFront, projectFlash, targetDistance, vectorAngles } from "../../foundation/monsters/ai.ts";
import type { Q2Monsters } from "../../foundation/monsters/index.ts";
import { muzzleOffset } from "../../foundation/monsters/muzzle.ts";
import { recordAt } from "../../foundation/monsters/types.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { bossExplode, withBossExplosionCallbacks } from "../../base/monsters/boss-common.ts";
import { damagedSkin, finishCorpse, loopSound, move, sound } from "../../base/monsters/common.ts";
import { monsterFlash, predictedDirection } from "../../rerelease/monsters/common.ts";
import { createRogueMonster, findRogueSpawnPoint, rogueSpawnCallbacks, rogueSpawnGrow } from "./spawn.ts";
import { carrierFrame, carrierMoves } from "./tables/rogue-carrier.ts";
import type { Q2MissionPackMonsterServices } from "./types.ts";

const flyerBounds: Bounds = { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 16 } };
function relation(context: MonsterContext, actor: ActorId): { readonly front: boolean; readonly back: boolean; readonly below: boolean } {
  const target = context.game.host.bodies.read(actor);
  if (target === null) return { front: false, back: false, below: false };
  const body = context.game.body(context.entity), direction = normalize(subtract(target.origin, body.origin));
  const forward = dot(direction, anglesVectors(body.angles).forward);
  return { front: forward > 0.3, back: forward < -0.3, below: -direction.z > 0.95 };
}
function anglemod(angle: number): number { return (Math.trunc(angle * 65536 / 360) & 65535) * 360 / 65536; }

export function createCarrierDefinition(monsters: Q2Monsters, services: Q2MissionPackMonsterServices): Q2MonsterDefinition {
  function rocket(context: MonsterContext): undefined {
    const { entity, game } = context, enemy = enemyBody(context);
    if (enemy === null || entity.enemy === null) return undefined;
    const predictive = game.host.isPlayer(entity.enemy) && game.host.random() < 0.5;
    const right = anglesVectors(game.body(entity).angles).right;
    for (let index = 0; index < 4; index++) {
      const flash = 191 + index, start = projectFlash(context, muzzleOffset(game.options.edition, flash));
      const spread = recordAt([0.4, 0.025, -0.025, -0.4], index);
      const direction = predictive ? predictedDirection(context, start, 750, false, -0.3 + index * 0.15)
        : normalize(add(normalize(subtract({ ...enemy.origin, z: enemy.origin.z - (index === 0 || index === 3 ? 15 : 0) }, start)), scale(right, spread)));
      if (direction === null) continue;
      context.weapons.fireRocket(entity, game, start, direction, 50, predictive ? 750 : 500, 70, 50);
      monsterFlash(context, flash, start, direction);
    }
    return undefined;
  }
  function coopCheck(context: MonsterContext): undefined {
    const { entity, game } = context;
    if (game.options.mode !== "coop" || entity.wait > game.host.now()) return undefined;
    const targets: ActorId[] = [];
    for (const player of game.host.players()) {
      if (!game.host.actors.isLive(player) || !game.host.isPlayer(player)) continue;
      const direction = relation(context, player), target = game.host.bodies.read(player);
      if (target !== null && (direction.back || direction.below) && game.host.trace({ start: game.body(entity).origin, end: target.origin, bounds: null, ignore: entity.actor.id, mask: 3 }).fraction === 1) targets.push(player);
    }
    if (targets.length === 0) return undefined;
    const chosen = recordAt(targets, Math.min(targets.length - 1, Math.floor(game.host.random() * targets.length)));
    entity.wait = game.host.now() + 2;
    const previous = entity.enemy; entity.enemy = chosen; rocket(context); entity.enemy = previous;
    return undefined;
  }
  function machineGun(context: MonsterContext): undefined {
    coopCheck(context);
    for (const rightGun of [false, true]) {
      const enemy = enemyBody(context), eye = enemyEye(context); if (enemy === null || eye === null) continue;
      const flash = (context.state.manualSteering ? 152 : 138) + (rightGun ? 1 : 0);
      const start = projectFlash(context, muzzleOffset(context.game.options.edition, flash));
      const direction = normalize(subtract(add(eye, scale(enemy.velocity, rightGun ? 0.2 : -0.2)), start));
      context.weapons.fireBullet(context.entity, context.game, start, direction, 6, 4, 900, 500, 0);
      monsterFlash(context, flash, start, direction);
    }
    return undefined;
  }
  function spawn(context: MonsterContext): undefined {
    const { entity, game, state } = context;
    const point = findRogueSpawnPoint(game, projectFlash(context, { x: 105, y: 0, z: -58 }), flyerBounds, 32);
    const time = Math.trunc((game.host.now() + 0.1 - entity.timestamp) / 0.5);
    if (point === null) return undefined;
    const child = createRogueMonster(monsters, game, point, game.body(entity).angles, time === 2 ? "monster_kamikaze" : "monster_flyer");
    game.sound(entity, "medic_commander/monsterspawn1.wav", 4, 1, 0); state.monsterSlots--;
    child.nextThink = game.host.now(); child.think?.(child, game);
    const childContext = monsters.context(child.actor.id);
    if (childContext === null) throw new Error("Carrier child has no source controller");
    childContext.state.spawnedBy = "carrier"; childContext.state.doNotCount = true; childContext.state.ignoreShots = true; childContext.state.commander = entity.actor.id;
    if (entity.enemy !== null && game.host.actors.isLive(entity.enemy) && health(game, entity.enemy) > 0) {
      child.enemy = entity.enemy; monsters.foundTarget(childContext);
      if (time === 1 || time === 3) { childContext.state.lefty = time === 3; childContext.state.attackState = "sliding"; childContext.setMove("flyer_move_attack3"); }
      else if (time === 2) {
        childContext.state.lefty = false; childContext.state.attackState = "straight"; childContext.setMove("flyer_move_kamikaze");
        game.host.combat.setTraits(child.actor, { mass: 100 }); childContext.state.charging = true;
      }
    }
    return undefined;
  }
  const run = (context: MonsterContext): undefined => { context.state.holdFrame = false; return context.setMove(context.state.standGround ? "carrier_move_stand" : "carrier_move_run"); };
  function railMove(context: MonsterContext): undefined { context.game.sound(context.entity, "gladiator/railgun.wav", 1); return context.setMove("carrier_move_attack_rail"); }
  return withBossExplosionCallbacks({
    classname: "monster_carrier", kind: "carrier", model: "models/monsters/carrier/tris.md2", health: 2000, gibHealth: -200, mass: 1000,
    bounds: { min: { x: -56, y: -56, z: -44 }, max: { x: 56, y: 56, z: 44 } }, scale: 1, yawSpeed: 15, locomotion: "fly",
    initialMove: "carrier_move_stand", moves: carrierMoves, stand: move("carrier_move_stand"), walk: move("carrier_move_walk"), run, sight: sound("carrier/sight.wav"),
    sourceCallbacks: rogueSpawnCallbacks,
    initialize(context) {
      const { game, entity, state } = context;
      const hp = Math.max(2000, 2000 + 1000 * (game.options.skill - 1)) + (game.options.mode === "coop" ? 500 * game.options.skill : 0);
      entity.maxHealth = hp; game.host.combat.setHealth(entity.actor, hp); entity.laserImmune = true; state.ignoreShots = true;
      state.monsterSlots = game.options.skill === 0 ? 3 : game.options.skill === 3 ? 9 : 6;
      return loopSound(context, "bosshovr/bhvengn1.wav");
    },
    attack(context) {
      const { entity, game, state } = context;
      state.holdFrame = false;
      if (entity.enemy === null || !game.host.actors.isLive(entity.enemy)) return undefined;
      const enemy = relation(context, entity.enemy), ready = game.host.now() >= state.attackFinished;
      if (services.badArea(entity.actor.id)) {
        if (enemy.back || enemy.below) return context.setMove("carrier_move_attack_rocket");
        return game.host.random() < 0.1 || !ready ? context.setMove("carrier_move_attack_pre_mg") : railMove(context);
      }
      if (state.attackState === "blind") return context.setMove("carrier_move_spawn");
      if (!enemy.back && !enemy.front && !enemy.below) return game.host.random() < 0.1 || !ready ? context.setMove("carrier_move_attack_pre_mg") : railMove(context);
      if (enemy.front) {
        const distance = targetDistance(context);
        if (distance <= 125) return game.host.random() < 0.8 || !ready ? context.setMove("carrier_move_attack_pre_mg") : railMove(context);
        const luck = game.host.random();
        if (distance < 600) {
          if (state.monsterSlots > 2) {
            if (luck <= 0.2) return context.setMove("carrier_move_attack_pre_mg");
            if (luck <= 0.4) return context.setMove("carrier_move_attack_pre_gren");
            return luck <= 0.7 && ready ? railMove(context) : context.setMove("carrier_move_spawn");
          }
          if (luck <= 0.3) return context.setMove("carrier_move_attack_pre_mg");
          if (luck <= 0.65) return context.setMove("carrier_move_attack_pre_gren");
          return ready ? railMove(context) : context.setMove("carrier_move_attack_pre_mg");
        }
        if (state.monsterSlots > 2) {
          if (luck < 0.3) return context.setMove("carrier_move_attack_pre_mg");
          if (luck < 0.65 && ready) { entity.pos1 = enemyEye(context) ?? entity.pos1; return railMove(context); }
          return context.setMove("carrier_move_spawn");
        }
        return luck < 0.45 || !ready ? context.setMove("carrier_move_attack_pre_mg") : railMove(context);
      }
      return enemy.below || enemy.back ? context.setMove("carrier_move_attack_rocket") : undefined;
    },
    checkAttack(context) {
      const { entity, game, state } = context, enemy = enemyBody(context), eye = enemyEye(context);
      if (entity.enemy === null || enemy === null || eye === null) return false;
      if (health(game, entity.enemy) > 0) {
        const origin = game.body(entity).origin, trace = game.host.trace({ start: { ...origin, z: origin.z + entity.viewHeight }, end: eye, bounds: null, ignore: entity.actor.id, mask: 1 | 0x2000000 | 8 | 16 });
        if (trace.hit.kind !== "actor" || !trace.hit.actor.equals(entity.enemy)) {
          if (game.host.isPlayer(entity.enemy) && state.monsterSlots > 2) { state.attackState = "blind"; return true; }
          if (game.entity(entity.enemy)?.solid !== "none" || trace.fraction < 1) return false;
        }
      }
      const direction = relation(context, entity.enemy), distance = targetDistance(context);
      state.idealYaw = vectorAngles(subtract(enemy.origin, game.body(entity).origin)).y;
      if ((direction.back || !direction.front && direction.below) && game.host.now() >= entity.wait) {
        entity.wait = game.host.now() + 2; context.attack(); state.attackState = game.host.random() < 0.6 ? "sliding" : "straight"; return true;
      }
      if (distance < 80) { state.attackState = "missile"; return true; }
      if (game.host.random() < (state.standGround ? 0.4 : distance < 1000 ? 0.8 : 0.5) || game.entity(entity.enemy)?.solid === "none") { state.attackState = "missile"; return true; }
      if ((entity.flags & 1) !== 0) state.attackState = game.host.random() < 0.6 ? "sliding" : "straight";
      return false;
    },
    pain(context, reaction) {
      damagedSkin(context);
      const { entity, game, state } = context;
      if (game.options.skill === 3 || game.host.now() < state.painTime) return undefined;
      state.painTime = game.host.now() + 5;
      let changed = false;
      if (reaction.damage < 10) game.sound(entity, "carrier/pain_sm.wav", 2, 1, 0);
      else if (reaction.damage < 30) { game.sound(entity, "carrier/pain_md.wav", 2, 1, 0); if (game.host.random() < 0.5) { changed = true; context.setMove("carrier_move_pain_light"); } }
      else { game.sound(entity, "carrier/pain_lg.wav", 2, 1, 0); context.setMove("carrier_move_pain_heavy"); changed = true; }
      if (changed) { state.holdFrame = false; state.manualSteering = false; state.yawSpeed = 15; }
      return undefined;
    },
    die(context) {
      context.game.sound(context.entity, "carrier/death.wav", 2, 1, 0); context.state.dead = true; context.state.canTakeDamage = false;
      context.game.host.combat.setTraits(context.entity.actor, { canTakeDamage: false }); context.entity.count = 0;
      return context.setMove("carrier_move_death");
    },
    callbacks: {
      carrier_run: run, carrier_dead(context) { return finishCorpse(context, { min: { x: -56, y: -56, z: 0 }, max: { x: 56, y: 56, z: 80 } }); },
      BossExplode: bossExplode, CarrierCoopCheck: coopCheck, CarrierMachineGun: machineGun, CarrierMachineGunHold: machineGun, CarrierRocket: rocket,
      CarrierGrenade(context) {
        coopCheck(context);
        const enemy = enemyBody(context); if (enemy === null) return undefined;
        const { entity, game } = context, direction = game.host.random() < 0.5 ? -1 : 1, time = Math.trunc((game.host.now() - entity.timestamp) / 0.4);
        const rightSpread = time === 0 ? 0.15 * direction : time === 2 ? -0.15 * direction : 0;
        const upSpread = time === 0 ? 0.1 - 0.1 * direction : time === 2 ? 0.1 + 0.1 * direction : time === 1 || time === 3 ? 0.1 : 0;
        const start = projectFlash(context, muzzleOffset(game.options.edition, 140)), axes = anglesVectors(game.body(entity).angles);
        const aim = add(add(normalize(subtract(enemy.origin, start)), scale(axes.right, rightSpread)), scale(axes.up, upSpread));
        const clipped = { ...aim, z: Math.max(-0.5, Math.min(0.15, aim.z)) };
        context.weapons.fireGrenade(entity, game, start, clipped, 50, 600, 2.5, 90, false, false, true);
        return monsterFlash(context, 53, start, clipped);
      },
      CarrierSaveLoc(context) { coopCheck(context); const eye = enemyEye(context); if (eye !== null) context.entity.pos1 = eye; return undefined; },
      CarrierRail(context) {
        coopCheck(context); const start = projectFlash(context, muzzleOffset(context.game.options.edition, 147)), direction = normalize(subtract(context.entity.pos1, start));
        context.weapons.fireRail(context.entity, context.game, start, direction, 50, 100); monsterFlash(context, 147, start, direction); context.state.attackFinished = context.game.host.now() + 3; return undefined;
      },
      carrier_attack_mg(context) { coopCheck(context); return context.setMove("carrier_move_attack_mg"); },
      carrier_reattack_mg(context) {
        coopCheck(context);
        return context.setMove(context.entity.enemy !== null && inFront(context, context.entity.enemy) && context.game.host.random() <= 0.5
          ? context.game.host.random() < 0.7 || context.state.monsterSlots <= 2 ? "carrier_move_attack_mg" : "carrier_move_spawn" : "carrier_move_attack_post_mg");
      },
      carrier_attack_gren(context) { coopCheck(context); context.entity.timestamp = context.game.host.now(); return context.setMove("carrier_move_attack_gren"); },
      carrier_reattack_gren(context) { coopCheck(context); return context.setMove(context.entity.enemy !== null && inFront(context, context.entity.enemy) && context.entity.timestamp + 1.3 > context.game.host.now() ? "carrier_move_attack_gren" : "carrier_move_attack_post_gren"); },
      carrier_prep_spawn(context) { coopCheck(context); context.state.manualSteering = true; context.entity.timestamp = context.game.host.now(); context.state.yawSpeed = 10; return machineGun(context); },
      carrier_start_spawn(context) {
        coopCheck(context); const enemy = enemyBody(context); if (enemy === null) return undefined;
        const time = Math.trunc((context.game.host.now() - context.entity.timestamp) / 0.5), yaw = vectorAngles(subtract(enemy.origin, context.game.body(context.entity).origin)).y;
        if (time >= 0 && time <= 2) context.state.idealYaw = anglemod(yaw + (time - 1) * 30);
        return machineGun(context);
      },
      carrier_ready_spawn(context) {
        coopCheck(context); machineGun(context);
        if (Math.abs(anglemod(context.game.body(context.entity).angles.y) - context.state.idealYaw) > 0.1) { context.state.holdFrame = true; context.entity.timestamp += 0.1; return undefined; }
        context.state.holdFrame = false;
        const point = findRogueSpawnPoint(context.game, projectFlash(context, { x: 105, y: 0, z: -58 }), flyerBounds, 32);
        if (point !== null) rogueSpawnGrow(context.game, point, 0);
        return undefined;
      },
      carrier_spawn_check(context) {
        coopCheck(context); machineGun(context); spawn(context);
        if (context.game.host.now() > context.entity.timestamp + 1.1) { context.state.manualSteering = false; context.state.yawSpeed = 15; }
        else context.state.nextFrame = carrierFrame.spawn08;
        return undefined;
      },
    },
  }, monsters);
}
