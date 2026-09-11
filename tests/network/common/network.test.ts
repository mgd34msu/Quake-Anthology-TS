import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createContentDigest } from "../../../src/contracts/content.ts";
import type { ExecutableRecipe, ProviderReference, ResolvedResourceReference } from "../../../src/contracts/content.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { UdpTransport } from "../../../src/network/common/transport.ts";
import type { DatagramTransport, ReceiveEvent } from "../../../src/network/common/transport.ts";
import type { NetworkAddress } from "../../../src/network/common/endpoint.ts";
import { addressKey, ipAddress, ipxAddress, resolveAddress } from "../../../src/network/common/endpoint.ts";
import { IpxUdpTransport } from "../../../src/network/common/ipx.ts";
import { admitCompositionOffer, compositionIdentity, encodeCompositionOffer, NetworkSession } from "../../../src/network/common/session.ts";
import { LoopbackHub } from "../../../src/network/common/loopback.ts";
import { ToggleReliableChannel, StopAndWaitChannel } from "../../../src/network/common/reliability.ts";
import { FragmentSender, FragmentReceiver } from "../../../src/network/common/fragments.ts";
import type { MessageFragment } from "../../../src/network/common/fragments.ts";
import { DownloadFile, DownloadSink, DownloadWindow, downloadHttp } from "../../../src/network/services/downloads.ts";
import { LocalAuthorization, LocalRankingService } from "../../../src/network/services/online.ts";
import { IpFilterList, sourceIpv4Filter, RconService } from "../../../src/network/services/admin.ts";
import { PacketRate } from "../../../src/network/common/scheduling.ts";

async function receive<TAddress extends NetworkAddress>(transport: DatagramTransport<TAddress>): Promise<ReceiveEvent<TAddress>> {
  const immediate = transport.poll();
  if (immediate !== null) return immediate;
  return new Promise((resolve, reject) => {
    const unsubscribe = transport.subscribeReadable(() => {
      const event = transport.poll();
      if (event !== null) { unsubscribe(); clearTimeout(timer); resolve(event); }
    });
    const timer = setTimeout(() => { unsubscribe(); reject(new Error("Local UDP exchange timed out")); }, 2000);
  });
}

describe("shared network transports", () => {
  test("real Bun UDP exchange copies packets and retains source addresses", async () => {
    const server = await UdpTransport.bind({ host: "127.0.0.1", port: 0 });
    const client = await UdpTransport.bind({ host: "127.0.0.1", port: 0 });
    try {
      const bytes = Uint8Array.of(255, 255, 255, 255, 112, 105, 110, 103);
      expect(client.send(server.address, bytes)).toBe(true); bytes.fill(0);
      const packet = await receive(server);
      expect(packet.kind).toBe("packet");
      if (packet.kind !== "packet") throw new Error("UDP did not produce a packet");
      expect(addressKey(packet.from)).toBe(addressKey(client.address));
      expect([...packet.payload]).toEqual([255, 255, 255, 255, 112, 105, 110, 103]);
      expect(server.send(packet.from, Uint8Array.of(97, 99, 107))).toBe(true);
      const reply = await receive(client);
      if (reply.kind !== "packet") throw new Error("UDP did not produce a reply");
      expect(new TextDecoder().decode(reply.payload)).toBe("ack");
      expect(addressKey(await resolveAddress("localhost", server.address.port, 4))).toBe(addressKey(server.address));
    } finally { client.close(); server.close(); }
  });
  test("several local clients have separate return paths", () => {
    const hub = new LoopbackHub(), server = hub.bind("server"), first = hub.bind("seat-0"), second = hub.bind("seat-1");
    try {
      first.send(server.address, Uint8Array.of(1)); second.send(server.address, Uint8Array.of(2));
      const one = server.poll(), two = server.poll();
      if (one?.kind !== "packet" || two?.kind !== "packet") throw new Error("Missing local packets");
      server.send(two.from, Uint8Array.of(9));
      expect(first.poll()).toBeNull(); expect(second.poll()).toMatchObject({ kind: "packet", payload: Uint8Array.of(9) });
    } finally { hub.close(); }
  });
  test("IPX tunnel exchanges Quake payloads on real UDP links", async () => {
    const firstSocket = await UdpTransport.bind({ host: "127.0.0.1", port: 0 }), secondSocket = await UdpTransport.bind({ host: "127.0.0.1", port: 0 });
    const first = new IpxUdpTransport(ipxAddress(0, [0, 0, 0, 0, 0, 1], 26000), firstSocket, { kind: "quake1" });
    const second = new IpxUdpTransport(ipxAddress(0, [0, 0, 0, 0, 0, 2], 26000), secondSocket, { kind: "quake1" });
    first.addPeer(second.address, secondSocket.address); second.addPeer(first.address, firstSocket.address);
    try {
      expect(first.send(second.address, Uint8Array.of(1, 2, 3))).toBe(true);
      const packet = await receive(second);
      expect(packet).toMatchObject({ kind: "packet", from: first.address, payload: Uint8Array.of(1, 2, 3) });
      expect(second.send(ipxAddress(0, [255, 255, 255, 255, 255, 255], 26000), Uint8Array.of(8))).toBe(true);
      expect(await receive(first)).toMatchObject({ kind: "packet", from: second.address, payload: Uint8Array.of(8) });
    } finally { first.close(); second.close(); }
  });
});

