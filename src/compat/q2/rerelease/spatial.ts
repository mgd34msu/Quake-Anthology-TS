// SPDX-License-Identifier: GPL-2.0-or-later
import type { Bounds } from "../../../contracts/math.ts";
import type { BodyState } from "../../../contracts/world.ts";

/** q2repro server/world.c SV_LinkEdict: rotated brush envelope plus one-unit padding. */
export function rereleaseLinkBounds(state: BodyState, solid: number): Bounds {
  let min = state.bounds.min, max = state.bounds.max;
  if (solid === 3 && (state.angles.x !== 0 || state.angles.y !== 0 || state.angles.z !== 0)) {
    const extent = Math.max(...[min.x, min.y, min.z, max.x, max.y, max.z].map(Math.abs));
    min = { x: -extent, y: -extent, z: -extent }; max = { x: extent, y: extent, z: extent };
  }
  return { min: { x: Math.fround(Math.fround(state.origin.x + min.x) - 1), y: Math.fround(Math.fround(state.origin.y + min.y) - 1), z: Math.fround(Math.fround(state.origin.z + min.z) - 1) },
    max: { x: Math.fround(Math.fround(state.origin.x + max.x) + 1), y: Math.fround(Math.fround(state.origin.y + max.y) + 1), z: Math.fround(Math.fround(state.origin.z + max.z) + 1) } };
}
/** q2proto_proto_kex.c kex_pack_solid selects q2pro_v2; shared solid BSP sentinel31. */
export function rereleaseNetworkSolid(bounds: Bounds, solid: number, serverFlags: number): number {
  if (solid === 3) return 31;
  if (solid !== 2 || (serverFlags & 2) !== 0 || bounds.min.x === bounds.max.x && bounds.min.y === bounds.max.y && bounds.min.z === bounds.max.z) return 0;
  const clamp = (value: number, minimum: number) => Math.max(minimum, Math.min(255, Math.trunc(value)));
  const packed = ((clamp(Math.fround(bounds.max.z + 32), 0) << 24) | (clamp(-bounds.min.z, 0) << 16) | (clamp(bounds.max.y, 1) << 8) | clamp(bounds.max.x, 1)) >>> 0;
  return packed === 31 ? 0 : packed;
}
