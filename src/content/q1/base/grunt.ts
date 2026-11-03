/* monsters/grunt.qc, monsters/rottweiler.qc and the soldier/dog parts of fight.qc and combat.qc.
 * Copyright (C) 1996-2022 id Software LLC. GPL-2.0-or-later. */
import { sameActor } from "../../../contracts/identity.ts";
import type { ActorId } from "../../../contracts/identity.ts";
import { POINT, length, normalize, vadd, vscale, vsub } from "../foundation/types.ts";
import { fireBullets } from "../foundation/weapons.ts";
import type { BaseMonster } from "./monsters.ts";
import { dropBackpack } from "./projectiles.ts";

/** Shells the dying grunt drops with its solid cleared. */
export function dropShells(monster: BaseMonster): undefined {
  monster.entity.solid = "none"; monster.game.link(monster.entity);
  dropBackpack(monster.game, monster.origin, { weapon: null, shells: 5, nails: 0, rockets: 0, cells: 0 }); return undefined;
}
export function walkBack(monster: BaseMonster, distance: number): undefined {
  monster.game.host.walkMove(monster.entity.actor, monster.game.body(monster.entity).angles.y + 180, distance); return undefined;
}
export function armyFire(monster: BaseMonster): undefined {
  const { game, entity } = monster; monster.face(); game.sound(entity, "soldier/sattck1.wav", "weapon");
  const enemy = monster.enemy === null ? null : game.host.bodies.read(monster.enemy); if (enemy === null) return undefined;
  fireBullets(game, entity.actor, normalize(vsub(vsub(enemy.origin, vscale(enemy.velocity, 0.2)), monster.origin)), entity.vector("v_angle"), 4, 0.1, 0.1, null);
  game.effect("muzzleflash", monster.origin, entity.actor.id); return undefined;
}
export function dogLeap(monster: BaseMonster, touch = `${monster.source?.callbackPrefix ?? "base"}:monster_jump_touch`): undefined {
  const { game, entity } = monster; monster.face();
  entity.touch = game.named.touch(entity, touch);
  const body = game.body(entity);
  game.setBody(entity, { origin: vadd(body.origin, { x: 0, y: 0, z: 1 }), velocity: vadd(vscale(game.makeVectors(body.angles).forward, 300), { x: 0, y: 0, z: 200 }), ground: null });
  entity.movementFlags &= ~512; return undefined;
}

/** dog_bite: close in, then bite when the enemy is within reach. */
export function dogBite(monster: BaseMonster): undefined {
  const { game, entity } = monster;
  if (monster.enemy === null) return undefined;
  monster.ai("charge", 10);
  if (game.canDamage(monster.enemy, entity.actor.id) && monster.distance <= 100)
    game.damage(monster.enemy, entity.actor.id, entity.actor.id, (game.host.random() + game.host.random() + game.host.random()) * 8);
  return undefined;
}

/** Frame actions of the grunt and the dog; returns false for every other frame. */
export function gruntAction(monster: BaseMonster, name: string): boolean {
  switch (name) {
    case "army_atk5": monster.face(); armyFire(monster); return true;
    case "army_atk7":
      monster.face();
      if (monster.game.options.skill === 3 && !monster.state.refired && monster.visible()) { monster.state.refired = true; monster.nextFrame = "army_atk1"; }
      return true;
    case "army_die3": dropShells(monster); return true;
    case "army_cdie2": walkBack(monster, 5); return true;
    case "army_cdie3": dropShells(monster); walkBack(monster, 4); return true;
    case "army_cdie4": walkBack(monster, 13); return true;
    case "army_cdie5": walkBack(monster, 3); return true;
    case "army_cdie6": walkBack(monster, 4); return true;
    case "dog_atta4": dogBite(monster); return true;
    case "dog_leap2": dogLeap(monster); return true;
    default: return false;
  }
}

/** SoldierCheckAttack: a clear shot, then a range-weighted chance to open fire. */
export function armyCheckAttack(monster: BaseMonster): boolean {
  const { game, entity } = monster, enemy = monster.enemy; if (enemy === null) return false;
  const start = monster.eye(), end = monster.eye(enemy); if (start === null || end === null) return false;
  const distance = monster.rangeDistance();
  if (game.time < monster.state.attackFinished || distance >= 1000) return false;
  const trace = game.host.trace({ start, end, bounds: POINT, ignore: entity.actor.id, monsters: true });
  if (trace.actor === null || !sameActor(trace.actor, enemy) || trace.inOpen && trace.inWater) return false;
  if (game.host.random() >= (distance < 120 ? 0.9 : distance < 500 ? 0.4 : 0.05)) return false;
  monster.play("army_atk1"); monster.attackFinished(1 + game.host.random());
  // The rerelease SoldierCheckAttack rolls for a change of strafe side after committing.
  if (game.host.random() < 0.3) monster.lefty = !monster.lefty;
  return true;
}

