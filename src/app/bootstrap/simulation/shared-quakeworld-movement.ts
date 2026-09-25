import { clientStanceCommand } from "../../../movement/client-outputs.ts";
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
    if (input.environment.pose !== undefined || input.state.dead || input.state.spectator !== 0) return createQwMovementProvider(id, options).move(input, services);
    let bounds = input.shape.kind === "box" ? input.shape.bounds : standingBounds;
    let viewHeight = options.viewHeight ?? postures.standingViewHeight, crouched = bounds.max.z < standingBounds.max.z, published = false;
    const posture = (command: typeof input.command, state: typeof input.state): void => {
      const effective = clientStanceCommand(command, input.environment.clientOutputs?.stance);
      if (effective.kind !== "q1-quakeworld") throw new Error("Client stance changed movement dialect");
      let requested = !input.environment.flight && effective.upMove < 0;
      if (!requested && bounds.max.z < standingBounds.max.z) {
        const clearance = services.scene.trace({ start: state.origin, end: state.origin,
          shape: { kind: "box", bounds: standingBounds }, target: { kind: "world" },
          policy: { kind: "q1", move: "normal", hull: null }, numeric: input.profile.numeric, passActor: input.actor.id });
        requested = clearance.startSolid || clearance.allSolid;
      }
      crouched = requested;
      const nextBounds = crouched ? postures.crouched.bounds : standingBounds, nextHeight = crouched ? postures.crouched.viewHeight : postures.standingViewHeight;
      if (!published || bounds !== nextBounds || viewHeight !== nextHeight) {
        bounds = nextBounds; viewHeight = nextHeight; published = true; publishPosture?.(bounds, viewHeight);
      }
    };
    const hooks = options.hooks;
    posture(input.command, input.state);
    const command = input.command.upMove > 0 ? { ...input.command, buttons: input.command.buttons | 2 } : input.command;
    const provider = createQwMovementProvider(id, { ...options, get viewHeight() { return viewHeight; }, hooks: {
      link: (actor, state, triggers) => hooks?.link(actor, state, triggers) ?? { kind: "continue", state },
      isBsp: hit => hooks?.isBsp(hit) ?? hit.kind === "world",
      ...(hooks?.think === undefined ? {} : { think: hooks.think }),
      ...(hooks?.qwState === undefined ? {} : { qwState: hooks.qwState }),
      ...(hooks?.sound === undefined ? {} : { sound: hooks.sound }),
      ...(hooks?.playerAction === undefined ? {} : { playerAction: hooks.playerAction }),
      shape: () => ({ kind: "box", bounds }),
      beforePhysics: (next, state) => {
        const result = hooks?.beforePhysics(next, state) ?? { kind: "continue", state };
        if (result.kind === "continue" && result.state.kind === "q1-quakeworld" && next.kind === "q1-quakeworld") posture(next.command, result.state);
        return result;
      },
      afterPhysics: (next, state) => hooks?.afterPhysics(next, state) ?? { kind: "continue", state },
    } });
    return provider.move({ ...input, command, shape: { kind: "box", bounds } }, {
      ...services, animationStep: request => services.animationStep(crouched ? { ...request, locomotion: "crouch" } : request),
    });
  } };
}
