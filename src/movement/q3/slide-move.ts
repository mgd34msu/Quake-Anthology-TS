import { sweepBody } from "../swept-body.ts";
// Ported from id Software's code/game/bg_slidemove.c and PM_ClipVelocity.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.

import { add3, cross3, dot3, normalize3, normalize3OrZero, scale3, vec3 } from "../../core/math.ts";
import type { Bounds, Vec3 } from "../../core/math.ts";
import type { TraceResult } from "../../contracts/scene.ts";
import { EntityEvent } from "./constants.ts";
import type { Q3Motion, Q3MovementTraceFunction } from "./types.ts";

export interface SlideMoveContext {
  readonly state: Q3Motion;
  readonly frameTime: number;
  readonly bounds: Bounds;
  readonly mask: number;
  readonly trace: Q3MovementTraceFunction;
  readonly groundNormal: Vec3 | null;
  impactSpeed: number;
  touch(trace: TraceResult): void;
  event(event: number): void;
  debug?(message: string): void;
}

export function clipVelocity(velocity: Vec3, normal: Vec3, overbounce = 1.001): Vec3 {
  const dot = Math.fround(dot3(velocity, normal));
  const bounce = Math.fround(overbounce);
  const backoff = Math.fround(dot < 0 ? dot * bounce : dot / bounce);
  return vec3(
    velocity.x - Math.fround(normal.x * backoff),
    velocity.y - Math.fround(normal.y * backoff),
    velocity.z - Math.fround(normal.z * backoff),
  );
}

export function slideMove(context: SlideMoveContext, gravity: boolean): boolean {
  const ps = context.state;
  let primalVelocity = ps.velocity;
  let endVelocity = ps.velocity;
  if (gravity) {
    endVelocity = vec3(ps.velocity.x, ps.velocity.y, ps.velocity.z - Math.fround(ps.gravity * context.frameTime));
    ps.velocity = vec3(ps.velocity.x, ps.velocity.y, (ps.velocity.z + endVelocity.z) * 0.5);
    primalVelocity = vec3(primalVelocity.x, primalVelocity.y, endVelocity.z);
    if (context.groundNormal !== null) ps.velocity = clipVelocity(ps.velocity, context.groundNormal);
  }
  const planes: Vec3[] = [];
  if (context.groundNormal !== null) planes.push(context.groundNormal);
  planes.push(normalize3OrZero(ps.velocity));
  let contacts = 0;
  const stop = sweepBody({
    read: () => ps, writeOrigin: origin => { ps.origin = origin; }, writeVelocity: (velocity, components) => { ps.velocity = components === "vertical" ? vec3(velocity.x, velocity.y, velocity.z) : velocity; },
    trace: (start, end) => context.trace(start, end, context.bounds, ps.actor, context.mask),
    touch: trace => { contacts++; context.touch(trace); }, impact: () => undefined,
    normal: trace => {
      if (trace.contact.kind !== "plane") throw new Error("Movement impact trace requires a collision plane");
      return trace.contact.plane.normal;
    },
    stopWhenStill: false, samePlane: (first, second) => first === second,
    collisionPolicy: { stopOnStartSolid: false, originalVelocity: "initial", creaseVelocity: "current", allSolidVelocity: "zero-z" },
    duplicatePlane: { threshold: Math.fround(0.99), recover: normal => { ps.velocity = add3(ps.velocity, normal); } },
    planeResponse: { kind: "paired", seeds: planes, enterThreshold: 0.1,
      endVelocity: () => endVelocity, writeEndVelocity: value => { endVelocity = value; }, normalize: normalize3,
      impactSpeed: speed => { context.impactSpeed = Math.max(context.impactSpeed, speed); } },
    math: { advance: (origin, time, velocity) => add3(origin, scale3(velocity, time)),
      remaining: (time, fraction) => Math.fround(time - Math.fround(time * fraction)), clip: clipVelocity,
      dot: dot3, cross: cross3, scale: scale3 },
  }, context.frameTime);
  if (stop !== "complete") return true;
  if (gravity) ps.velocity = endVelocity;
  if (ps.pmTime !== 0) ps.velocity = primalVelocity;
  return contacts !== 0;
}

export function stepSlideMove(context: SlideMoveContext, gravity: boolean): void {
  const ps = context.state;
  const startOrigin = ps.origin;
  const startVelocity = ps.velocity;
  if (!slideMove(context, gravity)) return;
  const down = vec3(startOrigin.x, startOrigin.y, startOrigin.z - 18);
  const ground = context.trace(startOrigin, down, context.bounds, ps.actor, context.mask);
  if (ps.velocity.z > 0 && (ground.fraction === 1 ||
    ground.contact.kind !== "plane" || ground.contact.plane.normal.z < Math.fround(0.7))) return;
  const up = vec3(startOrigin.x, startOrigin.y, startOrigin.z + 18);
  const raised = context.trace(startOrigin, up, context.bounds, ps.actor, context.mask);
  if (raised.allSolid) {
    context.debug?.("bend can't step");
    return;
  }
  const stepSize = Math.fround(raised.end.z - startOrigin.z);
  ps.origin = raised.end;
  ps.velocity = startVelocity;
  slideMove(context, gravity);
  const dropped = context.trace(ps.origin, vec3(ps.origin.x, ps.origin.y, ps.origin.z - stepSize),
    context.bounds, ps.actor, context.mask);
  if (!dropped.allSolid) ps.origin = dropped.end;
  if (dropped.fraction < 1 && dropped.contact.kind === "plane") {
    ps.velocity = clipVelocity(ps.velocity, dropped.contact.plane.normal);
  }
  const delta = Math.fround(ps.origin.z - startOrigin.z);
  if (delta > 2) {
    context.event(delta < 7 ? EntityEvent.EV_STEP_4 : delta < 11 ? EntityEvent.EV_STEP_8 :
      delta < 15 ? EntityEvent.EV_STEP_12 : EntityEvent.EV_STEP_16);
  }
  context.debug?.("stepped");
}