/** DogCheckAttack: bite inside 120 units, leap from 80 to 150 when the vertical ranges overlap. */
export function dogCheckAttack(monster: BaseMonster): boolean {
  const { game, entity } = monster, enemy = monster.enemy; if (enemy === null) return false;
  if (monster.rangeDistance() < 120) { entity.attackState = "melee"; return true; }
  const body = game.body(entity), target = game.host.bodies.read(enemy); if (target === null) return false;
  const height = target.bounds.max.z - target.bounds.min.z;
  const vertical = body.origin.z + body.bounds.min.z <= target.origin.z + target.bounds.min.z + height * 0.75
    && body.origin.z + body.bounds.max.z >= target.origin.z + target.bounds.min.z + height * 0.25;
  const horizontal = Math.hypot(target.origin.x - body.origin.x, target.origin.y - body.origin.y);
  if (!vertical || horizontal < 80 || horizontal > 150) return false;
  entity.attackState = "missile"; return true;
}

export function armyPain(monster: BaseMonster): undefined {
  const { game, entity, state } = monster; if (state.painFinished > game.time) return undefined;
  const r = game.host.random(); state.painFinished = game.time + (r < 0.2 ? 0.6 : 1.1);
  monster.play(r < 0.2 ? "army_pain1" : r < 0.6 ? "army_painb1" : "army_painc1");
  return game.sound(entity, r < 0.2 ? "soldier/pain1.wav" : "soldier/pain2.wav");
}
export function dogPain(monster: BaseMonster): undefined {
  monster.game.sound(monster.entity, "dog/dpain1.wav"); return monster.play(monster.game.host.random() > 0.5 ? "dog_pain1" : "dog_painb1");
}

/** Dog_JumpTouch: a hard hit while airborne, then land running or leap again from a ledge edge. */
export function dogJumpTouch(monster: BaseMonster, other: ActorId): undefined {
  const { game, entity } = monster; if (game.health(entity.actor.id) <= 0) return undefined;
  const gated = monster.source?.jumpAttackGate === true || game.sourceItemStart !== null;
  if (game.host.combat.read(other)?.canTakeDamage && (!gated || monster.state.attackFinished < game.time) && length(game.body(entity).velocity) > 300) {
    game.damage(other, entity.actor.id, entity.actor.id, 10 + 10 * game.host.random());
    if (gated) monster.state.attackFinished = game.time + 0.5;
  }
  if (game.host.checkBottom(entity.actor.id)) { entity.touch = null; monster.nextFrame = "dog_run1"; return monster.delay(0.1); }
  if (game.body(entity).ground !== null) { entity.touch = null; monster.nextFrame = "dog_leap1"; return monster.delay(0.1); }
  return undefined;
}

const legacyStarts: Readonly<Record<string, readonly (readonly [string, number, string])[]>> = {
  army: [["stand", 0, "army_stand"], ["walk", 90, "army_walk"], ["run", 73, "army_run"], ["attack", 81, "army_atk"], ["pain", 40, "army_pain"], ["pain", 46, "army_painb"],
    ["pain", 60, "army_painc"], ["death", 8, "army_die"], ["death", 18, "army_cdie"]],
  dog: [["stand", 69, "dog_stand"], ["walk", 78, "dog_walk"], ["run", 48, "dog_run"], ["attack", 0, "dog_atta"], ["leap", 60, "dog_leap"], ["pain", 26, "dog_pain"],
    ["pain", 32, "dog_painb"], ["death", 8, "dog_die"], ["death", 17, "dog_dieb"]],
};
/** The frame a version 5 grunt or dog sequence cursor corresponds to, or null for a cursor no sequence produces. */
export function legacyGruntFrame(species: "army" | "dog", mode: string, firstFrame: number, frameIndex: number): string | null {
  const start = legacyStarts[species]?.find(([name, first]) => name === mode && first === firstFrame);
  return start === undefined ? null : `${start[2]}${frameIndex + 1}`;
}
