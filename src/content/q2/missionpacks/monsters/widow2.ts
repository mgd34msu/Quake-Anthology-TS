/* Original Rogue m_widow2.c. ZeniMax Media, GPL-2.0-or-later. */
import type { Vec3 } from "../../../../contracts/math.ts";
import { add, length, normalize, scale, subtract, zero } from "../../foundation/fields.ts";
import { anglesVectors, changeYaw, enemyBody, enemyEye, health, inFront, projectFlash, targetDistance, vectorAngles } from "../../foundation/monsters/ai.ts";
import { throwGib, throwHead } from "../../foundation/monsters/gibs.ts";
import type { Q2Monsters } from "../../foundation/monsters/index.ts";
import { muzzleOffset } from "../../foundation/monsters/muzzle.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { recordAt } from "../../foundation/monsters/types.ts";
import { damagedSkin, move } from "../../base/monsters/common.ts";
import { monsterFlash, predictedDirection } from "../../rerelease/monsters/common.ts";
import { monsterPowerArmor } from "./power-armor.ts";
import { rogueSpawnCallbacks } from "./spawn.ts";
import type { Q2MissionPackMonsterState } from "./state.ts";
import { widow2Frame as frame, widow2Moves } from "./tables/rogue-widow2.ts";
import type { Q2MissionPackMonsterServices, Q2MissionPackMonsterWeapons } from "./types.ts";
import { widowClearPowerups, widowPowerThink, widowPowerups, widowProject, widowRestoreArmor, widowSlots, widowSlotsLeft, widowSummon } from "./widow/common.ts";
import { createWidowExplode, widowDebrisCallbacks, widowExplosion, widowExplosionLeg, widowGib } from "./widow/death.ts";

