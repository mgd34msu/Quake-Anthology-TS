import type { ActorAnimationState } from "../../../contracts/movement.ts";
import { q2AttackFrames } from "../../../content/q2/foundation/weapons/presentation.ts";
import { q2PainAnimationFrames, q2DeathAnimationFrames } from "../../../content/q2/base/player/view.ts";

export type QuakeCCharacterReaction = "attack" | "pain" | "death" | "alive";

/** Source events select visual clips only; no damage, sound or life callback is owned here. */
export function quakeCCharacterAnimation(animation: ActorAnimationState, reaction: QuakeCCharacterReaction, ducked: boolean): ActorAnimationState {
  const state = animation.state;
  if (state.kind !== "q2") return animation;
  if (reaction === "alive") return state.priority !== 5 ? animation : { ...animation,
    state: { ...state, frame: 0, endFrame: 39, priority: 0, duck: false, run: false } };
  if (state.priority === 5 || reaction === "pain" && state.priority >= 3) return animation;
  const frames = reaction === "attack" ? q2AttackFrames(ducked) : reaction === "pain" ? q2PainAnimationFrames(ducked, 1)
    : q2DeathAnimationFrames(ducked, 1);
  return { ...animation, state: { ...state, frame: frames.first, endFrame: frames.last,
    priority: reaction === "death" ? 5 : reaction === "pain" ? 3 : 4, duck: ducked } };
}
