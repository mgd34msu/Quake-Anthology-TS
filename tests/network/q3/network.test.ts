import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { LoopbackHub } from "../../../src/network/common/loopback.ts";
import { Q3ClientAdmission, Q3ServerAdmission } from "../../../src/network/q3/admission.ts";
import type { Q3AcceptedConnect, Q3OutgoingDatagram } from "../../../src/network/q3/admission.ts";
import { Q3ClientConnection } from "../../../src/network/q3/client.ts";
import { Q3ClientDownload, Q3ServerDownload } from "../../../src/network/q3/download.ts";
import { MessageReader, MessageWriter } from "../../../src/network/q3/message.ts";
import { ClientMessageReader, encodeClientMessage } from "../../../src/network/q3/client-message.ts";
import { encodeConnectionlessText, encodeConnect } from "../../../src/network/q3/connectionless.ts";
import { Q3ServerConfigStrings } from "../../../src/network/q3/configstrings.ts";
import { Q3ServerNetwork } from "../../../src/app/bootstrap/network/q3.ts";
import { Q3GameCallbackError } from "../../../src/app/bootstrap/network/q3-types.ts";
import type { Q3ApplicationServerHost } from "../../../src/app/bootstrap/network/q3-types.ts";
import type { WireUserCommand } from "../../../src/network/q3/message.ts";
import { Netchannel, xorClientMessage } from "../../../src/network/q3/netchan.ts";
import { verifyQ3PureCommand, q3ArchiveChecksums } from "../../../src/network/q3/pure.ts";
import { Q3ServerConnection } from "../../../src/network/q3/server.ts";
import { ServerOpcode, decodeServerMessage } from "../../../src/network/q3/server-message.ts";
import type { Snapshot, ServerMessageContext } from "../../../src/network/q3/server-message.ts";
import { Q3ServerSnapshotHistory, Q3SnapshotEntities } from "../../../src/network/q3/snapshot-store.ts";
import { EntityStateRecord } from "../../../src/network/q3/state/entity.ts";
import { PlayerStateRecord } from "../../../src/network/q3/state/player.ts";
import { q3ChannelDelivery } from "../../../src/network/q3/transport.ts";
import { openArchive } from "../../../src/content/archive/index.ts";
import { ipxAddress, sameAddress } from "../../../src/network/common/endpoint.ts";
import type { NetworkAddress, IpAddress, IpxAddress } from "../../../src/network/common/endpoint.ts";
import { PacketQueue } from "../../../src/network/common/transport.ts";
import type { DatagramTransport } from "../../../src/network/common/transport.ts";
import { Q3ClientNetwork } from "../../../src/app/bootstrap/network/q3-client.ts";
import { q3IsLanAddress } from "../../../src/network/q3/admission.ts";

