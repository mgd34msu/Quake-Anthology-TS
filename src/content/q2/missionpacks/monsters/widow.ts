/* Original Rogue m_widow.c. ZeniMax Media, GPL-2.0-or-later. */
import type { Vec3 } from "../../../../contracts/math.ts";
import { normalize, subtract } from "../../foundation/fields.ts";
import { anglesVectors, enemyBody, enemyEye, health, projectFlash, targetDistance, vectorAngles } from "../../foundation/monsters/ai.ts";
import type { Q2Monsters } from "../../foundation/monsters/index.ts";
import { muzzleOffset } from "../../foundation/monsters/muzzle.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { recordAt } from "../../foundation/monsters/types.ts";
import { damagedSkin, finishCorpse, move } from "../../base/monsters/common.ts";
import { monsterFlash, predictedDirection } from "../../rerelease/monsters/common.ts";
import { monsterPowerArmor } from "./power-armor.ts";
import { rogueBlockedCheckShot } from "./rogue-common.ts";
import { rogueSpawnCallbacks } from "./spawn.ts";
import type { Q2MissionPackMonsterState } from "./state.ts";
import { widowFrame as frame, widowMoves } from "./tables/rogue-widow.ts";
import type { Q2MissionPackMonsterServices, Q2MissionPackMonsterWeapons } from "./types.ts";
import { widowClearPowerups, widowPowerThink, widowPowerups, widowProject, widowRestoreArmor, widowSlots, widowSlotsLeft, widowSummon } from "./widow/common.ts";
import { spawnWidowLegs, widowDebrisCallbacks, widowEffect } from "./widow/death.ts";

