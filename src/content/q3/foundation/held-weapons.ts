import type { ModelTransform } from "../../../contracts/scene.ts";

/* Sarge TORSO_STAND frame 151, upper.md3 u_torso vertices 65..96:
 * centroid of 13 unique right-hand points, expressed in tag_weapon coordinates.
 * Q3's native guns share this authored tag registration across player models. */
export const Q3_WEAPON_HAND_GRIP: ModelTransform = {
  origin: { x: -2.9841071642362156, y: -0.7671715473899474, z: -2.208833547738882 },
  axis: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }],
  scale: { x: 1, y: 1, z: 1 },
};
