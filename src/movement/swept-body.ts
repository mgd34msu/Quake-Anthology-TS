import type { Vec3 } from "../contracts/math.ts";
import type { TraceResult } from "../contracts/scene.ts";

export interface SweptBodyState { readonly origin: Vec3; readonly velocity: Vec3; }
export interface SweptBodyTrace { readonly fraction: number; readonly end: Vec3; readonly allSolid: boolean; readonly startSolid: boolean; }
export interface SweptBodyServices<Trace extends SweptBodyTrace = TraceResult> {
  read(): SweptBodyState | null;
  writeOrigin(origin: Vec3): void;
  writeVelocity(velocity: Vec3, components?: "all" | "vertical"): void;
  trace(start: Vec3, end: Vec3): Trace;
  prepareTrace?(trace: Trace): void;
  solid?(trace: Trace): void;
  touch?(trace: Trace): void;
  normal(trace: Trace): Vec3;
  impact(trace: Trace, normal: Vec3): void;
  readonly stopWhenStill: boolean;
  readonly collisionPolicy?: {
    readonly stopOnStartSolid: boolean;
    readonly originalVelocity: "initial" | "last-progress";
    readonly allSolidVelocity?: "zero" | "zero-z";
    readonly candidateVelocity?: "original" | "sequential";
    readonly creaseVelocity: "last-candidate" | "current";
  };
  readonly planeResponse?: {
    readonly kind: "paired";
    readonly seeds: readonly Vec3[];
    readonly enterThreshold: number;
    endVelocity(): Vec3;
    writeEndVelocity(velocity: Vec3): void;
    normalize(direction: Vec3): Vec3;
    impactSpeed(speed: number): void;
  };
  readonly duplicatePlane?: { readonly threshold: number; recover(normal: Vec3): void };
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

/** Swept movement; source adapters own state access, contact effects and arithmetic. */
export function sweepBody<Trace extends SweptBodyTrace>(services: SweptBodyServices<Trace>, elapsed: number): SweepStop {
  const initial = services.read();
  if (initial === null) return "removed";
  const math = services.math, primal = initial.velocity, paired = services.planeResponse;
  const planes: Vec3[] = [...paired?.seeds ?? []];
  let original = initial.velocity, remaining = elapsed;
  for (let bump = 0; bump < 4; bump++) {
    const state = services.read();
    if (state === null) return "removed";
    if (services.stopWhenStill && state.velocity.x === 0 && state.velocity.y === 0 && state.velocity.z === 0) break;
    const trace = services.trace(state.origin, math.advance(state.origin, remaining, state.velocity));
    if (trace.allSolid || services.collisionPolicy?.stopOnStartSolid === true && trace.startSolid) {
      if (services.collisionPolicy?.allSolidVelocity === "zero-z") services.writeVelocity({ ...state.velocity, z: 0 }, "vertical");
      else services.writeVelocity(zero);
      services.solid?.(trace);
      return "solid";
    }
    services.prepareTrace?.(trace);
    if (trace.fraction > 0) { services.writeOrigin(trace.end); if (services.collisionPolicy?.originalVelocity !== "initial") original = state.velocity; if (paired === undefined) planes.length = 0; }
    if (trace.fraction === 1) break;
    services.touch?.(trace);
    if (paired !== undefined) {
      remaining = math.remaining(remaining, trace.fraction);
      if (planes.length >= 5) { services.writeVelocity(zero); return "plane-limit"; }
    }
    const normal = services.normal(trace);
    services.impact(trace, normal);
    const current = services.read();
    if (current === null) return "removed";
    if (paired === undefined) {
      remaining = math.remaining(remaining, trace.fraction);
      if (planes.length >= 5) { services.writeVelocity(zero); return "plane-limit"; }
    }
    const duplicate = services.duplicatePlane;
    if (duplicate !== undefined && planes.some(plane => math.dot(normal, plane) > duplicate.threshold)) {
      duplicate.recover(normal);
      continue;
    }
    planes.push(normal);
    let velocity: Vec3 | null = null;
    let lastCandidate = current.velocity;
    for (const [index, plane] of planes.entries()) {
      if (paired !== undefined) {
        const into = math.dot(current.velocity, plane);
        if (into >= paired.enterThreshold) continue;
        paired.impactSpeed(-into);
        let clipped = math.clip(current.velocity, plane);
        let endClipped = math.clip(paired.endVelocity(), plane);
        for (const [secondIndex, second] of planes.entries()) {
          if (secondIndex === index || math.dot(clipped, second) >= paired.enterThreshold) continue;
          clipped = math.clip(clipped, second);
          endClipped = math.clip(endClipped, second);
          if (math.dot(clipped, plane) >= 0) continue;
          const direction = paired.normalize(math.cross(plane, second));
          clipped = math.scale(direction, math.dot(direction, current.velocity));
          endClipped = math.scale(direction, math.dot(direction, paired.endVelocity()));
          if (planes.some((third, thirdIndex) => thirdIndex !== index && thirdIndex !== secondIndex && math.dot(clipped, third) < paired.enterThreshold)) {
            services.writeVelocity(zero);
            return "crease-blocked";
          }
        }
        velocity = clipped;
        paired.writeEndVelocity(endClipped);
        break;
      }
      const candidate = math.clip(services.collisionPolicy?.candidateVelocity === "sequential" ? lastCandidate : original, plane);
      lastCandidate = candidate;
      if (planes.every(other => services.samePlane(other, plane) || math.dot(candidate, other) >= 0)) { velocity = candidate; break; }
    }
    if (paired !== undefined) {
      if (velocity !== null) services.writeVelocity(velocity);
      continue;
    }
    if (velocity === null) {
      const first = planes[0], second = planes[1];
      if (planes.length !== 2 || first === undefined || second === undefined) { services.writeVelocity(zero); return "crease-blocked"; }
      const direction = math.cross(first, second);
      velocity = math.scale(direction, math.dot(direction, services.collisionPolicy?.creaseVelocity === "last-candidate" ? lastCandidate : current.velocity));
    }
    if (math.dot(velocity, primal) <= 0) { services.writeVelocity(zero); return "reversed"; }
    services.writeVelocity(velocity);
  }
  return "complete";
}
