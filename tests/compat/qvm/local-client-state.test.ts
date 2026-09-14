import { Q3ClientConnection } from "../../../src/network/q3/client.ts";
import { encodeServerMessage } from "../../../src/network/q3/server-message.ts";
import { expect, test } from "bun:test";
import { LocalQ3ClientState } from "../../../src/app/bootstrap/q3-client/client-state.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { PlayerStateRecord } from "../../../src/network/q3/state/player.ts";
import { EntityStateRecord } from "../../../src/network/q3/state/entity.ts";
import type { Snapshot } from "../../../src/network/q3/server-message.ts";

function fixture(clientNumber = 0) {
  const identities = createIdentityOwner("local qvm state"), applied: string[] = [];
  const client = new LocalQ3ClientState({ kind: "gamestate", commandSequence: 0, clientNumber, checksumFeed: 0,
    entries: [{ kind: "configstring", index: 7, value: "before" }] }, {
    assertCurrent() {}, actorAt: number => identities.actor(number, 0),
    systemInfo: info => { applied.push(info); }, mapRestart() {}, levelShot() {}, print() {},
  });
  const player = new PlayerStateRecord("baseq3", 0, 2, 0), entity = new EntityStateRecord(0);
  entity.number = 3; entity.modelindex = 4;
  const snapshot = (messageNumber: number): Snapshot => ({ messageNumber, serverTime: messageNumber * 50,
    deltaNumber: -1, flags: 0, serverCommandNumber: client.serverCommandSequence, parseEntitiesNumber: 0,
    playerState: player, entities: [entity], areaMask: new Uint8Array(32) });
  return { client, player, entity, snapshot, applied };
}

test("local cgame sees configstrings only through ordered server-command traps", async () => {
  const { client, snapshot, applied } = fixture();
  client.receiveServerCommand(1, 'cs 7 "after"');
  client.receiveServerCommand(2, 'cs 1 "\\sv_serverid\\42"');
  client.receiveSnapshot(snapshot(1));
  expect(client.source.getGameState()[7]).toBe("before");
  expect(applied).toEqual([]);
  expect(await client.getServerCommand(1)).toEqual(["cs", "7", "after"]);
  expect(client.source.getGameState()[7]).toBe("after");
  expect(await client.getServerCommand(2)).toEqual(["cs", "1", "\\sv_serverid\\42"]);
  expect(applied).toEqual(["\\sv_serverid\\42"]);
  expect(client.lastExecutedServerCommand).toBe(2);
});

test("local seats own detached snapshots, pings and usercmds with source retention limits", () => {
  const a = fixture(), b = fixture(1);
  a.client.receiveSnapshot(a.snapshot(1), 12); b.client.receiveSnapshot(b.snapshot(1));
  a.entity.modelindex = 99; a.player.commandTime = 88;
  expect(a.client.source.read(1)?.entities[0]?.modelindex).toBe(4);
  expect(a.client.source.read(1)?.playerState.commandTime).toBe(0);
  expect(a.client.snapshotPing(1)).toBe(12); expect(b.client.snapshotPing(1)).toBe(0);
  a.client.commands.append({ serverTime: 50, angles: [1, 2, 3], buttons: 1, weapon: 2, forwardmove: 127, rightmove: 0, upmove: 0 });
  expect(a.client.source.commands.read(1)?.angles).toEqual({ x: 1, y: 2, z: 3 });
  expect(b.client.commands.currentNumber).toBe(0);
  for (let i = 2; i <= 33; i++) a.client.receiveSnapshot(a.snapshot(i));
  expect(a.client.source.read(1)).toBeNull(); expect(a.client.snapshotPing(1)).toBeNull();
  expect(b.client.source.read(1)).not.toBeNull();
  expect(() => a.client.source.read(34)).toThrow("snapshotNumber");
});

test("local reliable fragments, restart, overflow and retirement follow client ownership", async () => {
  const { client } = fixture();
  client.commands.append({ serverTime: 50, angles: [1, 2, 3], buttons: 1, weapon: 2, forwardmove: 127, rightmove: 0, upmove: 0 });
  client.receiveServerCommand(1, 'bcs0 7 "first"'); client.receiveServerCommand(2, 'bcs1 7 "second"'); client.receiveServerCommand(3, 'bcs2 7 "third"');
  expect(await client.getServerCommand(1)).toBeNull(); expect(await client.getServerCommand(2)).toBeNull();
  expect(client.source.getGameState()[7]).toBe("before");
  expect(await client.getServerCommand(3)).toEqual(["cs", "7", "firstsecondthird"]);
  client.receiveServerCommand(4, "map_restart"); await client.getServerCommand(4);
  expect(client.commands.currentNumber).toBe(1); expect(client.commands.read(1)?.serverTime).toBe(0);
  for (let i = 5; i <= 68; i++) client.receiveServerCommand(i, "print hello");
  await expect(client.getServerCommand(4)).rejects.toThrow("cycled out");
  await expect(client.getServerCommand(69)).rejects.toThrow("not received");
  const generation = client.generation; client.retire(); client.retire();
  expect(client.generation).toBe(generation + 1);
  expect(() => client.source.getGameState()).toThrow("retired gamestate");
  await expect(client.getServerCommand(68)).rejects.toThrow("retired gamestate");
});

test("remote delivery uses the same deferred command executor and keeps its levelshot gate", async () => {
  const identities = createIdentityOwner("remote command execution"), updates: string[] = [];
  let restarts = 0, shots = 0;
  const connection = new Q3ClientConnection({ client: identities.client(0, 0), seat: null }, "baseq3", { kind: "network", challenge: 1, qport: 1 }, {
    assertCurrent() {}, print() {}, clearActive() {}, async systemInfo(info) { updates.push(info); }, async gamestate() {}, snapshot() {},
    downloadSize: size => size, async download() {}, mapRestart() { restarts++; }, levelShot() { shots++; }, localServerRunning: () => false,
  });
  connection.gameState.beginEntries(); connection.gameState.append(7, "before");
  const commands = ['bcs0 7 "first"', 'bcs2 7 "last"', 'cs 1 "\\sv_serverid\\42"', "map_restart", "clientLevelShot", 'disconnect "bye"'];
  const message = encodeServerMessage(0, commands.map((text, index) => ({ kind: "command", sequence: index + 1, text })), {
    product: "baseq3", messageNumber: 1, reliableSequence: 0, serverCommandSequence: 0, parseEntitiesNumber: 0, baseline: () => null, history: () => null,
  });
  await connection.receiveMessage(1, message, 0);
  expect(connection.gameState.get(7)).toBe("before"); expect(updates).toEqual([]);
  expect(await connection.getServerCommand(1)).toBeNull();
  expect(await connection.getServerCommand(2)).toEqual(["cs", "7", "firstlast"]);
  expect(connection.gameState.get(7)).toBe("firstlast");
  await connection.getServerCommand(3); expect(updates).toEqual(["\\sv_serverid\\42"]); expect(connection.serverId).toBe(42);
  await connection.getServerCommand(4); expect(restarts).toBe(1);
  expect(await connection.getServerCommand(5)).toBeNull(); expect(shots).toBe(0);
  await expect(connection.getServerCommand(6)).rejects.toThrow("bye");
});
