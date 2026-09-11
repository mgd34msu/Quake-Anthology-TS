// Rerelease m_gladiator.cpp, including the Xatrix plasma variant. ZeniMax Media, GPL-2.0.
import { length, normalize, numberField, subtract } from "../../foundation/fields.ts";
import { clearShot, corpse, enemyBody, enemyEye, health, projectFlash } from "../../foundation/monsters/ai.ts";
import { throwGib } from "../../foundation/monsters/gibs.ts";
import { muzzleOffset } from "../../foundation/monsters/muzzle.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import type { Q2MissionPackMonsterWeapons } from "../../missionpacks/monsters/types.ts";
import { gladiatorDefinition } from "../../base/monsters/gladiator.ts";
import { blockedCheckPlatform, checkGib, monsterFlash, reactsToPain } from "./common.ts";
import { gladiatorFrame, gladiatorMoves } from "./tables/gladiator.ts";

function bindArmor(context: MonsterContext): undefined {
  return context.game.host.combat.bindPowerArmorCells(context.entity.actor, {
    read: () => context.game.host.inventory.count(context.entity.actor.id, "q2:monster-power"),
    write: count => context.game.host.inventory.configure(context.entity.actor, { item: "q2:monster-power", count, capacity: Math.max(250, numberField(context.entity.spawn, "power_armor_power", 250)) }),
  });
}

export function createRereleaseGladiatorDefinitions(weapons: Q2MissionPackMonsterWeapons): readonly Q2MonsterDefinition[] {
  function plasma(context: MonsterContext): undefined {
    const { entity, game } = context, eye = enemyEye(context); if (eye === null) return undefined;
    const start = projectFlash(context, muzzleOffset("rerelease", 61)), direction = normalize(subtract(entity.pos1, start)), later = entity.frame > gladiatorFrame.attack3;
    weapons.firePlasma(entity, game, start, direction, later ? 17 : 35, 725, later ? 22 : 45, later ? 22 : 45);
    entity.pos1 = eye; return undefined;
  }
  const gladiator: Q2MonsterDefinition = {
    ...gladiatorDefinition, bounds: { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: 42 } }, moves: gladiatorMoves, blocked: blockedCheckPlatform,
    initialize(context) { return context.game.host.emit({ kind: "sound", actor: context.entity.actor.id, origin: context.game.body(context.entity).origin, path: "weapons/rg_hum.wav", channel: 1, volume: 1, attenuation: 1, reliable: false, loop: "start" }); },
    attack(context) {
      const enemy = enemyBody(context), eye = enemyEye(context); if (enemy === null || eye === null) return undefined;
      if (length(subtract(context.game.body(context.entity).origin, enemy.origin)) <= 112 && context.state.meleeTime <= context.game.host.now() || !clearShot(context, muzzleOffset("rerelease", 61))) return undefined;
      context.entity.pos1 = eye;
      context.game.sound(context.entity, context.entity.style === 1 ? "weapons/plasshot.wav" : "gladiator/railgun.wav", 1);
      return context.setMove(context.entity.style === 1 ? "gladb_move_attack_gun" : "gladiator_move_attack_gun");
    },
    pain(context) {
      const { entity, game, state } = context, airborne = game.body(entity).velocity.z > 100;
      entity.skin = health(game, entity.actor.id) < entity.maxHealth / 2 ? entity.skin | 1 : entity.skin & ~1;
      if (game.host.now() < state.painTime) { if (airborne && state.move.name === "gladiator_move_pain") context.setMove("gladiator_move_pain_air"); return undefined; }
      state.painTime = game.host.now() + 3; game.sound(entity, game.host.random() < 0.5 ? "gladiator/pain.wav" : "gladiator/gldpain2.wav", 2);
      if (!reactsToPain(context)) return undefined;
      return context.setMove(airborne ? "gladiator_move_pain_air" : "gladiator_move_pain");
    },
    die(context, reaction) {
      const { entity, game, state } = context;
      if (checkGib(context)) {
        game.sound(entity, "misc/udeath.wav", 2); entity.skin = Math.trunc(entity.skin / 2);
        for (let i = 0; i < 2; i++) { throwGib(entity, game, "models/objects/gibs/bone/tris.md2", reaction.damage); throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", reaction.damage); throwGib(entity, game, "models/monsters/gladiatr/gibs/thigh.md2", reaction.damage, { skinned: true }); }
        for (const part of ["larm", "rarm", "chest", "head"]) throwGib(entity, game, `models/monsters/gladiatr/gibs/${part}.md2`, reaction.damage, { skinned: true, upright: part === "larm" || part === "rarm", head: part === "head" });
        state.dead = true; state.gibbed = true; return undefined;
      }
      if (state.dead) return undefined;
      game.sound(entity, "gladiator/glddeth2.wav", 4); if (game.host.random() < 0.5) game.sound(entity, "gladiator/death.wav", 2);
      state.dead = true; state.canTakeDamage = true; game.host.combat.setTraits(entity.actor, { canTakeDamage: true }); return context.setMove("gladiator_move_death");
    },
    callbacks: {
      ...gladiatorDefinition.callbacks, gladiator_dead: corpse,
      GladiatorMelee(context) { const hit = context.weapons.fireHit(context.entity, context.game, { x: 80, y: context.game.body(context.entity).bounds.min.x, z: -4 }, 20 + Math.floor(context.game.host.random() * 5), 300); if (!hit) context.state.meleeTime = context.game.host.now() + 1.5; return context.game.sound(context.entity, hit ? "gladiator/melee2.wav" : "gladiator/melee3.wav", 0); },
      GladiatorGun(context) { const start = projectFlash(context, muzzleOffset("rerelease", 61)), direction = normalize(subtract(context.entity.pos1, start)); context.weapons.fireRail(context.entity, context.game, start, direction, 50, 100); return monsterFlash(context, 61, start, direction); },
      gladbGun: plasma, gladbGun_check(context) { if (context.game.options.skill === 3) plasma(context); return undefined; },
      gladiator_shrink(context) { context.entity.serverFlags |= 2; const bounds = context.game.body(context.entity).bounds; return context.game.move(context.entity, { bounds: { min: bounds.min, max: { ...bounds.max, z: 0 } } }); },
    },
  };
  return [gladiator, { ...gladiator, classname: "monster_gladb", health: 250, mass: 350,
    initialize(context) {
      const { entity, game } = context; entity.style = 1; entity.skin = 2;
      if (!game.host.inventory.has(entity.actor.id)) game.host.inventory.create(entity.actor, []);
      const cells = numberField(entity.spawn, "power_armor_power", 250), type = numberField(entity.spawn, "power_armor_type", 2);
      game.host.inventory.configure(entity.actor, { item: "q2:monster-power", count: cells, capacity: Math.max(250, cells) }); bindArmor(context);
      game.host.combat.setArmor(entity.actor, { kind: "q2", points: 0, normalProtection: 0, energyProtection: 0, item: "q2:monster-power", powerArmor: type === 0 ? { kind: "none" } : { kind: type === 1 ? "screen" : "shield", cells } });
      return game.host.emit({ kind: "sound", actor: entity.actor.id, origin: game.body(entity).origin, path: "weapons/phaloop.wav", channel: 1, volume: 1, attenuation: 1, reliable: false, loop: "start" });
    }, restore: bindArmor,
  }];
}
