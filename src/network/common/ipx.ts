// IPX header and Quake sequencing from WinQuake/net_ipx.c and net_wipx.c.
// Copyright (C) 1996-1997 Id Software, Inc. GPL-2.0-or-later.
import { addressKey, ipxAddress, sameAddress } from "./endpoint.ts";
import type { IpAddress, IpxAddress } from "./endpoint.ts";
import { PacketQueue, UNIFIED_DATAGRAM_LIMITS } from "./transport.ts";
import type { DatagramTransport, ReceiveEvent, UdpTransport } from "./transport.ts";

export interface IpxPacket { readonly from: IpxAddress; readonly to: IpxAddress; readonly packetType: number; readonly hops: number; readonly payload: Uint8Array; }
function writeAddress(view: DataView, offset: number, address: IpxAddress): void {
  view.setUint32(offset, address.network, false);
  address.node.forEach((byte, index) => view.setUint8(offset + 4 + index, byte));
  view.setUint16(offset + 10, address.port, false);
}
function readAddress(view: DataView, offset: number): IpxAddress {
  return ipxAddress(view.getUint32(offset, false), [view.getUint8(offset + 4), view.getUint8(offset + 5), view.getUint8(offset + 6), view.getUint8(offset + 7), view.getUint8(offset + 8), view.getUint8(offset + 9)], view.getUint16(offset + 10, false));
}
export function encodeIpxPacket(packet: IpxPacket): Uint8Array {
  if (packet.payload.length > 65505 || !Number.isInteger(packet.packetType) || packet.packetType < 0 || packet.packetType > 255 || !Number.isInteger(packet.hops) || packet.hops < 0 || packet.hops > 255) throw new RangeError("Invalid IPX packet");
  const bytes = new Uint8Array(packet.payload.length + 30), view = new DataView(bytes.buffer);
  view.setUint16(0, 65535, false); view.setUint16(2, bytes.length, false);
  view.setUint8(4, packet.hops); view.setUint8(5, packet.packetType);
  writeAddress(view, 6, packet.to); writeAddress(view, 18, packet.from); bytes.set(packet.payload, 30); return bytes;
}
export function decodeIpxPacket(bytes: Uint8Array): IpxPacket | null {
  if (bytes.length < 30) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // This transport emits Novell's checksum-disabled form, as used by Quake's IPX driver.
  if (view.getUint16(0, false) !== 65535 || view.getUint16(2, false) !== bytes.length || view.getUint16(16, false) === 0 || view.getUint16(28, false) === 0) return null;
  return { from: readAddress(view, 18), to: readAddress(view, 6), packetType: view.getUint8(5), hops: view.getUint8(4), payload: bytes.slice(30) };
}

export type IpxPayloadProfile = { readonly kind: "quake1" } | { readonly kind: "datagram"; readonly packetType: number };
/** Explicit IPX-over-UDP links. Native AF_IPX and DOSBox rendezvous are separate drivers. */
export class IpxUdpTransport implements DatagramTransport<IpxAddress> {
  private readonly peers = new Map<string, { readonly ipx: IpxAddress; readonly udp: IpAddress }>();
  private readonly queue: PacketQueue<IpxAddress>;
  private readonly unsubscribe: () => void;
  private ended = false;
  private sequence = 0;
  constructor(readonly address: IpxAddress, private readonly transport: UdpTransport, readonly profile: IpxPayloadProfile, now: () => number = () => performance.now()) {
    this.queue = new PacketQueue({ maxBytes: UNIFIED_DATAGRAM_LIMITS.maxBytes - 34, queuePackets: 256 }, now);
    this.unsubscribe = transport.subscribeReadable(() => { this.receivePackets(); });
  }
  get closed(): boolean { return this.ended; }
  addPeer(ipx: IpxAddress, udp: IpAddress): void { if (this.ended) throw new Error("IPX tunnel is closed"); this.peers.set(addressKey(ipx, false), { ipx, udp }); }
  removePeer(ipx: IpxAddress): void { this.peers.delete(addressKey(ipx, false)); }
  private receivePackets(): void {
    if (this.ended) return;
    while (true) {
      const event = this.transport.poll();
      if (event === null) return;
      if (event.kind === "error") { this.queue.push(event); continue; }
      if (event.kind !== "packet") continue;
      const packet = decodeIpxPacket(event.payload);
      if (packet === null) continue;
      const peer = this.peers.get(addressKey(packet.from, false));
      if (peer === undefined || !sameAddress(peer.udp, event.from)) continue;
      const broadcast = packet.to.node.every(byte => byte === 255) && (packet.to.network === 0 || packet.to.network === this.address.network);
      if (packet.to.port !== this.address.port || (!broadcast && !sameAddress(packet.to, this.address))) continue;
      const expectedType = this.profile.kind === "quake1" ? 4 : this.profile.packetType;
      if (packet.packetType !== expectedType) continue;
      if (this.profile.kind === "quake1") {
        if (packet.payload.length < 4) continue;
        this.queue.accept(packet.from, packet.payload.subarray(4));
      } else this.queue.accept(packet.from, packet.payload);
    }
  }
  send(to: IpxAddress, payload: Uint8Array): boolean {
    if (this.ended) throw new Error("IPX tunnel is closed");
    if (payload.length > this.queue.limits.maxBytes) throw new RangeError("IPX payload exceeds tunnel capacity");
    let bytes = payload;
    if (this.profile.kind === "quake1") {
      bytes = new Uint8Array(payload.length + 4); new DataView(bytes.buffer).setUint32(0, this.sequence++ >>> 0, true); bytes.set(payload, 4);
    }
    const packet = encodeIpxPacket({ from: this.address, to, packetType: this.profile.kind === "quake1" ? 4 : this.profile.packetType, hops: 0, payload: bytes });
    if (to.node.every(byte => byte === 255)) {
      let sent = false;
      for (const peer of this.peers.values()) if (to.network === 0 || to.network === peer.ipx.network) sent = this.transport.send(peer.udp, packet) || sent;
      return sent;
    }
    const peer = this.peers.get(addressKey(to, false));
    return peer === undefined ? false : this.transport.send(peer.udp, packet);
  }
  poll(): ReceiveEvent<IpxAddress> | null { if (this.ended) throw new Error("IPX tunnel is closed"); this.receivePackets(); return this.queue.poll(); }
  subscribeReadable(listener: () => void): () => void { return this.queue.subscribe(listener); }
  close(): void {
    if (this.ended) return;
    this.ended = true; this.unsubscribe(); this.peers.clear();
    try { this.queue.close(); } finally { this.transport.close(); }
  }
}
