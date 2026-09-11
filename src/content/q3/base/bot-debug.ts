import type { Vec3 } from "../../../contracts/math.ts";
export interface BotDebugPolygons { create(color: number, count: number, points: readonly Vec3[]): number; }
