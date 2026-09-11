import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { ContentId } from "../../contracts/content.ts";
import type { ProviderId } from "../../contracts/identity.ts";
import type { NetworkAddress } from "../common/endpoint.ts";
import type { CompositionIdentity } from "../common/session.ts";
import { isRecord as record, isUnknownArray } from "../common/value.ts";

export type AccountId = `account:${string}`;
export type LobbyId = `lobby:${string}`;
export type AccessToken = `access:${string}`;
export interface Account { readonly id: AccountId; readonly name: string; }
export type Authorization =
  | { readonly kind: "authorized"; readonly account: Account; readonly token: AccessToken }
  | { readonly kind: "denied"; readonly reason: string }
  | { readonly kind: "unavailable"; readonly provider: string; readonly reason: string };
export interface AuthorizationProvider { authorize(name: string, credential: string): Promise<Authorization>; }
interface AccountRecord { readonly account: Account; readonly salt: string; readonly passwordHash: string; }

/** Usable server-owned accounts. Retail authorization is a separate selected provider. */
export class LocalAuthorization implements AuthorizationProvider {
  private readonly accounts = new Map<string, AccountRecord>();
  private readonly tokens = new Map<AccessToken, Account>();
  register(name: string, password: string): Account {
    if (name.trim().length === 0 || password.length === 0 || this.accounts.has(name)) throw new Error("Account requires an unused name and a password");
    const account: Account = Object.freeze({ id: `account:${randomBytes(16).toString("hex")}`, name });
    const salt = randomBytes(16).toString("hex"), passwordHash = scryptSync(password, salt, 32).toString("hex");
    this.accounts.set(name, { account, salt, passwordHash }); return account;
  }
  async authorize(name: string, credential: string): Promise<Authorization> {
    const record = this.accounts.get(name);
    if (record === undefined) return { kind: "denied", reason: "Invalid account credentials" };
    const supplied = scryptSync(credential, record.salt, 32);
    if (!timingSafeEqual(supplied, Buffer.from(record.passwordHash, "hex"))) return { kind: "denied", reason: "Invalid account credentials" };
    const token: AccessToken = `access:${randomBytes(32).toString("hex")}`;
    this.tokens.set(token, record.account); return { kind: "authorized", account: record.account, token };
  }
  account(token: AccessToken): Account | null { return this.tokens.get(token) ?? null; }
  revoke(token: AccessToken): void { this.tokens.delete(token); }
  save(): string { return JSON.stringify({ version: 1, accounts: [...this.accounts.values()] }); }
  restore(text: string): void {
    const value: unknown = JSON.parse(text);
    if (!record(value) || value["version"] !== 1 || !isUnknownArray(value["accounts"])) throw new Error("Invalid local account save");
    const rows: readonly unknown[] = value["accounts"];
    const restored = new Map<string, AccountRecord>();
    const ids = new Set<string>();
    for (const row of rows) {
      if (!record(row) || !record(row["account"])) throw new Error("Invalid account record");
      const id = row["account"]["id"], name = row["account"]["name"], salt = row["salt"], passwordHash = row["passwordHash"];
      if (!isAccountId(id) || typeof name !== "string" || name.length === 0 || typeof salt !== "string" || !/^[a-f0-9]{32}$/.test(salt)
        || typeof passwordHash !== "string" || !/^[a-f0-9]{64}$/.test(passwordHash) || restored.has(name) || ids.has(id)) throw new Error("Invalid account fields");
      restored.set(name, { account: Object.freeze({ id, name }), salt, passwordHash }); ids.add(id);
    }
    this.accounts.clear(); this.tokens.clear(); for (const [name, account] of restored) this.accounts.set(name, account);
  }
}
function isAccountId(value: unknown): value is AccountId { return typeof value === "string" && /^account:[a-f0-9]{32}$/.test(value); }

export interface LobbyMember { readonly account: Account; readonly seats: number; readonly ready: boolean; }
export interface Lobby {
  readonly id: LobbyId;
  readonly owner: AccountId;
  readonly name: string;
  readonly capacity: number;
  readonly composition: CompositionIdentity;
  readonly endpoint: NetworkAddress;
  readonly members: readonly LobbyMember[];
  readonly phase: "open" | "playing";
}