test("Q3 application IPX admission, gamestate, command delivery and lifetime preserve native LAN policy", async () => {
  const serverAddress = ipxAddress(0x12345678, [1, 2, 3, 4, 5, 6], 27960);
  const clientAddress = ipxAddress(0x12345678, [10, 11, 12, 13, 14, 15], 31000);
  const serverQueue = new PacketQueue<NetworkAddress>({ maxBytes: 16384, queuePackets: 32 }, () => 0);
  const clientQueue = new PacketQueue<IpAddress | IpxAddress>({ maxBytes: 16384, queuePackets: 32 }, () => 0);
  const sent: NetworkAddress[] = [], diagnostics: string[] = [], userinfo: string[] = [], commands: string[] = [];
  let serverClosed = false, clientClosed = false, loaded = false, serverTime = 0;
  const serverTransport: DatagramTransport<NetworkAddress> = {
    address: serverAddress, get closed() { return serverClosed; },
    send(to, payload) { sent.push(to); expect(sameAddress(to, clientAddress)).toBe(true); clientQueue.accept(serverAddress, payload); return true; },
    poll: () => serverQueue.poll(), subscribeReadable: listener => serverQueue.subscribe(listener),
    close() { serverClosed = true; serverQueue.close(); },
  };
  const owner = createIdentityOwner("q3-ipx-application"), player = { client: owner.client(0, 0), actor: owner.actor(0, 0), sourceEntity: 0 };
  const host: Q3ApplicationServerHost = {
    product: "baseq3", maxClients: 1, async prepare() {},
    pure: () => ({ enabled: false, checksumFeed: 0, checksumFeedServerId: 1, cgameChecksum: undefined, uiChecksum: undefined, loadedPureChecksums: [] }),
    downloadsEnabled: () => false, openDownload: () => null,
    rate: () => ({ rate: 10000, maxRate: 0, snapshotMsec: 50, local: false, forceLan: true, lan: true }),
    supportsSourceWire: () => ({ kind: "supported" }), time: () => serverTime, occupiedSlots: () => [],
    admit(request) { userinfo.push(request.userinfo); return { kind: "accepted", player }; }, carriedPlayer: () => player,
    disconnect() {}, gameState: () => ({ kind: "gamestate", commandSequence: 0, entries: [{ kind: "configstring", index: 1, value: "\\sv_serverid\\1" }], clientNumber: 0, checksumFeed: 0 }),
    snapshot: () => ({ player: new PlayerStateRecord("baseq3", 0, 0, 0), areaMask: new Uint8Array(), entities: [] }),
    input: () => null, command(_player, name) { commands.push(name); }, userinfo() {}, status: () => "", print: text => diagnostics.push(text),
    administration: { rconPassword: () => '', async execute() {}, rejects: () => false,
      masters: () => [{ kind: 'ipv4', host: [192, 0, 2, 1], port: 27950 }], record() {} },
  };
  const server = new Q3ServerNetwork({ transport: serverTransport, host, random: () => 0,
    resolveAuthorization() { throw new Error("IPX must not resolve IPv4 authorization"); } });
  const client = new Q3ClientNetwork({ remote: serverAddress, qport: 77, host: {
    identity: { client: player.client, seat: null }, downloading: false, userinfo: () => "\\name\\IPX",
    attach() {}, command() { throw new Error("No fixture input"); }, disconnected() {}, print() {}, clearActive() {},
    async systemInfo() {}, async gamestate() { loaded = true; }, snapshot() {}, downloadSize: size => size, async download() {}, mapRestart() {},
  }, transport: {
    address: clientAddress, get closed() { return clientClosed; },
    send(to, payload) { expect(sameAddress(to, serverAddress)).toBe(true); serverQueue.accept(clientAddress, payload); return true; },
    poll: () => clientQueue.poll(),
    subscribeReadable: listener => clientQueue.subscribe(listener), close() { clientClosed = true; clientQueue.close(); },
  } });
  try {
    expect(q3IsLanAddress(clientAddress)).toBe(true);
    await client.poll(0); await server.poll(0);
    await client.poll(10); await client.poll(11); await server.poll(11); await client.poll(20);
    client.sendPacket(); await server.poll(20); await client.poll(30);
    expect(server.clients).toHaveLength(1); expect(loaded).toBe(true);
    expect(userinfo[0]).toContain("\\ip\\12345678.0a0b0c0d0e0f:31000");
    client.sendPacket(); await server.poll(40);
    serverTime = 1400; client.command("say ipx"); client.sendPacket(); await server.poll(serverTime);
    server.heartbeat(1401);
    expect(commands).toContain("say"); expect(sent.length).toBeGreaterThan(2);
    expect(diagnostics).toContain("Q3 IPX transport supports LAN play; IPv4 master advertisement is unavailable.\n");
  } finally { client.close(); await server.close(); }
  expect(clientClosed && serverClosed).toBe(true);
});

test("Q3 mixed-bit message matches the unchanged original msg.c fixture", () => {
  // Retained source fixture from quake-3-ts/tests/message.test.ts.
  const original = "95a48fdad27853f0956a3e46200f3158fe02", writer = new MessageWriter();
  writer.writeBits(5, 3); writer.writeByte(0); writer.writeByte(255); writer.writeShort(-1234);
  writer.writeLong(0x12345678); writer.writeFloat(1.5); writer.writeString("quake%");
  expect(Buffer.from(writer.toBytes()).toString("hex")).toBe(original);
  expect(writer.bitPosition).toBe(138);
  const reader = new MessageReader(Buffer.from(original, "hex"));
  expect([reader.readBits(3), reader.readByte(), reader.readByte(), reader.readShort(), reader.readLong(), reader.readFloat(), reader.readString()])
    .toEqual([5, 0, 255, -1234, 0x12345678, 1.5, "quake."]);
});

test("fragment boundaries retain the zero-length terminator and source qport", () => {
  const sender = new Netchannel("client", 27961), receiver = new Netchannel("server", 27961);
  const bytes = Uint8Array.from({ length: 2600 }, (_, index) => index & 255), packets = sender.transmit(bytes);
  expect(packets.map(packet => packet.length)).toEqual([1310, 1310, 10]);
  expect(receiver.receive(packets[0] ?? new Uint8Array()).kind).toBe("fragment");
  expect(receiver.receive(packets[1] ?? new Uint8Array()).kind).toBe("fragment");
  const final = receiver.receive(packets[2] ?? new Uint8Array());
  expect(final.kind).toBe("accepted");
  if (final.kind !== "accepted") throw new Error("Fragmented packet was not accepted");
  expect(final.qport).toBe(27961); expect(final.payload).toEqual(bytes);
  expect(receiver.receive(packets[2] ?? new Uint8Array())).toEqual({ kind: "rejected", reason: "sequence" });
});

