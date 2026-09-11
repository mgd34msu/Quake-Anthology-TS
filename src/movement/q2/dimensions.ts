import type { Bounds } from "../../contracts/math.ts";
import type { NumericOperations } from "../../contracts/numeric.ts";

export const Q2_PLAYER_BOUNDS: Bounds = { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } };

/** Source posture heights relative to the selected character's standing body. */
export function characterHeight(bounds: Bounds, sourceHeight: number, numeric: NumericOperations): number {
  return numeric.add(bounds.min.z, numeric.multiply(numeric.add(sourceHeight, 24) / 56, numeric.subtract(bounds.max.z, bounds.min.z)));
}
