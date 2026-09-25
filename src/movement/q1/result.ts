import type { Vec3 } from "../../contracts/math.ts";
import type { LocomotionAnimation, Q1MovementResult, Q1MovementState, QwMovementResult, QwMovementState } from "../../contracts/movement.ts";
import type { TraceHit } from "../../contracts/scene.ts";
import type { MovementContext } from "./common.ts";

export function finishMovement(context: MovementContext, state: Q1MovementState | QwMovementState, viewAngles: Vec3,
  ground: TraceHit, waterLevel: number, waterType: number): Q1MovementResult | QwMovementResult {
  const input = context.input, source = context.sourceState(state);
  if (source.kind !== "q1-netquake" && source.kind !== "q1-quakeworld") throw new Error("Source client output changed movement dialect");
  state = source;
  const weapon = context.services.weaponStep({ actor: input.actor, command: input.command, frame: input.frame,
    arsenal: input.arsenal, animation: input.animation, environment: input.environment, gauntletHit: false }, state);
  for (const effect of weapon.effects) context.effect(effect);
  const continuation = weapon.continuation;
  if (continuation?.kind === "actor-removed") return { kind: state.kind, status: "actor-removed", actor: input.actor.id,
    commandSequence: input.commandSequence, effects: context.effects };
  if (continuation?.kind === "continue") {
    const next = continuation.state;
    if ((next.kind !== "q1-netquake" && next.kind !== "q1-quakeworld") || next.kind !== state.kind) throw new Error("Weapon callback changed movement family");
    state = next; viewAngles = next.kind === "q1-netquake" ? next.viewAngles : next.angles; ground = next.ground;
    if (next.kind === "q1-netquake") { waterLevel = next.waterLevel; waterType = next.waterType; }
  }
  const horizontalSpeed = context.math.horizontal(state.velocity);
  const locomotion: LocomotionAnimation = waterLevel >= 2 ? "swim" : ground.kind === "none" ? "jump"
    : horizontalSpeed > 0 ? input.command.forwardMove < 0 ? "backward" : "run" : "idle";
  const animation = context.services.animationStep({ actor: input.actor, frame: input.frame, animation: weapon.animation,
    locomotion, backwards: input.command.forwardMove < 0, force: false });
  for (const effect of animation.effects) context.effect(effect);
  const fields = { actor: input.actor.id, commandSequence: input.commandSequence, bounds: context.bounds, viewAngles,
    viewHeight: context.viewHeight, ground, waterLevel, waterType, horizontalSpeed, contacts: context.contacts,
    effects: context.effects, arsenal: weapon.arsenal, animation: animation.animation };
  return state.kind === "q1-netquake" ? { kind: state.kind, status: "active", state, ...fields }
    : { kind: state.kind, status: "active", state, ...fields };
}