test("real shared loopback exchanges gamestate, user commands, snapshots and a delta for seat one", async () => {
  const identities = createIdentityOwner("q3-wire-smoke"), identity = { client: identities.client(1, 0), seat: identities.seat(1) };
  const hub = new LoopbackHub(), serverTransport = hub.bind("server"), clientTransport = hub.bind("seat-1");
  const received: Snapshot[] = [], moves: number[] = [], entered: number[] = [], executed: string[] = [];
  let now = 1000;
  const baseline = new EntityStateRecord<number>(0); baseline.number = 2; baseline.modelindex = 1;
  const snapshots = new Q3ServerSnapshotHistory(new Q3SnapshotEntities(2048), "missionpack", number => number === 2 ? baseline : new EntityStateRecord<number>(0));
  const server = new Q3ServerConnection(identity, 51, 27961, snapshots, {
    assertCurrent() {}, serverId: () => 42, restartedServerId: () => 42, checksumFeed: () => 123, pure: () => false,
    debugBuild: false, time: () => now, clientRunning: () => true, floodProtect: () => true, downloadName: () => "",
    command(command) { executed.push(command.text); return true; }, enterWorld(command) { entered.push(command.serverTime); }, think(command) { moves.push(command.serverTime); },
    resendGamestate() { throw new Error("Unexpected gamestate resend"); }, drop(reason) { throw new Error(reason); }, print() {},
  });
  const client = new Q3ClientConnection(identity, "missionpack", { kind: "network", challenge: 51, qport: 27961 }, {
    assertCurrent() {}, print() {}, clearActive() {}, async systemInfo() {}, async gamestate() {},
    snapshot(value) { received.push(value); }, downloadSize: size => size, async download() {}, mapRestart() {}, levelShot() {}, localServerRunning: () => true,
  });
  const serverDelivery = q3ChannelDelivery(serverTransport, () => clientTransport.address, server.sourceState, () => {});
  const clientDelivery = q3ChannelDelivery(clientTransport, () => serverTransport.address, client.sourceState, () => {});
  async function readClient(): Promise<void> {
    for (let packet = clientTransport.poll(); packet !== null; packet = clientTransport.poll()) {
      if (packet.kind !== "packet") throw new Error("Loopback delivery failed");
      await client.receiveDatagram(packet.payload, now);
    }
  }
  async function readServer(): Promise<void> {
    for (let packet = serverTransport.poll(); packet !== null; packet = serverTransport.poll()) {
      if (packet.kind !== "packet") throw new Error("Loopback delivery failed");
      await server.receiveDatagram(packet.payload);
    }
  }
  const rate = { rate: 25000, maxRate: 0, snapshotMsec: 50, local: true, forceLan: true, lan: true };
  try {
    server.sendGamestate({ kind: "gamestate", commandSequence: 0, entries: [{ kind: "configstring", index: 1, value: "\\sv_serverid\\42" }, { kind: "baseline", number: 2, entity: baseline }], clientNumber: 1, checksumFeed: 123 }, rate, serverDelivery);
    await readClient(); expect(client.serverId).toBe(42); expect(client.clientNumber).toBe(1); expect(client.identity.seat?.index).toBe(1);
    client.reliable.add('userinfo "\\name\\Ranger"');
    for (const serverTime of [100, 200]) client.commands.append({ serverTime, angles: [0, 16384, 0], buttons: 1, weapon: 5, forwardmove: 127, rightmove: 0, upmove: 0 });
    client.transmit({ realTime: now, packetDup: 1, noDelta: false }, clientDelivery); await readServer();
    expect(entered).toEqual([100]); expect(moves).toEqual([200]); expect(executed).toEqual(['userinfo "\\name\\Ranger"']);
    const player = new PlayerStateRecord<number, number, number>("missionpack", 0, 5, 0);
    player.clientNum = 1; player.commandTime = 200; player.origin = { x: 10, y: 20, z: 30 }; player.stats.set(0, 100);
    const entity = baseline.copy(); entity.pos = { ...entity.pos, base: { x: 64, y: 8, z: 16 } };
    snapshots.capture(server.channel.outgoingSequence, player, Uint8Array.of(254), [entity]); server.sendSnapshot(0, rate, serverDelivery, () => {});
    await readClient(); expect(received).toHaveLength(1); expect(received[0]?.playerState.origin).toEqual(player.origin);
    expect(client.reliable.acknowledge).toBe(1);
    now = 1100; client.commands.append({ serverTime: 300, angles: [0, 16384, 0], buttons: 0, weapon: 5, forwardmove: 64, rightmove: 0, upmove: 0 });
    client.transmit({ realTime: now, packetDup: 1, noDelta: false }, clientDelivery); await readServer();
    expect(server.deltaMessage).toBe(2); expect(moves).toEqual([200, 300]); expect(executed).toHaveLength(1);
    player.origin = { ...player.origin, x: 11 }; player.commandTime = 300;
    snapshots.capture(server.channel.outgoingSequence, player, Uint8Array.of(254), [entity]); server.sendSnapshot(0, rate, serverDelivery, () => {});
    await readClient(); expect(received).toHaveLength(2); expect(received[1]?.deltaNumber).toBe(2); expect(received[1]?.playerState.origin.x).toBe(11);
    expect(received[1]?.entities[0]?.pos.base.x).toBe(64);
  } finally { hub.close(); }
});