const sweepAngles: readonly number[] = [32, 26, 20, 10, 0, -6.5, -13, -27, -41];
function targetAngle(context: MonsterContext): number {
  const enemy = enemyBody(context); if (enemy === null) return 0;
  const body = context.game.body(context.entity);
  let angle = body.angles.y - vectorAngles(subtract(body.origin, enemy.origin)).y;
  if (angle < 0) angle += 360;
  return angle - 180;
}
function torso(context: MonsterContext): number {
  const angle = targetAngle(context);
  if (angle >= 105 || angle <= -75) { context.setMove(angle >= 105 ? "widow_move_attack_post_blaster_r" : "widow_move_attack_post_blaster_l"); context.state.manualSteering = false; return 0; }
  for (let index = 0; index < 17; index++) if (angle >= 95 - index * 10) return frame.fired03 + index;
  return frame.fired20;
}
export function createWidowDefinition(monsters: Q2Monsters, weapons: Q2MissionPackMonsterWeapons, services: Q2MissionPackMonsterServices, source: Q2MissionPackMonsterState): Q2MonsterDefinition {
  const powerThink = widowPowerThink(monsters, source);
  const run = (context: MonsterContext): undefined => { context.state.holdFrame = false; return context.setMove(context.state.standGround ? "widow_move_stand" : "widow_move_run"); };
  function railMove(context: MonsterContext): undefined { context.game.sound(context.entity, "gladiator/railgun.wav", 1); return context.setMove("widow_move_attack_pre_rail"); }
  function blaster(context: MonsterContext): undefined {
    const { entity, game, state } = context, enemy = enemyBody(context), eye = enemyEye(context);
    if (enemy === null || eye === null) return undefined;
    source.widowShotsFired++; const effect = source.widowShotsFired % 4 === 0 ? 8 : 0;
    let flash: number, direction: Vec3;
    if (entity.frame >= frame.spawn05 && entity.frame <= frame.spawn13) {
      const index = entity.frame - frame.spawn05; flash = 156 + index;
      const start = projectFlash(context, muzzleOffset(game.options.edition, flash)), body = game.body(entity);
      direction = anglesVectors({ ...body.angles, x: body.angles.x + vectorAngles(subtract(enemy.origin, start)).x, y: body.angles.y - recordAt(sweepAngles, index) }).forward;
      weapons.fireBlaster2(entity, game, start, direction, 10 * source.widowDamageMultiplier, 1000, effect); return monsterFlash(context, flash, start, direction);
    }
    if (entity.frame >= frame.fired02a && entity.frame <= frame.fired20) {
      state.manualSteering = true; state.nextFrame = torso(context) || entity.frame;
      flash = entity.frame === frame.fired02a ? 175 : 165 + entity.frame - frame.fired03;
      const start = projectFlash(context, muzzleOffset(game.options.edition, flash));
      const aim = predictedDirection(context, start, 1000, true, game.host.random() * 0.1 - 0.05); if (aim === null) return undefined;
      const angles = vectorAngles(aim), yaw = game.body(entity).angles.y;
      let aimAngle = 100 - 10 * (flash - 165); if (aimAngle <= 0) aimAngle += 360;
      let enemyAngle = yaw - angles.y; if (enemyAngle <= 0) enemyAngle += 360;
      const error = aimAngle - enemyAngle;
      direction = anglesVectors({ ...angles, y: error > 15 ? yaw - aimAngle + 15 : error < -15 ? yaw - aimAngle - 15 : angles.y }).forward;
      weapons.fireBlaster2(entity, game, start, direction, 10 * source.widowDamageMultiplier, 1000, effect); return monsterFlash(context, flash, start, direction);
    }
    if (entity.frame >= frame.run01 && entity.frame <= frame.run08) {
      flash = 183 + entity.frame - frame.run01; const start = projectFlash(context, muzzleOffset(game.options.edition, flash)); direction = subtract(eye, start);
      weapons.fireBlaster2(entity, game, start, direction, 10 * source.widowDamageMultiplier, 1000, effect); return monsterFlash(context, flash, start, direction);
    }
    return undefined;
  }
  function checkAttack(context: MonsterContext): boolean {
    const { entity, game, state } = context, enemy = enemyBody(context), eye = enemyEye(context);
    if (enemy === null || eye === null || entity.enemy === null) return false;
    widowPowerups(context, services, source);
    if (state.move.name === "widow_move_run" && (entity.frame >= frame.walk04 && entity.frame <= frame.walk08 || entity.frame === frame.walk12)) return false;
    const distance = targetDistance(context);
    if (game.host.random() < 0.8 && widowSlotsLeft(context) >= 2 && distance > 150) { source.get(entity).blocked = true; state.attackState = "missile"; return true; }
    if (health(game, entity.enemy) > 0) {
      const origin = game.body(entity).origin, trace = game.host.trace({ start: { ...origin, z: origin.z + entity.viewHeight }, end: eye, bounds: null, ignore: entity.actor.id, mask: 1 | 0x2000000 | 8 | 16 });
      if (trace.hit.kind !== "actor" || !trace.hit.actor.equals(entity.enemy)) {
        if (game.host.isPlayer(entity.enemy) && widowSlotsLeft(context) >= 2) { state.attackState = "blind"; return true; }
        if (game.entity(entity.enemy)?.solid !== "none" || trace.fraction < 1) return false;
      }
    }
    state.idealYaw = vectorAngles(subtract(enemy.origin, game.body(entity).origin)).y;
    if (distance <= 100) { if (game.options.skill === 0 && Math.floor(game.host.random() * 4) !== 0) return false; state.attackState = "melee"; return true; }
    if (game.host.now() < state.attackFinished) return false;
    const chance = state.standGround ? 0.4 : distance < 80 ? 0.8 : distance < 500 ? 0.7 : distance < 1000 ? 0.6 : 0.5;
    if (game.host.random() < chance || game.entity(entity.enemy)?.solid === "none") { state.attackState = "missile"; return true; }
    return false;
  }
  function attack(context: MonsterContext): undefined {
    const { entity, game, state } = context, own = source.get(entity), blocked = own.blocked, anger = state.targetAnger;
    state.moveTarget = null; own.blocked = false; state.targetAnger = false;
    if (enemyBody(context) === null) return undefined;
    if (services.badArea(entity.actor.id)) return game.host.random() < 0.1 || game.host.now() < entity.timestamp ? context.setMove("widow_move_attack_pre_blaster") : railMove(context);
    const railFrames = entity.frame === frame.walk13 || entity.frame >= frame.walk01 && entity.frame <= frame.walk03;
    const blasterFrames = entity.frame >= frame.walk09 && entity.frame <= frame.walk12;
    widowSlots(context);
    if ((state.attackState === "blind" || blocked) && widowSlotsLeft(context) >= 2) return context.setMove("widow_move_spawn");
    if (targetDistance(context) > 300 && !anger && game.host.random() < 0.5 && !blocked) return context.setMove("widow_move_run_attack");
    if (blasterFrames) {
      if (widowSlotsLeft(context) >= 2) return context.setMove("widow_move_spawn");
      if (state.pauseTime + 2 <= game.host.now()) return context.setMove("widow_move_attack_pre_blaster");
    }
    if (railFrames && game.host.now() >= entity.timestamp) return railMove(context);
    if (blasterFrames || railFrames) return undefined;
    const luck = game.host.random();
    if (widowSlotsLeft(context) >= 2) {
      if (luck <= 0.4 && state.pauseTime + 2 <= game.host.now()) return context.setMove("widow_move_attack_pre_blaster");
      if (luck <= 0.7 && game.host.now() >= entity.timestamp) return railMove(context);
      return context.setMove("widow_move_spawn");
    }
    if (game.host.now() < entity.timestamp) return context.setMove("widow_move_attack_pre_blaster");
    return luck <= 0.5 || game.host.now() + 2 >= state.pauseTime ? railMove(context) : context.setMove("widow_move_attack_pre_blaster");
  }
  return {
    classname: "monster_widow", kind: "widow", model: "models/monsters/blackwidow/tris.md2", health: 2000, gibHealth: -5000, mass: 1500,
    bounds: { min: { x: -40, y: -40, z: 0 }, max: { x: 40, y: 40, z: 144 } }, scale: 1, yawSpeed: 30,
    initialMove: "widow_move_stand", moves: widowMoves, stand(context) { context.game.sound(context.entity, "widow/laugh.wav", 2); return context.setMove("widow_move_stand"); }, walk: move("widow_move_walk"), run, sight(context) { context.state.pauseTime = 0; return undefined; },
    melee: move("widow_move_attack_kick"), attack, checkAttack,
    sourceCallbacks: { ...widowDebrisCallbacks, think: { ...widowDebrisCallbacks.think, ...rogueSpawnCallbacks.think, "q2:rogue/widow_powerups": powerThink } },
    initialize(context) {
      const { game, entity, state } = context; entity.maxHealth = 2000 + 1000 * game.options.skill + (game.options.mode === "coop" ? 500 * game.options.skill : 0);
      game.host.combat.setHealth(entity.actor, entity.maxHealth); entity.laserImmune = true; state.ignoreShots = true; entity.prethink = powerThink; widowSlots(context); source.widowDamageMultiplier = 1;
      if (game.options.skill === 3) monsterPowerArmor(context, "shield", 500); return undefined;
    },
    restore: widowRestoreArmor,
    blocked(context) {
      if (context.state.move.name === "widow_move_run_attack") { context.state.targetAnger = true; if (checkAttack(context)) attack(context); else run(context); return true; }
      return rogueBlockedCheckShot(context, 0.25 + 0.05 * context.game.options.skill, source);
    },
    pain(context, reaction) {
      damagedSkin(context); const { game, entity, state } = context, skill = game.options.skill;
      if (skill === 3 || game.host.now() < state.painTime) return undefined;
      if (state.pauseTime === 100000000) state.pauseTime = 0; state.painTime = game.host.now() + 5;
      if (reaction.damage < 15) return game.sound(entity, "widow/bw1pain1.wav", 2, 1, 0);
      if (game.host.random() < (reaction.damage < 75 ? 0.6 - 0.2 * skill : 0.75 - 0.1 * skill)) { state.manualSteering = false; context.setMove(reaction.damage < 75 ? "widow_move_pain_light" : "widow_move_pain_heavy"); }
      return game.sound(entity, reaction.damage < 75 ? "widow/bw1pain2.wav" : "widow/bw1pain3.wav", 2, 1, 0);
    },
    die(context) {
      context.state.dead = true; context.state.canTakeDamage = false; context.game.host.combat.setTraits(context.entity.actor, { canTakeDamage: false });
      context.entity.count = 0; widowClearPowerups(context, source); return context.setMove("widow_move_death");
    },
    callbacks: {
      widow_run: run, WidowBlaster: blaster,
      widow_step(context) { return context.game.sound(context.entity, "widow/bwstep3.wav", 4); },
      widow_stepshoot(context) { context.game.sound(context.entity, "widow/bwstep3.wav", 4); return blaster(context); },
      widow_start_run_5(context) { context.setMove("widow_move_run"); context.state.nextFrame = frame.walk05; return undefined; },
      widow_start_run_10(context) { context.setMove("widow_move_run"); context.state.nextFrame = frame.walk10; return undefined; },
      widow_start_run_12(context) { context.setMove("widow_move_run"); context.state.nextFrame = frame.walk12; return undefined; },
      widow_attack_blaster(context) { context.state.pauseTime = context.game.host.now() + 1 + 2 * context.game.host.random(); context.setMove("widow_move_attack_blaster"); context.state.nextFrame = torso(context); return undefined; },
      widow_reattack_blaster(context) {
        blaster(context); if (context.state.move.name === "widow_move_attack_post_blaster_r" || context.state.move.name === "widow_move_attack_post_blaster_l" || context.state.pauseTime >= context.game.host.now()) return undefined;
        context.state.manualSteering = false; return context.setMove("widow_move_attack_post_blaster");
      },
      WidowSaveLoc(context) { const eye = enemyEye(context); if (eye !== null) context.entity.pos1 = eye; return undefined; },
      WidowRail(context) {
        const flash = context.state.move.name === "widow_move_attack_rail_l" ? 154 : context.state.move.name === "widow_move_attack_rail_r" ? 155 : 150;
        const start = projectFlash(context, muzzleOffset(context.game.options.edition, flash)), direction = normalize(subtract(context.entity.pos1, start));
        context.weapons.fireRail(context.entity, context.game, start, direction, 50 * source.widowDamageMultiplier, 100); monsterFlash(context, flash, start, direction); context.entity.timestamp = context.game.host.now() + 3; return undefined;
      },
      widow_start_rail(context) { context.state.manualSteering = true; return undefined; },
      widow_rail_done(context) { context.state.manualSteering = false; return undefined; },
      widow_attack_rail(context) { const angle = targetAngle(context); return context.setMove(angle < -15 ? "widow_move_attack_rail_l" : angle > 15 ? "widow_move_attack_rail_r" : "widow_move_attack_rail"); },
      widow_start_spawn(context) { context.state.manualSteering = true; return undefined; },
      widow_done_spawn(context) { context.state.manualSteering = false; return undefined; },
      widow_ready_spawn(context) { blaster(context); return widowSummon(context, monsters, false, true); },
      widow_spawn_check(context) { blaster(context); return widowSummon(context, monsters, false, false); },
      widow_attack_kick(context) { const enemy = enemyBody(context); context.weapons.fireHit(context.entity, context.game, { x: 100, y: 0, z: 4 }, 50 + Math.floor(context.game.host.random() * 6), enemy?.ground === null ? 250 : 500); return undefined; },
      spawn_out_start(context) {
        const { entity, game } = context; entity.wait = game.host.now() + 2;
        widowEffect(game, widowProject(entity, game, { x: 12.58, y: -43.71, z: 68.88 }), "q2:widowbeamout", 20001);
        widowEffect(game, widowProject(entity, game, { x: 3.43, y: 58.72, z: 68.41 }), "q2:widowbeamout", 20002);
        return game.sound(entity, "misc/bwidowbeamout.wav", 2);
      },
      spawn_out_do(context) {
        const { entity, game } = context;
        widowEffect(game, widowProject(entity, game, { x: 12.58, y: -43.71, z: 68.88 }), "q2:widowsplash");
        widowEffect(game, widowProject(entity, game, { x: 3.43, y: 58.72, z: 68.41 }), "q2:widowsplash");
        const origin = game.body(entity).origin; widowEffect(game, { ...origin, z: origin.z + 36 }, "q2:bosstport"); spawnWidowLegs(entity, game); return game.remove(entity);
      },
      widow_dead(context) { return finishCorpse(context, { min: { x: -56, y: -56, z: 0 }, max: { x: 56, y: 56, z: 80 } }); },
    },
  };
}
