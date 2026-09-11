// PM animation operations from id Software bg_pmove.c.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.
import type { ActorAnimationState, AnimationState, AnimationStepResult, MovementEffect } from "../../contracts/movement.ts";
import { CommandButtons as B, EntityEvent, MoveType, PlayerAnimation as A } from "./constants.ts";
import type { Q3AnimationRequest, Q3HookContext } from "./types.ts";

export interface Q3AnimationContext {
  readonly animation: ActorAnimationState;
  readonly dead: boolean;
  readonly elapsedMilliseconds: number;
  readonly buttons: number;
  readonly product: "baseq3" | "missionpack";
  readonly eventSequence: number;
}

type Q3Animation = Extract<AnimationState, { readonly kind: "q3" }>;

function result(context: Q3AnimationContext, state: Q3Animation, events: readonly number[] = []): AnimationStepResult {
  const effects: MovementEffect[] = [];
  if (state !== context.animation.state) effects.push({ kind: "animation", provider: context.animation.provider,
    before: context.animation.state, after: state });
  for (const event of events) effects.push({ kind: "event", value: { provider: context.animation.provider,
    sequence: context.eventSequence, event, parameter: 0 } });
  return { animation: { provider: context.animation.provider, state }, effects };
}

/** A character adapter selects this only for an actual Q3 animation state. */
export function runQ3AnimationOperation(request: Q3AnimationRequest, context: Q3AnimationContext): AnimationStepResult {
  const state = context.animation.state;
  if (state.kind !== "q3") throw new TypeError("Q3 animation operations require the selected Q3 character adapter");
  switch (request.kind) {
    case "legs": {
      const timer = request.force ? 0 : state.legsTimerMilliseconds;
      if (context.dead || timer > 0 ||
          (!request.force && (state.legs & ~128) === request.animation)) {
        return result(context, timer === state.legsTimerMilliseconds ? state : { ...state, legsTimerMilliseconds: timer });
      }
      return result(context, { ...state, legsTimerMilliseconds: timer,
        legs: ((state.legs & 128) ^ 128) | request.animation });
    }
    case "legs-timer": return result(context, { ...state, legsTimerMilliseconds: request.milliseconds });
    case "drop-timers": {
      const elapsed = context.elapsedMilliseconds;
      return result(context, { ...state,
        legsTimerMilliseconds: state.legsTimerMilliseconds > 0 ? Math.max(0, state.legsTimerMilliseconds - elapsed) : state.legsTimerMilliseconds,
        torsoTimerMilliseconds: state.torsoTimerMilliseconds > 0 ? Math.max(0, state.torsoTimerMilliseconds - elapsed) : state.torsoTimerMilliseconds });
    }
    case "gesture": {
      if (state.torsoTimerMilliseconds !== 0) return result(context, state);
      if (context.buttons & B.GESTURE) {
        return result(context, { ...state,
          torso: !context.dead ? ((state.torso & 128) ^ 128) | A.TORSO_GESTURE : state.torso,
          torsoTimerMilliseconds: 34 * 66 + 50 }, [EntityEvent.EV_TAUNT]);
      }
      if (context.product === "missionpack") {
        const gestures: readonly (readonly [B, A])[] = [
          [B.GETFLAG, A.TORSO_GETFLAG], [B.GUARDBASE, A.TORSO_GUARDBASE], [B.PATROL, A.TORSO_PATROL],
          [B.FOLLOWME, A.TORSO_FOLLOWME], [B.AFFIRMATIVE, A.TORSO_AFFIRMATIVE], [B.NEGATIVE, A.TORSO_NEGATIVE],
        ];
        for (const [button, animation] of gestures) if (context.buttons & button) {
          return result(context, { ...state,
            torso: !context.dead ? ((state.torso & 128) ^ 128) | animation : state.torso,
            torsoTimerMilliseconds: 600 });
        }
      }
      return result(context, state);
    }
  }
}

/** PM_StartTorsoAnim and PM_ContinueTorsoAnim for the selected Q3 character. */
export function runQ3TorsoOperation(animation: number, context: Q3AnimationContext, continueAnimation = false): AnimationStepResult {
  const state = context.animation.state;
  if (state.kind !== "q3") throw new TypeError("Q3 torso operations require the selected Q3 character adapter");
  if (context.dead ||
      (continueAnimation && ((state.torso & ~128) === animation || state.torsoTimerMilliseconds > 0))) return result(context, state);
  return result(context, { ...state, torso: ((state.torso & 128) ^ 128) | animation });
}

function characterContext(context: Q3HookContext): Q3AnimationContext {
  return { animation: context.animation, dead: context.motion.pmType >= MoveType.PM_DEAD,
    elapsedMilliseconds: context.frame.elapsed.value, buttons: context.command.buttons,
    product: context.motion.product, eventSequence: context.motion.eventSequence };
}

export function q3SourceAnimation(request: Q3AnimationRequest, context: Q3HookContext): AnimationStepResult {
  return runQ3AnimationOperation(request, characterContext(context));
}

export function q3SourceTorso(animation: number, context: Q3HookContext, continueAnimation = false): AnimationStepResult {
  return runQ3TorsoOperation(animation, characterContext(context), continueAnimation);
}
