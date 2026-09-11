// Bun transport adapted from quake-3-ts/src/platform/network.ts. GPL-2.0-or-later.
import type { udp } from "bun";
import { addressHost, ipAddress, portNumber } from "./endpoint.ts";
import type { IpAddress, NetworkAddress } from "./endpoint.ts";
import { readSocksDatagram, socksDatagram, SocksAssociation } from "./socks.ts";
import type { SocksOptions } from "./socks.ts";

export interface DatagramLimits { readonly maxBytes: number; readonly queuePackets: number; }
export const Q3_DATAGRAM_LIMITS: DatagramLimits = { maxBytes: 16383, queuePackets: 256 };
export const Q2_DATAGRAM_LIMITS: DatagramLimits = { maxBytes: 4096, queuePackets: 256 };
export const UNIFIED_DATAGRAM_LIMITS: DatagramLimits = { maxBytes: 65507, queuePackets: 256 };
export type ReceiveEvent<TAddress extends NetworkAddress = NetworkAddress> =
  | { readonly kind: "packet"; readonly from: TAddress; readonly payload: Uint8Array; readonly receivedAt: number }
  | { readonly kind: "error"; readonly error: Error }
  | { readonly kind: "dropped"; readonly reason: "oversize" | "overflow"; readonly from: TAddress };
export interface DatagramTransport<TAddress extends NetworkAddress> {
  readonly address: TAddress;
  readonly closed: boolean;
  send(to: TAddress, payload: Uint8Array): boolean;
  poll(): ReceiveEvent<TAddress> | null;
  subscribeReadable(listener: () => void): () => void;
  close(): void;
}

export class PacketQueue<TAddress extends NetworkAddress> {
  private readonly events: ReceiveEvent<TAddress>[] = [];
  private readonly listeners = new Set<() => void>();
  private ended = false;
  dropped = 0;
  constructor(readonly limits: DatagramLimits, private readonly now: () => number) {
    if (!Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < 1 || !Number.isSafeInteger(limits.queuePackets) || limits.queuePackets < 1) throw new RangeError("Invalid datagram limits");
  }
  accept(from: TAddress, payload: Uint8Array, truncated = false): void {
    if (this.ended) return;
    if (truncated || payload.length > this.limits.maxBytes) { this.dropped++; this.push({ kind: "dropped", reason: "oversize", from }); return; }
    this.push({ kind: "packet", from, payload: payload.slice(), receivedAt: this.now() });
  }
  push(event: ReceiveEvent<TAddress>): void {
    if (this.ended) return;
    if (this.events.length === this.limits.queuePackets) { this.events.shift(); this.dropped++; }
    this.events.push(event);
    for (const listener of [...this.listeners]) if (this.listeners.has(listener)) listener();
  }
  poll(): ReceiveEvent<TAddress> | null { return this.events.shift() ?? null; }
  subscribe(listener: () => void): () => void {
    if (this.ended) throw new Error("Packet queue is closed");
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  close(): void {
    if (this.ended) return;
    this.ended = true; this.events.length = 0;
    const listeners = [...this.listeners]; this.listeners.clear();
    for (const listener of listeners) listener();
  }
}

export interface UdpBindOptions {
  readonly host: string;
  readonly port: number;
  readonly limits?: DatagramLimits;
  readonly now?: () => number;
  readonly broadcast?: boolean;
}

export class UdpTransport implements DatagramTransport<IpAddress> {
  private ended = false;
  private socks: SocksAssociation | null = null;
  private constructor(private readonly socket: udp.Socket<"uint8array">, private readonly queue: PacketQueue<IpAddress>, readonly address: IpAddress) {}
  static async bind(options: UdpBindOptions): Promise<UdpTransport> {
    ipAddress(options.host, options.port, true);
    const queue = new PacketQueue<IpAddress>(options.limits ?? UNIFIED_DATAGRAM_LIMITS, options.now ?? (() => performance.now()));
    const socket = await Bun.udpSocket({ hostname: options.host, port: portNumber(options.port, true), binaryType: "uint8array", socket: {
      data(_socket, payload, port, host, flags) {
        let from: IpAddress;
        try { from = ipAddress(host, port); }
        catch (error) { queue.push({ kind: "error", error: error instanceof Error ? error : new Error(String(error)) }); return; }
        queue.accept(from, payload, flags.truncated);
      },
      // Bun 1.3.14 runtime and declarations disagree on callback argument order.
      error(first: unknown, second: unknown) { queue.push({ kind: "error", error: first instanceof Error ? first : second instanceof Error ? second : new Error("UDP callback supplied no error") }); },
    } });
    try {
      if (options.broadcast === true && !socket.setBroadcast(true)) throw new Error("Could not enable UDP broadcast");
      return new UdpTransport(socket, queue, ipAddress(socket.hostname, socket.port));
    } catch (error) { socket.close(); queue.close(); throw error; }
  }
  get closed(): boolean { return this.ended; }
  get droppedPackets(): number { return this.queue.dropped; }
  private opened(): void { if (this.ended) throw new Error("UDP transport is closed"); }
  async connectSocks(options: SocksOptions): Promise<void> {
    this.opened(); this.socks?.close();
    const association = new SocksAssociation(); this.socks = association;
    try { await association.open(options, this.address.port); this.opened(); }
    catch (error) { association.close(); if (this.socks === association) this.socks = null; throw error; }
  }
  send(to: IpAddress, payload: Uint8Array): boolean {
    this.opened(); portNumber(to.port);
    if (payload.byteLength > this.queue.limits.maxBytes) throw new RangeError("Datagram exceeds selected transport limit");
    const relay = this.socks?.relay;
    const proxied = to.kind === "ipv4" && relay !== undefined && relay !== null && !to.host.every(value => value === 255);
    const destination = proxied ? relay : to;
    const bytes = proxied ? socksDatagram(to, payload) : payload.slice();
    try { return this.socket.send(bytes, destination.port, addressHost(destination)); }
    catch (error) {
      if (!(error instanceof Error) || !("syscall" in error) || error.syscall !== "send") throw error;
      this.queue.push({ kind: "error", error }); return false;
    }
  }
  poll(): ReceiveEvent<IpAddress> | null {
    this.opened();
    const event = this.queue.poll(), relay = this.socks?.relay;
    if (event?.kind === "packet" && relay !== undefined && relay !== null && event.from.kind === "ipv4"
      && event.from.port === relay.port && event.from.host.every((value, index) => value === relay.host[index])) {
      const decoded = readSocksDatagram(event.payload);
      return decoded === null ? null : { kind: "packet", ...decoded, receivedAt: event.receivedAt };
    }
    return event;
  }
  subscribeReadable(listener: () => void): () => void { this.opened(); return this.queue.subscribe(listener); }
  close(): void {
    if (this.ended) return;
    this.ended = true; this.socks?.close(); this.socks = null;
    try { this.queue.close(); } finally { this.socket.close(); }
  }
}

/** An IPX address is retained for a future native/guest driver, never sent as UDP by accident. */
export class UnsupportedTransportError extends Error {
  constructor(readonly transport: "ipx-native" | "serial", detail: string) { super(`${transport}: ${detail}`); this.name = "UnsupportedTransportError"; }
}
