import { expect, test } from "bun:test";
import { ipv4Address, ipxAddress } from "../../../src/network/common/endpoint.ts";
import type { IpAddress, IpxAddress, Ipv4Address } from "../../../src/network/common/endpoint.ts";
import { decodeIpxPacket, encodeIpxPacket } from "../../../src/network/common/ipx.ts";
import { DosBoxIpxNetwork } from "../../../src/network/common/ipx-dosbox.ts";
import { bindIpxTransport, IpxGameTransport } from "../../../src/network/common/ipx-host.ts";
import { PacketQueue } from "../../../src/network/common/transport.ts";
import type { DatagramTransport, ReceiveEvent } from "../../../src/network/common/transport.ts";

const relay = ipv4Address([127, 0, 0, 1], 213);
const node = ipxAddress(0, [127, 0, 0, 1, 160, 1], 2);
const peer = ipxAddress(0, [127, 0, 0, 1, 160, 2], 26000);

class RelayLink implements DatagramTransport<IpAddress> {
  readonly address = ipv4Address([127, 0, 0, 1], 40961);
  readonly queue = new PacketQueue<IpAddress>({ maxBytes: 65507, queuePackets: 256 }, () => 100);
  readonly sent: { readonly to: IpAddress; readonly payload: Uint8Array }[] = [];
  closed = false;
  acknowledge = true;
  send(to: IpAddress, payload: Uint8Array): boolean {
    this.sent.push({ to, payload: payload.slice() });
    if (this.acknowledge && this.sent.length === 1) this.queue.accept(relay,
      Uint8Array.from([255, 255, 0, 30, 0, 0, 0, 0, 0, 0, 127, 0, 0, 1, 160, 1, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 213, 0, 2]));
    return true;
  }
  inject(from: IpxAddress, to: IpxAddress, payload: Uint8Array, sender: Ipv4Address = relay): void {
    this.queue.accept(sender, encodeIpxPacket({ from, to, payload, packetType: 4, hops: 0 }));
  }
  poll(): ReceiveEvent<IpAddress> | null { return this.queue.poll(); }
  subscribeReadable(listener: () => void): () => void { return this.queue.subscribe(listener); }
  close(): void { if (this.closed) return; this.closed = true; this.queue.close(); }
}

test("DOSBox registration uses the real socket-2 handshake and retains the assigned node", async () => {
  const udp = new RelayLink(), network = await DosBoxIpxNetwork.connect(udp, relay);
  try {
    expect(udp.sent[0]?.payload).toEqual(Uint8Array.from([255, 255, 0, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2]));
    expect(network.address).toEqual(node);
    const first = network.bind(0, 4), second = network.bind(0, 0);
    expect(first.address.port).toBe(0x4002); expect(second.address.port).toBe(0x4003);
    expect(first.address.node).toEqual(second.address.node);
    expect(() => network.bind(first.address.port, 0)).toThrow("already bound");
    first.close(); expect(network.bind(0, 0).address.port).toBe(0x4002);
    expect(udp.closed).toBe(false);
  } finally { network.close(); }
  expect(udp.closed).toBe(true);
});

test("Q1 sequencing, Q2/Q3 datagrams and separate sockets use the DOSBox relay", async () => {
  const udp = new RelayLink(), network = await DosBoxIpxNetwork.connect(udp, relay);
  const q1 = await bindIpxTransport({ kind: "dosbox", network }, "quake1", 26000);
  const q2 = await bindIpxTransport({ kind: "dosbox", network }, "quake2", 27910);
  const q3 = await bindIpxTransport({ kind: "dosbox", network }, "quake3", 27960);
  try {
    q1.send(peer, Uint8Array.of(7)); q1.send(peer, Uint8Array.of(8));
    const first = udp.sent[1], second = udp.sent[2];
    if (first === undefined || second === undefined) throw new Error("Missing Q1 packets");
    expect(first.to).toEqual(relay);
    expect(decodeIpxPacket(first.payload)).toMatchObject({ from: q1.address, to: peer, packetType: 4, payload: Uint8Array.of(0, 0, 0, 0, 7) });
    expect(decodeIpxPacket(second.payload)?.payload).toEqual(Uint8Array.of(1, 0, 0, 0, 8));
    udp.inject(peer, q1.address, Uint8Array.of(6, 0, 0, 0, 91));
    expect(q1.poll()).toMatchObject({ kind: "packet", from: peer, payload: Uint8Array.of(91) });
    expect(q2.poll()).toBeNull();
    for (const socket of [q2, q3]) {
      socket.send(peer, Uint8Array.of(9, 10));
      const sent = udp.sent.at(-1);
      if (sent === undefined) throw new Error("Missing raw datagram");
      expect(decodeIpxPacket(sent.payload)).toMatchObject({ packetType: 0, payload: Uint8Array.of(9, 10) });
      udp.inject(peer, socket.address, Uint8Array.of(11, 12));
      expect(socket.poll()).toMatchObject({ payload: Uint8Array.of(11, 12) });
    }
    udp.inject(peer, q1.address, Uint8Array.of(1));
    expect(q1.poll()).toBeNull();
    expect(q1.send(peer, new Uint8Array(1391))).toBe(false);
    const oversize = q1.poll();
    expect(oversize?.kind).toBe("error");
    if (oversize?.kind === "error") expect(oversize.error.message).toContain("capacity");
    expect(q1.send(peer, new Uint8Array(1390))).toBe(true);
  } finally { network.close(); }
  expect(q1.closed).toBe(true); expect(q2.closed).toBe(true); expect(q3.closed).toBe(true);
});

