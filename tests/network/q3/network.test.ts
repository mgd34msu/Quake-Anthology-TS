import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { LoopbackHub } from "../../../src/network/common/loopback.ts";
import { Q3ClientAdmission, Q3ServerAdmission } from "../../../src/network/q3/admission.ts";
import type { Q3AcceptedConnect, Q3OutgoingDatagram } from "../../../src/network/q3/admission.ts";
import { Q3ClientConnection } from "../../../src/network/q3/client.ts";
import { Q3ClientDownload, Q3ServerDownload } from "../../../src/network/q3/download.ts";
import { MessageReader, MessageWriter } from "../../../src/network/q3/message.ts";
import { Netchannel } from "../../../src/network/q3/netchan.ts";
import { verifyQ3PureCommand, q3ArchiveChecksums } from "../../../src/network/q3/pure.ts";
import { Q3ServerConnection } from "../../../src/network/q3/server.ts";
import { ServerOpcode, decodeServerMessage } from "../../../src/network/q3/server-message.ts";
import type { Snapshot, ServerMessageContext } from "../../../src/network/q3/server-message.ts";
import { Q3ServerSnapshotHistory, Q3SnapshotEntities } from "../../../src/network/q3/snapshot-store.ts";
import { EntityStateRecord } from "../../../src/network/q3/state/entity.ts";
import { PlayerStateRecord } from "../../../src/network/q3/state/player.ts";
import { q3ChannelDelivery } from "../../../src/network/q3/transport.ts";
import { openArchive } from "../../../src/content/archive/index.ts";

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
  function readServer(): void {
    for (let packet = serverTransport.poll(); packet !== null; packet = serverTransport.poll()) {
      if (packet.kind !== "packet") throw new Error("Loopback delivery failed");
      server.receiveDatagram(packet.payload);
    }
  }
  const rate = { rate: 25000, maxRate: 0, snapshotMsec: 50, local: true, forceLan: true, lan: true };
  try {
    server.sendGamestate({ kind: "gamestate", commandSequence: 0, entries: [{ kind: "configstring", index: 1, value: "\\sv_serverid\\42" }, { kind: "baseline", number: 2, entity: baseline }], clientNumber: 1, checksumFeed: 123 }, rate, serverDelivery);
    await readClient(); expect(client.serverId).toBe(42); expect(client.clientNumber).toBe(1); expect(client.identity.seat?.index).toBe(1);
    client.reliable.add('userinfo "\\name\\Ranger"');
    for (const serverTime of [100, 200]) client.commands.append({ serverTime, angles: [0, 16384, 0], buttons: 1, weapon: 5, forwardmove: 127, rightmove: 0, upmove: 0 });
    client.transmit({ realTime: now, packetDup: 1, noDelta: false }, clientDelivery); readServer();
    expect(entered).toEqual([100]); expect(moves).toEqual([200]); expect(executed).toEqual(['userinfo "\\name\\Ranger"']);
    const player = new PlayerStateRecord<number, number, number>("missionpack", 0, 5, 0);
    player.clientNum = 1; player.commandTime = 200; player.origin = { x: 10, y: 20, z: 30 }; player.stats.set(0, 100);
    const entity = baseline.copy(); entity.pos = { ...entity.pos, base: { x: 64, y: 8, z: 16 } };
    snapshots.capture(server.channel.outgoingSequence, player, Uint8Array.of(254), [entity]); server.sendSnapshot(0, rate, serverDelivery, () => {});
    await readClient(); expect(received).toHaveLength(1); expect(received[0]?.playerState.origin).toEqual(player.origin);
    expect(client.reliable.acknowledge).toBe(1);
    now = 1100; client.commands.append({ serverTime: 300, angles: [0, 16384, 0], buttons: 0, weapon: 5, forwardmove: 64, rightmove: 0, upmove: 0 });
    client.transmit({ realTime: now, packetDup: 1, noDelta: false }, clientDelivery); readServer();
    expect(server.deltaMessage).toBe(2); expect(moves).toEqual([200, 300]); expect(executed).toHaveLength(1);
    player.origin = { ...player.origin, x: 11 }; player.commandTime = 300;
    snapshots.capture(server.channel.outgoingSequence, player, Uint8Array.of(254), [entity]); server.sendSnapshot(0, rate, serverDelivery, () => {});
    await readClient(); expect(received).toHaveLength(2); expect(received[1]?.deltaNumber).toBe(2); expect(received[1]?.playerState.origin.x).toBe(11);
    expect(received[1]?.entities[0]?.pos.base.x).toBe(64);
  } finally { hub.close(); }
});

test("challenge and compressed connect produce actual source admission fields", () => {
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
  server.receive(clientAddress, challenge.payload, 100);
  const response = replies.shift(); if (response === undefined) throw new Error("Missing challengeResponse");
  client.receive(serverAddress, response.payload, 110);
  const connect = client.resend(110, "\\name\\Ranger"); if (connect === null) throw new Error("Missing connect");
  server.receive(clientAddress, connect.payload, 120);
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
  for (const block of [0, 1, 2]) server.acknowledge(block, 2100);
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
