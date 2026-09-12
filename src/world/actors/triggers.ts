import type { OwnedActor } from "../../contracts/identity.ts";
import { sameActor } from "../../contracts/identity.ts";
import type { TouchContact } from "../../contracts/world.ts";
import { boundsIntersect } from "../spatial/index.ts";
import type { SpatialIndex } from "../spatial/index.ts";
import type { SessionActorRegistry } from "./registry.ts";
import type { SharedBodyTable } from "./body.ts";

/** Q1 visits live spatial links; nested touches may remove or relink either actor. */
export function touchQ1Triggers(services: {
  readonly actors: Pick<SessionActorRegistry, "isLive" | "resolveOwned">;
  readonly bodies: Pick<SharedBodyTable, "linked">;
  readonly spatial: Pick<SpatialIndex, "visit">;
  readonly isTrigger: (actor: OwnedActor) => boolean;
  readonly touch: (contact: TouchContact) => undefined;
}, actor: OwnedActor): undefined {
  const linked = services.bodies.linked(actor.id);
  if (linked === null || !services.actors.isLive(actor.id)) return undefined;
  services.spatial.visit(linked.absoluteBounds, candidate => {
    if (!services.actors.isLive(actor.id)) return "stop";
    const id = candidate.body.actor;
    if (candidate.collision.role === "trigger" && !sameActor(id, actor.id)) {
      const trigger = services.actors.resolveOwned(id), current = services.bodies.linked(id), moving = services.bodies.linked(actor.id);
      if (trigger !== null && current !== null && moving !== null && services.isTrigger(trigger)
        && boundsIntersect(current.absoluteBounds, moving.absoluteBounds)) {
        services.touch({ self: trigger, other: actor.id, plane: null, surface: null });
      }
    }
    return services.actors.isLive(actor.id) ? "continue" : "stop";
  });
  return undefined;
}
