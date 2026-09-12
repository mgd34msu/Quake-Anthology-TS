import type { Q1EntityServices } from "../../../content/q1/foundation/entity-services.ts";
import type { Q1PusherServices } from "../../../movement/q1/types.ts";
import type { SharedPhysics } from "./physics.ts";

/** Native source fields join the same pusher transaction used by raw QC. */
export function createNativeQ1PusherServices(game: Q1EntityServices, physics: SharedPhysics): Q1PusherServices {
  return { ...physics.q1PusherServices({
    read: actor => {
      const physical = physics.readQ1Pusher(actor), source = game.entity(actor);
      if (physical === null || source === null) return physical;
      return { ...physical, localTimeSeconds: source.number("ltime"), nextThinkSeconds: source.nextThink,
        state: { ...physical.state, flags: source.movementFlags } };
    },
    write: physical => {
      physics.writeQ1Pusher(physical);
      const source = game.entity(physical.actor.id);
      if (source !== null) {
        source.fields.set("ltime", String(physical.localTimeSeconds)); source.nextThink = physical.nextThinkSeconds;
        source.movementFlags = physical.state.flags;
      }
      return undefined;
    },
    link: (actor, touch) => { game.host.bodies.link(actor); if (touch) physics.touchTriggers(actor); return undefined; },
    blocked: (actor, other) => game.entity(actor.id)?.blocked?.(other),
  }), think: actor => game.entity(actor.id)?.think?.() };
}
