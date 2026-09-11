import type { SceneQueries, QueryTarget } from "../../../contracts/scene.ts";
import type { NumericProfile } from "../../../contracts/numeric.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { CollisionWorld, TraceQuery, TraceResult } from "../../../content/q3/presentation/collision-host.ts";
import { CollisionCounters } from "../../../world/collision/q3/counters.ts";

const numeric: NumericProfile = { id: "q3:cgame", arithmetic: { kind: "binary32", round: "each-operation" }, scalarStorage: "binary32", floatToInt: "qvm-indefinite", integerOverflow: "wrap32" };
const zero: Vec3 = { x: 0, y: 0, z: 0 };
export function q3ClientCollision(queries: SceneQueries): CollisionWorld {
  const counters = new CollisionCounters();
  // Cgame clips its own snapshot entities after the geometry trace.
  const target = (model: number | undefined, origin: Vec3, angles: Vec3): QueryTarget => ({ kind: "model", model: model ?? 0, origin, angles });
  const trace = (query: TraceQuery, origin: Vec3, angles: Vec3): TraceResult => {
    counters.c_traces++;
    const result = queries.trace({ start: query.start, end: query.end,
      shape: query.shape.kind === "point" ? query.shape : { kind: query.shape.kind, bounds: { min: query.shape.mins, max: query.shape.maxs } },
      target: target(query.modelIndex, origin, angles), policy: { kind: "q3", contentsMask: query.mask, curves: query.curves ?? true, playerCurveClip: query.playerCurveClip ?? true }, numeric, passActor: null });
    if (result.kind !== "q3") throw new Error("Shared map did not apply cgame Q3 collision policy");
    return { fraction: result.fraction, end: result.end, solidity: result.allSolid ? "all-solid" : result.startSolid ? "start-solid" : "clear",
      contact: result.contact, contents: result.contents, surfaceFlags: result.surfaceFlags };
  };
  const contents = (point: Vec3, model: number | undefined, origin: Vec3, angles: Vec3): number => {
    counters.c_pointcontents++;
    const result = queries.pointContents({ point, target: target(model, origin, angles),
      policy: { kind: "q3", contentsMask: -1, curves: true, playerCurveClip: true }, numeric, passActor: null });
    if (result.kind !== "q3") throw new Error("Shared map did not apply cgame Q3 contents policy");
    return result.contents;
  };
  return { counters, trace: query => trace(query, zero, zero), transformedTrace: trace,
    pointContents: (point, model) => contents(point, model, zero, zero), transformedPointContents: contents };
}
