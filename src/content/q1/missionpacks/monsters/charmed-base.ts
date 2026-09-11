/* Hipnotic grunt/rottweiler source frames share horn-aware monster AI. GPL-2.0-or-later. */
import { POINT, length, normalize, vadd, vscale, vsub } from "../../foundation/types.ts";
import { fireBullets } from "../../foundation/weapons.ts";
import { dropBackpack, throwGib, throwHead } from "../../base/projectiles.ts";
import type { MissionMonster, Q1MissionPackMonsters } from "./runtime.ts";
import type { MissionAction, PackMonsterDefinition } from "./types.ts";
import { frames as armyFrames } from "./tables/grunt.ts";
import { frames as dogFrames } from "./tables/rottweiler.ts";
import { humanBounds } from "./helpers.ts";

function armyFire(monster: MissionMonster): undefined {
  monster.face(); const { game, entity } = monster; game.sound(entity, "soldier/sattck1.wav", "weapon");
  const enemy = monster.enemy === null ? null : game.host.bodies.read(monster.enemy); if (enemy === null) return undefined;
  return fireBullets(game, entity.actor, normalize(vsub(vsub(enemy.origin, vscale(enemy.velocity, 0.2)), monster.origin)), entity.vector("v_angle"), 4, 0.1, 0.1, null);
}
function dropShells(monster: MissionMonster): undefined {
  monster.entity.solid = "none"; monster.game.link(monster.entity);
  dropBackpack(monster.game, monster.origin, { weapon: null, shells: 5, nails: 0, rockets: 0, cells: 0 }); return undefined;
}
const armyActions: Record<string, MissionAction> = {
  army_fire: armyFire,
  "grunt:army_atk5": monster => { monster.face(); armyFire(monster); monster.entity.effects |= 2; return undefined; },
  "grunt:army_atk7": monster => { monster.face(); if (monster.game.options.skill === 3 && !monster.state.refired && monster.visible()) { monster.state.refired = true; monster.nextFrame = "army_atk1"; } return undefined; },
  "grunt:army_die3": dropShells,
  "grunt:army_cdie3": monster => { dropShells(monster); monster.game.host.walkMove(monster.entity.actor, monster.game.body(monster.entity).angles.y + 180, 4); return undefined; },
};
for (const distance of [3, 4, 5, 13]) armyActions[`ai_back(${distance})`] = monster => { monster.game.host.walkMove(monster.entity.actor, monster.game.body(monster.entity).angles.y + 180, distance); return undefined; };
export const hipnoticArmyDefinition: PackMonsterDefinition = {
  spec: { species: "army", classnames: ["monster_army"], model: "soldier", head: "h_guard", health: 30, gibHealth: -35, gibs: ["gib1", "gib2", "gib3"], bounds: humanBounds,
    stand: "army_stand1", walk: "army_walk1", run: "army_run1", sight: "soldier/sight1.wav", missile: "army_atk1", melee: false, movement: "walk" }, frames: armyFrames, actions: armyActions,
  checkAttack: monster => {
    const start = monster.eye(), end = monster.enemy === null ? null : monster.eye(monster.enemy); if (start === null || end === null) return false;
    const trace = monster.game.host.trace({ start, end, bounds: POINT, ignore: monster.entity.actor.id, monsters: true });
    if (trace.inOpen && trace.inWater || trace.actor !== monster.enemy || monster.game.time < monster.state.attackFinished || monster.rangeDistance() >= 1000) return false;
    if (monster.game.host.random() >= (monster.rangeDistance() < 120 ? 0.9 : monster.rangeDistance() < 500 ? 0.4 : 0.05)) return false;
    monster.play("army_atk1"); monster.attackFinished(1 + monster.game.host.random()); if (monster.game.host.random() < 0.3) monster.lefty = !monster.lefty; return true;
  },
  pain: monster => {
    const { game } = monster; if (monster.state.painFinished > game.time) return undefined;
    const r = game.host.random(); monster.state.painFinished = game.time + (r < 0.2 ? 0.6 : 1.1); monster.play(r < 0.2 ? "army_pain1" : r < 0.6 ? "army_painb1" : "army_painc1");
    return game.sound(monster.entity, r < 0.2 ? "soldier/pain1.wav" : "soldier/pain2.wav");
  },
  die: monster => {
    const { game, entity } = monster, health = game.health(entity.actor.id);
    if (health < -35) { game.sound(entity, "player/udeath.wav"); throwHead(game, entity, "h_guard", health); for (const model of ["gib1", "gib2", "gib3"]) throwGib(game, monster.origin, model, health); return undefined; }
    game.sound(entity, "soldier/death1.wav"); return monster.play(game.host.random() < 0.5 ? "army_die1" : "army_cdie1");
  },
};
export function hipnoticDogDefinition(runtime: Q1MissionPackMonsters): PackMonsterDefinition {
  return {
    spec: { species: "dog", classnames: ["monster_dog"], model: "dog", head: "h_dog", health: 25, gibHealth: -35, gibs: ["gib3", "gib3", "gib3"],
      bounds: { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: 40 } }, stand: "dog_stand1", walk: "dog_walk1", run: "dog_run1", sight: "dog/dsight.wav", missile: "dog_leap1", melee: true, movement: "walk" }, frames: dogFrames,
    callbacks: { Dog_JumpTouch: { touch(game, entity, other) {
      const monster = runtime.require(entity); if (game.health(entity.actor.id) <= 0) return undefined;
      if (game.host.combat.read(other)?.canTakeDamage && length(game.body(entity).velocity) > 300) game.damage(other, entity.actor.id, entity.actor.id, 10 + 10 * game.host.random());
      if (!game.host.checkBottom(entity.actor.id)) { if ((entity.movementFlags & 512) !== 0) { entity.touch = null; monster.nextFrame = "dog_leap1"; monster.delay(0.1); } return undefined; }
      entity.touch = null; monster.nextFrame = "dog_run1"; return monster.delay(0.1);
    } } },
    actions: {
      dog_bite: monster => { if (monster.enemy === null) return undefined; monster.ai("charge", 10); if (!monster.game.canDamage(monster.enemy, monster.entity.actor.id) || monster.distance > 100) return undefined;
        monster.game.damage(monster.enemy, monster.entity.actor.id, monster.entity.actor.id, (monster.game.host.random() + monster.game.host.random() + monster.game.host.random()) * 8); return undefined; },
      "rottweiler:dog_leap2": monster => { monster.face(); const { game, entity } = monster; entity.touch = game.named.touch(entity, "hipnotic:Dog_JumpTouch"); const basis = game.makeVectors(game.body(entity).angles);
        game.setBody(entity, { origin: vadd(monster.origin, { x: 0, y: 0, z: 1 }), velocity: vadd(vscale(basis.forward, 300), { x: 0, y: 0, z: 200 }) }); entity.movementFlags &= ~512; return undefined; },
    },
    checkAttack: monster => {
      if (monster.rangeDistance() < 120) { monster.entity.attackState = "melee"; return true; }
      const { game, entity } = monster, body = game.body(entity), enemy = monster.enemy === null ? null : game.host.bodies.read(monster.enemy); if (enemy === null) return false;
      if (body.origin.z + body.bounds.min.z > enemy.origin.z + enemy.bounds.min.z + 0.75 * (enemy.bounds.max.z - enemy.bounds.min.z) || body.origin.z + body.bounds.max.z < enemy.origin.z + enemy.bounds.min.z + 0.25 * (enemy.bounds.max.z - enemy.bounds.min.z)) return false;
      const distance = Math.hypot(enemy.origin.x - body.origin.x, enemy.origin.y - body.origin.y); if (distance < 80 || distance > 150) return false;
      entity.attackState = "missile"; return true;
    },
    melee: monster => monster.play("dog_atta1"),
    pain: monster => { monster.game.sound(monster.entity, "dog/dpain1.wav"); return monster.play(monster.game.host.random() > 0.5 ? "dog_pain1" : "dog_painb1"); },
    die: monster => { const { game, entity } = monster, health = game.health(entity.actor.id);
      if (health < -35) { game.sound(entity, "player/udeath.wav"); for (let i = 0; i < 3; i++) throwGib(game, monster.origin, "gib3", health); return throwHead(game, entity, "h_dog", health); }
      game.sound(entity, "dog/ddeath.wav"); entity.solid = "none"; game.link(entity); return monster.play(game.host.random() > 0.5 ? "dog_die1" : "dog_dieb1"); },
  };
}
