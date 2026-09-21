/* quakec_ctf/client.qc parm10/14/15, independent of reset equipment and selected appearance. GPL-2.0-or-later. */
import type { ActorId, OwnedActor } from "../../../../contracts/identity.ts";
import type { Q1TravelState } from "../../base/travel.ts";
import { captureQ1Travel, newQ1Travel } from "../../base/travel.ts";
import { SaveReader, decodeCheckpointValue, encodeCheckpointValue } from "../../../../persistence/value.ts";
import { numberTeam } from "./state.ts";
import type { CtfState } from "./state.ts";
import { CTF_FLAGS } from "./types.ts";

/** CTF SetNewParms always starts at 100, including rerelease nightmare co-op. */
export function newQ1CtfTravel(state: CtfState): Q1TravelState {
  const base = newQ1Travel(state.game.options), lobby = state.startMap && (state.game.world?.number("ctf.pregameOver") ?? 0) === 0;
  const inventory = base.inventory.map(entry => entry.item === "q1:weapon/shotgun" ? { ...entry, count: lobby ? 0 : 1 } :
    entry.item === "q1:ammo/shells" ? { ...entry, count: lobby ? 0 : 40 } : entry);
  inventory.push({ item: "q1:ctf/weapon/grapple", count: state.nativeGrappleEnabled && !lobby && (state.teamplay & CTF_FLAGS.disableGrapple) === 0 ? 1 : 0, capacity: 1 });
  return { health: 100, maxHealth: 100, inventory, weapon: lobby ? "axe" : "shotgun", extensions: [],
    armor: { ...base.armor, regular: lobby ? { kind: "none" } : { kind: "q1", points: 50, absorption: 0.3, item: "q1:item_armor1" } } };
}

/** SetChangeParms resets equipment even for living players; parm10/14/15 still travel. */
export function captureQ1CtfTravel(state: CtfState, actor: OwnedActor): Q1TravelState {
  const saved = captureQ1Travel(state.game, actor);
  return { ...newQ1CtfTravel(state), extensions: saved.extensions };
}

export function decodeQ1CtfTravel(state: CtfState, travel: Q1TravelState): Q1TravelState {
  return state.startMap ? { ...newQ1CtfTravel(state), extensions: travel.extensions } : travel;
}

export function captureTravel(state: CtfState, actor: ActorId): Uint8Array {
  const lastTeam = state.game.health(actor) > 0 && (state.startMap || state.services.observer(actor)) ? -1 : state.number(actor, "lastteam");
  return encodeCheckpointValue({ lastTeam, status: state.number(actor, "status"), access: state.number(actor, "access") });
}
export function restoreTravel(state: CtfState, actor: ActorId, bytes: Uint8Array): undefined {
  const reader = new SaveReader(decodeCheckpointValue(bytes), "q1:ctf:travel"), team = reader.field("lastTeam").number();
  state.set(actor, "lastteam", state.startMap ? 1 : team); state.set(actor, "status", reader.field("status").number()); state.set(actor, "access", reader.field("access").number());
  const color = numberTeam(team);
  if (!state.startMap && color !== null) { state.game.host.combat.setTraits(state.owner(actor), { team: color }); state.services.colors(actor, team - 1, team - 1); }
  return undefined;
}
