// Rerelease m_supertank.cpp. ZeniMax Media, GPL-2.0.
import { normalize, numberField, subtract, zero } from "../../foundation/fields.ts";
import { clearShot, enemyBody, enemyEye, health, projectFlash, targetDistance, visible } from "../../foundation/monsters/ai.ts";
import { throwGib } from "../../foundation/monsters/gibs.ts";
import { muzzleOffset } from "../../foundation/monsters/muzzle.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import type { Q2MissionPackMonsterWeapons } from "../../missionpacks/monsters/types.ts";
import { supertankDefinition } from "../../base/monsters/supertank.ts";
import { bossExplode, bossExplodeThink } from "./boss.ts";
import { blockedCheckPlatform, calculatePitchToFire, chainfist, checkGib, monsterFlash, predictAim, predictedDirection, reactsToPain } from "./common.ts";
import { supertankFrame as frame, supertankMoves } from "./tables/supertank.ts";
import { rereleaseFlash } from "./tables/flashes.ts";

function bindArmor(context: MonsterContext): undefined {
  return context.game.host.combat.bindPowerArmorCells(context.entity.actor, {
    read: () => context.game.host.inventory.count(context.entity.actor.id, "q2:monster-power"),
    write: count => context.game.host.inventory.configure(context.entity.actor, { item: "q2:monster-power", count, capacity: Math.max(400, numberField(context.entity.spawn, "power_armor_power", 400)) }),
  });
}
function gib(context: MonsterContext): undefined {
  const { game, entity } = context;
  game.host.emit({ kind: "effect", effect: "q2:explosion1-big", origin: game.body(entity).origin, direction: zero, count: 1, color: 0 });
  if (entity.sound !== "") game.host.emit({ kind: "sound", actor: entity.actor.id, origin: game.body(entity).origin, path: entity.sound, channel: 0, volume: 1, attenuation: 1, reliable: false, loop: "stop" });
  entity.sound = ""; entity.skin = Math.trunc(entity.skin / 2);
  for (let i = 0; i < 2; i++) { throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", 500); throwGib(entity, game, "models/objects/gibs/sm_metal/tris.md2", 500, { metallic: true }); }
  for (const part of ["cgun", "chest", "core", "ltread", "rgun", "rtread", "tube", "head"]) throwGib(entity, game, `models/monsters/boss1/gibs/${part}.md2`, 500, { skinned: true, metallic: part === "cgun" || part === "head", upright: ["ltread", "rgun", "rtread", "tube"].includes(part), head: part === "head" });
  context.state.gibbed = true; return undefined;
}

export function createRereleaseSupertankDefinitions(weapons: Q2MissionPackMonsterWeapons, isN64: boolean): readonly Q2MonsterDefinition[] {
  const tank: Q2MonsterDefinition = {
    ...supertankDefinition, moves: supertankMoves, blocked: blockedCheckPlatform,
    sourceCallbacks: { think: { BossExplode_think: bossExplodeThink } },
    initialize(context) {
      const { game, entity } = context;
      if (isN64) { entity.spawnflags |= 16; entity.count = 10; }
      if ((entity.spawnflags & 8) !== 0) {
        if (!game.host.inventory.has(entity.actor.id)) game.host.inventory.create(entity.actor, []);
        const cells = numberField(entity.spawn, "power_armor_power", 400), type = numberField(entity.spawn, "power_armor_type", 2);
        game.host.inventory.configure(entity.actor, { item: "q2:monster-power", count: cells, capacity: Math.max(400, cells) }); bindArmor(context);
        game.host.combat.setPoweredProtection(entity.actor, type === 0 ? { kind: "none" } : { kind: type === 1 ? "screen" : "shield", cells });
      }
      return undefined;
    },
    restore(context) { if ((context.entity.spawnflags & 8) !== 0) bindArmor(context); return undefined; },
    attack(context) {
      const enemy = enemyBody(context); if (enemy === null) return undefined;
      const range = targetDistance(context), delta = subtract(enemy.origin, context.game.body(context.entity).origin);
      const chain = clearShot(context, muzzleOffset("rerelease", 64)), rocket = clearShot(context, muzzleOffset("rerelease", 70)), grenade = clearShot(context, muzzleOffset("rerelease", rereleaseFlash.SUPERTANK_GRENADE_1));
      if (chain && (!rocket || range <= 540 || context.game.host.random() < 0.3)) {
        if (grenade && (range >= 350 || delta.z > 120 || context.game.host.random() < 0.2)) return context.setMove("supertank_move_attack4");
        context.entity.timestamp = context.game.host.now() + 1.5 + context.game.host.random() * 1.2; return context.setMove("supertank_move_attack1");
      }
      if (rocket) return context.setMove(grenade && (delta.z > 120 || context.game.host.random() < 0.2) ? "supertank_move_attack4" : "supertank_move_attack2");
      if (grenade) context.setMove("supertank_move_attack4"); return undefined;
    },
    pain(context, reaction) {
      const { game, entity, state } = context;
      entity.skin = health(game, entity.actor.id) < entity.maxHealth / 2 ? entity.skin | 1 : entity.skin & ~1;
      if (game.host.now() < state.painTime) return undefined;
      if (!chainfist(context)) { if (reaction.damage <= 25 && game.host.random() < 0.2) return undefined; if (entity.frame >= frame.attak2_1 && entity.frame <= frame.attak2_14) return undefined; }
      game.sound(entity, reaction.damage <= 10 ? "bosstank/btkpain1.wav" : reaction.damage <= 25 ? "bosstank/btkpain3.wav" : "bosstank/btkpain2.wav", 2);
      state.painTime = game.host.now() + 3; if (!reactsToPain(context)) return undefined;
      return context.setMove(reaction.damage <= 10 ? "supertank_move_pain1" : reaction.damage <= 25 ? "supertank_move_pain2" : "supertank_move_pain3");
    },
    die(context) {
      const { entity, game, state } = context;
      if ((entity.spawnflags & (1 << 16)) !== 0) { if (checkGib(context)) { gib(context); state.dead = true; return undefined; } if (state.dead) return undefined; }
      else { game.sound(entity, "bosstank/btkdeth1.wav", 2); state.dead = true; state.canTakeDamage = false; game.host.combat.setTraits(entity.actor, { canTakeDamage: false }); }
      return context.setMove("supertank_move_death");
    },
    callbacks: {
      ...supertankDefinition.callbacks, BossExplode: bossExplode,
      BossLoop(context) { if ((context.entity.spawnflags & 16) === 0) return undefined; if (context.entity.count !== 0) context.entity.count--; else context.entity.spawnflags &= ~16; context.state.nextFrame = frame.death_19; return undefined; },
      supertank_dead(context) { if ((context.entity.spawnflags & (1 << 16)) === 0) return gib(context); context.state.dead = false; context.state.canTakeDamage = true; return context.game.host.combat.setTraits(context.entity.actor, { canTakeDamage: true }); },
      supertank_reattack1(context) { return context.setMove(visible(context) && (context.entity.timestamp >= context.game.host.now() || context.game.host.random() < 0.3) ? "supertank_move_attack1" : "supertank_move_end_attack1"); },
      supertankMachineGun(context) {
        if (enemyBody(context) === null) return undefined;
        const body = context.game.body(context.entity), id = 64 + context.entity.frame - frame.attak1_1, start = projectFlash(context, muzzleOffset("rerelease", id), { x: 0, y: body.angles.y, z: 0 }), direction = predictedDirection(context, start, 0, true, -0.1);
        if (direction === null) return undefined;
        context.weapons.fireBullet(context.entity, context.game, start, direction, 6, 4, 900, 1500, 0); return monsterFlash(context, id, start, direction);
      },
      supertankRocket(context) {
        const enemy = enemyEye(context); if (enemy === null) return undefined;
        const id = context.entity.frame === frame.attak2_8 ? 70 : context.entity.frame === frame.attak2_11 ? 71 : 72, start = projectFlash(context, muzzleOffset("rerelease", id)), heat = (context.entity.spawnflags & 8) !== 0;
        const direction = heat ? normalize(subtract(enemy, start)) : predictedDirection(context, start, 750, false);
        if (direction === null) return undefined;
        if (heat) weapons.fireHeatRocket(context.entity, context.game, start, direction, 40, 500, 60, 40); else context.weapons.fireRocket(context.entity, context.game, start, direction, 50, 750, 70, 50);
        return monsterFlash(context, id, start, direction);
      },
      supertankGrenade(context) {
        if (enemyBody(context) === null) return undefined;
        const { game, entity } = context, id = entity.frame === frame.attak4_1 ? rereleaseFlash.SUPERTANK_GRENADE_1 : rereleaseFlash.SUPERTANK_GRENADE_2, start = projectFlash(context, muzzleOffset("rerelease", id));
        const target = predictAim(context, start, 0, false, (game.host.random() * 2 - 1) * 0.1); if (target === null) return undefined;
        for (let speed = 500; speed < 1000; speed += 100) {
          const direction = calculatePitchToFire(context, target.point, start, target.direction, speed, 2.5, true); if (direction === null) continue;
          context.weapons.fireGrenade(entity, game, start, direction, 50, speed, 2.5, 90, false, false, true, { right: 0, up: 0, gravity: game.host.gravity() });
          return monsterFlash(context, id, start, direction);
        }
        return undefined;
      },
    },
  };
  return [tank, { ...tank, classname: "monster_boss5", initialize(context) { context.entity.spawnflags |= 8; tank.initialize?.(context); context.entity.skin = 2; return undefined; } }];
}
