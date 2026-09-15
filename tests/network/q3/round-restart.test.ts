import { expect, test } from "bun:test";
import { Q3ServerNetwork } from "../../../src/app/bootstrap/network/q3.ts";
import type { Q3ApplicationPlayer, Q3ApplicationServerHost, Q3NetworkRoundRestart } from "../../../src/app/bootstrap/network/q3-types.ts";
import type { SimulationOutput, WorldSnapshot } from "../../../src/contracts/session.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { createContentId } from "../../../src/contracts/content.ts";
import { LoopbackHub } from "../../../src/network/common/loopback.ts";
import { Q3ClientConnection } from "../../../src/network/q3/client.ts";
import { encodeConnect } from "../../../src/network/q3/connectionless.ts";
import type { WireUserCommand } from "../../../src/network/q3/message.ts";
import type { Snapshot } from "../../../src/network/q3/server-message.ts";
import { PlayerStateRecord } from "../../../src/network/q3/state/player.ts";
import { q3ChannelDelivery } from "../../../src/network/q3/transport.ts";

const content = createContentId({ family: "q3", edition: "missionpack", package: "pak0", revision: "fixture" });

function fixture(pure = false) {
  const hub = new LoopbackHub(), transport = hub.bind("round-server"), remote = hub.bind("round-client");
  const identity = createIdentityOwner("wire-round"), clientId = identity.client(0, 0);
  let actorGeneration = 0, now = 1000, sourceGeneration = 0, eligible = true, prepareFailure = false;
  let player: Q3ApplicationPlayer = { client: clientId, actor: identity.actor(0, actorGeneration), sourceEntity: 0 };
  const calls: string[] = [], feeds: number[] = [], moves: { generation: number; time: number; sequence: number }[] = [];
  const snapshots: Snapshot[] = [], commands: string[] = [], pureEpochs: number[] = [];
  let gamestates = 0, restarts = 0, randomDraws = 0;
  const host: Q3ApplicationServerHost = {
    product: "missionpack", maxClients: 1,
    async prepare(feed) { if (prepareFailure) throw new Error("prepare failed"); feeds.push(feed); },
    pure: (serverId, checksumFeedServerId = serverId) => { pureEpochs.push(checksumFeedServerId); return { enabled: pure, checksumFeed: 0, checksumFeedServerId, cgameChecksum: 7, uiChecksum: 8, loadedPureChecksums: [] }; },
    downloadsEnabled: () => false, openDownload: () => null,
    rate: () => ({ rate: 10000, maxRate: 0, snapshotMsec: 50, local: true, forceLan: false, lan: true }),
    supportsSourceWire: () => ({ kind: "supported" }), time: () => now, occupiedSlots: () => [],
    admit: () => { calls.push("admit"); return { kind: "accepted", player }; }, carriedPlayer: () => player,
    disconnect() { calls.push("disconnect"); },
    gameState: (_player, serverId) => ({ kind: "gamestate", commandSequence: 0,
      entries: [{ kind: "configstring", index: 1, value: `\\sv_serverid\\${serverId}` }], clientNumber: 0, checksumFeed: 0 }),
    snapshot: () => { const state = new PlayerStateRecord("missionpack", 0, 5, 0); state.clientNum = 0; state.commandTime = now;
      return { player: state, areaMask: new Uint8Array(), entities: [] }; },
    input(player, command, sequence) {
      moves.push({ generation: player.actor.generation, time: command.serverTime, sequence });
      return { actor: player.actor, source: { kind: "remote-client", client: player.client }, sequence,
        command: { kind: "q3", serverTimeMilliseconds: command.serverTime, angleWords: command.angles, buttons: command.buttons,
          weapon: command.weapon, forwardMove: command.forwardmove, rightMove: command.rightmove, upMove: command.upmove } };
    }, command() {}, userinfo() {}, status: () => "", print() {},
    sourceRound: {
      preflight() { if (!eligible) throw new Error("incompatible source round"); calls.push("preflight"); },
      rebind() { expect(actorGeneration).toBe(sourceGeneration + 1); sourceGeneration = actorGeneration; calls.push("bind"); },
      reconnect(client, userinfo, command) {
        expect(client).toBe(clientId); expect(userinfo).toContain("Retained"); calls.push(`reconnect:${command.serverTime}`);
        player = { client, actor: identity.actor(0, actorGeneration), sourceEntity: 0 }; return { kind: "accepted", player };
      },
    },
  };
  const network = new Q3ServerNetwork({ transport, host, random: () => { randomDraws++; return 0; } });
  const client = new Q3ClientConnection({ client: clientId, seat: identity.seat(0) }, "missionpack", { kind: "network", challenge: 0, qport: 77 }, {
    assertCurrent() {}, print() {}, clearActive() {}, async systemInfo() {}, async gamestate() { gamestates++; },
    snapshot(snapshot) { snapshots.push(snapshot); }, downloadSize: size => size, async download() {},
    mapRestart() { restarts++; }, levelShot() {}, localServerRunning: () => true,
  });
  const delivery = q3ChannelDelivery(remote, () => transport.address, client.sourceState, () => {});
  const output: SimulationOutput = { get snapshot(): WorldSnapshot { return { session: identity.session,
    frame: { frame: 1, time: { kind: "milliseconds", value: now }, elapsed: { kind: "milliseconds", value: 100 }, phase: "frame-exit" },
    actors: [], bodies: [], inventories: [], configurations: [], scene: { session: identity.session,
      time: { kind: "milliseconds", value: now }, world: null, entities: [], lights: [], particles: [], lightStyles: [], areaBits: null } }; }, events: [] };
  const read = async () => {
    for (let packet = remote.poll(); packet !== null; packet = remote.poll()) {
      if (packet.kind !== "packet") throw new Error("Loopback packet failed");
      if (packet.payload.slice(0, 4).every(byte => byte === 255)) continue;
      await client.receiveDatagram(packet.payload, now);
    }
    for (let sequence = client.lastExecutedServerCommand + 1; sequence <= client.serverCommandSequence; sequence++) {
      const argv = await client.getServerCommand(sequence); if (argv !== null) commands.push(argv.join(" "));
    }
  };
  const send = async (time: number) => {
    const command: WireUserCommand = { serverTime: time, angles: [0, 0, 0], buttons: 0, weapon: 5, forwardmove: 127, rightmove: 0, upmove: 0 };
    client.commands.append(command); client.transmit({ realTime: now, packetDup: 0, noDelta: false }, delivery);
    return network.poll(now);
  };
  return { hub, transport, remote, network, client, clientId, host, calls, feeds, moves, snapshots, commands, pureEpochs, output, read, send,
    advance() { now += 100; }, reset() { actorGeneration++; }, incompatible() { eligible = false; }, failPrepare() { prepareFailure = true; },
    get randomDraws() { return randomDraws; }, get gamestates() { return gamestates; }, get restarts() { return restarts; },
    async connect() {
      remote.send(transport.address, encodeConnect("\\protocol\\68\\qport\\77\\challenge\\0\\name\\Retained"));
      await network.poll(now); await read(); if (pure) client.reliable.add("cp 1 7 8 @ 0"); await send(10); await read(); await send(20); await read();
      await network.publish(output, [], now); await read();
    },
    async publish() { await network.publish(output, [], now); await read(); },
    async close() { await network.close(); hub.close(); },
  };
}

