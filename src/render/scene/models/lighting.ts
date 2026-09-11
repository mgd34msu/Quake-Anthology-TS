/* Alias lighting rules from Quake II gl_mesh.c. GPL-2.0-or-later. */
import type { Vec3 } from "../../../contracts/math.ts";

export const Q2_SHELL_MASK = 1024 | 2048 | 4096 | 65536 | 131072;

export function q2ShellColor(flags: number): Vec3 | null {
  if ((flags & Q2_SHELL_MASK) === 0) return null;
  const red = (flags & 1024) !== 0, green = (flags & 2048) !== 0, blue = (flags & 4096) !== 0;
  const double = (flags & 65536) !== 0, half = (flags & 131072) !== 0;
  if (red && green && blue) return { x: 1, y: 1, z: 1 };
  if (red) return { x: 1, y: 0, z: blue || double ? 1 : 0 };
  if (blue) return { x: 0, y: double ? 1 : 0, z: 1 };
  if (double) return { x: 0.9, y: 0.7, z: 0 };
  return { x: half ? 0.56 : 0, y: green ? 1 : half ? 0.59 : 0, z: half ? 0.45 : 0 };
}

export function q2AliasLight(flags: number, sampled: Vec3, timeSeconds: number, monochrome = false, infrared = false): Vec3 {
  const shell = q2ShellColor(flags);
  let light = shell ?? ((flags & 8) !== 0 ? { x: 1, y: 1, z: 1 } : sampled);
  if (shell === null && (flags & 8) === 0 && monochrome) {
    const value = Math.max(light.x, light.y, light.z);
    light = { x: value, y: value, z: value };
  }
  if ((flags & 1) !== 0 && light.x <= 0.1 && light.y <= 0.1 && light.z <= 0.1) light = { x: 0.1, y: 0.1, z: 0.1 };
  if ((flags & 512) !== 0) {
    const pulse = 0.1 * Math.sin(timeSeconds * 7);
    light = { x: Math.max(light.x * 0.8, light.x + pulse), y: Math.max(light.y * 0.8, light.y + pulse), z: Math.max(light.z * 0.8, light.z + pulse) };
  }
  return infrared && (flags & 32768) !== 0 ? { x: 1, y: 0, z: 0 } : light;
}

/** Q2 projects the alias shadow in model space onto the sampled world floor. */
export function aliasShadowPoint(point: Vec3, shadeVector: Vec3, entityHeight: number, floorHeight: number): Vec3 {
  const height = entityHeight - floorHeight;
  return { x: point.x - shadeVector.x * (point.z + height), y: point.y - shadeVector.y * (point.z + height), z: -height + 1 };
}
