import type { Q2CtfGrappleEquipment } from "../../equipment/ctf-grapple.ts";
import { captureCtfGrapple, restoreCtfGrapple } from "../../equipment/grapple-services.ts";
import type { CtfGrappleState } from "../../equipment/grapple-services.ts";
import type { SavedActorId } from "../../../../contracts/session.ts";
import { readSavedActor } from "../../../../persistence/save-image.ts";
import { decodeCheckpointValue, encodeCheckpointValue, SaveReader } from "../../../../persistence/value.ts";
import type { Q2GameServices } from "../../foundation/host.ts";
import { Q2CtfPlayerState, saveCtfActor } from "./types.ts";
import type { Q2CtfContext, Q2CtfElection, Q2CtfGhost, Q2CtfMatchState, Q2CtfRules } from "./types.ts";

type PlayerCheckpoint = Q2CtfPlayerState & Omit<CtfGrappleState, "grapple"> & { readonly grapple: SavedActorId | null };
type GhostCheckpoint = Omit<Q2CtfGhost, "actor"> & { readonly actor: SavedActorId | null };
type ElectionCheckpoint = Omit<Q2CtfElection, "target"> & { readonly target: SavedActorId };
export interface Q2CtfCheckpoint {
  readonly version: 1;
  readonly rules: Omit<Q2CtfRules, "adminPassword" | "warpList">;
  readonly match: Omit<Q2CtfMatchState, "ghosts" | "election"> & { readonly ghosts: readonly GhostCheckpoint[]; readonly election: ElectionCheckpoint | null };
  readonly players: readonly { readonly actor: SavedActorId; readonly state: PlayerCheckpoint }[];
}

export function captureQ2Ctf(context: Q2CtfContext, equipment: Q2CtfGrappleEquipment): Q2CtfCheckpoint {
  const { adminPassword: _password, warpList: _mapPermissions, ...rules } = context.rules;
  const { ghosts, election, ...match } = context.match;
  return { version: 1, rules, match: { ...match, ghosts: [...ghosts.values()].map(ghost => ({ ...ghost, actor: ghost.actor === null ? null : saveCtfActor(ghost.actor) })),
    election: election === null ? null : { ...election, target: saveCtfActor(election.target) } },
    players: [...context.states].map(([actor, state]) => ({ actor: saveCtfActor(actor), state: { ...state, ...captureCtfGrapple(equipment.state(actor)) } })) };
}

/** Shared actors, player records, inventory and the foundation restore first. */
export function restoreQ2Ctf(context: Q2CtfContext, game: Q2GameServices, checkpoint: Q2CtfCheckpoint, equipment: Q2CtfGrappleEquipment): undefined {
  equipment.bind(game);
  const players = checkpoint.players.map(entry => {
    const actor = game.host.actors.resolveSaved(entry.actor);
    if (actor === null || game.entity(actor.id) === null || context.hooks.player(actor.id) === null) throw new Error("CTF restore requires the existing shared player and source entity");
    const state = new Q2CtfPlayerState();
    const { grapple, grappleState, grappleReleaseTime, ...matchState } = entry.state;
    Object.assign(state, matchState);
    const hook = restoreCtfGrapple({ grapple, grappleState, grappleReleaseTime }, game);
    return { actor: actor.id, state, hook };
  });
  context.states.clear(); equipment.states.clear();
  for (const entry of players) { context.states.set(entry.actor, entry.state); equipment.states.set(entry.actor, entry.hook); }
  const { ghosts, election, ...match } = checkpoint.match;
  Object.assign(context.rules, checkpoint.rules); Object.assign(context.match, match);
  context.match.ghosts.clear();
  for (const ghost of ghosts) context.match.ghosts.set(ghost.code, { ...ghost, actor: ghost.actor === null ? null : game.host.actors.referenceSaved(ghost.actor) });
  context.match.election = election === null ? null : { ...election, target: game.host.actors.referenceSaved(election.target) };
  for (const [actor, state] of equipment.states) context.hooks.setGrapplePrediction(actor, state.grapple !== null && state.grappleState === "hang");
  return undefined;
}