test("wire fast restart keeps channels and reliable sequence, reconnects once and ignores old epoch input", async () => {
  const f = fixture();
  try {
    await f.connect();
    const channel = f.client.channel, reliable = f.client.reliable, initialGamestates = f.gamestates;
    const oldPlayer = f.network.clients[0], priorSnapshots = f.snapshots.length, drawsBefore = f.randomDraws;
    const captured: { round: Q3NetworkRoundRestart | null } = { round: null };
    await f.network.restartSourceRound(async round => {
      captured.round = round;
      expect(round.clients).toEqual([f.clientId]); expect(round.snapshotServerBit).toBe(4);
      await expect(f.network.poll(1001)).rejects.toThrow("already in progress");
      f.reset(); await round.bindSource();
      for (let settle = 0; settle < 3; settle++) f.advance();
      await round.receiveEvents([{ kind: "q3-source", content, sequence: 1, seconds: 1.3,
        event: { kind: "configstring", index: 1, value: "\\sv_serverid\\2" } },
      { kind: "q3-source", content, sequence: 2, seconds: 1.3,
        event: { kind: "configstring", index: 5, value: "0" } }]);
      expect(await round.reconnectClient(f.clientId)).toBe(true);
      await expect(round.reconnectClient(f.clientId)).rejects.toThrow("already reconnected");
      f.advance(); await f.read(); expect(f.snapshots).toHaveLength(priorSnapshots);
      expect(f.restarts).toBe(0);
    });
    const staleInput = await f.send(30);
    expect(staleInput).toEqual([]); expect(f.gamestates).toBe(initialGamestates);
    await f.publish();
    expect(f.randomDraws).toBe(drawsBefore); expect(f.client.serverId).toBe(2); expect(f.client.checksumFeed).toBe(0);
    expect(f.client.channel).toBe(channel); expect(f.client.reliable).toBe(reliable);
    expect(f.gamestates).toBe(initialGamestates); expect(f.restarts).toBe(1);
    expect(f.commands.slice(-3)).toEqual(["cs 1 \\sv_serverid\\2", "cs 5 0", "map_restart"]);
    expect(f.snapshots.at(-1)?.flags).toBe(4);
    expect(f.network.clients[0]?.client).toBe(oldPlayer?.client);
    expect(f.network.clients[0]?.actor.generation).toBe(1);
    expect(f.calls.filter(call => call.startsWith("reconnect:"))).toEqual(["reconnect:20"]);
    expect(f.calls.filter(call => call === "admit")).toHaveLength(1);
    f.advance(); const commands = await f.send(40);
    expect(commands.length).toBeGreaterThan(0); expect(commands.every(command => command.actor.generation === 1)).toBe(true);
    expect(f.moves.at(-1)?.time).toBe(40); expect(new Set(f.feeds)).toEqual(new Set([0]));
    if (captured.round === null) throw new Error("Missing completed scope");
    await expect(captured.round.bindSource()).rejects.toThrow("scope has ended");
    await f.network.restartSourceRound(async round => {
      expect(round.snapshotServerBit).toBe(0); f.reset(); await round.bindSource();
      for (let settle = 0; settle < 3; settle++) f.advance();
      await round.receiveEvents([{ kind: "q3-source", content, sequence: 3, seconds: 1.8,
        event: { kind: "configstring", index: 1, value: "\\sv_serverid\\3" } }]);
      expect(await round.reconnectClient(f.clientId)).toBe(true); f.advance();
    });
    f.client.serverId = 1;
    expect(await f.send(50)).toEqual([]);
    await f.publish();
    expect(f.client.serverId).toBe(3); expect(f.gamestates).toBe(initialGamestates);
    expect(f.restarts).toBe(2); expect(f.snapshots.at(-1)?.flags).toBe(0);
    expect(f.calls.filter(call => call.startsWith("reconnect:"))).toEqual(["reconnect:20", "reconnect:40"]);
    await f.network.changeWorld(f.host); await f.network.poll(2000); await f.read();
    expect(f.gamestates).toBe(initialGamestates + 1); expect(f.randomDraws).toBe(drawsBefore + 2);
  } finally { await f.close(); }
});

