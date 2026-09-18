import type { ModuleIdentity } from "../../contracts/execution.ts";
import { readElement } from "../../network/q2/state.ts";
import type { Q2PlayerState, Q2RereleasePlayerState } from "../../contracts/protocol.ts";
import { randomUUID } from "node:crypto";
import { Q2CvarFlag } from "../../core/cvars/index.ts";
import type { ActorId, SeatId } from "../../contracts/identity.ts";
import type { SharedSimulation } from "./simulation/runtime.ts";
import type { PlayerProgressEvent } from "./player-progress.ts";

export interface NativeQ2MapTransition {
  readonly kind: "game-module-map-transition";
  readonly module: ModuleIdentity;
}
export function classicMatchScore(state: Pick<Q2PlayerState, "stats">): number | null {
  return readElement(state.stats, 17) !== 0 ? null : readElement(state.stats, 14);
}

const roundIdentity = "qts_matchRoundIdentity";
/** The source cvar checkpoint retains this identity across save/load, but new maps begin a new report. */
export function prepareQ2MatchReports(simulation: SharedSimulation, restoring: boolean): void {
  if (simulation.q2Source() === null && simulation.q2Native() === null || simulation.options.mode !== "deathmatch") return;
  const cvars = simulation.q2ServerCvars();
  if (cvars === null) throw new Error("Q2 match reporting has no source cvars");
  cvars.register(roundIdentity, "", Q2CvarFlag.ReadOnly);
  if (!restoring || cvars.variableString(roundIdentity) === "") cvars.set(roundIdentity, randomUUID(), true);
}

/** API2023 bg_local.h STAT_LAYOUTS/STAT_FRAGS/STAT_SPECTATOR, not private gclient fields. */
export function rereleaseMatchScore(state: Pick<Q2RereleasePlayerState, "stats">): number | null {
  if ((readElement(state.stats, 13) & 8) === 0 || readElement(state.stats, 17) !== 0) return null;
  return readElement(state.stats, 14);
}

/** API2023 game.h LAYOUTS_INTERMISSION is explicit; classic PM_FREEZE is not a match-completion signal. */
export function q2MatchCompleted(simulation: SharedSimulation, transition?: NativeQ2MapTransition): boolean {
  if (simulation.options.mode !== "deathmatch") return false;
  const source = simulation.q2Source();
  if (source !== null) return source.players.intermission.kind !== "playing";
  const native = simulation.q2Native();
  if (transition !== undefined && native !== null) {
    const module = native.module, producer = transition.module;
    if (module.id !== producer.id || module.digest !== producer.digest || module.revision !== producer.revision || module.artifactPath !== producer.artifactPath)
      throw new Error("Native match transition belongs to another module");
    return true;
  }
  return native?.edition === "rerelease" && simulation.q2NativePlayers().some(player =>
    (readElement(native.playerState(player.client.slot + 1).stats, 13) & 8) !== 0);
}

export function q2MatchReports(simulation: SharedSimulation, locals: readonly { readonly actor: ActorId; readonly seat: SeatId }[], transition?: NativeQ2MapTransition): readonly PlayerProgressEvent[] {
  if (!q2MatchCompleted(simulation, transition)) return [];
  const identity = simulation.q2ServerCvars()?.variableString(roundIdentity);
  if (identity === undefined || identity === "") throw new Error("Q2 match reporting was not prepared");
  const map = simulation.recipe.map.geometry.requestedPath, source = simulation.q2Source();
  if (source !== null && source.players.intermission.kind !== "playing") {
    const started = source.players.intermission.started;
    return locals.flatMap<PlayerProgressEvent>(local => {
      const player = source.players.states.get(local.actor);
      if (player === undefined || player.spectator) return [];
      return [{ kind: "match-completed", source: "q2", participant: `local-seat:${local.seat.index}`,
        event: `match:${identity}:${started}`, map, score: player.score }];
    });
  }
  const native = simulation.q2Native();
  if (native === null) return [];
  return locals.flatMap<PlayerProgressEvent>(local => {
    const client = simulation.playerClient(local.actor); if (client === null) return [];
    const score = native.edition === "classic" || transition !== undefined
      ? classicMatchScore(native.playerState(client.slot + 1)) : rereleaseMatchScore(native.playerState(client.slot + 1));
    if (score === null) return [];
    return [{ kind: "match-completed", source: "q2", participant: `local-seat:${local.seat.index}`,
      event: `match:${identity}`, map, score }];
  });
}