function readPlayer(reader: SaveReader): PlayerCheckpoint {
  return { team: reader.field("team").choice(0, 1, 2), spawnState: reader.field("spawnState").integer(0),
    lastHurtCarrier: reader.field("lastHurtCarrier").nullable(value => value.finite()), lastReturnedFlag: reader.field("lastReturnedFlag").nullable(value => value.finite()),
    lastFraggedCarrier: reader.field("lastFraggedCarrier").nullable(value => value.finite()), flagSince: reader.field("flagSince").finite(),
    voted: reader.field("voted").boolean(), ready: reader.field("ready").boolean(), admin: reader.field("admin").boolean(), idView: reader.field("idView").boolean(),
    ghostCode: reader.field("ghostCode").nullable(value => value.integer(10000)), grapple: reader.field("grapple").nullable(readSavedActor),
    grappleState: reader.field("grappleState").choice("fly", "pull", "hang"), grappleReleaseTime: reader.field("grappleReleaseTime").finite(), regenTime: reader.field("regenTime").finite(),
    techSoundTime: reader.field("techSoundTime").finite(), lastTechMessage: reader.field("lastTechMessage").finite(), matchRespawnAt: reader.field("matchRespawnAt").nullable(value => value.finite()) };
}
export function encodeQ2CtfCheckpoint(checkpoint: Q2CtfCheckpoint): Uint8Array { return encodeCheckpointValue(checkpoint); }
export function decodeQ2CtfCheckpoint(bytes: Uint8Array): Q2CtfCheckpoint {
  const reader = new SaveReader(decodeCheckpointValue(bytes), "q2-ctf"), rules = reader.field("rules"), match = reader.field("match");
  return { version: reader.field("version").literal(1), rules: {
    forceJoin: rules.field("forceJoin").choice("", "red", "blue"), competition: rules.field("competition").integer(0), matchLock: rules.field("matchLock").boolean(), electionPercentage: rules.field("electionPercentage").finite(),
    matchMinutes: rules.field("matchMinutes").finite(), setupMinutes: rules.field("setupMinutes").finite(), startSeconds: rules.field("startSeconds").finite(), captureLimit: rules.field("captureLimit").integer(0), instantWeapons: rules.field("instantWeapons").boolean(),
  }, match: { team1: match.field("team1").integer(0), team2: match.field("team2").integer(0), total1: match.field("total1").integer(), total2: match.field("total2").integer(),
    lastFlagCapture: match.field("lastFlagCapture").nullable(value => value.finite()), lastCaptureTeam: match.field("lastCaptureTeam").nullable(value => value.choice(1, 2)),
    phase: match.field("phase").choice("none", "setup", "pregame", "game", "post"), matchTime: match.field("matchTime").finite(), lastTime: match.field("lastTime").integer(),
    election: match.field("election").nullable(value => ({ kind: value.field("kind").choice("match", "admin", "map"), target: readSavedActor(value.field("target")), map: value.field("map").string(), message: value.field("message").string(), votes: value.field("votes").integer(0), needed: value.field("needed").integer(1), expires: value.field("expires").finite() })),
    ghosts: match.field("ghosts").list(value => ({ code: value.field("code").integer(10000), team: value.field("team").choice(1, 2), name: value.field("name").string(), actor: value.field("actor").nullable(readSavedActor), score: value.field("score").integer(), deaths: value.field("deaths").integer(0), kills: value.field("kills").integer(0), captures: value.field("captures").integer(0), baseDefense: value.field("baseDefense").integer(0), carrierDefense: value.field("carrierDefense").integer(0) })),
  }, players: reader.field("players").list(value => ({ actor: readSavedActor(value.field("actor")), state: readPlayer(value.field("state")) })) };
}
