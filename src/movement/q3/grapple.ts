// Grapple pull velocity from bg_pmove.c.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.
import type { Vec3 } from "../../contracts/math.ts";
import { add3, length3, normalize3, scale3, sub3 } from "../../core/math.ts";

export const Q3_GRAPPLE_SPEED = 800;

export function q3GrappleVelocity(origin: Vec3, point: Vec3, forward: Vec3): Vec3 {
  const pull = sub3(add3(point, scale3(forward, -16)), origin);
  const distance = Math.fround(length3(pull));
  return scale3(normalize3(pull), distance <= 100 ? Math.fround(10 * distance) : Q3_GRAPPLE_SPEED);
}