test("challenge and compressed connect produce actual source admission fields", async () => {
  const replies: Q3OutgoingDatagram[] = [], admitted: Q3AcceptedConnect[] = [];
  const serverAddress = { kind: "ipv4", host: [127, 0, 0, 1], port: 27960 } satisfies import("../../../src/network/q3/admission.ts").Q3Address;
  const clientAddress = { kind: "ipv4", host: [127, 0, 0, 1], port: 31000 } satisfies import("../../../src/network/q3/admission.ts").Q3Address;
  const client = new Q3ClientAdmission(4711, () => {});
  const server = new Q3ServerAdmission({ enabled: () => true,
    slots: () => [{ slot: 0, phase: "free", address: null, bot: false, qport: 0, lastConnectTime: 0 }], privateClients: () => 0, privatePassword: () => "",
    reconnectLimitSeconds: () => 3, minimumPing: () => 0, maximumPing: () => 0, authorizeAddress: () => null, demoRestricted: () => false,
    isLan: () => true, random: () => 123, authorize() { throw new Error("LAN should not authorize"); }, send(to, payload) { replies.push({ to, payload }); },
    admit(value) { admitted.push(value); return null; }, dropBot() {}, print() {}, query() {},
  });
  client.begin(serverAddress);
  const challenge = client.resend(100, "\\name\\Ranger"); if (challenge === null) throw new Error("Missing getchallenge");
  await server.receive(clientAddress, challenge.payload, 100);
  const response = replies.shift(); if (response === undefined) throw new Error("Missing challengeResponse");
  client.receive(serverAddress, response.payload, 110);
  const connect = client.resend(110, "\\name\\Ranger"); if (connect === null) throw new Error("Missing connect");
  await server.receive(clientAddress, connect.payload, 120);
  const connected = replies.shift(); if (connected === undefined) throw new Error("Missing connectResponse");
  expect(client.receive(serverAddress, connected.payload, 125).kind).toBe("admitted");
  expect(admitted[0]?.qport).toBe(4711); expect(admitted[0]?.userinfo).toContain("\\ip\\127.0.0.1:31000");
});

test("download window transfers two data blocks and EOF through the actual message codec", async () => {
  const data = Uint8Array.from({ length: 4096 }, (_, index) => index & 255), received: Uint8Array[] = [], commands: string[] = [];
  let offset = 0, published = false, completed = false;
  const server = new Q3ServerDownload({ enabled: () => true, pure: () => false, print() {}, drop(reason) { throw new Error(reason); },
    open() { return { size: data.length, read(target) { const count = Math.min(target.length, data.length - offset); target.set(data.subarray(offset, offset + count)); offset += count; return count; }, close() {} }; } });
  const client = new Q3ClientDownload({ assertCurrent() {}, openTemporary() { return { writeBytes(bytes) { received.push(bytes.slice()); }, close() {} }; },
    publishTemporary() { published = true; }, reliable(text) { commands.push(text); }, sendPacket() {}, progress() {}, async completed() { completed = true; } });
  server.begin("mods/example.pk3"); client.begin("mods/example.pk3", "mods/example.pk3");
  const writer = new MessageWriter(); writer.writeLong(0); server.write(writer, 2000, { rate: 100000, maxRate: 0, snapshotMsec: 50 }); writer.writeByte(ServerOpcode.Eof);
  const context: ServerMessageContext = { product: "baseq3", messageNumber: 1, reliableSequence: 0, serverCommandSequence: 0, parseEntitiesNumber: 0, baseline: () => null, history: () => null };
  const decoded = decodeServerMessage(writer.toBytes(), context);
  for (const operation of decoded.operations) if (operation.kind === "download") {
    if (operation.block.kind === "start") client.publishSize(operation.block.fileSize);
    await client.receive(operation.block);
  }
  expect(Buffer.concat(received)).toEqual(Buffer.from(data)); expect(published && completed).toBe(true);
  expect(commands).toEqual(["download mods/example.pk3", "nextdl 0", "nextdl 1", "nextdl 2"]);
  for (const block of [0, 1, 2]) await server.acknowledge(block, 2100);
  expect(server.name).toBe("");
});

test("source pure verification retains signed checksums and rejects duplicate references", () => {
  const server = { enabled: true, checksumFeed: 99, checksumFeedServerId: 42, cgameChecksum: 0xffffffff, uiChecksum: 7, loadedPureChecksums: [0xffffffff, 7] };
  const checksum = 99 ^ -1 ^ 7 ^ 2;
  expect(verifyQ3PureCommand(server, ["cp", "42", "-1", "7", "@", "-1", "7", String(checksum)])).toEqual({ kind: "authentic" });
  expect(verifyQ3PureCommand(server, ["cp", "42", "-1", "7", "@", "7", "7", "97"]).kind).toBe("rejected");
  expect(verifyQ3PureCommand(server, ["cp", "41"])).toEqual({ kind: "ignored", reason: "outdated" });
});

const retailPak = "/home/buzzkill/Projects/qfiles/q3a/baseq3/pak0.pk3";
test.skipIf(!await Bun.file(retailPak).exists())("retail Q3 pak0 source checksum and keyed pure checksum match donor", async () => {
  const archive = await openArchive(retailPak);
  try { expect(q3ArchiveChecksums(archive, 0x12345678)).toEqual({ checksum: 1566731103, pureChecksum: 3017657714 }); }
  finally { archive.close(); }
});

