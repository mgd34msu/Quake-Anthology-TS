// SPDX-License-Identifier: GPL-2.0-or-later
import type { HeldWeaponModel } from "../../../contracts/held-weapon.ts";

// player.qc stand1/axstnd1 use one carried firearm and one axe for the complete Q1 arsenal.
const digests = [
  "sha256:10cecfe08d312ff17c63529e280b976c50018f683f541cb03b2048c7a681ebf9",
  "sha256:7bd9988aa264d27cea670bbf280d9101d712cf27d87dbe774ac41d363bdf01d2",
];
const gun: HeldWeaponModel = {
  path: "progs/player.mdl",
  referenceFrame: 12,
  part: {
    digests,
    vertices: [
      40, 41, 42, 100, 101, 102, 116, 117, 118, 142, 143, 144, 145, 146, 147, 148, 156, 157, 158, 174, 175, 177, 178, 179, 185, 186, 187, 188, 189, 190, 191,
      194, 195, 196, 199, 200, 201, 202,
    ],
  },
  grip: {
    origin: { x: 3.192499796549479, y: -5.947635650634766, z: 10.002536137898764 },
    axis: [
      { x: 0.7190015912055969, y: 0.6357764005661011, z: -0.280758261680603 },
      { x: -0.608428418636322, y: 0.7710461020469666, z: 0.18789082765579224 },
      { x: 0.3359340727329254, y: 0.03572748228907585, z: 0.941207766532898 },
    ],
    scale: { x: 1, y: 1, z: 1 },
  },
};
const axe: HeldWeaponModel = {
  path: "progs/player.mdl",
  referenceFrame: 17,
  part: { digests, vertices: [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24] },
  grip: {
    origin: { x: -1.0801829099655151, y: -16.939233779907227, z: 3.4784603118896484 },
    axis: [
      { x: 0.8529600501060486, y: 0.34326276183128357, z: 0.3932298421859741 },
      { x: -0.49903303384780884, y: 0.31537508964538574, z: 0.8071582913398743 },
      { x: 0.15305252373218536, y: -0.8847085237503052, z: 0.4403018355369568 },
    ],
    scale: { x: 1, y: 1, z: 1 },
  },
};

export function q1HeldWeapon(viewModel: string): HeldWeaponModel | null {
  return viewModel.startsWith("progs/v_") && viewModel.endsWith(".mdl") ? (viewModel === "progs/v_axe.mdl" ? axe : gun) : null;
}
