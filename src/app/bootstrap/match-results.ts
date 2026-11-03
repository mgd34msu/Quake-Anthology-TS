import { randomBytes, randomUUID } from "node:crypto";
import type { ProviderId } from "../../contracts/identity.ts";
import { EventRing, type EventCursor } from "../../foundation/event-ring.ts";
import { LocalAuthorization, LocalRankingService, type Account, type AccountId, type RankingEntry } from "../../network/services/online.ts";
import { classicMatchScore, q2MatchCompleted, rereleaseMatchScore, type NativeQ2MapTransition } from "./q2-match-reports.ts";
import type { PlayerProgressStore } from "./player-progress.ts";
import type { SharedSimulation } from "./simulation/runtime.ts";

/** One finished match, family neutral: client slots are the source's own and carry no account. */
export interface MatchResult {
  readonly family: "q1" | "q2" | "q3";
  readonly rules: ProviderId;
  readonly match: string;
  readonly map: string;
  /** `identity` is the player's own userinfo identity (a protocol account or social id, else the name); null for bots and unnamed clients. */
  readonly players: readonly { readonly slot: number; readonly score: number; readonly won: boolean; readonly identity: string | null }[];
}

const MAX_SLOTS = 256;

function ended(simulation: SharedSimulation, transition?: NativeQ2MapTransition): boolean {
  if (simulation.options.mode !== "deathmatch") return false;
  const q3 = simulation.q3Source();
  if (q3 !== null) return q3.level.intermissionTime !== 0;
  if (simulation.q2Source() !== null || simulation.q2Native() !== null) return q2MatchCompleted(simulation, transition);
  return simulation.players().some(actor => simulation.movementPlayer(actor)?.intermission === true);
}

const identityKeys = ["social_id", "cl_guid", "name"];
/** Userinfo is `\\key\\value` pairs; protocol-carried ids outrank the display name. */
function userinfoIdentity(userinfo: string | null): string | null {
  if (userinfo === null) return null;
  const parts = userinfo.split("\\"), values = new Map<string, string>();
  for (let index = 1; index + 1 < parts.length; index += 2) values.set(parts[index] ?? "", parts[index + 1] ?? "");
  for (const key of identityKeys) {
    const value = values.get(key)?.trim();
    if (value !== undefined && value !== "") return key === "name" ? value : `${key}:${value}`;
  }
  return null;
}

/** The result of the match a family's own end-of-match state reports (Q1/QW intermission, Q2 layout intermission, Q3 level intermission), or null while it plays. */
export function matchResultOf(simulation: SharedSimulation, match: string, transition?: NativeQ2MapTransition): MatchResult | null {
  if (!ended(simulation, transition)) return null;
  const q2 = simulation.q2Source(), native = simulation.q2Native();
  const scored: { slot: number; score: number; identity: string | null }[] = [];
  for (const actor of simulation.players()) {
    const client = simulation.playerClient(actor);
    // Native Q2 DLLs keep the score in the public STAT_FRAGS/STAT_SPECTATOR player state, which also excludes spectators.
    const score = native === null ? simulation.matchScore(actor) : client === null ? null
      : native.edition === "classic" || transition !== undefined ? classicMatchScore(native.playerState(client.slot + 1)) : rereleaseMatchScore(native.playerState(client.slot + 1));
    if (client === null || score === null || q2?.players.states.get(actor)?.spectator === true) continue;
    scored.push({ slot: client.slot, score, identity: simulation.botServices.isBot(actor) ? null : userinfoIdentity(simulation.sourcePlayerUserinfo(actor)) });
  }
  if (scored.length === 0) return null;
  const best = Math.max(...scored.map(player => player.score));
  const map = simulation.recipe.map.geometry.requestedPath;
  const content = simulation.recipe.map.entities.content, family = content.startsWith("q3") ? "q3" : content.startsWith("q2") ? "q2" : "q1";
  return { family, rules: simulation.recipe.match.provider, match: `${match}:${map}`, map, players: scored.map(player => ({ ...player, won: player.score === best })) };
}

/**
 * Local accounts and standings fed by match-result events. Producers admit each result once into the ring; the ranking
 * service reads it through its own cursor, and slots without a bound account are not ranked. Ranked results persist
 * in the player-progress store, so standings survive restarts and rebuild from it.
 */