test("reliable source protocols and exact-multiple fragmentation", () => {
  const sender = new ToggleReliableChannel(1400), receiver = new ToggleReliableChannel(1400);
  sender.queue(Uint8Array.of(11, 12));
  const first = sender.transmit(Uint8Array.of(13));
  expect(receiver.receive(first)).toMatchObject({ kind: "accepted", payload: Uint8Array.of(11, 12, 13) });
  expect(receiver.receive(first).kind).toBe("rejected");
  sender.receive(receiver.transmit(new Uint8Array(0)));
  expect(sender.hasPendingReliable).toBe(false);
  const nq = new StopAndWaitChannel(100, 4);
  nq.begin(Uint8Array.of(1, 2, 3, 4, 5));
  const fragment = nq.next(0);
  expect(fragment).toMatchObject({ sequence: 0, final: false });
  expect(nq.next(1000)).toBeNull(); expect(nq.next(1001)).toEqual(fragment);
  expect(nq.acknowledge(0)).toBe(true); expect(nq.next(1002)).toMatchObject({ sequence: 1, final: true, payload: Uint8Array.of(5) });
  const fragmenter = new FragmentSender(1300, 16384, true), assembler = new FragmentReceiver(16384);
  fragmenter.begin(1, new Uint8Array(2600).fill(7));
  const parts: MessageFragment[] = [];
  while (fragmenter.pending) { const part = fragmenter.next(); if (part !== null) parts.push(part); }
  expect(parts.map(part => part.bytes.length)).toEqual([1300, 1300, 0]);
  let length = 0;
  for (const part of parts) { const result = assembler.receive(part); if (result.kind === "complete") length = result.bytes.length; }
  expect(length).toBe(2600);
  const rate = new PacketRate(2500);
  rate.sent(1000, 0); expect(rate.canSend(319)).toBe(false); expect(rate.canSend(321)).toBe(true);
});

test("actual file and HTTP downloads verify bytes before installation", async () => {
  const root = mkdtempSync(join(tmpdir(), "quake-network-")), bytes = new TextEncoder().encode("authored download fixture");
  const digest = createContentDigest(createHash("sha256").update(bytes).digest("hex"));
  writeFileSync(join(root, "source.dat"), bytes);
  const source = DownloadFile.open(root, "source.dat"), window = new DownloadWindow(source, 8, 8);
  const sink = DownloadSink.create(root, "mods/udp.dat", { digest, byteLength: bytes.length });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(bytes) });
  try {
    const blocks = window.packets(0, 8);
    for (const block of blocks) { sink.append(block.bytes); window.acknowledge(block.index, 1); }
    expect(window.closed).toBe(true); expect(sink.finish()).toBe(digest);
    expect(new Uint8Array(readFileSync(join(root, "mods/udp.dat")))).toEqual(bytes);
    const httpSink = DownloadSink.create(root, "mods/http.dat", { digest, byteLength: bytes.length });
    expect(await downloadHttp(new URL(`http://127.0.0.1:${server.port}/fixture`), httpSink)).toBe(digest);
    symlinkSync(tmpdir(), join(root, "outside"));
    expect(() => DownloadSink.create(root, "outside/nope.dat", { digest, byteLength: bytes.length })).toThrow();
  } finally { sink.close(); window.close(); await server.stop(true); rmSync(root, { recursive: true, force: true }); }
});

test("local account persistence and ranking reports are usable", async () => {
  const accounts = new LocalAuthorization(), account = accounts.register("player", "secret");
  const restored = new LocalAuthorization(); restored.restore(accounts.save());
  expect((await restored.authorize("player", "wrong")).kind).toBe("denied");
  const authorized = await restored.authorize("player", "secret");
  expect(authorized.kind).toBe("authorized");
  if (authorized.kind !== "authorized") throw new Error("Expected authorized account");
  expect(restored.account(authorized.token)).toEqual(account);
  restored.revoke(authorized.token); expect(restored.account(authorized.token)).toBeNull();
  const rankings = new LocalRankingService();
  const report = { match: "one", rules: "q3:ffa", players: [{ account: account.id, score: 12, won: true, statistics: new Map([["frags", 12]]) }] } satisfies Parameters<LocalRankingService["submit"]>[0];
  expect(rankings.submit(report)).toBe(true); expect(rankings.submit(report)).toBe(false);
  expect(rankings.standings("q3:ffa")[0]).toMatchObject({ matches: 1, wins: 1, score: 12 });
  const restoredRanks = new LocalRankingService(); restoredRanks.restore(rankings.save());
  expect(restoredRanks.standings("q3:ffa")).toEqual(rankings.standings("q3:ffa"));
});

