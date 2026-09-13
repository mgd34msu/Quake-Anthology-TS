import type { ModelTransform } from "../../../contracts/scene.ts";

export interface HeldWeaponModel {
  readonly path: string;
  readonly referenceFrame: number;
  readonly grip: ModelTransform;
}

/* Male blaster stand01, players/male/w_blaster.md2 vertices 36..47 form the
 * angled pistol grip, held by the native male's right hand. Vertices 0..7
 * form the separate rectangular underside box, not the grip.
 * The matching rerelease MD5 Weapon joint supplies forward=Y, left=-Z, up=-X.
 * Native CL_AddPacketEntities
 * places this mesh in player coordinates, with the player's frame and transform. */
const MALE_BLASTER_GRIP: ModelTransform = {
  origin: { x: -2.5316378672917685, y: -9.27009121576945, z: 4.795252025127411 },
  axis: [
    { x: 0.9701912999153137, y: -0.16778743267059326, z: -0.17486034333705902 },
    { x: 0.16538193821907043, y: 0.9858221411705017, z: -0.02834496460855007 },
    { x: 0.17713716626167297, y: -0.0014186727348715067, z: 0.9841850996017456 },
  ],
  scale: { x: 1, y: 1, z: 1 },
};

export function q2HeldWeapon(viewModel: string): HeldWeaponModel | null {
  return viewModel === "models/weapons/v_blast/tris.md2"
    ? { path: "players/male/w_blaster.md2", referenceFrame: 0, grip: MALE_BLASTER_GRIP } : null;
}
