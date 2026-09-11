/* Movement portions of Quake progs106/client.qc, callable by the game provider.
 * Copyright (C) 1996-1997 Id Software, Inc. GPL-2.0-or-later. */
import type { Q1MovementInput, Q1MovementState, MovementServices } from "../../contracts/movement.ts";
import { MovementContext, seconds } from "./common.ts";
import { Q1_CONTENTS_SLIME, Q1_CONTENTS_WATER, Q1_FLAG_JUMPRELEASED, Q1_FLAG_ONGROUND, Q1_FLAG_WATERJUMP,
  type Q1MovementOptions } from "./types.ts";

export interface Q1JumpResult {
  readonly state: Q1MovementState;
  readonly action: "none" | "jump" | "swim";
}

/** Gamecode owns jump/swim sounds and timers. Do not run in addition to QC. */
export function q1PlayerJump(state: Q1MovementState, services: MovementServices): Q1JumpResult {
  if ((state.flags & Q1_FLAG_WATERJUMP) !== 0) return { state, action: "none" };
  if (state.waterLevel >= 2) {
    const vertical = state.waterType === Q1_CONTENTS_WATER ? 100 : state.waterType === Q1_CONTENTS_SLIME ? 80 : 50;
    return { state: { ...state, velocity: { ...state.velocity, z: vertical } }, action: "swim" };
  }
  if ((state.flags & Q1_FLAG_ONGROUND) === 0 || (state.flags & Q1_FLAG_JUMPRELEASED) === 0) return { state, action: "none" };
  return { state: { ...state, flags: state.flags & ~(Q1_FLAG_ONGROUND | Q1_FLAG_JUMPRELEASED),
    velocity: { ...state.velocity, z: services.numeric.store(services.numeric.add(state.velocity.z, 270)) } }, action: "jump" };
}

/** Original QC's point traces and 225-unit impulse differ from QW's 310 impulse. */
export function q1CheckWaterJump(input: Q1MovementInput, services: MovementServices, options: Q1MovementOptions = {}): Q1MovementState {
  const c = new MovementContext(input, services, options), m = c.math, n = m.n, s = input.state;
  const axes = m.angles(s.angles);
  // progs106 ignores normalize(v_forward)'s return value after zeroing Z.
  const forward = m.vec(axes.forward.x, axes.forward.y, 0);
  let start = m.add(s.origin, { x: 0, y: 0, z: 8 });
  const low = c.trace(start, m.ma(start, 24, forward), { kind: "point" }, "no-monsters");
  if (low.fraction === 1) return s;
  start = m.add(start, { x: 0, y: 0, z: n.subtract(c.bounds.max.z, 8) });
  const direction = m.scale(low.sourcePlane.normal, -50);
  const high = c.trace(start, m.ma(start, 24, forward), { kind: "point" }, "no-monsters");
  if (high.fraction !== 1) return { ...s, waterJumpDirection: direction };
  return { ...s, flags: (s.flags | Q1_FLAG_WATERJUMP) & ~Q1_FLAG_JUMPRELEASED,
    velocity: m.vec(s.velocity.x, s.velocity.y, 225), waterJumpDirection: direction,
    teleportTimeSeconds: n.store(n.add(seconds(input.frame.time), 2)) };
}
