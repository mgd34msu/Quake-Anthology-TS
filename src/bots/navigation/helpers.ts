// SPDX-License-Identifier: GPL-2.0-or-later
import type { Bounds, Vec3 } from "../../contracts/math.ts";
import type { QueryTarget } from "../../contracts/scene.ts";
import type { NavigationNode, NavigationProfile, NavigationWorld } from "./types.ts";
export function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new RangeError(`Navigation record ${index} exceeds ${values.length}`);
  return value;
}
export function distance(a: Vec3, b: Vec3): number { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
export function midpoint(a: Vec3, b: Vec3): Vec3 { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }; }
export function translated(point: Vec3, bounds: Bounds): Bounds {
  return { min: { x: point.x + bounds.min.x, y: point.y + bounds.min.y, z: point.z + bounds.min.z },
    max: { x: point.x + bounds.max.x, y: point.y + bounds.max.y, z: point.z + bounds.max.z } };
}
export const NavigationContents = Object.freeze({ water: 1, slime: 2, lava: 4, ladder: 8 });
export function crouchedProfile(profile: NavigationProfile): NavigationProfile | null {
  return profile.crouchedShape === undefined || !profile.capabilities.has("crouch") ? null : { ...profile, shape: profile.crouchedShape };
}
export function nodeProfile(profile: NavigationProfile, node: NavigationNode): NavigationProfile | null {
  const crouched = node.source.kind === "aas" ? (node.presence & 2) === 0 && (node.presence & 4) !== 0
    : node.source.kind === "nav3" ? (node.flags & 512) !== 0 : node.source.kind === "constructed" && node.presence === 4;
  return crouched ? crouchedProfile(profile) : profile;
}
export function contents(world: NavigationWorld, profile: NavigationProfile, point: Vec3, target: QueryTarget = { kind: "world" }): number {
  const sample = world.scene.pointContents({ point, target, policy: profile.policy, numeric: profile.movement.numeric, passActor: world.passActor });
  if (sample.kind === "q1") return sample.contents === -3 ? 1 : sample.contents === -4 ? 2 : sample.contents === -5 ? 4 : 0;
  const value = sample.kind === "q2" ? sample.merged : sample.contents;
  return ((value & 32) !== 0 ? 1 : 0) | ((value & 16) !== 0 ? 2 : 0) | ((value & 8) !== 0 ? 4 : 0)
    | (sample.kind === "q2" && (value & 0x20000000) !== 0 ? 8 : 0);
}
export function trace(world: NavigationWorld, profile: NavigationProfile, start: Vec3, end: Vec3, target: QueryTarget = { kind: "world" }) {
  return world.scene.trace({ start, end, shape: profile.shape, target, policy: profile.policy,
    numeric: profile.movement.numeric, passActor: world.passActor });
}
export function clear(world: NavigationWorld, profile: NavigationProfile, start: Vec3, end: Vec3, target: QueryTarget = { kind: "world" }): boolean {
  const result = trace(world, profile, start, end, target);
  return !result.startSolid && !result.allSolid && result.fraction === 1;
}
export function validateProfile(profile: NavigationProfile): void {
  for (const shape of [profile.shape, ...(profile.crouchedShape === undefined ? [] : [profile.crouchedShape])]) {
    const bounds = shape.bounds;
    for (const value of [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z,
      profile.maximumStep, profile.maximumDrop, profile.minimumFloorNormal]) if (!Number.isFinite(value)) throw new RangeError("Navigation profile must be finite");
    if (bounds.min.x >= bounds.max.x || bounds.min.y >= bounds.max.y || bounds.min.z >= bounds.max.z
      || profile.maximumStep < 0 || profile.maximumDrop < 0 || profile.minimumFloorNormal <= 0 || profile.minimumFloorNormal > 1) throw new RangeError("Invalid navigation body/traversal envelope");
  }
  const family = profile.movement.kind.startsWith("q1") ? "q1" : profile.movement.kind.startsWith("q2") ? "q2" : "q3";
  if (profile.policy.kind !== family) throw new TypeError("Navigation collision policy must follow selected movement, independently of BSP format");
}