function orderedWireCommand(serverTime: number): WireUserCommand {
  return { serverTime, angles: [0, 0, 0], buttons: 0, weapon: 2, forwardmove: 0, rightmove: 0, upmove: 0 };
}

function orderedConnection(bindings: import("../../../src/network/q3/server.ts").Q3ServerBindings): Q3ServerConnection {
  const owner = createIdentityOwner("q3-await-wire");
  return new Q3ServerConnection({ client: owner.client(0, 0), seat: null }, 0, 77,
    new Q3ServerSnapshotHistory(new Q3SnapshotEntities(2048), "baseq3", () => new EntityStateRecord<number>(0)), bindings);
}

function orderedMessage(commands: readonly string[], times: readonly number[]): ClientMessageReader {
  return new ClientMessageReader(encodeClientMessage({ header: { serverId: 42, messageAcknowledge: 0, reliableAcknowledge: 0 },
    commands: commands.map((text, index) => ({ sequence: index + 1, text })),
    movement: times.length === 0 ? null : { kind: "move-no-delta", commands: times.map(orderedWireCommand) },
  }, { checksumFeed: 0, serverCommand: () => "" }));
}

test("Q3 server awaits reliable commands, begin and each think in wire order", async () => {
  const commandGate = Promise.withResolvers<void>(), beginGate = Promise.withResolvers<void>(), thinkGate = Promise.withResolvers<void>();
  const beginEntered = Promise.withResolvers<void>(), thinkEntered = Promise.withResolvers<void>();
  const calls: string[] = [];
  const server = orderedConnection({ assertCurrent() {}, serverId: () => 42, restartedServerId: () => 42, checksumFeed: () => 0,
    pure: () => false, debugBuild: false, time: () => 0, clientRunning: () => true, floodProtect: () => false, downloadName: () => "",
    async command(command) { calls.push(command.text); if (command.text === "one") await commandGate.promise; return true; },
    async enterWorld(command) { calls.push(`begin:${command.serverTime}`); beginEntered.resolve(); await beginGate.promise; },
    async think(command) { calls.push(`think:${command.serverTime}`); if (command.serverTime === 20) { thinkEntered.resolve(); await thinkGate.promise; } },
    resendGamestate() {}, drop(reason) { throw new Error(reason); }, print() {},
  });
  server.phase = "primed";
  const pending = server.executeMessage(orderedMessage(["one", "two"], [10, 20, 30]));
  expect(calls).toEqual(["one"]); expect(server.lastClientCommand).toBe(0);
  commandGate.resolve(); await beginEntered.promise;
  expect(calls).toEqual(["one", "two", "begin:10"]); expect(server.lastClientCommand).toBe(2);
  beginGate.resolve(); await thinkEntered.promise;
  expect(calls).toEqual(["one", "two", "begin:10", "think:20"]);
  thinkGate.resolve(); await pending;
  expect(calls).toEqual(["one", "two", "begin:10", "think:20", "think:30"]);
});

test("Q3 server stops a suspended packet after peer drop or world replacement", async () => {
  for (const retirement of ["peer", "world"]) {
    const gate = Promise.withResolvers<void>(), calls: string[] = []; let serverId = 42;
    const server = orderedConnection({ assertCurrent() {}, serverId: () => serverId, restartedServerId: () => serverId, checksumFeed: () => 0,
      pure: () => false, debugBuild: false, time: () => 0, clientRunning: () => true, floodProtect: () => false, downloadName: () => "",
      async command(command) { calls.push(command.text); await gate.promise; return true; }, enterWorld() {}, think() {}, resendGamestate() {}, drop() {}, print() {},
    });
    const pending = server.executeMessage(orderedMessage(["one", "two"], []));
    if (retirement === "peer") server.phase = "zombie"; else serverId++;
    gate.resolve();
    if (retirement === "world") await expect(pending).rejects.toThrow("retired server world"); else await pending;
    expect(calls).toEqual(["one"]); expect(server.lastClientCommand).toBe(0);
  }
});

test("Q3 configstring overflow and broken download acknowledgement await peer drop", async () => {
  const gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>(); let dropped = false;
  const server = orderedConnection({ assertCurrent() {}, serverId: () => 42, restartedServerId: () => 42, checksumFeed: () => 0,
    pure: () => false, debugBuild: false, time: () => 0, clientRunning: () => true, floodProtect: () => false, downloadName: () => "",
    command: () => true, enterWorld() {}, think() {}, resendGamestate() {}, print() {},
    async drop() { entered.resolve(); await gate.promise; server.phase = "zombie"; dropped = true; },
  });
  server.phase = "active";
  for (let index = 0; index < 64; index++) server.reliable.add(`pending ${index}`);
  const strings = new Q3ServerConfigStrings({ running: () => true, restarting: () => false, clients: () => [{ connection: server, noServerInfo: false }] });
  const pending = strings.set(2, "x".repeat(3000)); await entered.promise;
  expect(dropped).toBe(false); expect(server.reliable.sequence).toBe(65);
  gate.resolve(); await pending; expect(dropped).toBe(true); expect(server.reliable.sequence).toBe(65);
  const downloadGate = Promise.withResolvers<void>(); let finished = false;
  const download = new Q3ServerDownload({ enabled: () => true, pure: () => false, open: () => null, print() {}, async drop() { await downloadGate.promise; finished = true; } });
  const acknowledgement = download.acknowledge(1, 0);
  expect(finished).toBe(false); downloadGate.resolve(); await acknowledgement; expect(finished).toBe(true);
});

