import type { CollisionWorld as Q3CollisionWorld } from "../../../world/collision/q3/world.ts";
export type { TraceQuery, TraceResult } from "../../../world/collision/q3/world.ts";
/** Methods are supplied by the selected map's collision adapter, including foreign BSP families. */
export type CollisionWorld = Pick<Q3CollisionWorld, "trace" | "pointContents" | "transformedTrace" | "transformedPointContents" | "counters">;
