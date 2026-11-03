// SPDX-License-Identifier: GPL-2.0-or-later
/* Hipnotic grunt/rottweiler source frames share horn-aware monster AI. GPL-2.0-or-later. */
import { length, normalize, vscale, vsub } from "../../foundation/types.ts";
import { fireBullets } from "../../foundation/weapons.ts";
import { throwGib, throwHead } from "../../base/projectiles.ts";
import { armyCheckAttack, armyPain, dogBite, dogCheckAttack, dogLeap, dogPain, dropShells, walkBack } from "../../base/grunt.ts";
import type { MissionMonster, Q1MissionPackMonsters } from "./runtime.ts";
import type { MissionAction, PackMonsterDefinition } from "./types.ts";
import { frames as armyFrames } from "./tables/grunt.ts";
import { frames as dogFrames } from "./tables/rottweiler.ts";
import { humanBounds } from "./helpers.ts";

function armyFire(monster: MissionMonster): undefined {
  monster.face();
  const { game, entity } = monster;
  game.sound(entity, "soldier/sattck1.wav", "weapon");
  const enemy = monster.enemy === null ? null : game.host.bodies.read(monster.enemy);
  if (enemy === null) return undefined;
  return fireBullets(
    game,
    entity.actor,
    normalize(vsub(vsub(enemy.origin, vscale(enemy.velocity, 0.2)), monster.origin)),
    entity.vector("v_angle"),
    4,
    0.1,
    0.1,
    null,
  );
}
const armyActions: Record<string, MissionAction> = {
  army_fire: armyFire,
  "grunt:army_atk5": monster => {
    monster.face();
    armyFire(monster);
    monster.entity.effects |= 2;
    return undefined;
  },
  "grunt:army_atk7": monster => {
    monster.face();
    if (monster.game.options.skill === 3 && !monster.state.refired && monster.visible()) {
      monster.state.refired = true;
      monster.nextFrame = "army_atk1";
    }
    return undefined;
  },
  "grunt:army_die3": dropShells,
  "grunt:army_cdie3": monster => {
    dropShells(monster);
    return walkBack(monster, 4);
  },
};
for (const distance of [3, 4, 5, 13]) armyActions[`ai_back(${distance})`] = monster => walkBack(monster, distance);
export const hipnoticArmyDefinition: PackMonsterDefinition = {
  spec: {
    species: "army",
    classnames: ["monster_army"],
    model: "soldier",
    head: "h_guard",
    health: 30,
    gibHealth: -35,
    gibs: ["gib1", "gib2", "gib3"],
    bounds: humanBounds,
    stand: "army_stand1",
    walk: "army_walk1",
    run: "army_run1",
    sight: "soldier/sight1.wav",
    missile: "army_atk1",
    melee: false,
    movement: "walk",
  },
  frames: armyFrames,
  actions: armyActions,
  checkAttack: armyCheckAttack,
  pain: armyPain,
  die: monster => {
    const { game, entity } = monster,
      health = game.health(entity.actor.id);
    if (health < -35) {
      game.sound(entity, "player/udeath.wav");
      throwHead(game, entity, "h_guard", health);
      for (const model of ["gib1", "gib2", "gib3"]) throwGib(game, monster.origin, model, health);
      return undefined;
    }
    game.sound(entity, "soldier/death1.wav");
    return monster.play(game.host.random() < 0.5 ? "army_die1" : "army_cdie1");
  },
};
export function hipnoticDogDefinition(runtime: Q1MissionPackMonsters): PackMonsterDefinition {
  return {
    spec: {
      species: "dog",
      classnames: ["monster_dog"],
      model: "dog",
      head: "h_dog",
      health: 25,
      gibHealth: -35,
      gibs: ["gib3", "gib3", "gib3"],
      bounds: { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: 40 } },
      stand: "dog_stand1",
      walk: "dog_walk1",
      run: "dog_run1",
      sight: "dog/dsight.wav",
      missile: "dog_leap1",
      melee: true,
      movement: "walk",
    },
    frames: dogFrames,
    callbacks: {
      Dog_JumpTouch: {
        touch(game, entity, other) {
          const monster = runtime.require(entity);
          if (game.health(entity.actor.id) <= 0) return undefined;
          if (game.host.combat.read(other)?.canTakeDamage && length(game.body(entity).velocity) > 300)
            game.damage(other, entity.actor.id, entity.actor.id, 10 + 10 * game.host.random());
          if (!game.host.checkBottom(entity.actor.id)) {
            if ((entity.movementFlags & 512) !== 0) {
              entity.touch = null;
              monster.nextFrame = "dog_leap1";
              monster.delay(0.1);
            }
            return undefined;
          }
          entity.touch = null;
          monster.nextFrame = "dog_run1";
          return monster.delay(0.1);
        },
      },
    },
    actions: {
      dog_bite: dogBite,
      "rottweiler:dog_leap2": monster => dogLeap(monster, "hipnotic:Dog_JumpTouch"),
    },
    checkAttack: dogCheckAttack,
    melee: monster => monster.play("dog_atta1"),
    pain: dogPain,
    die: monster => {
      const { game, entity } = monster,
        health = game.health(entity.actor.id);
      if (health < -35) {
        game.sound(entity, "player/udeath.wav");
        for (let i = 0; i < 3; i++) throwGib(game, monster.origin, "gib3", health);
        return throwHead(game, entity, "h_dog", health);
      }
      game.sound(entity, "dog/ddeath.wav");
      entity.solid = "none";
      game.link(entity);
      return monster.play(game.host.random() > 0.5 ? "dog_die1" : "dog_dieb1");
    },
  };
}
