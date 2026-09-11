// BG_TouchJumpPad from id Software code/game/bg_misc.c.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.
import type { ActorId, ProviderId } from "../../contracts/identity.ts";
import { sameActor } from "../../contracts/identity.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { PredictableMovementEvent, Q3MovementState } from "../../contracts/movement.ts";
import { angleNormalize180, vec3, vectorToAngles } from "../../core/math.ts";
import { EntityEvent, MoveType } from "./constants.ts";

export interface Q3JumpPadResult {
  readonly state: Q3MovementState;
  readonly event: PredictableMovementEvent | null;
}

export function touchQ3JumpPad(state: Q3MovementState, pad: ActorId, velocity: Vec3,
  flight: boolean, provider: ProviderId): Q3JumpPadResult {
  if (state.movementType !== MoveType.PM_NORMAL || flight) return { state, event: null };
  const changed = state.jumpPad === null || !sameActor(state.jumpPad, pad);
  const pitch = Math.abs(angleNormalize180(vectorToAngles(velocity).x));
  return { state: { ...state, jumpPad: pad, jumpPadFrame: state.movementFrame,
    velocity: vec3(velocity.x, velocity.y, velocity.z),
    predictableEventSequence: changed ? (state.predictableEventSequence + 1) | 0 : state.predictableEventSequence },
    event: changed ? { provider, sequence: state.predictableEventSequence, event: EntityEvent.EV_JUMP_PAD,
      parameter: pitch < 45 ? 0 : 1 } : null };
}

/** End of CG_TouchTriggerPrediction, after all eligible source triggers have run. */
export function finishQ3JumpPadPrediction(state: Q3MovementState): Q3MovementState {
  return state.jumpPadFrame === state.movementFrame ? state : { ...state, jumpPad: null, jumpPadFrame: 0 };
}