test("preflight preserves live wire state and interrupted round retires the network", async () => {
  const f = fixture();
  try {
    await f.connect(); f.incompatible();
    let notifications = 0;
    await expect(f.network.restartSourceRound(async () => { throw new Error("must not run"); }, () => { notifications++; return undefined; })).rejects.toThrow("incompatible");
    expect(notifications).toBe(0);
    expect(f.network.phase).toBe("active"); expect(f.network.clients).toHaveLength(1);
    f.advance(); await f.publish(); expect(f.snapshots.at(-1)?.flags).toBe(0);
  } finally { await f.close(); }
  const failed = fixture();
  try {
    await failed.connect();
    await expect(failed.network.restartSourceRound(async round => {
      failed.reset(); await round.bindSource(); throw new Error("source round failed");
    })).rejects.toThrow("source round failed");
    expect(failed.network.phase).toBe("closed"); expect(failed.transport.closed).toBe(true);
    expect(failed.network.clients).toEqual([]); expect(await failed.network.poll(2000)).toEqual([]);
  } finally { await failed.close(); }
});

test("delayed pure commands retain the checksum epoch through fast restart but not full replacement", async () => {
  const fast = fixture(true);
  try {
    await fast.connect();
    await fast.network.restartSourceRound(async round => {
      fast.reset(); await round.bindSource();
      for (let settle = 0; settle < 3; settle++) fast.advance();
      await round.receiveEvents([{ kind: "q3-source", content, sequence: 1, seconds: 1.3,
        event: { kind: "configstring", index: 1, value: "\\sv_serverid\\2" } }]);
      await round.reconnectClient(fast.clientId); fast.advance();
    });
    await fast.publish(); expect(fast.client.serverId).toBe(2);
    fast.client.reliable.add("cp 1 7 8 @ 0"); await fast.send(30);
    expect(fast.network.clients).toHaveLength(1); expect(fast.pureEpochs.at(-1)).toBe(1);
    fast.advance(); fast.client.reliable.add("cp 1 7 8 @ 999"); await fast.send(40);
    expect(fast.network.clients).toEqual([]); expect(fast.calls.at(-1)).toBe("disconnect");
  } finally { await fast.close(); }
  const full = fixture(true);
  try {
    await full.connect(); await full.network.changeWorld(full.host); await full.network.poll(2000); await full.read();
    expect(full.client.serverId).toBe(2);
    full.client.reliable.add("cp 1 7 8 @ 999"); await full.send(30);
    expect(full.network.clients).toHaveLength(1); expect(full.pureEpochs.at(-1)).toBe(2);
    full.client.reliable.add("cp 2 7 8 @ 0"); await full.send(40);
    expect(full.network.clients).toHaveLength(1);
  } finally { await full.close(); }
});

for (const failure of ["prepare", "notification"]) test(`round mutation notification precedes ${failure} failure and retires the wire`, async () => {
  const f = fixture(); let notifications = 0, runs = 0;
  try {
    await f.connect();
    if (failure === "prepare") f.failPrepare();
    await expect(f.network.restartSourceRound(async () => { runs++; }, () => {
      notifications++;
      if (failure === "notification") throw new Error("notification failed");
      return undefined;
    })).rejects.toThrow(`${failure} failed`);
    expect(notifications).toBe(1); expect(runs).toBe(0);
    expect(f.network.phase).toBe("closed"); expect(f.transport.closed).toBe(true);
    expect(f.network.clients).toEqual([]); expect(await f.network.poll(2000)).toEqual([]);
  } finally { await f.close(); }
});
