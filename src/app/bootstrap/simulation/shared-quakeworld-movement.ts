import type { ProviderId } from "../../../contracts/identity.ts";
import type { Bounds } from "../../../contracts/math.ts";
import type { MovementProvider } from "../../../contracts/movement.ts";
import type { Q1MovementOptions } from "../../../movement/q1/types.ts";
import { createQwMovementProvider } from "../../../movement/q1/index.ts";
import type { Q3Postures } from "../../../movement/q3/types.ts";

/** Shared controls and character stance surround the unchanged QuakeWorld physics. */
export function createSharedQuakeWorldMovement(id: ProviderId, options: Q1MovementOptions, standingBounds: Bounds,
  postures: Pick<Q3Postures, "standingViewHeight" | "crouched">,
  publishPosture?: (bounds: Bounds, viewHeight: number) => void): Extract<MovementProvider, { readonly kind: "q1-quakeworld" }> {
  return { kind: "q1-quakeworld", id, move(input, services) {
    if (input.state.dead || input.state.spectator !== 0) return createQwMovementProvider(id, options).move(input, services);
    let crouched = !input.environment.flight && input.command.upMove < 0;
    if (!crouched && input.shape.kind === "box" && input.shape.bounds.max.z < standingBounds.max.z) {
      const clearance = services.scene.trace({ start: input.state.origin, end: input.state.origin,
        shape: { kind: "box", bounds: standingBounds }, target: { kind: "world" },
        policy: { kind: "q1", move: "normal", hull: null }, numeric: input.profile.numeric, passActor: input.actor.id });
      crouched = clearance.startSolid || clearance.allSolid;
    }
    const bounds = crouched ? postures.crouched.bounds : standingBounds;
    const viewHeight = crouched ? postures.crouched.viewHeight : postures.standingViewHeight;
    publishPosture?.(bounds, viewHeight);
    const command = input.command.upMove > 0 ? { ...input.command, buttons: input.command.buttons | 2 } : input.command;
    const provider = createQwMovementProvider(id, { ...options, viewHeight });
    return provider.move({ ...input, command, shape: { kind: "box", bounds } }, {
      ...services, animationStep: request => services.animationStep(crouched ? { ...request, locomotion: "crouch" } : request),
    });
  } };
}
