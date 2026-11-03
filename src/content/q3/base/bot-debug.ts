// SPDX-License-Identifier: GPL-2.0-or-later
import type { Vec3 } from "../../../contracts/math.ts";
export interface BotDebugPolygons {
  create(color: number, count: number, points: readonly Vec3[]): number;
}
