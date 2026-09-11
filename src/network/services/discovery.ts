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
export type DiscoverySource = "lan" | "master" | "favorite" | "direct";
export interface BrowserEntry {
  readonly address: NetworkAddress;
  readonly sources: readonly DiscoverySource[];
  readonly status: ServerStatus | null;
  readonly pingMilliseconds: number | null;
  readonly updatedAt: number;
}
export interface DiscoveryWire {
  query(kind: "info" | "status", challenge: string): Uint8Array;
  masterQuery(): Uint8Array;
  heartbeat(active: boolean): Uint8Array;
}
export interface PacketSender { send(to: NetworkAddress, bytes: Uint8Array): boolean; }
interface PendingQuery { readonly challenge: string; readonly sentAt: number; }

/** Codecs retain source text/opcodes. This table never guesses a game's protocol. */
export class ServerBrowser {
  private readonly entries = new Map<string, BrowserEntry>();
  private readonly queries = new Map<string, PendingQuery>();
  private readonly broadcasts = new Map<string, PendingQuery>();
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
    const key = addressKey(address), entry = this.entries.get(key);
    if (entry === undefined) return;
    const sources = entry.sources.filter(source => source !== "favorite");
    if (sources.length === 0) this.entries.delete(key); else this.entries.set(key, { ...entry, sources });
  }
  list(): readonly BrowserEntry[] { return [...this.entries.values()]; }
  query(address: NetworkAddress, now: number, kind: "info" | "status" = "info"): boolean {
    const challenge = String(++this.querySequence), key = addressKey(address);
    this.queries.set(key, { challenge, sentAt: now });
    if (!this.transport.send(address, this.wire.query(kind, challenge))) { this.queries.delete(key); return false; }
    return true;
  }
  receive(address: NetworkAddress, status: ServerStatus, challenge: string | null, now: number): boolean {
    const key = addressKey(address), direct = this.queries.get(key);
    const broadcast = challenge === null ? [...this.broadcasts.values()].at(-1) : this.broadcasts.get(challenge);
    const pending = direct ?? broadcast;
    if (pending === undefined || (challenge !== null && pending.challenge !== challenge)) return false;
    const old = this.entries.get(key) ?? this.add(address, broadcast === undefined ? "direct" : "lan", now);
    this.entries.set(key, { ...old, status, pingMilliseconds: Math.max(0, now - pending.sentAt), updatedAt: now });
    this.queries.delete(key); return true;
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
    for (const [key, query] of this.queries) {
      if (now - query.sentAt < timeoutMilliseconds) continue;
      const entry = this.entries.get(key);
      if (entry !== undefined) expired.push(entry.address);
      this.queries.delete(key);
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
