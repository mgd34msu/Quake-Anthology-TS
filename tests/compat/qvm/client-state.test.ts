import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { HistorySnapshotSource } from "../../../src/content/q3/presentation/snapshots.ts";
import { Q3ClientConnection } from "../../../src/network/q3/client.ts";
import { PlayerStateRecord } from "../../../src/network/q3/state/player.ts";
import { EntityStateRecord } from "../../../src/network/q3/state/entity.ts";
import type { Snapshot } from "../../../src/network/q3/server-message.ts";
import { QvmCgameImport } from "../../../src/compat/qvm/abi.ts";
import { QvmMemory } from "../../../src/compat/qvm/memory.ts";
import { qvmClientStateSyscall } from "../../../src/compat/qvm/client-state-syscalls.ts";
import type { QvmClientStateServices } from "../../../src/compat/qvm/client-state-syscalls.ts";
import type { QvmHostCall } from "../../../src/compat/qvm/syscalls.ts";

function fixture() {
  const owner = createIdentityOwner("QVM state traps");
  const connection = new Q3ClientConnection({ client: owner.client(0, 0), seat: null }, "baseq3", { kind: "network", challenge: 1, qport: 1 }, {
    assertCurrent() {}, print() {}, clearActive() {}, async systemInfo() {}, async gamestate() {}, snapshot() {},
    downloadSize: size => size, async download() {}, mapRestart() {}, levelShot() {}, localServerRunning: () => false,
  });
  const guest = new QvmMemory(new Uint8Array(131072));
  const selection: number[] = [];
  const services: QvmClientStateServices = { connection,
    snapshots: new HistorySnapshotSource(connection.history, () => connection.parseEntities.number, () => {}),
    snapshotPing: () => 37, getServerCommand: number => connection.getServerCommand(number),
    setUserCommandValue: (weapon, sensitivity) => { selection.push(weapon, sensitivity); },
  };
  const call = (code: QvmCgameImport, args: readonly number[] = []): QvmHostCall => {
    const words = new DataView(new ArrayBuffer(4 + args.length * 4)); words.setInt32(0, code, true);
    args.forEach((word, index) => words.setInt32(4 + index * 4, word, true));
    return { kind: "engine", role: "cgame", code, words, guest, memory: guest.bytes, commandArguments: null,
      cancelFunction: (): never => { throw new Error("Unexpected source cancellation"); },
      invoke: (): never => { throw new Error("Unexpected reentry"); }, invokeAsync: async (): Promise<number> => { throw new Error("Unexpected reentry"); } };
  };
  return { connection, guest, services, call, selection };
}

test("QVM copies actual source gameState allocation and user command ring", () => {
  const f = fixture();
  f.connection.gameState.beginEntries(); f.connection.gameState.append(7, "same"); f.connection.gameState.append(8, "same");
  const source = f.connection.gameState.copySourceRecord();
  expect(qvmClientStateSyscall(f.call(QvmCgameImport.CG_GETGAMESTATE, [8]), f.services)).toBe(0);
  expect(f.guest.view(8, 20100).getInt32(20096, true)).toBe(source.dataCount);
  expect(f.guest.span(8, 16000, 4096)).toEqual(source.stringData);
  expect(Array.from({ length: 1024 }, (_, index) => f.guest.view(8, 4096).getInt32(index * 4, true))).toEqual(Array.from(source.stringOffsets));
  f.connection.commands.append({ serverTime: 4242, angles: [65537, -65538, 7], buttons: 257, weapon: 8, forwardmove: -127, rightmove: 126, upmove: -5 });
  expect(qvmClientStateSyscall(f.call(QvmCgameImport.CG_GETCURRENTCMDNUMBER), f.services)).toBe(1);
  expect(qvmClientStateSyscall(f.call(QvmCgameImport.CG_GETUSERCMD, [1, 22000]), f.services)).toBe(1);
  const command = f.guest.view(22000, 24);
  expect(command.getInt32(4, true)).toBe(65537); expect(command.getInt32(8, true)).toBe(-65538);
  expect(command.getInt8(21)).toBe(-127); expect(command.getUint8(20)).toBe(8);
  expect(() => qvmClientStateSyscall(f.call(QvmCgameImport.CG_GETUSERCMD, [2, 22000]), f.services)).toThrow("future command");
  expect(qvmClientStateSyscall(f.call(QvmCgameImport.CG_GETUSERCMD, [-63, 22000]), f.services)).toBe(0);
  const selection = f.call(QvmCgameImport.CG_SETUSERCMDVALUE, [9, 0]); selection.words.setFloat32(8, 0.375, true);
  qvmClientStateSyscall(selection, f.services); expect(f.selection).toEqual([9, 0.375]);
});

