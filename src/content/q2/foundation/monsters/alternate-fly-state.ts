/* Quake II rerelease monsterinfo_t fly_* fields. GPL-2.0-or-later. */
import type { Vec3 } from "../../../../contracts/math.ts";

/** Values are source-private save state. Timers use the shared seconds unit;
 * source integer-millisecond random deadlines are converted at the boundary. */
export interface Q2AlternateFlyState {
  alternateFly: boolean;
  flyMinDistance: number;
  flyMaxDistance: number;
  flyAcceleration: number;
  flySpeed: number;
  flyIdealPosition: Vec3;
  flyPositionTime: number;
  flyBuzzard: boolean;
  flyAbove: boolean;
  flyPinned: boolean;
  flyThrusters: boolean;
  flyRecoveryTime: number;
  flyRecoveryDirection: Vec3;
  hintPath: boolean;
  pathing: { readonly firstMovePoint: Vec3; readonly secondMovePoint: Vec3; readonly traversalPending: boolean } | null;
}

export function createAlternateFlyState(): Q2AlternateFlyState {
  return { alternateFly: false, flyMinDistance: 0, flyMaxDistance: 0, flyAcceleration: 0, flySpeed: 0,
    flyIdealPosition: { x: 0, y: 0, z: 0 }, flyPositionTime: 0, flyBuzzard: false, flyAbove: false,
    flyPinned: false, flyThrusters: false, flyRecoveryTime: 0, flyRecoveryDirection: { x: 0, y: 0, z: 0 }, hintPath: false, pathing: null };
}
