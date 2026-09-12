import type { Vec3 } from "../contracts/math.ts";
import type { TraceResult } from "../contracts/scene.ts";

export interface SweptBodyState { readonly origin: Vec3; readonly velocity: Vec3; }
export interface SweptBodyServices {
  read(): SweptBodyState | null;
  writeOrigin(origin: Vec3): void;
  writeVelocity(velocity: Vec3): void;
  trace(start: Vec3, end: Vec3): TraceResult;
  normal(trace: TraceResult): Vec3;
  impact(trace: TraceResult, normal: Vec3): void;
  readonly stopWhenStill: boolean;
  samePlane(first: Vec3, second: Vec3): boolean;
  readonly math: {
    advance(origin: Vec3, time: number, velocity: Vec3): Vec3;
    remaining(time: number, fraction: number): number;
    clip(velocity: Vec3, normal: Vec3): Vec3;
    dot(first: Vec3, second: Vec3): number;
    cross(first: Vec3, second: Vec3): Vec3;
    scale(vector: Vec3, amount: number): Vec3;
  };
}
export type SweepStop = "complete" | "removed" | "solid" | "plane-limit" | "crease-blocked" | "reversed";
const zero: Vec3 = { x: 0, y: 0, z: 0 };

/** Classic swept movement; source adapters own state access, contact effects and arithmetic. */
export function sweepBody(services: SweptBodyServices, elapsed: number): SweepStop {
  const initial = services.read();
  if (initial === null) return "removed";
  const math = services.math, primal = initial.velocity, planes: Vec3[] = [];
  let original = initial.velocity, remaining = elapsed;
  for (let bump = 0; bump < 4; bump++) {
    const state = services.read();
    if (state === null) return "removed";
    if (services.stopWhenStill && state.velocity.x === 0 && state.velocity.y === 0 && state.velocity.z === 0) break;
    const trace = services.trace(state.origin, math.advance(state.origin, remaining, state.velocity));
    if (trace.allSolid) { services.writeVelocity(zero); return "solid"; }
    if (trace.fraction > 0) { services.writeOrigin(trace.end); original = state.velocity; planes.length = 0; }
    if (trace.fraction === 1) break;
    const normal = services.normal(trace);
    services.impact(trace, normal);
    const current = services.read();
    if (current === null) return "removed";
    remaining = math.remaining(remaining, trace.fraction);
    if (planes.length >= 5) { services.writeVelocity(zero); return "plane-limit"; }
    planes.push(normal);
    let velocity: Vec3 | null = null;
    for (const plane of planes) {
      const candidate = math.clip(original, plane);
      if (planes.every(other => services.samePlane(other, plane) || math.dot(candidate, other) >= 0)) { velocity = candidate; break; }
    }
    if (velocity === null) {
      const first = planes[0], second = planes[1];
      if (planes.length !== 2 || first === undefined || second === undefined) { services.writeVelocity(zero); return "crease-blocked"; }
      const direction = math.cross(first, second);
      velocity = math.scale(direction, math.dot(direction, current.velocity));
    }
    if (math.dot(velocity, primal) <= 0) { services.writeVelocity(zero); return "reversed"; }
    services.writeVelocity(velocity);
  }
  return "complete";
}
