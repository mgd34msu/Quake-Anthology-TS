import { add3Double, angleVectorsRule, distance3Double, dot3Double, length3Double, ma3Double, normalize3DoubleOrZero, scale3Double, sub3Double, vectorToAnglesRule } from "../../../core/math.ts";
// Vector and angle arithmetic for the game-agnostic bot brain, delegating
// to the unified engine math in src/core/math.ts (double-precision helpers
// and the "bot" angle rules, bit-identical to the former local formulas).
// `BotVec3` below is structurally identical to the navigation node vector,
// so a parsed NAV2 node position is a `BotVec3` with no conversion; the
// game binding converts at its own boundary.

export interface BotVec3 {
  x: number;
  y: number;
  z: number;
}

export function bvec(x = 0, y = 0, z = 0): BotVec3 {
  return { x, y, z };
}

export function bvecCopy(v: BotVec3): BotVec3 {
  return { x: v.x, y: v.y, z: v.z };
}

export const bvecAdd = add3Double;

export const bvecSub = sub3Double;

export const bvecScale = scale3Double;

export const bvecMA = ma3Double;

export const bvecDot = dot3Double;

export const bvecLength = length3Double;

export function bvecLength2D(v: BotVec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

export const bvecDistance = distance3Double;

export function bvecDistance2D(a: BotVec3, b: BotVec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Returns a unit-length copy; a zero vector comes back as (0,0,0). */
export const bvecNormalized = normalize3DoubleOrZero;

/** Wraps an angle into [0, 360), matching mathlib.ts's anglemod. */
export function angleMod(a: number): number {
  return ((a % 360) + 360) % 360;
}

/** The shortest signed rotation from `from` to `to`, in (-180, 180]. */
export function angleDelta(from: number, to: number): number {
  let d = angleMod(to - from);
  if (d > 180) d -= 360;
  return d;
}

const RAD_TO_DEG = 180 / Math.PI;

/**
 * The pitch/yaw a view must hold to look along `dir`. Quake's convention:
 * pitch is negative looking up, angles are (pitch, yaw, roll) in degrees.
 */
export function vectorToAngles(dir: BotVec3): { pitch: number; yaw: number } {
  const angles = vectorToAnglesRule(dir, "bot");
  return { pitch: angles.x, yaw: angles.y };
}

/** mathlib.ts's AngleVectors, in this module's own vector type. */
export function angleVectors(pitch: number, yaw: number, roll: number): { forward: BotVec3; right: BotVec3; up: BotVec3 } {
  return angleVectorsRule({ x: pitch, y: yaw, z: roll }, "bot");
}

/** The angle, in degrees, between `dir` and the view direction (pitch, yaw). */
export function angleBetween(pitch: number, yaw: number, dir: BotVec3): number {
  const { forward } = angleVectors(pitch, yaw, 0);
  const d = bvecNormalized(dir);
  const dot = Math.max(-1, Math.min(1, bvecDot(forward, d)));
  return Math.acos(dot) * RAD_TO_DEG;
}

export function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
