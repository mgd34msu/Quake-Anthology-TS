import type { Vec3 as SceneVector } from "../../contracts/math.ts";
import type { NumericOperations } from "../../contracts/numeric.ts";
import { sweepBody } from "../swept-body.ts";
import type { SweepStop } from "../swept-body.ts";
import { createMovementMath } from "./math.ts";
import type { Vec3, TraceT } from "./types.ts";

function scene(value: Vec3): SceneVector { return { x: value[0], y: value[1], z: value[2] }; }
function source(value: SceneVector): Vec3 { return [value.x, value.y, value.z]; }

export interface Q2BodySweep {
  readonly origin: Vec3;
  readonly velocity: Vec3;
  readonly elapsed: number;
  readonly numeric: NumericOperations;
  trace(start: Vec3, end: Vec3): TraceT;
  clip(velocity: Vec3, normal: Vec3): Vec3;
  touch(trace: TraceT): void;
  prepareTrace?(trace: TraceT): void;
  solid?(trace: TraceT): void;
  readonly duplicatePlane?: { readonly threshold: number; recover(normal: Vec3): void };
}

/** Converts source tuple storage and preserves native trace identity; the shared solver owns iteration. */
export function sweepQ2Body(options: Q2BodySweep): SweepStop {
  const n = options.numeric, m = createMovementMath(n);
  return sweepBody({
    read: () => ({ origin: scene(options.origin), velocity: scene(options.velocity) }),
    writeOrigin: value => m.VectorCopy(source(value), options.origin),
    writeVelocity: (value, components) => {
      if (components === "vertical") options.velocity[2] = n.store(value.z);
      else m.VectorCopy(source(value), options.velocity);
    },
    trace: (_start, end) => {
      const native = options.trace(options.origin, source(end));
      return { fraction: native.fraction, end: scene(native.endpos), allSolid: native.allsolid, startSolid: native.startsolid, native };
    },
    prepareTrace: trace => options.prepareTrace?.(trace.native),
    solid: trace => options.solid?.(trace.native),
    normal: trace => scene(m.vec3(...trace.native.plane.normal)),
    impact: trace => options.touch(trace.native), stopWhenStill: false, samePlane: (a, b) => a === b,
    collisionPolicy: { stopOnStartSolid: false, originalVelocity: "initial", creaseVelocity: "last-candidate", candidateVelocity: "sequential", allSolidVelocity: "zero-z" },
    ...(options.duplicatePlane === undefined ? {} : { duplicatePlane: { threshold: options.duplicatePlane.threshold,
      recover: (normal: SceneVector) => options.duplicatePlane?.recover(source(normal)) } }),
    math: {
      advance: (origin, time, velocity) => {
        const out = m.vec3(); m.VectorMA(source(origin), time, source(velocity), out); return scene(out);
      },
      remaining: (time, fraction) => n.subtract(time, n.multiply(time, fraction)),
      clip: (velocity, normal) => {
        const out = m.vec3(); m.VectorCopy(options.clip(source(velocity), source(normal)), out); return scene(out);
      },
      dot: (a, b) => m.DotProduct(source(a), source(b)),
      cross: (a, b) => scene(m.vec3_cross(source(a), source(b))),
      scale: (vector, amount) => scene(m.vec3_muls(source(vector), amount)),
    },
  }, options.elapsed);
}