const tongueOffsets: readonly Vec3[] = [
  { x: 17.48, y: 0.10, z: 68.92 }, { x: 17.47, y: 0.29, z: 68.91 }, { x: 17.45, y: 0.53, z: 68.87 }, { x: 17.42, y: 0.78, z: 68.81 },
  { x: 17.39, y: 1.02, z: 68.75 }, { x: 17.37, y: 1.20, z: 68.70 }, { x: 17.36, y: 1.24, z: 68.71 }, { x: 17.37, y: 1.21, z: 68.72 },
];
function tongueOkay(start: Vec3, end: Vec3): boolean {
  const delta = subtract(start, end); let pitch = vectorAngles(delta).x; if (pitch < -180) pitch += 360;
  return length(delta) <= 256 && Math.abs(pitch) <= 30;
}
function saveBeam(context: MonsterContext): undefined {
  const enemy = enemyBody(context); context.entity.pos2 = enemy === null ? zero : context.entity.pos1; context.entity.pos1 = enemy?.origin ?? zero; return undefined;
}
export function createWidow2Definition(monsters: Q2Monsters, weapons: Q2MissionPackMonsterWeapons, services: Q2MissionPackMonsterServices, source: Q2MissionPackMonsterState): Q2MonsterDefinition {
  const powerThink = widowPowerThink(monsters, source), explode = createWidowExplode(monsters);
  const run = (context: MonsterContext): undefined => { context.state.holdFrame = false; return context.setMove(context.state.standGround ? "widow2_move_stand" : "widow2_move_run"); };
  function beam(context: MonsterContext): undefined {
    const { entity, game } = context, enemy = enemyBody(context); if (enemy === null) return undefined;
    let flash: number, direction: Vec3;
    if (entity.frame >= frame.spawn04 && entity.frame <= frame.spawn14) {
      const index = entity.frame - frame.spawn04; flash = 200 + index;
      const start = projectFlash(context, muzzleOffset(game.options.edition, flash)), angles = game.body(entity).angles;
      direction = anglesVectors({ ...angles, x: angles.x + vectorAngles(subtract(enemy.origin, start)).x, y: angles.y - (-40 + index * 8) }).forward;
      weapons.fireHeatBeam(entity, game, start, direction, zero, 10, 50); return monsterFlash(context, flash, start, direction);
    }
    saveBeam(context);
    const firing = entity.frame >= frame.fireb05 && entity.frame <= frame.fireb09;
    flash = firing ? 195 + entity.frame - frame.fireb05 : 195;
    const start = projectFlash(context, muzzleOffset(game.options.edition, flash)), height = (enemyEye(context)?.z ?? enemy.origin.z) - enemy.origin.z;
    direction = normalize(subtract({ ...entity.pos2, z: entity.pos2.z + height - 10 }, start));
    weapons.fireHeatBeam(entity, game, start, direction, zero, 10, 50);
    if (firing) monsterFlash(context, flash, start, direction);
    return undefined;
  }
  function tonguePull(context: MonsterContext): undefined {
    const { entity, game } = context, enemy = enemyBody(context);
    if (enemy === null || entity.enemy === null) return run(context);
    const start = widowProject(entity, game, recordAt(tongueOffsets, entity.frame - frame.tongs01));
    if (!tongueOkay(start, enemy.origin)) return undefined;
    const actor = game.host.actors.resolveOwned(entity.enemy); if (actor === null) return undefined;
    const origin = enemy.ground === null ? enemy.origin : { ...enemy.origin, z: enemy.origin.z + 1 };
    const delta = subtract(game.body(entity).origin, origin);
    let velocity: Vec3;
    if (game.host.isPlayer(entity.enemy)) velocity = add(enemy.velocity, scale(normalize(delta), 1000));
    else {
      const target = monsters.context(entity.enemy); if (target !== null) { target.state.idealYaw = vectorAngles(delta).y; changeYaw(target); }
      velocity = scale(anglesVectors(game.body(entity).angles).forward, 1000);
    }
    game.host.bodies.write(actor, { ...enemy, angles: game.host.bodies.read(actor.id)?.angles ?? enemy.angles, origin, ground: null, velocity });
    const target = game.entity(entity.enemy); if (target !== null) game.motion(target, target.motion);
    return undefined;
  }
  function checkAttack(context: MonsterContext): boolean {
    const { entity, game, state } = context, enemy = enemyBody(context), eye = enemyEye(context);
    if (enemy === null || eye === null || entity.enemy === null) return false;
    widowPowerups(context, services, source);
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
    if (entity.timestamp < game.host.now() && distance < 300 && tongueOkay(widowProject(entity, game, recordAt(tongueOffsets, 0)), enemy.origin)) {
      if (game.options.skill === 0 && Math.floor(game.host.random() * 4) !== 0) return false; state.attackState = "melee"; return true;
    }
    if (game.host.now() < state.attackFinished) return false;
    const chance = state.standGround ? 0.4 : distance < 1000 ? 0.8 : 0.5;
    if (game.host.random() < chance || game.entity(entity.enemy)?.solid === "none") { state.attackState = "missile"; return true; }
    return false;
  }
  return {
    classname: "monster_widow2", kind: "widow2", model: "models/monsters/blackwidow2/tris.md2", health: 2800, gibHealth: -900, mass: 2500,
    bounds: { min: { x: -70, y: -70, z: 0 }, max: { x: 70, y: 70, z: 144 } }, scale: 1, yawSpeed: 30,
    initialMove: "widow2_move_stand", moves: widow2Moves, stand: move("widow2_move_stand"), walk: move("widow2_move_walk"), run, melee: move("widow2_move_tongs"), checkAttack,
    sourceCallbacks: { ...widowDebrisCallbacks, think: { ...widowDebrisCallbacks.think, ...rogueSpawnCallbacks.think, "q2:rogue/widow2_powerups": powerThink, "q2:rogue/WidowExplode": explode } },
    initialize(context) {
      const { game, entity, state } = context; entity.maxHealth = 2800 + 1000 * game.options.skill + (game.options.mode === "coop" ? 500 * game.options.skill : 0);
      game.host.combat.setHealth(entity.actor, entity.maxHealth); entity.laserImmune = true; state.ignoreShots = true; entity.prethink = powerThink; widowSlots(context);
      if (game.options.skill === 3) monsterPowerArmor(context, "shield", 750); return undefined;
    },
    restore: widowRestoreArmor,
    search(context) { if (context.game.host.random() < 0.5) context.game.sound(context.entity, "bosshovr/bhvunqv1.wav", 2, 1, 0); return undefined; },
    attack(context) {
      const { entity, game, state } = context, blocked = source.get(entity).blocked; source.get(entity).blocked = false;
      if (enemyBody(context) === null) return undefined;
      const ready = game.host.now() >= state.attackFinished;
      if (services.badArea(entity.actor.id)) return context.setMove(game.host.random() < 0.75 || !ready ? "widow2_move_attack_pre_beam" : "widow2_move_attack_disrupt");
      widowSlots(context);
      if ((state.attackState === "blind" || blocked) && widowSlotsLeft(context) >= 2) return context.setMove("widow2_move_spawn");
      const luck = game.host.random(), slots = widowSlotsLeft(context) >= 2;
      if (targetDistance(context) < 600) {
        if (slots) { if (luck <= 0.4) return context.setMove("widow2_move_attack_pre_beam"); return context.setMove(luck <= 0.7 && ready ? "widow2_move_attack_disrupt" : "widow2_move_spawn"); }
        return context.setMove(luck <= 0.5 || !ready ? "widow2_move_attack_pre_beam" : "widow2_move_attack_disrupt");
      }
      if (slots) { if (luck < 0.3) return context.setMove("widow2_move_attack_pre_beam"); return context.setMove(luck < 0.65 || !ready ? "widow2_move_spawn" : "widow2_move_attack_disrupt"); }
      return context.setMove(luck < 0.45 || !ready ? "widow2_move_attack_pre_beam" : "widow2_move_attack_disrupt");
    },
    pain(context, reaction) {
      damagedSkin(context); const { game, entity, state } = context, skill = game.options.skill;
      if (skill === 3 || game.host.now() < state.painTime) return undefined;
      state.painTime = game.host.now() + 5;
      game.sound(entity, reaction.damage < 15 ? "widow/bw2pain1.wav" : reaction.damage < 75 ? "widow/bw2pain2.wav" : "widow/bw2pain3.wav", 2, 1, 0);
      if (reaction.damage >= 15 && game.host.random() < (reaction.damage < 75 ? 0.6 - 0.2 * skill : 0.75 - 0.1 * skill)) { state.manualSteering = false; context.setMove("widow2_move_pain"); }
      return undefined;
    },
    die(context, reaction) {
      const { entity, game, state } = context;
      if (health(game, entity.actor.id) <= state.gibHealth) {
        const clipped = Math.min(reaction.damage, 100); game.sound(entity, "misc/udeath.wav", 2);
        for (let i = 0; i < 2; i++) widowGib(entity, game, "models/objects/gibs/bone/tris.md2", clipped, true, null, false, "", false);
        for (let i = 0; i < 3; i++) widowGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", clipped, true, null, false, "", false);
        for (let i = 0; i < 3; i++) {
          widowGib(entity, game, "models/monsters/blackwidow2/gib1/tris.md2", clipped, false, null, true, "", false);
          widowGib(entity, game, "models/monsters/blackwidow2/gib2/tris.md2", clipped, false, null, true, "misc/fhit3.wav", false);
        }
        for (let i = 0; i < 2; i++) {
          widowGib(entity, game, "models/monsters/blackwidow2/gib3/tris.md2", clipped, false, null, true, "", false);
          widowGib(entity, game, "models/monsters/blackwidow/gib3/tris.md2", clipped, false, null, true, "", false);
        }
        throwGib(entity, game, "models/objects/gibs/chest/tris.md2", clipped); throwHead(entity, game, "models/objects/gibs/head2/tris.md2", clipped); state.dead = true; state.gibbed = true; return undefined;
      }
      if (state.dead) return undefined;
      game.sound(entity, "widow/death.wav", 2, 1, 0); state.dead = true; state.canTakeDamage = false; game.host.combat.setTraits(entity.actor, { canTakeDamage: false }); entity.count = 0;
      for (const child of game.entities.values()) if (child.classname === "monster_stalker" && health(game, child.actor.id) > 0) game.damage(child.actor.id, entity, entity.actor.id, health(game, child.actor.id) + 1, 0, zero, enemyBody(context)?.origin ?? game.body(entity).origin, zero, 0, 8);
      widowClearPowerups(context, source); return context.setMove("widow2_move_death");
    },
    callbacks: {
      widow2_run: run, Widow2Beam: beam, Widow2SaveBeamTarget: saveBeam, Widow2StartSweep: saveBeam,
      Widow2BeamTargetRemove(context) { context.entity.pos1 = zero; context.entity.pos2 = zero; return undefined; },
      widow2_attack_beam: move("widow2_move_attack_beam"),
      widow2_reattack_beam(context) {
        context.state.manualSteering = false;
        if (context.entity.enemy !== null && inFront(context, context.entity.enemy) && context.game.host.random() <= 0.5) return context.setMove(context.game.host.random() < 0.7 || widowSlotsLeft(context) < 2 ? "widow2_move_attack_beam" : "widow2_move_spawn");
        return context.setMove("widow2_move_attack_post_beam");
      },
      Widow2SaveDisruptLoc(context) { context.entity.pos1 = enemyEye(context) ?? zero; return undefined; },
      WidowDisrupt(context) {
        const enemy = enemyBody(context); if (enemy === null) return undefined;
        const start = projectFlash(context, muzzleOffset(context.game.options.edition, 148));
        const locked = length(subtract(context.entity.pos1, enemy.origin)) < 30;
        const direction = locked ? normalize(subtract(context.entity.pos1, start)) : predictedDirection(context, start, 1200, true);
        if (direction === null) return undefined;
        weapons.fireTracker(context.entity, context.game, start, direction, 20, locked ? 500 : 1200, locked ? context.entity.enemy : null); return monsterFlash(context, 148, start, direction);
      },
      widow2_disrupt_reattack(context) { if (context.game.host.random() < 0.25 + 0.15 * context.game.options.skill) context.state.nextFrame = frame.firea01; return undefined; },
      widow_start_spawn(context) { context.state.manualSteering = true; return undefined; },
      widow2_ready_spawn(context) { beam(context); return widowSummon(context, monsters, true, true); },
      widow2_spawn_check(context) { beam(context); return widowSummon(context, monsters, true, false); },
      Widow2Tongue(context) {
        const { entity, game } = context, enemy = enemyBody(context); if (enemy === null || entity.enemy === null) return undefined;
        const start = widowProject(entity, game, recordAt(tongueOffsets, entity.frame - frame.tongs01));
        if (!tongueOkay(start, enemy.origin) && !tongueOkay(start, { ...enemy.origin, z: enemy.origin.z + enemy.bounds.max.z - 8 }) && !tongueOkay(start, { ...enemy.origin, z: enemy.origin.z + enemy.bounds.min.z + 8 })) return undefined;
        const trace = game.host.trace({ start, end: enemy.origin, bounds: null, ignore: entity.actor.id, mask: 1 | 2 | 0x2000000 | 0x4000000 });
        if (trace.hit.kind !== "actor" || !trace.hit.actor.equals(entity.enemy)) return undefined;
        game.sound(entity, "brain/brnatck3.wav", 1); game.host.emit({ kind: "monster-beam", effect: "parasite", actor: entity.actor.id, start, end: enemy.origin });
        game.damage(entity.enemy, entity, entity.actor.id, 2, 0, subtract(start, enemy.origin), enemy.origin, zero, 0, 8); return undefined;
      },
      Widow2TonguePull: tonguePull,
      Widow2Crunch(context) { if (enemyBody(context) === null) return run(context); tonguePull(context); const enemy = enemyBody(context); context.weapons.fireHit(context.entity, context.game, { x: 150, y: 0, z: 4 }, 20 + Math.floor(context.game.host.random() * 6), context.entity.frame !== frame.tongs07 ? 0 : enemy?.ground === null ? 250 : 500); return undefined; },
      Widow2Toss(context) { context.entity.timestamp = context.game.host.now() + 3; return undefined; },
      WidowExplosion1(context) { return widowExplosion(context, { x: 23.74, y: -37.67, z: 76.96 }); },
      WidowExplosion2(context) { return widowExplosion(context, { x: -20.49, y: 36.92, z: 73.52 }); },
      WidowExplosion3(context) { return widowExplosion(context, { x: 2.11, y: 0.05, z: 92.20 }); },
      WidowExplosion4(context) { return widowExplosion(context, { x: -28.04, y: -35.57, z: -77.56 }); },
      WidowExplosion5(context) { return widowExplosion(context, { x: -20.11, y: -1.11, z: 40.76 }); },
      WidowExplosion6(context) { return widowExplosion(context, { x: -20.11, y: -1.11, z: 40.76 }); },
      WidowExplosion7(context) { return widowExplosion(context, { x: -20.11, y: -1.11, z: 40.76 }); }, WidowExplosionLeg: widowExplosionLeg,
      WidowExplode(context) { return explode(context.entity, context.game); },
      widow2_start_searching(context) { context.entity.count = 0; return undefined; },
      widow2_keep_searching(context) { if (context.entity.count <= 2) { context.setMove("widow2_move_dead"); context.entity.frame = frame.dthsrh01; context.entity.count++; } else context.setMove("widow2_move_really_dead"); return undefined; },
      widow2_finaldeath(context) {
        const { entity, game, state } = context; state.corpse = true; state.canTakeDamage = true; game.host.combat.setTraits(entity.actor, { canTakeDamage: true });
        game.move(entity, { bounds: { min: { x: -70, y: -70, z: 0 }, max: { x: 70, y: 70, z: 80 } } }); game.motion(entity, "toss"); return game.cancel(entity);
      },
    },
  };
}
