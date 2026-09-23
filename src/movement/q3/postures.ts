import type { FixedMovementPose } from "../../contracts/movement.ts";
import type { Bounds } from "../../contracts/math.ts";
import type { Q3Postures } from "./types.ts";

/** Source bg_pmove dimensions for a selected Q3 collision body. */
export const Q3_SOURCE_STANDING_BOUNDS: Bounds = { min: { x: -15, y: -15, z: -24 }, max: { x: 15, y: 15, z: 32 } };
export const Q3_SOURCE_POSTURES: Q3Postures = {
  standingViewHeight: 26,
  crouched: { bounds: { min: { x: -15, y: -15, z: -24 }, max: { x: 15, y: 15, z: 16 } }, viewHeight: 12 },
  dead: { bounds: { min: { x: -15, y: -15, z: -24 }, max: { x: 15, y: 15, z: -8 } }, viewHeight: -16 },
  invulnerabilityExpanded: { min: { x: -42, y: -42, z: -42 }, max: { x: 42, y: 42, z: 42 } },
};

/** PM_CheckDuck uses the expanded sphere only after the original client overlap test admits it. */
export function q3InvulnerabilityPose(expanded: boolean, postures: Q3Postures): FixedMovementPose {
  return { kind: "fixed", crouched: true, bounds: expanded ? postures.invulnerabilityExpanded : postures.crouched.bounds, viewHeight: postures.crouched.viewHeight };
}
