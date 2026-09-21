// Rerelease m_guncmdr.cpp. ZeniMax Media, GPL-2.0.
import type { ActorId } from "../../../../contracts/identity.ts";
import { add, dot, length, normalize, numberField, scale, subtract } from "../../foundation/fields.ts";
import { anglesVectors, clearShot, corpse, enemyBody, finishDodge, health, projectFlash, setDuck, targetDistance, visible } from "../../foundation/monsters/ai.ts";
import { throwGib } from "../../foundation/monsters/gibs.ts";
import { muzzleOffset } from "../../foundation/monsters/muzzle.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import type { Q2MissionPackMonsterWeapons } from "../../missionpacks/monsters/types.ts";
import { move, sound } from "../../base/monsters/common.ts";
import { slamRadiusDamage } from "./berserk.ts";
import { blockedCheckJump, blockedCheckPlatform, calculatePitchToFire, checkGib, monsterFlash, monsterJumpFinished, predictedDirection, reactsToPain } from "./common.ts";
import { guncmdrFrame as frame, guncmdrMoves } from "./tables/guncmdr.ts";
import { rereleaseFlash as flash } from "./tables/flashes.ts";

function run(context: MonsterContext): undefined { finishDodge(context); return context.setMove(context.state.standGround ? "guncmdr_move_stand" : "guncmdr_move_run"); }
function behind(context: MonsterContext, actor: ActorId | null): boolean {
  const other = actor === null ? null : context.game.host.bodies.read(actor);
  if (other === null) return false;
  const body = context.game.body(context.entity), delta = subtract(other.origin, body.origin);
  return dot(normalize({ ...delta, z: 0 }), anglesVectors(body.angles).forward) < -0.4;
}
function canAdvance(context: MonsterContext): boolean {
  const body = context.game.body(context.entity), end = add(body.origin, scale(anglesVectors(body.angles).forward, 8));
  return context.game.host.trace({ start: body.origin, end, bounds: body.bounds, ignore: context.entity.actor.id, mask: 0x2020003 }).fraction === 1;
}
function fireChain(context: MonsterContext, immediate = true): undefined {
  return context.setMove(!context.state.standGround && enemyBody(context) !== null && targetDistance(context) > 400 && canAdvance(context) ? "guncmdr_move_fire_chain_run" : "guncmdr_move_fire_chain", immediate);
}
function attack(context: MonsterContext): undefined {
  finishDodge(context);
  const enemy = enemyBody(context); if (enemy === null) return undefined;
  const distance = targetDistance(context), body = context.game.body(context.entity);
  if (distance < 80 && context.state.meleeTime < context.game.host.now()) return context.setMove("guncmdr_move_attack_kick");
  if ((distance <= 100 || context.game.host.random() < 0.5) && clearShot(context, muzzleOffset("rerelease", flash.GUNCMDR_CHAINGUN_1))) return context.setMove("guncmdr_move_attack_chain");
  const aim = normalize(subtract(enemy.origin, body.origin)), mortarOffset = muzzleOffset("rerelease", flash.GUNCMDR_GRENADE_MORTAR_1), frontOffset = muzzleOffset("rerelease", flash.GUNCMDR_GRENADE_FRONT_1);
  if ((distance >= 525 || Math.abs(body.origin.z + body.bounds.min.z - enemy.origin.z - enemy.bounds.max.z) > 64) && clearShot(context, mortarOffset) && calculatePitchToFire(context, enemy.origin, projectFlash(context, mortarOffset), aim, 850, 2.5, true) !== null) {
    context.setMove("guncmdr_move_attack_mortar"); return setDuck(context, true);
  }
  if (clearShot(context, frontOffset) && !context.state.standGround && calculatePitchToFire(context, enemy.origin, projectFlash(context, frontOffset), aim, 600, 2.5, false) !== null) return context.setMove("guncmdr_move_attack_grenade_back");
  if (context.state.standGround) context.setMove("guncmdr_move_attack_chain");
  return undefined;
}
function jump(context: MonsterContext, high: boolean): undefined {
  const body = context.game.body(context.entity), axes = anglesVectors(body.angles);
  return context.game.move(context.entity, { velocity: add(body.velocity, add(scale(axes.forward, high ? 150 : 100), scale(axes.up, high ? 400 : 300))) });
}
function sidestep(context: MonsterContext): boolean {
  const current = context.state.move.name, side = context.state.lefty ? "left" : "right";
  if (current === "guncmdr_move_fire_chain" || current === "guncmdr_move_fire_chain_run") context.setMove(`guncmdr_move_fire_chain_dodge_${side}`, false);
  else if (current === "guncmdr_move_attack_grenade_back") { context.entity.count = context.entity.frame; context.setMove(`guncmdr_move_attack_grenade_back_dodge_${side}`, false); }
  else if (current === "guncmdr_move_attack_mortar") { context.entity.count = context.entity.frame; context.setMove("guncmdr_move_attack_mortar_dodge", false); }
  else if (current === "guncmdr_move_run") context.setMove("guncmdr_move_run");
  else return false;
  return true;
}
function bindArmor(context: MonsterContext): undefined {
  const { entity, game } = context;
  return game.host.combat.bindPowerArmorCells(entity.actor, {
    read: () => game.host.inventory.count(entity.actor.id, "q2:monster-power"),
    write: count => game.host.inventory.configure(entity.actor, { item: "q2:monster-power", count, capacity: Math.max(200, numberField(entity.spawn, "power_armor_power", 200)) }),
  });
}

