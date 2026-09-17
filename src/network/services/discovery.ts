// Shared browser operations derived from Quake/Q2 server lists and Q3 cl_main.c.
import { addressKey, parseNetworkAddress } from "../common/endpoint.ts";
import type { NetworkAddress } from "../common/endpoint.ts";
import type { WireSelection } from "../common/session.ts";
import { isUnknownArray } from "../common/value.ts";

export interface ServerStatus {
  readonly name: string;
  readonly map: string;
  readonly players: number;
  readonly maxPlayers: number;
  readonly rules: ReadonlyMap<string, string>;
  readonly playerDetails: readonly { readonly name: string; readonly score: number; readonly ping: number }[];
  readonly wire: WireSelection;
}
export type DiscoverySource = "lan" | "master" | "secondary-master" | "favorite" | "direct";
export interface BrowserEntry {
  readonly address: NetworkAddress;
  readonly sources: readonly DiscoverySource[];
  readonly status: ServerStatus | null;
  readonly pingMilliseconds: number | null;
  readonly updatedAt: number;
}
export type DiscoveryRequestKind = "info" | "status";
export type DiscoveryRequestHandle = symbol;
interface DiscoveryRequestDetails {
  readonly address: NetworkAddress;
  readonly requestKind: DiscoveryRequestKind;
  readonly sentAt: number;
}
export type DiscoveryRequestResult = DiscoveryRequestDetails & (
  | { readonly kind: "pending" }
  | { readonly kind: "completed"; readonly status: ServerStatus; readonly pingMilliseconds: number; readonly completedAt: number }
  | { readonly kind: "expired" }
  | { readonly kind: "cancelled" }
);
export interface DiscoveryWire {
  query(kind: DiscoveryRequestKind, challenge: string): Uint8Array;
  masterQuery(): Uint8Array;
  heartbeat(active: boolean): Uint8Array;
}
export interface PacketSender { send(to: NetworkAddress, bytes: Uint8Array): boolean; }
interface PendingBroadcast { readonly challenge: string; readonly sentAt: number; }
interface PendingQuery extends DiscoveryRequestDetails, PendingBroadcast {
  readonly handle: DiscoveryRequestHandle;
  readonly retainResult: boolean;
  readonly timeoutMilliseconds: number | null | undefined;
}