test("Q3 network close waits for suspended think and retires later wire commands", async () => {
  const hub = new LoopbackHub(), transport = hub.bind("await-server"), client = hub.bind("await-client");
  const owner = createIdentityOwner("q3-await-network"), player = { client: owner.client(0, 0), actor: owner.actor(0, 0), sourceEntity: 0 };
  const gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>(), calls: string[] = [];
  const host: Q3ApplicationServerHost = {
    product: "baseq3", maxClients: 1, async prepare() {},
    pure: () => ({ enabled: false, checksumFeed: 0, checksumFeedServerId: 1, cgameChecksum: undefined, uiChecksum: undefined, loadedPureChecksums: [] }),
    downloadsEnabled: () => false, openDownload: () => null,
    rate: () => ({ rate: 10000, maxRate: 0, snapshotMsec: 50, local: true, forceLan: false, lan: true }),
    supportsSourceWire: () => ({ kind: "supported" }), time: () => 0, occupiedSlots: () => [],
    admit: () => ({ kind: "accepted", player }), carriedPlayer: () => player,
    disconnect() { calls.push("disconnect"); },
    gameState: () => ({ kind: "gamestate", commandSequence: 0, entries: [], clientNumber: 0, checksumFeed: 0 }),
    snapshot: () => ({ player: new PlayerStateRecord("baseq3", 0, 0, 0), areaMask: new Uint8Array(), entities: [] }),
    async input(player, command, sequence) {
      calls.push(`input:${command.serverTime}`);
      if (command.serverTime === 20) { entered.resolve(); await gate.promise; }
      return { actor: player.actor, source: { kind: "remote-client", client: player.client }, sequence,
        command: { kind: "q3", serverTimeMilliseconds: command.serverTime, angleWords: command.angles, buttons: command.buttons,
          weapon: command.weapon, forwardMove: command.forwardmove, rightMove: command.rightmove, upMove: command.upmove } };
    },
    command() {}, userinfo() {}, status: () => "", print() {},
  };
  const network = new Q3ServerNetwork({ transport, host, random: () => 0 });
  const channel = new Netchannel("client", 77);
  function send(times: readonly number[]): void {
    const bytes = encodeClientMessage({ header: { serverId: 1, messageAcknowledge: 0, reliableAcknowledge: 0 }, commands: [],
      movement: times.length === 0 ? null : { kind: "move-no-delta", commands: times.map(orderedWireCommand) } }, { checksumFeed: 0, serverCommand: () => "" });
    for (const packet of channel.transmit(xorClientMessage(bytes, 0, () => ""))) client.send(transport.address, packet);
  }
  try {
    client.send(transport.address, encodeConnect("\\protocol\\68\\qport\\77\\challenge\\0")); await network.poll(0);
    expect(network.clients).toHaveLength(1); send([]); await network.poll(1);
    send([10, 20, 30]); const polling = network.poll(2); await entered.promise;
    const closing = network.close(); expect(network.close()).toBe(closing);
    expect(network.phase).toBe("closed"); expect(transport.closed).toBe(false); expect(calls).toEqual(["input:10", "input:20"]);
    gate.resolve(); expect(await polling).toEqual([]); await closing;
    expect(calls).toEqual(["input:10", "input:20", "disconnect"]); expect(transport.closed).toBe(true);
  } finally { gate.resolve(); await network.close(); hub.close(); }
});

test("Q3 admission awaits connect decision and suppresses replies after owner closes", async () => {
  for (const closeWhileWaiting of [false, true]) {
    const gate = Promise.withResolvers<string | null>(), entered = Promise.withResolvers<void>();
    const replies: Q3OutgoingDatagram[] = []; let enabled = true;
    const address = { kind: "loopback", id: "deferred-admission" } satisfies import("../../../src/network/q3/admission.ts").Q3Address;
    const server = new Q3ServerAdmission({ enabled: () => enabled,
      slots: () => [{ slot: 0, phase: "free", address: null, bot: false, qport: 0, lastConnectTime: 0 }], privateClients: () => 0, privatePassword: () => "",
      reconnectLimitSeconds: () => 3, minimumPing: () => 0, maximumPing: () => 0, authorizeAddress: () => null, demoRestricted: () => false,
      isLan: () => true, random: () => 0, authorize() {}, send(to, payload) { replies.push({ to, payload }); },
      async admit() { entered.resolve(); return await gate.promise; }, dropBot() {}, print() {}, query() {},
    });
    const pending = server.receive(address, encodeConnect("\\protocol\\68\\qport\\77\\challenge\\0"), 0);
    await entered.promise; expect(replies).toEqual([]);
    if (closeWhileWaiting) enabled = false;
    gate.resolve(null); await pending; expect(replies).toHaveLength(closeWhileWaiting ? 0 : 1);
  }
});