export class LocalLobbyService {
  private readonly lobbies = new Map<LobbyId, Lobby>();
  create(owner: Account, name: string, capacity: number, composition: CompositionIdentity, endpoint: NetworkAddress): Lobby {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || name.length === 0) throw new RangeError("Invalid lobby settings");
    const lobby: Lobby = { id: `lobby:${randomBytes(16).toString("hex")}`, owner: owner.id, name, capacity, composition, endpoint,
      members: [{ account: owner, seats: 1, ready: false }], phase: "open" };
    this.lobbies.set(lobby.id, lobby); return lobby;
  }
  private require(id: LobbyId): Lobby { const lobby = this.lobbies.get(id); if (lobby === undefined) throw new Error("Lobby no longer exists"); return lobby; }
  list(): readonly Lobby[] { return [...this.lobbies.values()]; }
  join(id: LobbyId, account: Account, seats = 1): Lobby {
    const lobby = this.require(id);
    if (lobby.phase !== "open" || lobby.members.some(member => member.account.id === account.id)) throw new Error("Cannot join this lobby");
    if (!Number.isSafeInteger(seats) || seats < 1 || lobby.members.reduce((sum, member) => sum + member.seats, seats) > lobby.capacity) throw new Error("Lobby has insufficient seat capacity");
    const updated: Lobby = { ...lobby, members: [...lobby.members, { account, seats, ready: false }] };
    this.lobbies.set(id, updated); return updated;
  }
  ready(id: LobbyId, account: AccountId, ready: boolean): Lobby {
    const lobby = this.require(id);
    if (lobby.phase !== "open" || !lobby.members.some(member => member.account.id === account)) throw new Error("Account cannot change readiness");
    const updated = { ...lobby, members: lobby.members.map(member => member.account.id === account ? { ...member, ready } : member) };
    this.lobbies.set(id, updated); return updated;
  }
  start(id: LobbyId, owner: AccountId): Lobby {
    const lobby = this.require(id);
    if (lobby.owner !== owner || lobby.phase !== "open" || lobby.members.some(member => !member.ready)) throw new Error("Lobby is not ready to start");
    const updated: Lobby = { ...lobby, phase: "playing" }; this.lobbies.set(id, updated); return updated;
  }
  leave(id: LobbyId, account: AccountId): void {
    const lobby = this.require(id);
    if (lobby.owner === account) { this.lobbies.delete(id); return; }
    this.lobbies.set(id, { ...lobby, members: lobby.members.filter(member => member.account.id !== account) });
  }
}

export interface RankingReport {
  readonly match: string;
  readonly rules: ProviderId;
  readonly players: readonly { readonly account: AccountId; readonly score: number; readonly won: boolean; readonly statistics: ReadonlyMap<string, number> }[];
}
export interface RankingEntry { readonly account: AccountId; readonly matches: number; readonly wins: number; readonly score: number; readonly statistics: ReadonlyMap<string, number>; }
export class LocalRankingService {
  private readonly reports = new Map<string, RankingReport>();
  submit(report: RankingReport): boolean {
    const key = JSON.stringify([report.rules, report.match]);
    if (this.reports.has(key)) return false;
    if (report.match.length === 0 || new Set(report.players.map(player => player.account)).size !== report.players.length
      || report.players.some(player => !Number.isFinite(player.score) || [...player.statistics.values()].some(value => !Number.isFinite(value)))) throw new Error("Invalid ranking report");
    this.reports.set(key, { ...report, players: report.players.map(player => ({ ...player, statistics: new Map(player.statistics) })) }); return true;
  }
  standings(rules: ProviderId): readonly RankingEntry[] {
    const entries = new Map<AccountId, RankingEntry>();
    for (const report of this.reports.values()) {
      if (report.rules !== rules) continue;
      for (const player of report.players) {
        const old = entries.get(player.account), statistics = new Map(old?.statistics);
        for (const [key, value] of player.statistics) statistics.set(key, (statistics.get(key) ?? 0) + value);
        entries.set(player.account, { account: player.account, matches: (old?.matches ?? 0) + 1, wins: (old?.wins ?? 0) + (player.won ? 1 : 0), score: (old?.score ?? 0) + player.score, statistics });
      }
    }
    return [...entries.values()].sort((left, right) => right.score - left.score || right.wins - left.wins || (left.account < right.account ? -1 : left.account > right.account ? 1 : 0));
  }
  save(): string { return JSON.stringify([...this.reports.values()].map(report => ({ ...report, players: report.players.map(player => ({ ...player, statistics: [...player.statistics] })) }))); }
  restore(text: string): void {
    const value: unknown = JSON.parse(text);
    if (!isUnknownArray(value)) throw new Error("Invalid ranking save");
    const rows: readonly unknown[] = value, restored = new LocalRankingService();
    for (const row of rows) {
      if (!record(row) || typeof row["match"] !== "string" || !isProviderId(row["rules"]) || !isUnknownArray(row["players"])) throw new Error("Invalid ranking report");
      const sourcePlayers: readonly unknown[] = row["players"], players: RankingReport["players"][number][] = [];
      for (const player of sourcePlayers) {
        if (!record(player) || !isAccountId(player["account"]) || typeof player["score"] !== "number" || typeof player["won"] !== "boolean" || !isUnknownArray(player["statistics"])) throw new Error("Invalid ranked player");
        const pairs: readonly unknown[] = player["statistics"], statistics = new Map<string, number>();
        for (const pair of pairs) {
          if (!isUnknownArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || typeof pair[1] !== "number") throw new Error("Invalid rank statistic");
          statistics.set(pair[0], pair[1]);
        }
        players.push({ account: player["account"], score: player["score"], won: player["won"], statistics });
      }
      if (!restored.submit({ match: row["match"], rules: row["rules"], players })) throw new Error("Duplicate saved match");
    }
    this.reports.clear(); for (const [key, report] of restored.reports) this.reports.set(key, report);
  }
}
function isProviderId(value: unknown): value is ProviderId { return typeof value === "string" && value.includes(":"); }

export interface AddonCatalogEntry { readonly content: ContentId; readonly title: string; readonly installed: boolean; readonly download: URL | null; }
export interface AddonCatalogProvider { list(): Promise<readonly AddonCatalogEntry[]>; }
export type ExternalServiceState =
  | { readonly kind: "available"; readonly provider: string }
  | { readonly kind: "unavailable"; readonly provider: string; readonly reason: string };