/** Codecs retain source text/opcodes. This table never guesses a game's protocol. */
export class ServerBrowser {
  private readonly entries = new Map<string, BrowserEntry>();
  private readonly queries = new Map<DiscoveryRequestHandle, PendingQuery>();
  private readonly results = new Map<DiscoveryRequestHandle, DiscoveryRequestResult>();
  private readonly broadcasts = new Map<string, PendingBroadcast>();
  private querySequence = 0;
  constructor(readonly wire: DiscoveryWire, readonly transport: PacketSender) {}
  add(address: NetworkAddress, source: DiscoverySource, now = 0): BrowserEntry {
    const key = addressKey(address), previous = this.entries.get(key);
    const entry: BrowserEntry = previous === undefined
      ? { address, sources: [source], status: null, pingMilliseconds: null, updatedAt: now }
      : { ...previous, sources: previous.sources.includes(source) ? previous.sources : [...previous.sources, source] };
    this.entries.set(key, entry); return entry;
  }
  removeFavorite(address: NetworkAddress): void {
    this.removeSource(address, "favorite");
  }
  removeSource(address: NetworkAddress, source: DiscoverySource): void {
    const key = addressKey(address), entry = this.entries.get(key);
    if (entry === undefined) return;
    const sources = entry.sources.filter(value => value !== source);
    if (sources.length === 0) this.entries.delete(key); else this.entries.set(key, { ...entry, sources });
  }
  restoreEntry(entry: BrowserEntry): void {
    const key = addressKey(entry.address), existing = this.entries.get(key);
    this.entries.set(key, existing === undefined ? entry : { ...(existing.status === null ? entry : existing),
      sources: [...new Set([...existing.sources, ...entry.sources])] });
  }
  entry(address: NetworkAddress): BrowserEntry | null { return this.entries.get(addressKey(address)) ?? null; }
  list(): readonly BrowserEntry[] { return [...this.entries.values()]; }
  get size(): number { return this.entries.size; }
  get pendingRequests(): number { return this.queries.size; }
  query(address: NetworkAddress, now: number, kind: DiscoveryRequestKind = "info"): boolean {
    for (const pending of this.queries.values()) {
      if (!pending.retainResult && pending.requestKind === kind && addressKey(pending.address) === addressKey(address)) {
        this.releaseRequest(pending.handle);
      }
    }
    return this.startRequest(address, now, kind, false) !== null;
  }
  request(address: NetworkAddress, now: number, kind: DiscoveryRequestKind = "info", timeoutMilliseconds?: number | null): DiscoveryRequestHandle | null {
    if (timeoutMilliseconds !== undefined && timeoutMilliseconds !== null && (!Number.isFinite(timeoutMilliseconds) || timeoutMilliseconds < 0)) throw new RangeError("Invalid discovery request timeout");
    return this.startRequest(address, now, kind, true, timeoutMilliseconds);
  }
  requestResult(handle: DiscoveryRequestHandle): DiscoveryRequestResult | null { return this.results.get(handle) ?? null; }
  cancelRequest(handle: DiscoveryRequestHandle): boolean {
    const pending = this.queries.get(handle);
    if (pending === undefined) return false;
    this.finishRequest(pending, { kind: "cancelled", address: pending.address, requestKind: pending.requestKind, sentAt: pending.sentAt });
    return true;
  }
  releaseRequest(handle: DiscoveryRequestHandle): void {
    this.queries.delete(handle);
    this.results.delete(handle);
  }
  private startRequest(address: NetworkAddress, now: number, kind: DiscoveryRequestKind, retainResult: boolean, timeoutMilliseconds?: number | null): DiscoveryRequestHandle | null {
    const handle = Symbol("discovery request"), challenge = String(++this.querySequence);
    const pending: PendingQuery = { handle, challenge, address, requestKind: kind, sentAt: now, retainResult, timeoutMilliseconds };
    this.queries.set(handle, pending);
    if (retainResult) this.results.set(handle, Object.freeze({ kind: "pending", address, requestKind: kind, sentAt: now }));
    try {
      if (this.transport.send(address, this.wire.query(kind, challenge))) return handle;
    } catch (error) { this.releaseRequest(handle); throw error; }
    this.releaseRequest(handle);
    return null;
  }
  private finishRequest(pending: PendingQuery, result: DiscoveryRequestResult): void {
    this.queries.delete(pending.handle);
    if (pending.retainResult) this.results.set(pending.handle, Object.freeze(result));
  }
  receive(address: NetworkAddress, status: ServerStatus, challenge: string | null, now: number, kind?: DiscoveryRequestKind): boolean {
    const key = addressKey(address);
    const matches = [...this.queries.values()].filter(query => addressKey(query.address) === key
      && (kind === undefined || query.requestKind === kind) && (challenge === null || query.challenge === challenge));
    // A challenge-less protocol cannot distinguish two requests to the same endpoint.
    if (matches.length > 1) return false;
    const direct = matches[0];
    const broadcast = kind === "status" ? undefined
      : challenge === null ? [...this.broadcasts.values()].at(-1) : this.broadcasts.get(challenge);
    const pending = direct ?? broadcast;
    if (pending === undefined) return false;
    const pingMilliseconds = Math.max(0, now - pending.sentAt);
    const old = direct === undefined ? this.add(address, "lan", now) : this.entries.get(key) ?? this.add(address, "direct", now);
    this.entries.set(key, { ...old, status, pingMilliseconds, updatedAt: now });
    if (direct !== undefined) this.finishRequest(direct, { kind: "completed", address: direct.address,
      requestKind: direct.requestKind, sentAt: direct.sentAt, status, pingMilliseconds, completedAt: now });
    return true;
  }
  queryMaster(address: NetworkAddress): boolean { return this.transport.send(address, this.wire.masterQuery()); }
  receiveMaster(addresses: readonly NetworkAddress[], now: number): void { for (const address of addresses) this.add(address, "master", now); }
  broadcast(addresses: readonly NetworkAddress[], now: number): number {
    let sent = 0;
    const challenge = String(++this.querySequence);
    this.broadcasts.set(challenge, { challenge, sentAt: now });
    for (const address of addresses) if (this.transport.send(address, this.wire.query("info", challenge))) sent++;
    if (sent === 0) this.broadcasts.delete(challenge);
    return sent;
  }
  expireQueries(now: number, timeoutMilliseconds: number): readonly NetworkAddress[] {
    const expired: NetworkAddress[] = [];
    for (const [key, query] of this.broadcasts) if (now - query.sentAt >= timeoutMilliseconds) this.broadcasts.delete(key);
    for (const query of this.queries.values()) {
      if (query.timeoutMilliseconds === null || now - query.sentAt < (query.timeoutMilliseconds ?? timeoutMilliseconds)) continue;
      const entry = this.entries.get(addressKey(query.address));
      if (entry !== undefined && !expired.some(address => addressKey(address) === addressKey(entry.address))) expired.push(entry.address);
      this.finishRequest(query, { kind: "expired", address: query.address, requestKind: query.requestKind, sentAt: query.sentAt });
    }
    return expired;
  }
  favoriteAddresses(): readonly NetworkAddress[] { return this.list().filter(entry => entry.sources.includes("favorite")).map(entry => entry.address); }
  saveFavorites(): string { return JSON.stringify(this.favoriteAddresses()); }
  restoreFavorites(text: string): void {
    const value: unknown = JSON.parse(text);
    if (!isUnknownArray(value)) throw new Error("Invalid favorites save");
    const entries: readonly unknown[] = value, addresses = entries.map(parseNetworkAddress);
    for (const address of this.favoriteAddresses()) this.removeFavorite(address);
    for (const address of addresses) this.add(address, "favorite");
  }
}

export class MasterHeartbeat {
  private nextTime = -Infinity;
  constructor(readonly wire: DiscoveryWire, readonly transport: PacketSender, readonly intervalMilliseconds = 300000) {}
  send(masters: readonly NetworkAddress[], now: number, active: boolean, force = false): number {
    if (!force && now < this.nextTime) return 0;
    this.nextTime = now + this.intervalMilliseconds;
    let sent = 0;
    for (const address of masters) if (this.transport.send(address, this.wire.heartbeat(active))) sent++;
    return sent;
  }
}
