// SPDX-License-Identifier: GPL-2.0-or-later
/* quakec_mg3/items.qc and subs.qc. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import { vadd } from "../../foundation/types.ts";
import type { Q1AddonContext } from "../context.ts";

export const MG3_ITEM_PREFIX = "mg3:items:";
export const MG3_SPAWNED_ITEM = 4;

/** items.qc draught_fx: the ring hum and teleport particles, once per ring. */
export function ringEffect(context: Q1AddonContext, entity: Q1Actor, offsetZ: number): undefined {
  const { game } = context;
  if (entity.count !== 0) return undefined;
  entity.count = 1;
  const origin = vadd(game.body(entity).origin, { x: 0, y: 0, z: offsetZ });
  game.host.emit({ kind: "ambient", origin, path: "ambience/hum1.wav", volume: 0.7, attenuation: 3 });
  const particles = game.create("particle_tele");
  context.setNumber(particles, "distance", 48);
  game.setOrigin(particles, origin);
  return game.spawnEntity(particles);
}

export function startMg3Item(context: Q1AddonContext, entity: Q1Actor): undefined {
  const { game } = context;
  if (context.removedOutsideCoop(entity) || context.removedForRunes(entity)) return undefined;
  entity.originalModel = entity.model;
  if ((entity.spawnflags & MG3_SPAWNED_ITEM) !== 0) entity.use = game.named.use(entity, MG3_ITEM_PREFIX + "regenerate");
  return game.schedule(entity, 0.2, game.named.action(entity, MG3_ITEM_PREFIX + "place"));
}

export function finishMg3Pickup(
  context: Q1AddonContext,
  entity: Q1Actor,
  other: ActorId,
  message: string,
  sound: string,
  args: readonly (string | number)[] = [],
): undefined {
  const { game } = context,
    player = game.host.actors.resolveOwned(other);
  if (player === null) return undefined;
  const live = () => game.live(entity) && game.host.actors.isLive(other);
  if (message !== "") game.message(other, message, true, args);
  if (!live()) return undefined;
  game.sound(player, sound, "item");
  if (!live()) return undefined;
  game.effect("pickup", game.body(entity).origin, other);
  if (!live()) return undefined;
  entity.activator = other;
  game.useTargets(entity, other);
  return game.live(entity) ? game.remove(entity) : undefined;
}

export function registerMg3ItemCallbacks(context: Q1AddonContext): undefined {
  const { game } = context;
  game.named.register(MG3_ITEM_PREFIX + "place", {
    action: (_game, entity) => {
      game.named.action(entity, "PlaceItem")();
      if (game.live(entity) && (entity.spawnflags & MG3_SPAWNED_ITEM) !== 0) {
        entity.solid = "none";
        entity.model = "";
        game.link(entity);
      }
      return undefined;
    },
  });
  game.named.register(MG3_ITEM_PREFIX + "regenerate", {
    use: (_game, entity) => {
      game.named.action(entity, "SUB_regen")();
      return entity.classname === "item_draught_stupor" || entity.classname === "item_draught_insight" ? ringEffect(context, entity, 0) : undefined;
    },
  });
  return undefined;
}
