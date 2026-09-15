/* quakec_mg3/items.qc and subs.qc. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import type { Q1AddonContext } from "../context.ts";

export const MG3_ITEM_PREFIX = "mg3:items:";
export const MG3_SPAWNED_ITEM = 4;

export function startMg3Item(context: Q1AddonContext, entity: Q1Actor): undefined {
  const { game } = context;
  if (context.removedOutsideCoop(entity) || context.removedForRunes(entity)) return undefined;
  entity.originalModel = entity.model;
  if ((entity.spawnflags & MG3_SPAWNED_ITEM) !== 0) entity.use = game.named.use(entity, MG3_ITEM_PREFIX + "regenerate");
  return game.schedule(entity, 0.2, game.named.action(entity, MG3_ITEM_PREFIX + "place"));
}

export function finishMg3Pickup(context: Q1AddonContext, entity: Q1Actor, other: ActorId,
  message: string, sound: string, args: readonly (string | number)[] = []): undefined {
  const { game } = context, player = game.host.actors.resolveOwned(other);
  if (player === null) return undefined;
  if (message !== "") game.message(other, message, true, args);
  game.sound(player, sound, "item"); game.effect("pickup", game.body(entity).origin, other);
  entity.activator = other; game.useTargets(entity, other);
  return game.live(entity) ? game.remove(entity) : undefined;
}

export function registerMg3ItemCallbacks(context: Q1AddonContext): undefined {
  const { game } = context;
  game.named.register(MG3_ITEM_PREFIX + "place", { action: (_game, entity) => {
    game.named.action(entity, "PlaceItem")();
    if (game.live(entity) && (entity.spawnflags & MG3_SPAWNED_ITEM) !== 0) {
      entity.solid = "none"; entity.model = ""; game.link(entity);
    }
    return undefined;
  } });
  game.named.register(MG3_ITEM_PREFIX + "regenerate", { use: (_game, entity) => game.named.action(entity, "SUB_regen")() });
  return undefined;
}
