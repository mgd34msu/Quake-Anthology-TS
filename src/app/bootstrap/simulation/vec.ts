// SPDX-License-Identifier: GPL-2.0-or-later
import type { Vec3 } from "../../../contracts/math.ts";

export const zero: Vec3 = { x: 0, y: 0, z: 0 };
export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: Math.fround(a.x + b.x), y: Math.fround(a.y + b.y), z: Math.fround(a.z + b.z) };
}