test("Q3 callback drops stop the packet without a false error and leave the server active", async () => {
  for (const dropAt of ["begin", "input", "userinfo", "command"]) {
    const hub = new LoopbackHub(), transport = hub.bind(`drop-server-${dropAt}`), client = hub.bind(`drop-client-${dropAt}`);
    const owner = createIdentityOwner(`q3-drop-${dropAt}`), player = { client: owner.client(0, 0), actor: owner.actor(0, 0), sourceEntity: 0 };
    const calls: string[] = [], printed: string[] = [];
    const host: Q3ApplicationServerHost = {
      product: "baseq3", maxClients: 1, async prepare() {},
      pure: () => ({ enabled: false, checksumFeed: 0, checksumFeedServerId: 1, cgameChecksum: undefined, uiChecksum: undefined, loadedPureChecksums: [] }),
      downloadsEnabled: () => false, openDownload: () => null,
      rate: () => ({ rate: 10000, maxRate: 0, snapshotMsec: 50, local: true, forceLan: false, lan: true }),
      supportsSourceWire: () => ({ kind: "supported" }), time: () => 0, occupiedSlots: () => [],
      admit: () => ({ kind: "accepted", player }), carriedPlayer: () => player,
      disconnect() { calls.push("disconnect"); },
      gameState: () => ({ kind: "gamestate", commandSequence: 0, entries: [], clientNumber: 0, checksumFeed: 0 }),
      snapshot: () => ({ player: new PlayerStateRecord("baseq3", 0, 0, 0), areaMask: new Uint8Array(), entities: [] }),
      async begin(_player, command) { calls.push(`begin:${command.serverTime}`); if (dropAt === "begin") await network.gameOutput().dropClient(0, "guest drop"); },
      async input(_player, command) { calls.push(`input:${command.serverTime}`); if (dropAt === "input") await network.gameOutput().dropClient(0, "guest drop"); return null; },
      async command(_player, name) { calls.push(`command:${name}`); if (dropAt === "command") await network.gameOutput().dropClient(0, "guest drop"); },
      async userinfo() { calls.push("userinfo"); if (dropAt === "userinfo") await network.gameOutput().dropClient(0, "guest drop"); },
      status() { calls.push("status"); return "infoResponse\n"; }, print(text) { printed.push(text); },
    };
    const network = new Q3ServerNetwork({ transport, host, random: () => 0 }), channel = new Netchannel("client", 77);
    const send = (times: readonly number[], commands: readonly string[] = []): void => {
      const bytes = encodeClientMessage({ header: { serverId: 1, messageAcknowledge: 0, reliableAcknowledge: 0 },
        commands: commands.map((text, index) => ({ sequence: index + 1, text })),
        movement: times.length === 0 ? null : { kind: "move-no-delta", commands: times.map(orderedWireCommand) } }, { checksumFeed: 0, serverCommand: () => "" });
      for (const packet of channel.transmit(xorClientMessage(bytes, 0, () => ""))) client.send(transport.address, packet);
    };
    try {
      client.send(transport.address, encodeConnect("\\protocol\\68\\qport\\77\\challenge\\0")); await network.poll(0);
      send([]); await network.poll(1);
      if (dropAt === "command" || dropAt === "userinfo") {
        send([10]); await network.poll(2);
        send([20, 30], [dropAt === "userinfo" ? 'userinfo "\\name\\Changed"' : "drop", "later"]);
      } else send([10, 20, 30]);
      expect(await network.poll(3)).toEqual([]);
      expect(network.clients).toHaveLength(0); expect(network.phase).toBe("active");
      expect(calls).toEqual(dropAt === "begin" ? ["begin:10", "disconnect"] : dropAt === "input" ? ["begin:10", "input:20", "disconnect"]
        : dropAt === "userinfo" ? ["begin:10", "userinfo", "disconnect"] : ["begin:10", "command:drop", "disconnect"]);
      expect(printed.some(text => text.includes("callback belongs to a dropped client"))).toBe(false);
      client.send(transport.address, Uint8Array.of(255, 255, 255, 255, ...new TextEncoder().encode("getinfo")));
      await network.poll(4); expect(calls.at(-1)).toBe("status");
    } finally { await network.close(); hub.close(); }
  }
});


