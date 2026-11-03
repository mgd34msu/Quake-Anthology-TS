// Quake II g_svcmds.c address masks and Quake III sv_main.c rcon. GPL-2.0-or-later.
import { PeerTable } from "../common/peer-table.ts";
import { RconGuard, passwordMatches } from "../common/rcon-guard.ts";
import type { Ipv4Address, NetworkAddress } from "../common/endpoint.ts";

export interface Ipv4Filter { readonly mask: number; readonly compare: number; }
/** Source addip uses omitted/zero octets as wildcards and truncates supplied octets to bytes. */
export function sourceIpv4Filter(text: string): Ipv4Filter | null {
  const bytes = new Uint8Array(4), mask = new Uint8Array(4);
  let cursor = 0;
  for (let index = 0; index < 4; index++) {
    const start = cursor;
    while (cursor < text.length && /[0-9]/.test(text.charAt(cursor))) cursor++;
    if (start === cursor) return null;
    const value = Number.parseInt(text.slice(start, cursor), 10) & 255;
    bytes[index] = value; if (value !== 0) mask[index] = 255;
    if (cursor >= text.length) break;
    cursor++;
  }
  return { mask: new DataView(mask.buffer).getUint32(0, true), compare: new DataView(bytes.buffer).getUint32(0, true) };
}
export function cidrIpv4Filter(address: Ipv4Address, prefixBits: number): Ipv4Filter {
  if (!Number.isInteger(prefixBits) || prefixBits < 0 || prefixBits > 32) throw new RangeError("Invalid IPv4 prefix");
  const maskBytes = new Uint8Array(4);
  for (let index = 0; index < 4; index++) maskBytes[index] = prefixBits >= index * 8 + 8 ? 255 : prefixBits <= index * 8 ? 0 : (255 << (8 - (prefixBits - index * 8))) & 255;
  const mask = new DataView(maskBytes.buffer).getUint32(0, true), bytes = Uint8Array.from(address.host);
  return { mask, compare: (new DataView(bytes.buffer).getUint32(0, true) & mask) >>> 0 };
}
export class IpFilterList {
  private readonly entries: Ipv4Filter[] = [];
  constructor(public mode: "deny-matches" | "allow-matches" = "deny-matches") {}
  add(filter: Ipv4Filter): void { this.entries.push(filter); }
  remove(filter: Ipv4Filter): boolean {
    const index = this.entries.findIndex(value => value.mask === filter.mask && value.compare === filter.compare);
    if (index < 0) return false;
    this.entries.splice(index, 1); return true;
  }
  rejects(address: NetworkAddress): boolean {
    if (address.kind !== "ipv4") return false;
    const value = new DataView(Uint8Array.from(address.host).buffer).getUint32(0, true);
    const matches = this.entries.some(filter => ((value & filter.mask) >>> 0) === filter.compare);
    return this.mode === "deny-matches" ? matches : !matches;
  }
  snapshot(): readonly Ipv4Filter[] { return this.entries.map(entry => ({ ...entry })); }
}

export class FloodLimiter {
  private readonly peers: PeerTable;
  private readonly tokens: Float64Array;
  private readonly times: Float64Array;
  constructor(readonly burst: number, readonly intervalMilliseconds: number, readonly maxEntries = 8192) {
    if (burst <= 0 || intervalMilliseconds <= 0 || maxEntries < 1) throw new RangeError("Invalid flood limit");
    this.peers = new PeerTable(maxEntries);
    this.tokens = new Float64Array(maxEntries);
    this.times = new Float64Array(maxEntries);
  }
  allow(address: NetworkAddress, now: number): boolean {
    let slot = this.peers.find(address);
    if (slot < 0) {
      if (this.peers.count >= this.maxEntries) this.expire(now);
      slot = this.peers.claim(address);
      if (slot < 0) return false;
      this.tokens[slot] = this.burst;
      this.times[slot] = now;
    }
    const tokens = Math.min(this.burst, (this.tokens[slot] ?? 0) + Math.max(0, now - (this.times[slot] ?? 0)) / this.intervalMilliseconds);
    this.tokens[slot] = tokens >= 1 ? tokens - 1 : tokens;
    this.times[slot] = now;
    return tokens >= 1;
  }
  expire(now: number): void { this.peers.retain(slot => now - (this.times[slot] ?? 0) <= this.burst * this.intervalMilliseconds); }
}

/** Per-source and global budgets for unauthenticated replies, in the manner of ioquake3 SVC_RateLimit. */
export class ConnectionlessGate {
  private readonly perSource = new FloodLimiter(10, 200);
  private readonly global = new FloodLimiter(400, 5, 1);
  private static readonly everyone: NetworkAddress = { kind: "ipv4", host: [0, 0, 0, 0], port: 0 };
  allow(address: NetworkAddress, now: number): boolean {
    if (address.kind === "loopback") return true;
    return this.perSource.allow(address, now) && this.global.allow(ConnectionlessGate.everyone, now);
  }
}