test("source address filters and private rcon replies", async () => {
  const filters = new IpFilterList(), filter = sourceIpv4Filter("192.168.0");
  if (filter === null) throw new Error("Expected parsed source filter");
  filters.add(filter); expect(filters.rejects(ipAddress("192.168.1.4", 27960))).toBe(true);
  expect(filters.rejects(ipAddress("10.0.0.1", 27960))).toBe(false);
  const replies: string[] = [], executed: string[] = [];
  const admin = new RconService({ password: () => "secret", async execute(command, output) { executed.push(command); output("map: start\n"); }, reply(to, text) { replies.push(`${addressKey(to)} ${text}`); } });
  const address = ipAddress("127.0.0.1", 3000);
  expect(await admin.handle(address, "bad", "status", 500)).toBe("denied");
  expect(await admin.handle(address, "secret", "status", 1000)).toBe("executed");
  expect(executed).toEqual(["status"]); expect(replies[1]).toBe("127.0.0.1:3000 map: start\n");
});

test("composition offer and private remote seats retain separate identities", () => {
  const provider: ProviderReference = { provider: "q3:authored", content: "q3:test:authored:1" };
  const resource: ResolvedResourceReference = {
    id: "resource:authored-map", requestedPath: "maps/authored.bsp", digest: createContentDigest("0".repeat(64)), byteLength: 0,
    provenance: { kind: "loose", memberPath: "maps/authored.bsp", mount: { kind: "loose", identity: { id: "mount:test:maps", content: provider.content, generation: 0 }, rootPath: "/tmp/authored-map-fixture" } },
    resolution: { kind: "default-order", plan: "mount-plan:test:1", rank: 0 },
  };
  const recipe: ExecutableRecipe = {
    schemaVersion: 1, id: "recipe:test:1", preset: "recipe:test:1", map: { geometry: resource, entities: provider }, campaign: { kind: "none" },
    movement: provider, character: { definition: provider, appearance: provider }, weapons: [provider], enemies: { kind: "map-defined" },
    presentation: { assets: provider.content, hud: provider, effects: provider, audio: provider }, engineBehavior: provider, combat: provider, inventory: provider,
    match: provider, transition: provider, execution: [], mounts: { id: "mount-plan:test:1", mounts: [resource.provenance.mount], defaultOrder: [resource.provenance.mount.identity.id], prefixOrders: [] },
    resources: [resource], timing: [], ordering: { kind: "mixed", providers: [provider.provider], entityOrder: "source-slot-order", ties: "provider-entity-invocation" },
  };
  const identity = compositionIdentity({ schemaVersion: 1, recipe, snapshotSchema: "unified:snapshot-v1", actorConfigurations: [] });
  const offer = encodeCompositionOffer(identity);
  expect(admitCompositionOffer(identity, offer).kind).toBe("supported");
  const other = compositionIdentity({ ...identity.composition, snapshotSchema: "unified:snapshot-v2" });
  expect(admitCompositionOffer(other, offer).kind).toBe("unsupported");
  const ids = createIdentityOwner("network seats"), first = ids.client(0, 0), second = ids.client(1, 0), localSeat = ids.seat(0), remoteSeat = ids.seat(2);
  const session = new NetworkSession(ids, identity, { supports: () => ({ kind: "unsupported", reasons: ["No source codec registered"] }) });
  const wire = { kind: "unified", version: 1, composition: identity.digest, snapshotSchema: identity.composition.snapshotSchema } satisfies Parameters<NetworkSession["connect"]>[2];
  session.connect(first, { kind: "local", seat: localSeat, endpoint: { kind: "loopback", id: "local" } }, wire, 0);
  session.connect(second, { kind: "remote", remoteSeats: [{ seat: remoteSeat, index: 0 }], endpoint: ipAddress("127.0.0.1", 27960) }, wire, 0);
  session.route({ sequence: 0, time: { kind: "milliseconds", value: 10 }, audience: { kind: "seat", seat: remoteSeat }, payload: { kind: "message", event: { kind: "print", level: 0, text: "private" } } });
  expect(session.drain(first)).toHaveLength(0); expect(session.drain(second)).toHaveLength(1);
  session.disconnect(second);
  expect(() => session.get(second)).toThrow("stale");
  session.close();
});
