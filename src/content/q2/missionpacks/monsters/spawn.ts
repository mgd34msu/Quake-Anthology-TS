/* Quake II rogue/g_spawn.c monster creation and spawn growth. ZeniMax Media, GPL-2.0-or-later. */
import type { Bounds, Vec3 } from "../../../../contracts/math.ts";
import type { Q2Entity, Q2GameServices, Q2Think } from "../../foundation/host.ts";
import type { Q2CallbackDefinitions } from "../../foundation/callbacks.ts";
import { add, zero } from "../../foundation/fields.ts";
import { monsterSolidMask } from "../../foundation/monsters/ai.ts";
import type { Q2Monsters } from "../../foundation/monsters/index.ts";
import { sourceTraceWorld } from "./rogue-common.ts";

export function findRogueSpawnPoint(game: Q2GameServices, start: Vec3, bounds: Bounds, maxMoveUp: number): Vec3 | null {
  let trace = game.host.trace({ start, end: start, bounds, ignore: null, mask: monsterSolidMask(game) | 0x10000 });
  if (trace.startSolid || trace.allSolid || !sourceTraceWorld(game, trace)) {
    trace = game.host.trace({ start: { ...start, z: start.z + maxMoveUp }, end: start, bounds, ignore: null, mask: monsterSolidMask(game) });
    return trace.startSolid || trace.allSolid ? null : trace.end;
  }
  return start;
}

export function checkRogueSpawnPoint(game: Q2GameServices, origin: Vec3, bounds: Bounds): boolean {
  if (bounds.min.x === 0 && bounds.min.y === 0 && bounds.min.z === 0 || bounds.max.x === 0 && bounds.max.y === 0 && bounds.max.z === 0) return false;
  const trace = game.host.trace({ start: origin, end: origin, bounds, ignore: null, mask: monsterSolidMask(game) });
  return !trace.startSolid && !trace.allSolid && sourceTraceWorld(game, trace);
}

export function checkRogueGroundSpawnPoint(game: Q2GameServices, origin: Vec3, bounds: Bounds, height: number, gravity: number): boolean {
  if (!checkRogueSpawnPoint(game, origin, bounds)) return false;
  let stop = { ...origin, z: origin.z + bounds.min.z - height };
  let trace = game.host.trace({ start: origin, end: stop, bounds, ignore: null, mask: monsterSolidMask(game) | 56 });
  if (trace.fraction >= 1 || trace.kind === "q1" || (trace.contents & monsterSolidMask(game)) === 0) return false;
  const min = add(trace.end, bounds.min), max = add(trace.end, bounds.max);
  const corners = [{ x: min.x, y: min.y }, { x: min.x, y: max.y }, { x: max.x, y: min.y }, { x: max.x, y: max.y }];
  if (corners.every(corner => game.host.pointContents({ ...corner, z: gravity > 0 ? max.z + 1 : min.z - 1 }) === 1)) return true;
  let start = { x: (min.x + max.x) * 0.5, y: (min.y + max.y) * 0.5, z: min.z };
  stop = { ...stop, x: start.x, y: start.y };
  trace = game.host.trace({ start, end: stop, bounds: null, ignore: null, mask: monsterSolidMask(game) });
  if (trace.fraction === 1) return false;
  const mid = trace.end.z + (gravity < 0 ? bounds.min.z : -bounds.max.z);
  start = { ...start, z: gravity < 0 ? min.z : max.z };
  stop = { ...stop, z: start.z + (gravity < 0 ? -36 : 36) };
  for (const corner of corners) {
    trace = game.host.trace({ start: { ...start, ...corner }, end: { ...stop, ...corner }, bounds: null, ignore: null, mask: monsterSolidMask(game) });
    if (trace.fraction === 1 || (gravity > 0 ? trace.end.z - mid : mid - trace.end.z) > 18) return false;
  }
  return true;
}

export function createRogueMonster(monsters: Q2Monsters, game: Q2GameServices, origin: Vec3, angles: Vec3, classname: string): Q2Entity {
  const entity = game.create(classname);
  game.move(entity, { origin, angles }, false);
  entity.gravityVector = { x: 0, y: 0, z: -1 };
  monsters.spawnSummoned(entity, game);
  entity.renderFlags |= 32768;
  return entity;
}

export function createRogueGroundMonster(monsters: Q2Monsters, game: Q2GameServices, origin: Vec3, angles: Vec3, bounds: Bounds, classname: string, height: number): Q2Entity | null {
  return checkRogueGroundSpawnPoint(game, origin, bounds, height, -1) ? createRogueMonster(monsters, game, origin, angles, classname) : null;
}

function randomAngles(game: Q2GameServices): Vec3 {
  let angles = zero;
  for (let i = 0; i < 2; i++) angles = { x: Math.floor(game.host.random() * 360), y: Math.floor(game.host.random() * 360), z: Math.floor(game.host.random() * 360) };
  return angles;
}
const spawnGrowThink: Q2Think = (entity, game) => {
  game.move(entity, { angles: randomAngles(game) });
  if (game.host.now() < entity.wait && entity.frame < 2) entity.frame++;
  if (game.host.now() >= entity.wait) {
    if ((entity.effects & 0x10000000) !== 0 || entity.frame === 0) return game.remove(entity);
    entity.frame--;
  }
  game.show(entity);
  return game.schedule(entity, (entity.nextThink ?? game.host.now()) + 0.1 - game.host.now(), spawnGrowThink);
};
export const rogueSpawnCallbacks: Q2CallbackDefinitions = { think: { "q2:rogue/spawngrow_think": spawnGrowThink } };

export function rogueSpawnGrow(game: Q2GameServices, origin: Vec3, size: number): Q2Entity {
  game.sourceCallbacks.register(rogueSpawnCallbacks);
  const entity = game.create("spawngro");
  game.move(entity, { origin, angles: randomAngles(game) }, false);
  entity.renderFlags = 32768;
  entity.model = size <= 1 ? "models/items/spawngro2/tris.md2" : size === 2 ? "models/items/spawngro3/tris.md2" : "models/items/spawngro/tris.md2";
  entity.wait = game.host.now() + (size === 2 ? 2 : 0.3);
  if (size !== 2) entity.effects |= 0x10000000;
  game.solid(entity, "none"); game.motion(entity, "stationary");
  game.schedule(entity, 0.1, spawnGrowThink); game.link(entity); game.show(entity);
  return entity;
}
