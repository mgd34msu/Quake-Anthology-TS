import type { Vec3 } from "../contracts/math.ts";

export interface AudioGeometryHit { readonly fraction: number; readonly startSolid: boolean; readonly allSolid: boolean; }
export type AudioGeometryTrace = (start: Vec3, end: Vec3) => AudioGeometryHit;

/** Shared replacement for geometry obstruction: clear paths retain source gain.
 * A solid boundary transmits half amplitude, halving again per 64 units of
 * estimated thickness. This is an explicit acoustic policy, not A3D SDK math. */
export function geometryTransmission(start: Vec3, end: Vec3, trace: AudioGeometryTrace): number {
  const distance = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  if (distance === 0) return 1;
  const forward = trace(start, end);
  if (forward.fraction === 1 && !forward.startSolid && !forward.allSolid) return 1;
  const reverse = trace(end, start);
  const thickness = forward.allSolid || reverse.allSolid ? distance
    : Math.max(0, distance * (1 - (forward.startSolid ? 0 : forward.fraction) - (reverse.startSolid ? 0 : reverse.fraction)));
  return Math.pow(0.5, 1 + thickness / 64);
}
