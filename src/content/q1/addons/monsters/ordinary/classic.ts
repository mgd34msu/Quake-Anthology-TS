/* quakec_{mg1,mg3}/monsters/{soldier,dog}.qc: the ordinary grunt and dog under InitMonster. GPL-2.0-or-later. */
import type { ActorId } from "../../../../../contracts/identity.ts";
import type { BaseMonster } from "../../../base/monsters.ts";
import type { MonsterFrame, MonsterOperation } from "../../../base/animation.ts";
import type { MonsterSpecies } from "../../../base/species.ts";
import { dropBackpack } from "../../../base/projectiles.ts";
import { monsterAction } from "../../../base/monster-actions.ts";
import { length, vadd, vscale, vsub } from "../../../foundation/types.ts";
import { dogFrames } from "../demodog-frames.ts";
import { infectedFrames } from "../infected/frames.ts";
import { armyActions } from "./army.ts";

export const dogSpecies: MonsterSpecies = { species: "dog", classnames: ["monster_dog"], model: "dog", head: "h_dog", health: 25, gibHealth: -35, gibs: ["gib3", "gib3", "gib3"],
  bounds: { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: 64 } }, stand: "dog_stand1", walk: "dog_walk1", run: "dog_run1", sight: "dog/dsight.wav", missile: "dog_leap1", melee: true, movement: "walk" };

function armyDeathFrames(backpack: boolean): ReadonlyMap<string, MonsterFrame> {
  const frames = new Map<string, MonsterFrame>();
  const solid: MonsterOperation = { kind: "solid", solid: "none" }, drop: MonsterOperation = { kind: "action", name: "army_die3" };
  const back = (distance: number): MonsterOperation => ({ kind: "ai", mode: "pain", distance });
  for (let i = 1; i <= 10; i++) frames.set(`army_die${i}`, { frame: 7 + i, next: i === 10 ? "army_die10" : `army_die${i + 1}`, operations: i === 3 ? [solid, ...backpack ? [drop] : []] : [] });
  const cdie = new Map<number, readonly MonsterOperation[]>([[2, [back(5)]], [3, [solid, ...backpack ? [drop, back(4)] : []]], [4, [back(13)]], [5, [back(3)]], [6, [back(4)]]]);
  for (let i = 1; i <= 11; i++) frames.set(`army_cdie${i}`, { frame: 17 + i, next: i === 11 ? "army_cdie11" : `army_cdie${i + 1}`, operations: [...cdie.get(i) ?? []] });
  return frames;
}
const armyAlive = new Map([...infectedFrames].filter(([name]) => name.startsWith("army_")));
/** MG1 soldiers still drop their shells; the MG3 source commented every backpack out. */
export function classicFrames(program: "mg1" | "mg3"): ReadonlyMap<string, MonsterFrame> {
  return new Map([...armyAlive, ...dogFrames, ...armyDeathFrames(program === "mg1")]);
}

function jumpTouchName(monster: BaseMonster): string { return `${monster.source?.callbackPrefix ?? "base"}:dog_jump_touch`; }
export const classicActions: ReadonlyMap<string, (monster: BaseMonster) => undefined> = new Map([
  ...armyActions,
  ["army_die3", monster => { if (hordeActive(monster)) return undefined; dropBackpack(monster.game, monster.origin, { weapon: null, shells: 5, nails: 0, rockets: 0, cells: 0 }); return undefined; }],
  ["dog_bite", monster => { if (monster.enemy === null) return undefined; monster.ai("charge", 10); monster.melee(100, 8, 3, true); return undefined; }],
  ["dog_jump", monster => {
    const { game, entity } = monster, body = game.body(entity);
    entity.touch = game.named.touch(entity, jumpTouchName(monster)); entity.movementFlags &= ~512;
    return game.setBody(entity, { origin: vadd(body.origin, { x: 0, y: 0, z: 1 }), velocity: vadd(vscale(game.makeVectors(body.angles).forward, 300), { x: 0, y: 0, z: 200 }), ground: null });
  }],
]);
/** MG1 items.qc DropBackpack returns when a horde manager exists. */
const hordeActive = (monster: BaseMonster): boolean => [...monster.game.entities.values()].some(entity => entity.classname === "horde_manager");
export const mg1HordeNoBackpackActions: ReadonlyMap<string, (monster: BaseMonster) => undefined> = new Map(
  ["enf_die3", "enf_fdie3", "ogre_die3", "ogre_bdie3"].map((name): [string, (monster: BaseMonster) => undefined] => [name, monster => hordeActive(monster) ? undefined : monsterAction(monster, name)]));
/** MG3 removed every ammo drop from the ordinary monsters; MG1 keeps them. */
export const mg3NoBackpackActions: ReadonlyMap<string, (monster: BaseMonster) => undefined> = new Map(
  ["enf_die3", "enf_fdie3", "ogre_die3", "ogre_bdie3"].map((name): [string, (monster: BaseMonster) => undefined] => [name, () => undefined]));

export function dogJumpTouch(monster: BaseMonster, other: ActorId): undefined {
  const { game, entity } = monster; if (game.health(entity.actor.id) <= 0) return undefined;
  if (game.host.combat.read(other)?.canTakeDamage === true && monster.state.attackFinished < game.time && length(game.body(entity).velocity) > 300) {
    game.damage(other, entity.actor.id, entity.actor.id, 10 + 10 * game.host.random()); monster.state.attackFinished = game.time + 0.5;
  }
  if (!game.host.checkBottom(entity.actor.id)) {
    if ((entity.movementFlags & 512) !== 0) { entity.touch = null; monster.nextFrame = "dog_leap1"; return monster.delay(0.1); }
    return undefined;
  }
  entity.touch = null; monster.nextFrame = "dog_run1"; return monster.delay(0.1);
}
export function dogPain(monster: BaseMonster, attacker: ActorId | null): undefined {
  monster.retaliate(attacker); monster.game.sound(monster.entity, "dog/dpain1.wav", "voice");
  return monster.play(monster.game.host.random() > 0.5 ? "dog_pain1" : "dog_painb1");
}
export function dogAttack(monster: BaseMonster, range: number): boolean {
  const { game, entity } = monster, enemy = monster.enemy; if (enemy === null) return false;
  if (range === 0) { entity.attackState = "melee"; return true; }
  const body = game.body(entity), target = game.host.bodies.read(enemy); if (target === null) return false;
  const height = target.bounds.max.z - target.bounds.min.z;
  if (body.origin.z + body.bounds.min.z > target.origin.z + target.bounds.min.z + height * 0.75 || body.origin.z + body.bounds.max.z < target.origin.z + target.bounds.min.z + height * 0.25) return false;
  const delta = vsub(target.origin, body.origin), distance = Math.hypot(delta.x, delta.y);
  if (distance < 80 || distance > 150) return false;
  entity.attackState = "missile"; return true;
}