/** Per-client source chat history; QW sv_user.c uses a ten-entry ring and realtime seconds. */
export class SourceChatFlood {
  private readonly times = new Float64Array(10);
  private head = 0;
  private lockedUntil = 0;
  constructor(readonly messages: number, readonly seconds: number, readonly lockSeconds: number) {
    if (!Number.isInteger(messages) || messages < 0 || messages > 10 || seconds < 0 || lockSeconds < 0) throw new RangeError("Invalid source chat flood policy");
  }
  check(now: number, paused = false): { readonly kind: "allowed" } | { readonly kind: "locked" | "flood"; readonly seconds: number } {
    if (this.messages === 0) return { kind: "allowed" };
    if (!paused && now < this.lockedUntil) return { kind: "locked", seconds: Math.trunc(this.lockedUntil - now) };
    const previous = this.times[(this.head - this.messages + 11) % 10] ?? 0;
    if (!paused && previous !== 0 && now - previous < this.seconds) {
      this.lockedUntil = now + this.lockSeconds;
      return { kind: "flood", seconds: Math.trunc(this.lockSeconds) };
    }
    this.head = (this.head + 1) % 10; this.times[this.head] = now;
    return { kind: "allowed" };
  }
}

export interface RconHost {
  password(): string;
  execute(command: string, output: (text: string) => void): Promise<void>;
  reply(to: NetworkAddress, text: string): void;
}
export interface ServerAdministration {
  rconPassword(): string;
  execute(command: string, output: (text: string) => void): Promise<void>;
  rejects(address: NetworkAddress): boolean;
  masters(): readonly NetworkAddress[];
  record(event: { readonly address: NetworkAddress; readonly operation: "rcon"; readonly result: RconResult }): void;
}

/** Q3 SVC_RemoteCommand advances past the password without retokenizing command quotes. */
export function q3RconCommand(line: string): string {
  let cursor = 4;
  while (line[cursor] === " ") cursor++;
  while (cursor < line.length && line[cursor] !== " ") cursor++;
  while (line[cursor] === " ") cursor++;
  return line.slice(cursor, cursor + 1023);
}
export type RconResult = "throttled" | "disabled" | "denied" | "executed";
export class RconService {
  private readonly sources = new PeerTable(1024);
  private readonly lastTimes = new Float64Array(1024);
  private readonly guard = new RconGuard();
  private tail: Promise<void> = Promise.resolve();
  constructor(readonly host: RconHost, readonly profile: "q3" | "unified" = "q3", readonly outputBytes = 1008) {
    if (!Number.isSafeInteger(outputBytes) || outputBytes < 5) throw new RangeError("Rcon output buffer must hold a complete character and terminator");
  }
  handle(from: NetworkAddress, suppliedPassword: string, command: string, milliseconds: number): Promise<RconResult> {
    const operation = this.tail.then(() => this.run(from, suppliedPassword, command, milliseconds));
    this.tail = operation.then(() => undefined, () => undefined); return operation;
  }
  private async run(from: NetworkAddress, suppliedPassword: string, command: string, milliseconds: number): Promise<RconResult> {
    const time = this.profile === "q3" ? milliseconds >>> 0 : milliseconds, known = this.sources.find(from), last = known < 0 ? 0 : this.lastTimes[known] ?? 0;
    const next = this.profile === "q3" ? (last + 500) >>> 0 : last + 500;
    // The 500 ms slot is per source so that spoofed packets from other addresses cannot lock the administrator out.
    if (known >= 0 && time < next || !this.guard.permitted(from, milliseconds)) return "throttled";
    if (known < 0 && this.sources.count >= this.sources.capacity) this.sources.clear();
    this.lastTimes[known >= 0 ? known : this.sources.claim(from)] = time;
    const password = this.host.password();
    if (password.length === 0) { this.host.reply(from, "No rconpassword set on the server.\n"); return "disabled"; }
    if (!passwordMatches(password, suppliedPassword)) { this.guard.failed(from, milliseconds); this.host.reply(from, "Bad rconpassword.\n"); return "denied"; }
    this.guard.succeeded(from);
    let buffered = "";
    const flush = (): void => { if (buffered.length > 0) { this.host.reply(from, buffered); buffered = ""; } };
    const output = (text: string): void => {
      for (const character of text) {
        if (this.profile === "q3" && character.charCodeAt(0) > 255) throw new RangeError("Source rcon output requires byte characters");
        const candidate = buffered + character;
        const size = this.profile === "q3" ? candidate.length : new TextEncoder().encode(candidate).length;
        if (size > this.outputBytes - 1) flush();
        buffered += character;
      }
    };
    try { if (command.length > 0) await this.host.execute(this.profile === "q3" ? command.slice(0, 1023) : command, output); }
    finally { flush(); }
    return "executed";
  }
}
