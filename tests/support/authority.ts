// SPDX-License-Identifier: GPL-2.0-or-later
import type { ActorCallbackTable, SessionActorRegistry, SharedBodyTable } from "../../src/world/actors/index.ts";
import { GameplayAuthority } from "../../src/world/gameplay/authority.ts";

/** A combat authority whose damage hooks do nothing: for tests that only need a valid authority to hand to the code under test. */
export function inertAuthority(actors: SessionActorRegistry, callbacks: ActorCallbackTable): GameplayAuthority {
  return new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined });
}

/** Like {@link inertAuthority}, but a confirmed impulse adds to the target body's velocity as the Q1 source does. */
export function impulseAuthority(actors: SessionActorRegistry, callbacks: ActorCallbackTable, bodies: SharedBodyTable): GameplayAuthority {
  return new GameplayAuthority(actors, callbacks, {
    impulse: (actor, impulse) => {
      const body = bodies.read(actor.id);
      if (body !== null)
        bodies.write(actor, { ...body, velocity: { x: body.velocity.x + impulse.x, y: body.velocity.y + impulse.y, z: body.velocity.z + impulse.z } });
      return undefined;
    },
    beforeReaction: () => undefined,
    confirmed: () => undefined,
  });
}