test("Q3 packet recovery handles malformed bytes but propagates an awaited game failure", async () => {
  const hub = new LoopbackHub(), transport = hub.bind("failure-server"), client = hub.bind("failure-client");
  const owner = createIdentityOwner("q3-failure"), player = { client: owner.client(0, 0), actor: owner.actor(0, 0), sourceEntity: 0 };
  const failure = new RangeError("guest memory access failed"), calls: string[] = [], printed: string[] = [];
  const host: Q3ApplicationServerHost = {
    product: "baseq3", maxClients: 1, async prepare() {},
    pure: () => ({ enabled: false, checksumFeed: 0, checksumFeedServerId: 1, cgameChecksum: undefined, uiChecksum: undefined, loadedPureChecksums: [] }),
    downloadsEnabled: () => false, openDownload: () => null,
    rate: () => ({ rate: 10000, maxRate: 0, snapshotMsec: 50, local: true, forceLan: false, lan: true }),
    supportsSourceWire: () => ({ kind: "supported" }), time: () => 0, occupiedSlots: () => [],
    admit: () => ({ kind: "accepted", player }), carriedPlayer: () => player, disconnect() {},
    gameState: () => ({ kind: "gamestate", commandSequence: 0, entries: [], clientNumber: 0, checksumFeed: 0 }),
    snapshot: () => ({ player: new PlayerStateRecord("baseq3", 0, 0, 0), areaMask: new Uint8Array(), entities: [] }),
    async begin() { calls.push("begin"); await Promise.resolve(); throw failure; },
    input() { calls.push("input"); return null; }, command() {}, userinfo() {},
    status() { calls.push("status"); return "infoResponse\n"; }, print(text) { printed.push(text); },
  };
  const network = new Q3ServerNetwork({ transport, host, random: () => 0 }), channel = new Netchannel("client", 77);
  const send = (times: readonly number[]): void => {
    const bytes = encodeClientMessage({ header: { serverId: 1, messageAcknowledge: 0, reliableAcknowledge: 0 }, commands: [],
      movement: times.length === 0 ? null : { kind: "move-no-delta", commands: times.map(orderedWireCommand) } }, { checksumFeed: 0, serverCommand: () => "" });
    for (const packet of channel.transmit(xorClientMessage(bytes, 0, () => ""))) client.send(transport.address, packet);
  };
  try {
    client.send(transport.address, encodeConnect("\\protocol\\68\\qport\\77\\challenge\\0")); await network.poll(0);
    client.send(transport.address, encodeConnect("\\protocol\\68\\qport\\77\\challenge\\0").slice(0, 13));
    expect(await network.poll(1)).toEqual([]);
    expect(printed.length).toBeGreaterThan(0);
    send([]); await network.poll(2);
    send([10, 20]);
    client.send(transport.address, Uint8Array.of(255, 255, 255, 255, ...new TextEncoder().encode("getinfo")));
    let caught: unknown;
    try { await network.poll(3); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(Q3GameCallbackError);
    if (!(caught instanceof Q3GameCallbackError)) throw new Error("Missing authoritative callback failure");
    expect(caught.cause).toBe(failure);
    expect(calls).toEqual(["begin"]);
    expect(printed.some(text => text.includes(failure.message))).toBe(false);
  } finally { await network.close(); hub.close(); }
});


test("Q3 endpoint authenticates rcon, preserves quoted commands and applies its address filter", async () => {
  const hub = new LoopbackHub(), transport = hub.bind("admin-server"), client = hub.bind("admin-client");
  const owner = createIdentityOwner("q3-admin-network"), player = { client: owner.client(0, 0), actor: owner.actor(0, 0), sourceEntity: 0 };
  const commands: string[] = [];
  let blocked = false;
  const host: Q3ApplicationServerHost = {
    product: "baseq3", maxClients: 1, async prepare() {},
    pure: () => ({ enabled: false, checksumFeed: 0, checksumFeedServerId: 1, cgameChecksum: undefined, uiChecksum: undefined, loadedPureChecksums: [] }),
    downloadsEnabled: () => false, openDownload: () => null,
    rate: () => ({ rate: 10000, maxRate: 0, snapshotMsec: 50, local: true, forceLan: false, lan: true }),
    supportsSourceWire: () => ({ kind: "supported" }), time: () => 0, occupiedSlots: () => [],
    admit: () => ({ kind: "accepted", player }), carriedPlayer: () => player, disconnect() {},
    gameState: () => ({ kind: "gamestate", commandSequence: 0, entries: [], clientNumber: 0, checksumFeed: 0 }),
    snapshot: () => ({ player: new PlayerStateRecord("baseq3", 0, 0, 0), areaMask: new Uint8Array(), entities: [] }),
    input: () => null, command() {}, userinfo() {}, status: () => "", print() {},
    administration: { rconPassword: () => "secret", rejects: () => blocked, masters: () => [], record() {},
      async execute(command, output) { commands.push(command); output("executed\n"); } },
  };
  const network = new Q3ServerNetwork({ transport, host, random: () => 0 });
  const reply = () => {
    const event = client.poll(); if (event?.kind !== "packet") throw new Error("Missing rcon response");
    return new TextDecoder().decode(event.payload.subarray(4));
  };
  try {
    client.send(transport.address, encodeConnectionlessText('rcon wrong echo "two words"'));
    await network.poll(1000); expect(reply()).toContain("Bad rconpassword"); expect(commands).toEqual([]);
    client.send(transport.address, encodeConnectionlessText('rcon secret echo "two words"'));
    await network.poll(2000); expect(reply()).toContain("executed"); expect(commands).toEqual(['echo "two words"']);
    blocked = true;
    client.send(transport.address, encodeConnectionlessText('rcon secret echo blocked'));
    await network.poll(3000); expect(client.poll()).toBeNull(); expect(commands).toHaveLength(1);
  } finally { await network.close(); hub.close(); }
});
