import type { Q2Entity, Q2GameServices } from "../foundation/host.ts";
import type { Q2RereleasePlayers } from "./players.ts";
import { add, zero } from "../foundation/fields.ts";

/** Rerelease KillBox visits the complete linked overlap set and protects coop teammates. */
export function killQ2RereleaseBox(entity: Q2Entity, game: Q2GameServices, players: Q2RereleasePlayers, spawning: boolean, exact: boolean): boolean {
  if (players.states.get(entity.actor.id)?.noclip) return true;
  const body = game.body(entity), min = add(body.origin, body.bounds.min), max = add(body.origin, body.bounds.max);
  for (const observation of game.host.actors.observations()) {
    const actor = observation.id;
    if (actor === entity.actor.id) continue;
    const target = game.entity(actor), linked = game.host.bodies.linked(actor);
    if (linked === null || game.host.combat.read(actor)?.canTakeDamage !== true || target !== null && target.solid !== "box") continue;
    const bounds = linked.absoluteBounds;
    if (bounds.max.x < min.x || bounds.min.x > max.x || bounds.max.y < min.y || bounds.min.y > max.y || bounds.max.z < min.z || bounds.min.z > max.z) continue;
    if (spawning && game.options.mode === "coop" && !players.rereleaseOptions.coopPlayerCollision && game.host.isPlayer(actor)) continue;
    if (exact && entity.model.startsWith("*") && !players.rereleaseHooks.clipTrigger(entity, actor, game)) continue;
    if (game.options.mode === "coop" && game.host.isPlayer(entity.actor.id) && game.host.isPlayer(actor)) {
      entity.clipMask &= ~0x40000000;
      if (target !== null) target.clipMask &= ~0x40000000;
      players.rereleaseHooks.playerCollision?.(entity.actor.id, false); players.rereleaseHooks.playerCollision?.(actor, false);
      continue;
    }
    game.damage(actor, entity, entity.actor.id, 100000, 0, zero, body.origin, zero, spawning ? 57 : 21, 32);
  }
  return true;
}
