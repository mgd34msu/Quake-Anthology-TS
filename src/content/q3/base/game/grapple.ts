// Grapple motion and cable placement from bg_pmove.c and cg_weapons.c.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.
import type { Bounds, Vec3 } from "../../../../contracts/math.ts";
import { add3, length3, normalize3, scale3, sub3, vec3 } from "../../../../core/math.ts";

export const Q3_GRAPPLE_SPEED = 800;
export const Q3_GRAPPLE_LIFETIME = 10000;
export const Q3_GRAPPLE_THINK_INTERVAL = 100;

export function q3GrappleVelocity(origin: Vec3, point: Vec3, forward: Vec3): Vec3 {
  const pull = sub3(add3(point, scale3(forward, -16)), origin);
  const distance = Math.fround(length3(pull));
  return scale3(normalize3(pull), distance <= 100 ? Math.fround(10 * distance) : Q3_GRAPPLE_SPEED);
}

export function q3GrappleTarget(origin: Vec3, bounds: Bounds): Vec3 {
  return add3(origin, scale3(add3(bounds.min, bounds.max), 0.5));
}

export function q3GrappleCable(origin: Vec3, up: Vec3, point: Vec3, viewHeight = 26): { readonly start: Vec3; readonly end: Vec3 } | null {
  const start = add3(add3(origin, vec3(0, 0, viewHeight)), scale3(up, -6));
  return length3(sub3(start, point)) < 64 ? null : { start, end: point };
}
