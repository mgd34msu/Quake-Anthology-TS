import type { Bounds, Vec3 } from "../../../../contracts/math.ts";
import type { Q2Entity, Q2GameServices, Q2LandmarkCarry } from "../../foundation/host.ts";
import { add, dot, scale, subtract, zero } from "../../foundation/fields.ts";

interface Side { readonly axis: "x" | "y" | "z"; readonly sign: 1 | -1; }
const sides: readonly Side[] = [{ axis: "z", sign: 1 }, { axis: "z", sign: -1 }, { axis: "x", sign: 1 }, { axis: "x", sign: -1 }, { axis: "y", sign: 1 }, { axis: "y", sign: -1 }];
const axes: readonly ("x" | "y" | "z")[] = ["x", "y", "z"];
function axisSet(vector: Vec3, axis: "x" | "y" | "z", value: number): Vec3 { return { ...vector, [axis]: value }; }
export function rotateQ2Landmark(vector: Vec3, angles: Vec3): Vec3 {
  const pitch = angles.x * Math.PI / 180, roll = angles.z * Math.PI / 180, yaw = angles.y * Math.PI / 180;
  const x = { x: vector.x, y: vector.y * Math.cos(pitch) - vector.z * Math.sin(pitch), z: vector.y * Math.sin(pitch) + vector.z * Math.cos(pitch) };
  const y = { x: x.x * Math.cos(roll) + x.z * Math.sin(roll), y: x.y, z: -x.x * Math.sin(roll) + x.z * Math.cos(roll) };
  return { x: y.x * Math.cos(yaw) - y.y * Math.sin(yaw), y: y.x * Math.sin(yaw) + y.y * Math.cos(yaw), z: y.z };
}

/** Source p_move.cpp face probes, including its final-unsorted-candidate quirk. */
export function fixQ2StuckPlayer(entity: Q2Entity, game: Q2GameServices, origin: Vec3, bounds: Bounds): Vec3 | null {
  const trace = (start: Vec3, shape: Bounds, end: Vec3) => game.host.trace({ start, bounds: shape, end, ignore: entity.actor.id, mask: 0x2010003 });
  if (!trace(origin, bounds, origin).startSolid) return origin;
  const good: { readonly origin: Vec3; readonly distance: number }[] = [];
  for (const side of sides) {
    const component = side.sign < 0 ? bounds.min[side.axis] : bounds.max[side.axis];
    let start = axisSet(origin, side.axis, origin[side.axis] + component);
    const face = { min: axisSet(bounds.min, side.axis, 0), max: axisSet(bounds.max, side.axis, 0) };
    let hit = trace(start, face, start), epsilon: { readonly axis: "x" | "y" | "z"; readonly distance: number } | null = null;
    if (hit.startSolid) {
      for (const axis of axes) {
        if (axis === side.axis) continue;
        const positive = axisSet(start, axis, start[axis] + 1), first = trace(positive, face, positive);
        if (!first.startSolid) { start = positive; hit = first; epsilon = { axis, distance: 1 }; break; }
        const negative = axisSet(start, axis, start[axis] - 1), second = trace(negative, face, negative);
        if (!second.startSolid) { start = negative; hit = second; epsilon = { axis, distance: -1 }; break; }
      }
    }
    if (hit.startSolid) continue;
    const oppositeComponent = side.sign < 0 ? bounds.max[side.axis] : bounds.min[side.axis];
    let opposite = axisSet(origin, side.axis, origin[side.axis] + oppositeComponent);
    if (epsilon !== null) opposite = axisSet(opposite, epsilon.axis, opposite[epsilon.axis] + epsilon.distance);
    hit = trace(start, face, opposite); if (hit.startSolid) continue;
    const normal = axisSet(zero, side.axis, side.sign), delta = subtract(add(hit.end, scale(normal, 0.125)), opposite);
    let position = add(origin, delta);
    if (epsilon !== null) position = axisSet(position, epsilon.axis, position[epsilon.axis] + epsilon.distance);
    if (!trace(position, bounds, position).startSolid) good.push({ origin: position, distance: dot(delta, delta) });
  }
  if (good.length > 1) { const last = good.pop(); good.sort((left, right) => left.distance - right.distance); if (last !== undefined) good.push(last); }
  return good[0]?.origin ?? null;
}

export interface Q2LandmarkPlacement { readonly origin: Vec3; readonly velocity: Vec3; readonly angles: Vec3; }
export function placeQ2Landmark(entity: Q2Entity, game: Q2GameServices, carry: Q2LandmarkCarry, spawn: Q2Entity, bounds: Bounds): Q2LandmarkPlacement | null {
  if (carry.name === "") return null;
  const landmark = game.pickTarget(carry.name); if (landmark === null) return null;
  const reference = game.body(landmark);
  let origin = add(rotateQ2Landmark(carry.relativeOrigin, reference.angles), reference.origin);
  // This is source bit 0, also authored by the shipped rerelease BSPs.
  if ((landmark.spawnflags & 1) !== 0) origin = { ...origin, z: game.body(spawn).origin.z };
  const clear = fixQ2StuckPlayer(entity, game, origin, bounds);
  return clear === null ? null : { origin: clear, velocity: rotateQ2Landmark(carry.relativeVelocity, reference.angles), angles: add(carry.relativeViewAngles, reference.angles) };
}
