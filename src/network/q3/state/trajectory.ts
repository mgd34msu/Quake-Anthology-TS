// q_shared.h trType_t wire storage preserves numeric mod tags. GPL-2.0-or-later.
import type { Vec3 } from "../../../contracts/math.ts";
export interface Trajectory<T extends number = number> { readonly type: T; readonly time: number; readonly duration: number; readonly base: Vec3; readonly delta: Vec3; }