test("QVM snapshot uses retained parse entities, preserves untouched ABI slots, and expires with source history", () => {
  const f = fixture(), ps = new PlayerStateRecord("baseq3", 0, 2, 0), entity = new EntityStateRecord(0);
  ps.commandTime = 150; ps.ping = 99; ps.entityEventSequence = 123; ps.ammo.set(15, 75);
  entity.number = 5; entity.modelindex = 12;
  f.connection.parseEntities.at(0).copyFrom(entity); f.connection.parseEntities.advance();
  const snapshot: Snapshot = { messageNumber: 1, serverTime: 200, deltaNumber: -1, flags: 4, serverCommandNumber: 17,
    parseEntitiesNumber: 0, areaMask: new Uint8Array(32), playerState: ps, entities: [entity] };
  f.connection.history.publish({ kind: "snapshot", validity: { kind: "valid" }, snapshot });
  expect(qvmClientStateSyscall(f.call(QvmCgameImport.CG_GETCURRENTSNAPSHOTNUMBER, [60000, 60004]), f.services)).toBe(0);
  expect(f.guest.view(60000, 8).getInt32(0, true)).toBe(1); expect(f.guest.view(60000, 8).getInt32(4, true)).toBe(200);
  f.connection.parseEntities.at(0).modelindex = 19;
  f.guest.span(8, 53772).fill(0x5a);
  const stores: { offset: number; length: number }[] = [];
  const close = f.guest.observeWrites([
    { byteOffset: 20, byteLength: 32 }, { byteOffset: 52, byteLength: 4 }, { byteOffset: 684, byteLength: 4 },
  ], event => {
    for (const range of event.ranges) stores.push({ offset: range.byteOffset, length: range.after.length });
  });
  expect(qvmClientStateSyscall(f.call(QvmCgameImport.CG_GETSNAPSHOT, [1, 8]), f.services)).toBe(1);
  expect(stores).toEqual([{ offset: 20, length: 32 }, { offset: 52, length: 4 }, { offset: 684, length: 4 }]);
  close();
  const view = f.guest.view(8, 53772);
  expect(view.getInt32(4, true)).toBe(37); expect(view.getInt32(44 + 452, true)).toBe(99);
  expect(view.getInt32(44 + 464, true)).toBe(123); expect(view.getInt32(44 + 436, true)).toBe(75);
  expect(view.getInt32(516 + 160, true)).toBe(19);
  expect(view.getInt32(724, true)).toBe(0x5a5a5a5a); expect(view.getInt32(53764, true)).toBe(0x5a5a5a5a);
  expect(view.getInt32(53768, true)).toBe(17);
  expect(() => qvmClientStateSyscall(f.call(QvmCgameImport.CG_GETSNAPSHOT, [2, 8]), f.services)).toThrow("snapshotNumber");
  expect(() => qvmClientStateSyscall(f.call(QvmCgameImport.CG_GETSNAPSHOT, [1, 100000]), f.services)).toThrow("allocation");
  for (let index = 1; index < 2048; index++) f.connection.parseEntities.advance();
  expect(qvmClientStateSyscall(f.call(QvmCgameImport.CG_GETSNAPSHOT, [1, 8]), f.services)).toBe(0);
});

test("QVM server command trap awaits its owner before reporting argv availability", async () => {
  const f = fixture(), order: string[] = [];
  const services: QvmClientStateServices = { ...f.services, async getServerCommand(number) {
    order.push(`start ${number}`); await Promise.resolve(); order.push("install argv"); return ["cs", "7", "updated"];
  } };
  expect(order).toEqual([]);
  const result = qvmClientStateSyscall(f.call(QvmCgameImport.CG_GETSERVERCOMMAND, [7]), services);
  expect(order).toEqual(["start 7"]); expect(await result).toBe(1); expect(order).toEqual(["start 7", "install argv"]);
});