export function createGunCommanderDefinition(weapons: Q2MissionPackMonsterWeapons): Q2MonsterDefinition {
  return {
    classname: "monster_guncmdr", kind: "guncmdr", model: "models/monsters/gunner/tris.md2", health: 325, gibHealth: -175, mass: 255, scale: Math.fround(1.15),
    bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 36 } }, initialMove: "guncmdr_move_stand", moves: guncmdrMoves,
    stand: move("guncmdr_move_stand"), walk: move("guncmdr_move_walk"), run, attack, sidestep,
    sight: sound("guncmdr/sight1.wav"), search: sound("guncmdr/gcdrsrch1.wav"),
    initialize(context) {
      const { entity, game, state } = context; entity.scale = 1.25; entity.skin = 2; state.scale = Math.fround(Math.fround(1.15) * 1.25);
      game.move(entity, { bounds: { min: { x: -20, y: -20, z: -30 }, max: { x: 20, y: 20, z: 45 } } });
      state.normalHeight = 45; entity.viewHeight = 37; game.host.combat.setTraits(entity.actor, { mass: 255 * 1.25 });
      if (!game.host.inventory.has(entity.actor.id)) game.host.inventory.create(entity.actor, []);
      const cells = numberField(entity.spawn, "power_armor_power", 200), type = numberField(entity.spawn, "power_armor_type", 2);
      game.host.inventory.configure(entity.actor, { item: "q2:monster-power", count: cells, capacity: Math.max(200, cells) }); bindArmor(context);
      return game.host.combat.setPoweredProtection(entity.actor, type === 0 ? { kind: "none" } : { kind: type === 1 ? "screen" : "shield", cells });
    },
    restore: bindArmor,
    duck(context) {
      const current = context.state.move.name;
      if (current === "guncmdr_move_jump" || current === "guncmdr_move_jump2") return false;
      if (current.includes("_dodge")) { setDuck(context, false); return false; }
      context.setMove("guncmdr_move_duck_attack"); return true;
    },
    blocked(context, distance) {
      if (blockedCheckPlatform(context, distance)) return true;
      const result = blockedCheckJump(context, distance, 192, 40, (context.entity.spawnflags & 8) === 0);
      if (result === "none") return false;
      if (result !== "turn" && enemyBody(context) !== null) { finishDodge(context); context.setMove(result === "up" ? "guncmdr_move_jump2" : "guncmdr_move_jump"); }
      return true;
    },
    pain(context, reaction) {
      const { game, entity, state } = context; finishDodge(context);
      entity.skin = health(game, entity.actor.id) < entity.maxHealth / 2 ? entity.skin | 1 : entity.skin & ~1;
      if (["guncmdr_move_jump", "guncmdr_move_jump2", "guncmdr_move_duck_attack"].includes(state.move.name)) return undefined;
      const dodge = (): undefined => { if (game.host.random() < 0.3 && reaction.attacker !== null) context.dodge(reaction.attacker, game.host.frameSeconds(), null, false); return undefined; };
      if (game.host.now() < state.painTime) return dodge();
      state.painTime = game.host.now() + 3; game.sound(entity, game.host.random() < 0.5 ? "guncmdr/gcdrpain2.wav" : "guncmdr/gcdrpain1.wav", 2);
      if (!reactsToPain(context)) return dodge();
      if (reaction.damage < 35) { const choice = Math.floor(game.host.random() * 4); context.setMove(`guncmdr_move_pain${choice === 0 ? 3 : choice === 1 ? 2 : choice === 2 ? 1 : 7}`); }
      else { context.setMove(behind(context, reaction.attacker) ? "guncmdr_move_pain6" : game.host.random() < 0.5 ? "guncmdr_move_pain4" : "guncmdr_move_pain5"); state.painTime += 1.5; }
      state.manualSteering = false; if (state.ducked) setDuck(context, false); return undefined;
    },
    die(context, reaction) {
      const { entity, game, state } = context;
      if (checkGib(context)) {
        game.sound(entity, "misc/udeath.wav", 2); entity.skin = Math.trunc(entity.skin / 2);
        for (let i = 0; i < 2; i++) { throwGib(entity, game, "models/objects/gibs/bone/tris.md2", reaction.damage); throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", reaction.damage); }
        throwGib(entity, game, "models/objects/gibs/gear/tris.md2", reaction.damage);
        for (const part of ["chest", "garm", "gun", "foot"]) throwGib(entity, game, `models/monsters/gunner/gibs/${part}.md2`, reaction.damage, { skinned: true, upright: part === "garm" || part === "gun" });
        throwGib(entity, game, state.move.name !== "guncmdr_move_death5" ? "models/objects/gibs/sm_meat/tris.md2" : "models/monsters/gunner/gibs/head.md2", reaction.damage, { head: true, skinned: true });
        state.dead = true; state.gibbed = true; return undefined;
      }
      if (state.dead) return undefined;
      game.sound(entity, "guncmdr/gcdrdeath1.wav", 2); state.dead = true; state.canTakeDamage = true; game.host.combat.setTraits(entity.actor, { canTakeDamage: true });
      if (state.move.name === "guncmdr_move_pain5" && entity.frame < frame.c_pain508 || state.move.name === "guncmdr_move_pain6" && entity.frame < frame.c_pain607) return undefined;
      const body = game.body(entity);
      if (Math.abs(body.origin.z + entity.viewHeight - reaction.point.z) <= 4 && body.velocity.z < 65) {
        context.setMove("guncmdr_move_death5");
        const head = throwGib(entity, game, "models/monsters/gunner/gibs/head.md2", reaction.damage), inflictor = reaction.inflictor === null ? null : game.host.bodies.read(reaction.inflictor);
        if (head !== null) { const direction = normalize(subtract(body.origin, inflictor?.origin ?? body.origin)); head.angularVelocity = scale(head.angularVelocity, 0.15); game.move(head, { origin: add(body.origin, { x: 0, y: 0, z: 24 }), angles: body.angles, velocity: { ...scale(direction, 100), z: 200 } }); }
      } else if (behind(context, reaction.inflictor)) { const choice = Math.floor(game.host.random() * (state.move.name === "guncmdr_move_pain6" ? 2 : 3)); context.setMove(choice === 0 ? "guncmdr_move_death3" : choice === 1 ? "guncmdr_move_death7" : "guncmdr_move_pain6"); }
      else context.setMove(Math.floor(game.host.random() * (state.move.name === "guncmdr_move_pain5" ? 1 : 2)) === 0 ? "guncmdr_move_death4" : "guncmdr_move_pain5");
      return undefined;
    },
    callbacks: {
      guncmdr_stand: move("guncmdr_move_stand"), guncmdr_run: run,
      guncmdr_idlesound: sound("guncmdr/gcdridle1.wav", 2, 2), guncmdr_opengun: sound("guncmdr/gcdratck1.wav", 2, 2),
      guncmdr_fidget(context) { if (!context.state.standGround && context.entity.enemy === null && context.game.host.random() <= 0.05) context.setMove("guncmdr_move_fidget"); return undefined; },
      guncmdr_pain5_to_death1(context) { if (health(context.game, context.entity.actor.id) < 0) context.setMove("guncmdr_move_death1", false); return undefined; },
      guncmdr_pain5_to_death2(context) { if (health(context.game, context.entity.actor.id) < 0 && context.game.host.random() < 0.5) context.setMove("guncmdr_move_death2", false); return undefined; },
      guncmdr_pain6_to_death6(context) { if (health(context.game, context.entity.actor.id) < 0) context.setMove("guncmdr_move_death6", false); return undefined; },
      guncmdr_dead(context) { corpse(context); return context.game.move(context.entity, { bounds: { min: scale({ x: -16, y: -16, z: -24 }, context.entity.scale), max: scale({ x: 16, y: 16, z: -8 }, context.entity.scale) } }); },
      guncmdr_shrink(context) { context.entity.serverFlags |= 2; const bounds = context.game.body(context.entity).bounds; return context.game.move(context.entity, { bounds: { min: bounds.min, max: { ...bounds.max, z: -4 * context.entity.scale } } }); },
      guncmdr_fire_chain: context => fireChain(context),
      guncmdr_refire_chain(context) { finishDodge(context); context.state.attackState = "straight"; return health(context.game, context.entity.enemy) > 0 && visible(context) && context.game.host.random() <= 0.5 ? fireChain(context, false) : context.setMove("guncmdr_move_endfire_chain", false); },
      GunnerCmdrFire(context) {
        const { game, entity } = context; if (enemyBody(context) === null) return undefined;
        const id = entity.frame >= frame.c_attack401 && entity.frame <= frame.c_attack505 ? flash.GUNCMDR_CHAINGUN_2 : flash.GUNCMDR_CHAINGUN_1;
        const start = projectFlash(context, muzzleOffset("rerelease", id)), aim = predictedDirection(context, start, 800, false, game.host.random() * 0.3);
        if (aim === null) return undefined;
        const direction = { x: aim.x + (game.host.random() * 2 - 1) * 0.025, y: aim.y + (game.host.random() * 2 - 1) * 0.025, z: aim.z + (game.host.random() * 2 - 1) * 0.025 };
        weapons.fireFlechette(entity, game, start, direction, 4, 800, 2); return monsterFlash(context, id, start, direction);
      },
      GunnerCmdrGrenade(context) {
        const { game, entity, state } = context, enemy = enemyBody(context); if (enemy === null) return undefined;
        const shots = [
          { frame: frame.c_attack205, spread: -0.1, id: flash.GUNCMDR_GRENADE_MORTAR_1, kind: "mortar" }, { frame: frame.c_attack208, spread: 0, id: flash.GUNCMDR_GRENADE_MORTAR_2, kind: "mortar" }, { frame: frame.c_attack211, spread: 0.1, id: flash.GUNCMDR_GRENADE_MORTAR_3, kind: "mortar" },
          { frame: frame.c_attack304, spread: -0.1, id: flash.GUNCMDR_GRENADE_FRONT_1, kind: "front" }, { frame: frame.c_attack307, spread: 0, id: flash.GUNCMDR_GRENADE_FRONT_2, kind: "front" }, { frame: frame.c_attack310, spread: 0.1, id: flash.GUNCMDR_GRENADE_FRONT_3, kind: "front" },
          { frame: frame.c_attack911, spread: 0.25, id: flash.GUNCMDR_GRENADE_CROUCH_1, kind: "crouch" }, { frame: frame.c_attack912, spread: 0, id: flash.GUNCMDR_GRENADE_CROUCH_2, kind: "crouch" }, { frame: frame.c_attack913, spread: -0.25, id: flash.GUNCMDR_GRENADE_CROUCH_3, kind: "crouch" },
        ];
        const shot = shots.find(candidate => candidate.frame === entity.frame); if (shot === undefined) return undefined;
        const target = state.manualSteering && !visible(context) ? state.blindFireTarget : enemy.origin;
        if (state.manualSteering && !visible(context) && length(target) === 0) return undefined;
        const body = game.body(entity), axes = anglesVectors(body.angles), start = projectFlash(context, muzzleOffset("rerelease", shot.id));
        let delta = subtract(target, body.origin), pitch = 0;
        if (shot.kind !== "crouch") {
          const distance = length(delta); if (distance > 512 && delta.z < 64 && delta.z > -64) delta = { ...delta, z: delta.z + distance - 512 };
          pitch = Math.max(-0.5, Math.min(0.4, normalize(delta).z));
          if (enemy.origin.z + enemy.bounds.min.z - body.origin.z - body.bounds.max.z > 16 && shot.kind === "mortar") pitch += 0.5;
        }
        if (shot.kind === "front") pitch -= 0.05;
        const direction = shot.kind === "crouch" ? predictedDirection(context, start, 800, false) : add(axes.forward, scale(axes.up, pitch));
        if (direction === null) return undefined;
        const aim = normalize(add(direction, scale(axes.right, shot.spread)));
        if (shot.kind === "crouch") for (let i = 0; i < 3; i++) weapons.fireIonRipper(entity, game, start, add(aim, scale(axes.right, -0.25 + 0.125 * (i + 1))), 15, 800, 0x100000);
        else {
          const speed = shot.kind === "mortar" ? 850 : 600, predicted = calculatePitchToFire(context, target, start, aim, speed, 2.5, shot.kind === "mortar");
          const right = (game.host.random() * 2 - 1) * 10, up = predicted === null ? 200 + (game.host.random() * 2 - 1) * 10 : game.host.random() * 10;
          context.weapons.fireGrenade(entity, game, start, predicted ?? aim, 50, speed, 2.5, 90, false, false, true, { right, up, gravity: game.host.gravity() });
        }
        return monsterFlash(context, shot.id, start, aim);
      },
      guncmdr_grenade_mortar_resume(context) { context.setMove("guncmdr_move_attack_mortar"); context.state.attackState = "straight"; context.entity.frame = context.entity.count; return undefined; },
      guncmdr_grenade_back_dodge_resume(context) { context.setMove("guncmdr_move_attack_grenade_back"); context.state.attackState = "straight"; context.entity.frame = context.entity.count; return undefined; },
      guncmdr_kick_finished(context) { context.state.meleeTime = context.game.host.now() + 3; return attack(context); },
      guncmdr_kick(context) {
        const { entity, game } = context;
        if (context.weapons.fireHit(entity, game, { x: 80, y: 0, z: -32 }, 15, 400) && entity.enemy !== null && game.host.isPlayer(entity.enemy)) {
          const body = game.host.bodies.read(entity.enemy), actor = game.host.actors.resolveOwned(entity.enemy);
          if (body !== null && actor !== null && body.velocity.z < 270) game.host.bodies.write(actor, { ...body, velocity: { ...body.velocity, z: 270 } });
        }
        return undefined;
      },
      guncmdr_jump_now: context => jump(context, false), guncmdr_jump2_now: context => jump(context, true),
      guncmdr_jump_wait_land(context) { context.state.nextFrame = context.game.body(context.entity).ground !== null || monsterJumpFinished(context) ? context.entity.frame + 1 : context.entity.frame; return undefined; },
      GunnerCmdrCounter(context) {
        const { game, entity } = context, body = game.body(entity), direction = anglesVectors(body.angles).forward;
        const trace = game.host.trace({ start: body.origin, end: projectFlash(context, { x: 20, y: 0, z: 14 }), bounds: null, ignore: entity.actor.id, mask: 3 });
        game.host.emit({ kind: "effect", effect: "q2:berserk-slam", origin: trace.end, direction, count: 1, color: 0 });
        return slamRadiusDamage(context, trace.end, 15, 250, 200);
      },
    },
  };
}
