/* Quake II rerelease rogue/g_rogue_spawn.cpp, g_monster.cpp, m_move.cpp.
 * Copyright (c) ZeniMax Media Inc. GPL-2.0-or-later. */
import type { Bounds, Vec3 } from "../../../../contracts/math.ts";
import type { Q2GameServices } from "../../foundation/host.ts";
import { createNumericOperations, Q3_BINARY32_PROFILE } from "../../../../core/numeric.ts";
import { createRereleaseMovement, Q2RereleaseMovementContext } from "../../../../movement/q2/rerelease.ts";
import { plane, StuckResultT, type Vec3 as MovementVector } from "../../../../movement/q2/types.ts";
import { monsterSolidMask } from "../../foundation/monsters/ai.ts";
import { checkRogueSpawnPoint } from "../../missionpacks/monsters/spawn.ts";

const f = Math.fround;
const vector = (v: MovementVector): Vec3 => ({ x: v[0], y: v[1], z: v[2] });
const movementVector = (v: Vec3): MovementVector => [f(v.x), f(v.y), f(v.z)];
const placement = createRereleaseMovement(createNumericOperations(Q3_BINARY32_PROFILE), new Q2RereleaseMovementContext());

function dropToFloor(game: Q2GameServices, origin: Vec3, bounds: Bounds): Vec3 | null {
  const mask = monsterSolidMask(game);
  if (game.host.trace({ start: origin, end: origin, bounds, ignore: null, mask }).startSolid) origin = { ...origin, z: f(origin.z + 1) };
  const trace = game.host.trace({ start: origin, end: { ...origin, z: f(origin.z - 256) }, bounds, ignore: null, mask });
  return trace.fraction === 1 || trace.allSolid || trace.startSolid ? null : trace.end;
}

export function findRereleaseSpawnPoint(game: Q2GameServices, start: Vec3, bounds: Bounds, _maxMoveUp: number, drop = true): Vec3 | null {
  if (drop) {
    const dropped = dropToFloor(game, start, bounds);
    if (dropped !== null) return dropped;
  }
  const origin = movementVector(start);
  const result = placement.G_FixStuckObject_Generic(origin, movementVector(bounds.min), movementVector(bounds.max), (from, mins, maxs, end) => {
    const trace = game.host.trace({ start: vector(from), end: vector(end), bounds: { min: vector(mins), max: vector(maxs) }, ignore: null, mask: monsterSolidMask(game) });
    if (trace.kind !== "q2") throw new Error("Rerelease monster placement requires Q2 trace fields");
    return { startsolid: trace.startSolid, allsolid: trace.allSolid, fraction: trace.fraction, endpos: movementVector(trace.end),
      plane: { normal: movementVector(trace.sourcePlane.normal), dist: trace.sourcePlane.distance, type: trace.sourcePlane.type, signbits: trace.sourcePlane.signbits },
      plane2: trace.secondary === null ? plane() : { normal: movementVector(trace.secondary.plane.normal), dist: trace.secondary.plane.distance, type: trace.secondary.plane.type, signbits: trace.secondary.plane.signbits },
      surface: trace.surface, surface2: trace.secondary?.surface ?? null, contents: trace.contents, ent: trace.hit.kind === "none" ? null : trace.hit, source: trace };
  });
  if (result === StuckResultT.NO_GOOD_POSITION) return null;
  return drop ? dropToFloor(game, vector(origin), bounds) : vector(origin);
}

export function checkRereleaseGroundSpawnPoint(game: Q2GameServices, origin: Vec3, bounds: Bounds, _height: number, _gravity: number): boolean {
  if (!checkRogueSpawnPoint(game, origin, bounds)) return false;
  const bottom = f(origin.z + bounds.min.z);
  let fast = true;
  for (const x of [f(origin.x + bounds.min.x), f(origin.x + bounds.max.x)]) {
    for (const y of [f(origin.y + bounds.min.y), f(origin.y + bounds.max.y)]) {
      if (game.host.pointContents({ x, y, z: f(bottom - 1) }) !== 1) { fast = false; break; }
    }
    if (!fast) break;
  }
  if (fast) return true;
  const mask = monsterSolidMask(game);
  const start = { x: origin.x, y: origin.y, z: bottom };
  const stopZ = f(bottom - 36);
  const trace = game.host.trace({ start, end: { ...start, z: stopZ }, bounds: { min: { ...bounds.min, z: 0 }, max: { ...bounds.max, z: 0 } }, ignore: null, mask });
  if (trace.fraction === 1) return false;
  const center = { x: f(origin.x + f(f(bounds.min.x + bounds.max.x) * 0.5)), y: f(origin.y + f(f(bounds.min.y + bounds.max.y) * 0.5)), z: bottom };
  const half = { x: f(f(f(bounds.max.x - bounds.min.x) * 0.5) * 0.5), y: f(f(f(bounds.max.y - bounds.min.y) * 0.5) * 0.5), z: 0 };
  const quadrantBounds = { min: { x: -half.x, y: -half.y, z: 0 }, max: half };
  for (const x of [f(center.x - half.x), f(center.x + half.x)]) {
    for (const y of [f(center.y - half.y), f(center.y + half.y)]) {
      const corner = game.host.trace({ start: { x, y, z: bottom }, end: { x, y, z: stopZ }, bounds: quadrantBounds, ignore: null, mask });
      if (corner.fraction === 1 || f(trace.end.z - corner.end.z) > 18) return false;
    }
  }
  return true;
}