export class ApplicationMatchRankings {
  private readonly authorization = new LocalAuthorization();
  private readonly ranking = new LocalRankingService();
  private readonly results = new EventRing<MatchResult>(64);
  private readonly cursor: EventCursor = this.results.openCursor();
  private readonly slots: (AccountId | null)[] = new Array<AccountId | null>(MAX_SLOTS).fill(null);
  private readonly accounts = new Map<string, Account>();
  private readonly names = new Map<AccountId, string>();
  private store: PlayerProgressStore | null = null;
  private published: SharedSimulation | null = null;
  private dropped = 0;

  /** Rebuilds the standings from the store's ranked results and records every later result into it. */
  async attach(store: PlayerProgressStore): Promise<void> {
    if (this.store === store) return;
    this.store = store;
    const matches = new Map<string, { rules: ProviderId; match: string; players: { account: AccountId; score: number; won: boolean; statistics: ReadonlyMap<string, number> }[] }>();
    for (const event of store.all()) {
      if (event.kind !== "ranked-match") continue;
      const account = await this.account(event.participant);
      const key = JSON.stringify([event.rules, event.event]);
      const report = matches.get(key) ?? { rules: event.rules, match: event.event, players: [] };
      report.players.push({ account: account.id, score: event.score, won: event.won, statistics: new Map([["score", event.score]]) });
      matches.set(key, report);
    }
    for (const report of matches.values()) this.ranking.submit(report);
  }
  private async account(name: string): Promise<Account> {
    let account = this.accounts.get(name);
    if (account === undefined) {
      const password = randomBytes(24).toString("hex");
      this.authorization.register(name, password);
      const authorization = await this.authorization.authorize(name, password);
      if (authorization.kind !== "authorized") throw new Error("Local ranking account could not be authorized");
      account = authorization.account; this.accounts.set(name, account); this.names.set(account.id, name);
    }
    return account;
  }
  /** Registers the named local account once and binds the client slot to it after a real authorization. */
  async bind(slot: number, name: string): Promise<Account> {
    if (!Number.isSafeInteger(slot) || slot < 0 || slot >= MAX_SLOTS) throw new RangeError("Ranking slot is out of range");
    const account = await this.account(name);
    this.slots[slot] = account.id;
    return account;
  }
  unbind(slot: number): void { if (Number.isSafeInteger(slot) && slot >= 0 && slot < MAX_SLOTS) this.slots[slot] = null; }
  /** Results the full ring refused; their match is not ranked. */
  get droppedResults(): number { return this.dropped; }

  /** Publishes the simulation's match result once, on the first frame its family reports the match as over. */
  observe(simulation: SharedSimulation, transition?: NativeQ2MapTransition): MatchResult | null {
    if (this.published === simulation) return null;
    const result = matchResultOf(simulation, randomUUID(), transition);
    if (result === null) return null;
    this.published = simulation;
    if (this.results.append(result) === 0) { this.dropped += 1; return null; }
    return result;
  }
  /** Consumes pending results through the cursor; returns the entries of the accounts they ranked. */
  async settle(): Promise<readonly RankingEntry[]> {
    const touched = new Set<AccountId>(), rules = new Set<ProviderId>();
    for (const result of this.results.take(this.cursor)) {
      const merged = new Map<AccountId, { account: AccountId; score: number; won: boolean; statistics: ReadonlyMap<string, number> }>();
      for (const player of result.players) {
        const account = this.slots[player.slot];
        if (account === null || account === undefined) continue;
        const old = merged.get(account);
        merged.set(account, old === undefined ? { account, score: player.score, won: player.won, statistics: new Map([["score", player.score]]) }
          : { ...old, score: Math.max(old.score, player.score), won: old.won || player.won, statistics: new Map([["score", Math.max(old.score, player.score)]]) });
      }
      if (merged.size === 0) continue;
      this.ranking.submit({ match: result.match, rules: result.rules, players: [...merged.values()] });
      rules.add(result.rules);
      for (const player of merged.values()) {
        touched.add(player.account);
        const name = this.names.get(player.account);
        if (this.store !== null && name !== undefined) await this.store.record({ kind: "ranked-match", source: result.family, participant: name, event: result.match,
          map: result.map, score: player.score, won: player.won, rules: result.rules });
      }
    }
    this.results.retire();
    return [...rules].flatMap(id => this.ranking.standings(id)).filter(entry => touched.has(entry.account));
  }
  standings(rules: ProviderId): readonly RankingEntry[] { return this.ranking.standings(rules); }
}