test("DOSBox filters foreign relays and destinations, echoes ping and locally routes broadcasts", async () => {
  const udp = new RelayLink(), network = await DosBoxIpxNetwork.connect(udp, relay), socket = network.bind(26000, 4);
  try {
    udp.inject(peer, socket.address, Uint8Array.of(1), ipv4Address([127, 0, 0, 2], 213));
    udp.inject(peer, ipxAddress(0, peer.node, 26000), Uint8Array.of(2));
    udp.queue.accept(relay, Uint8Array.of(255, 255));
    expect(socket.poll()).toBeNull();
    const broadcast = ipxAddress(0, [255, 255, 255, 255, 255, 255], 26000);
    socket.send(broadcast, Uint8Array.of(3));
    expect(socket.poll()).toMatchObject({ from: socket.address, payload: Uint8Array.of(3) });
    udp.inject(peer, broadcast, Uint8Array.of(4));
    expect(socket.poll()).toMatchObject({ from: peer, payload: Uint8Array.of(4) });
    const pingFrom = ipxAddress(0, peer.node, 2), pingTo = ipxAddress(0, broadcast.node, 2);
    udp.inject(pingFrom, pingTo, new Uint8Array());
    const ack = udp.sent.at(-1);
    if (ack === undefined) throw new Error("Missing ping acknowledgement");
    expect(decodeIpxPacket(ack.payload)).toMatchObject({ from: node, to: pingFrom, packetType: 0, payload: new Uint8Array() });
    expect(socket.poll()).toBeNull();
    const count = udp.sent.length;
    socket.send(socket.address, Uint8Array.of(5));
    expect(udp.sent.length).toBe(count);
    expect(socket.poll()).toMatchObject({ payload: Uint8Array.of(5) });
  } finally { network.close(); }
});

test("DOSBox timeout, cancellation, and underlying socket closure release owned resources", async () => {
  const timed = new RelayLink(); timed.acknowledge = false;
  await expect(DosBoxIpxNetwork.connect(timed, relay, { timeoutMilliseconds: 2 })).rejects.toThrow("timed out");
  expect(timed.closed).toBe(true);
  const cancelled = new RelayLink(); cancelled.acknowledge = false;
  const controller = new AbortController(), connecting = DosBoxIpxNetwork.connect(cancelled, relay, { signal: controller.signal });
  controller.abort();
  await expect(connecting).rejects.toThrow("aborted"); expect(cancelled.closed).toBe(true);
  const udp = new RelayLink(), network = await DosBoxIpxNetwork.connect(udp, relay), socket = network.bind(26000, 4);
  udp.close();
  expect(network.closed).toBe(true); expect(socket.closed).toBe(true);
});

test("DOSBox registration ignores another relay and a game packet instead of adopting their identities", async () => {
  const udp = new RelayLink(); udp.acknowledge = false;
  const connecting = DosBoxIpxNetwork.connect(udp, relay);
  const ack = encodeIpxPacket({ from: ipxAddress(1, [0, 0, 0, 0, 0, 213], 2), to: node, hops: 0, packetType: 0, payload: new Uint8Array() });
  udp.queue.accept(ipv4Address([127, 0, 0, 2], 213), ack);
  udp.inject(peer, ipxAddress(0, peer.node, 26000), new Uint8Array());
  udp.queue.accept(relay, ack);
  const network = await connecting;
  try { expect(network.address).toEqual(node); }
  finally { network.close(); }
});

test("native IPX is an explicit host capability and never silently becomes UDP", async () => {
  await expect(bindIpxTransport({ kind: "native", capability: { kind: "unavailable", reason: "AF_IPX is not provided by this Bun host" } }, "quake3", 27960)).rejects.toThrow("ipx-native: AF_IPX");
  const queue = new PacketQueue<IpxAddress>({ maxBytes: 4096, queuePackets: 4 }, () => 0), sent: Uint8Array[] = [];
  let closed = false;
  const raw: DatagramTransport<IpxAddress> = { address: peer, get closed() { return closed; }, send: (_to, payload) => { sent.push(payload.slice()); return true; },
    poll: () => queue.poll(), subscribeReadable: listener => queue.subscribe(listener), close: () => { closed = true; queue.close(); } };
  const transport = await bindIpxTransport({ kind: "native", capability: { kind: "available", bind: async options => {
    expect(options).toEqual({ port: 26000, packetType: 4, broadcast: true }); return raw;
  } } }, "quake1", 26000);
  transport.send(peer, Uint8Array.of(99));
  expect(sent).toEqual([Uint8Array.of(0, 0, 0, 0, 99)]);
  queue.accept(peer, Uint8Array.of(12, 0, 0, 0, 100));
  expect(transport.poll()).toMatchObject({ payload: Uint8Array.of(100) });
  expect(transport).toBeInstanceOf(IpxGameTransport);
  transport.close(); expect(closed).toBe(true);
});
