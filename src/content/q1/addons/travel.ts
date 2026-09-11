/* quakec_mg1/client.qc and quakec_mg3/client.qc source level parameters. GPL-2.0-or-later. */
import type { OwnedActor } from "../../../contracts/identity.ts";
import { admitQ1Travel, captureQ1Travel, newQ1Travel } from "../base/travel.ts";
import type { Q1TravelState } from "../base/travel.ts";
import type { Q1AddonContext } from "./context.ts";
import { BLOODY_NIGHTMARE_ACTIVE, BLOODY_NIGHTMARE_DISCOVERED } from "./campaign.ts";

export function newQ1AddonTravel(context: Q1AddonContext): Q1TravelState {
  const state = newQ1Travel(context.game.options);
  if (context.program !== "mg3" || context.game.options.deathmatch !== 0) return state;
  return { ...state, health: 50, maxHealth: 50, inventory: state.inventory.map(entry => {
    const capacity = entry.item === "q1:ammo/shells" ? 50 : entry.item === "q1:ammo/nails" ? 100 : entry.item === "q1:ammo/rockets" ? 20 : entry.capacity;
    return { ...entry, capacity };
  }) };
}

export function captureQ1AddonTravel(context: Q1AddonContext, actor: OwnedActor): Q1TravelState {
  const { game } = context;
  const state = captureQ1Travel(game, actor);
  if (game.health(actor.id) <= 0 || game.options.deathmatch !== 0 || game.worldType === 3) return { ...newQ1AddonTravel(context), extensions: state.extensions };
  return state;
}

export function decodeQ1AddonTravel(context: Q1AddonContext, state: Q1TravelState): Q1TravelState {
  const { game, base } = context;
  if (context.program === "mg3" && game.mapName === "boss2" && game.options.skill === 3) {
    base.campaign.writeFlags(base.campaign.readFlags() | BLOODY_NIGHTMARE_ACTIVE | BLOODY_NIGHTMARE_DISCOVERED);
  }
  return game.mapName === "start" || game.worldType === 3 || context.program !== "mg3" && context.services.cvar("horde") !== 0 ? { ...newQ1AddonTravel(context), extensions: state.extensions } : state;
}

/** The existing admission applies shared inventory, then source travel extensions restore addon words. */
export function admitQ1AddonTravel(context: Q1AddonContext, actor: OwnedActor, state: Q1TravelState): undefined {
  return admitQ1Travel(context.game, actor, decodeQ1AddonTravel(context, state));
}
