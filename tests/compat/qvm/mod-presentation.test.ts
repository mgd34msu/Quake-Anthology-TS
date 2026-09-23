import { expect, test } from "bun:test";
import { BinaryWriter } from "../../../src/core/binary/index.ts";
import { digestBytes } from "../../../src/content/mounts/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { ActorId } from "../../../src/contracts/identity.ts";
import type { ModuleIdentity } from "../../../src/contracts/execution.ts";
import type { Q3SourcePlayerEvent } from "../../../src/app/bootstrap/simulation/q3/types.ts";
import { QvmOpcode } from "../../../src/compat/qvm/image.ts";
import { resolveQvmArtifact } from "../../../src/compat/qvm/artifacts.ts";
import { QvmModPresentation } from "../../../src/compat/qvm/mod-presentation.ts";
import { QvmMemory } from "../../../src/compat/qvm/memory.ts";
import { readQvmPlayerState, readSourceQvmPlayerState, writeQvmPlayerState, writeSourceQvmPlayerState } from "../../../src/compat/qvm/player-record.ts";
import { writeQvmGameState, writeSourceQvmGameState } from "../../../src/compat/qvm/client-state-record.ts";
import { readQvmModPresentation } from "../../../src/content/mods/qvm-presentation.ts";
import { ClientGameStateStorage } from "../../../src/network/q3/game-state.ts";

function fixture() {
  const code = new BinaryWriter(128), operations: (readonly [QvmOpcode, number?])[] = [];
  for (let trap = 0; trap < 3; trap++) operations.push([QvmOpcode.OP_ENTER, 8], [QvmOpcode.OP_CONST, -1 - trap],
    [QvmOpcode.OP_CALL], [QvmOpcode.OP_POP], [QvmOpcode.OP_CONST, 0], [QvmOpcode.OP_LEAVE, 8]);
  for (const [opcode, operand] of operations) { code.u8(opcode); if (operand !== undefined) code.i32(operand); }
  const instructions = code.finish(), file = new BinaryWriter(32 + instructions.length);
  for (const value of [0x12721444, operations.length, 32, instructions.length, 32 + instructions.length, 0, 0, 131072]) file.i32(value);
  file.bytes(instructions); const bytes = file.finish(), digest = digestBytes(bytes);
  const source = { id: "mod:source", artifactPath: "vm/qagame.qvm", revision: "1", digest } satisfies ModuleIdentity;
  const artifact = resolveQvmArtifact({ role: "cgame", bytes, module: { ...source, id: "mod:source/cgame", artifactPath: "vm/cgame.qvm" } });
  if (artifact.kind !== "bytecode") throw new Error("Missing cgame fixture");
  const declaration = readQvmModPresentation(new TextEncoder().encode(JSON.stringify({ version: 1, runtime: "qvm-player-events",
    gameplay: { path: source.artifactPath, digest, abiProfile: "q3-modern" }, cgame: { path: artifact.module.artifactPath, digest, abiProfile: "q3-modern" },
    storage: { gameState: 0, playerState: 21000, snapshot: { kind: "synthetic-player-event", address: 22000, pointers: [78000] },
      centities: { address: 76000, stride: 800, capacity: 2, state: 0, origin: 708 }, time: [78004], frameTime: [78008], viewOrigin: [78012] },
    initialize: [{ entry: 0, arguments: [] }], refresh: [{ entry: 6, arguments: [] }], frame: [{ entry: 6, arguments: [] }], project: [],
    event: { entry: 12, arguments: [{ kind: "source", value: "centity" }, { kind: "source", value: "origin" }] } })));
  const ids = createIdentityOwner("source-presentation"), actor = ids.actor(7, 1);
  let currentActor: ActorId | null = actor, revision = 0, elapsed = 50;
  const raw = readSourceQvmPlayerState(new DataView(new ArrayBuffer(468)), "q3-modern");
  const state = new ClientGameStateStorage(message => { throw new Error(message); }); state.beginEntries(); state.append(20, "private");
  const calls: number[] = [];
  let effect: (() => void | Promise<void>) | undefined;
  const options = { artifact, source, declaration, context: () => ({ gameState: state.copySourceRecord(), gameStateRevision: revision,
    frameTimeMilliseconds: elapsed, viewOrigin: { x: 30, y: 40, z: 50 },
    snapshot: { serverTime: 1000, playerState: { ...raw, clientNumber: 0 } } }),
    actor: (slot: number) => slot === 1 ? currentActor : null, live: (candidate: ActorId) => currentActor !== null && candidate.equals(currentActor), assertCurrent: () => {},
    host: async (call: import("../../../src/compat/qvm/syscalls.ts").QvmHostCall) => {
      if (call.kind !== "engine") throw new Error("Unexpected intrinsic");
      calls.push(call.code);
      if (call.code === 1) expect(call.guest.dataView(21000 + 140, 4).getInt32(0, true)).toBe(0);
      if (call.code === 2) await effect?.();
      return 0;
    } };
  const make = () => new QvmModPresentation(options), owner = make();
  const event = (target = actor): Q3SourcePlayerEvent => ({ kind: "player-event", actor: target,
    source: { module: source, abiProfile: "q3-modern" }, playerState: { ...raw, clientNumber: 1 }, event: 349, parameter: 123,
    sequence: { kind: "external", time: 1000 }, origin: { x: 10, y: 20, z: 30 }, time: 1 });
  return { owner, make, options, declaration, ids, actor, event, calls, state,
    revise: () => { revision++; }, elapsed: (value: number) => { elapsed = value; }, replace: (value: ActorId | null) => { currentActor = value; }, effect: (value: () => void | Promise<void>) => { effect = value; } };
}

test("source presentation keeps target/viewer slots, revisions, generations and rebuild delivery cursor distinct", async () => {
  const f = fixture(), owner = f.owner;
  try {
    await owner.initialize(); await owner.consume(f.event(), 10); await owner.consume(f.event(), 10);
    expect(f.calls).toEqual([0, 2]);
    expect(readSourceQvmPlayerState(owner.module.memory.dataView(22044, 468), "q3-modern").clientNumber).toBe(0);
    expect(readSourceQvmPlayerState(owner.module.memory.dataView(21000, 468), "q3-modern").clientNumber).toBe(1);
    const entity = owner.module.memory.dataView(76800, 800);
    expect([entity.getInt32(180, true), entity.getInt32(184, true), entity.getFloat32(708, true)]).toEqual([349, 123, 10]);
    f.revise(); await owner.consume(f.event(), 11); await owner.consume(f.event(), 12);
    expect(f.calls).toEqual([0, 2, 1, 2, 2]);
    entity.setInt32(500, 99, true); owner.release(f.actor);
    const replacement = f.ids.actor(7, 2); f.replace(replacement);
    await owner.consume(f.event(), 13); expect(f.calls).toHaveLength(5);
    await owner.consume(f.event(replacement), 14); expect(entity.getInt32(500, true)).toBe(0);
    const cursor = owner.lastSequence; owner.close();
    const rebuilt = f.make();
    try {
      await rebuilt.initialize(cursor); const before = f.calls.length;
      await rebuilt.consume(f.event(replacement), cursor); expect(f.calls).toHaveLength(before);
      await rebuilt.consume(f.event(replacement), cursor + 1); expect(f.calls).toHaveLength(before + 1);
    } finally { rebuilt.close(); }
  } finally { owner.close(); }
});

test("source presentation consumes partial failure and rejects unknown original layouts before execution", async () => {
  const f = fixture();
  try {
    expect(() => new QvmModPresentation({ ...f.options, source: { ...f.options.source, artifactPath: "wrong.qvm" } })).toThrow("artifacts");
    expect(() => new QvmModPresentation({ ...f.options, declaration: { ...f.declaration, event: { entry: 1, arguments: [] } } })).toThrow("entry");
    expect(() => new QvmModPresentation({ ...f.options, declaration: { ...f.declaration,
      storage: { ...f.declaration.storage, playerState: 22044 } } })).toThrow("separate");
    await f.owner.initialize(); f.effect(() => { throw new Error("original effect failed"); });
    await expect(f.owner.consume(f.event(), 1)).rejects.toThrow("original effect failed");
    expect(f.owner.lastSequence).toBe(1);
    await expect(f.owner.consume(f.event(), 1)).rejects.toThrow("failed");
    expect(f.calls).toEqual([0, 2]);
  } finally { f.owner.close(); }
});

test("source presentation rechecks target lifetime after an asynchronous original trap", async () => {
  const f = fixture();
  try {
    await f.owner.initialize();
    f.effect(async () => { await Promise.resolve(); f.replace(null); });
    await f.owner.consume(f.event(), 1); expect(f.owner.lastSequence).toBe(1);
    f.replace(f.actor); f.effect(() => {});
    await f.owner.consume(f.event(), 2); expect(f.calls).toEqual([0, 2, 2]);
  } finally { f.owner.close(); }
});

test("source presentation advances original frame calls once with current camera and zero paused elapsed", async () => {
  const f = fixture();
  try {
    await f.owner.initialize(); await f.owner.advance(1); await f.owner.advance(1);
    expect(f.calls).toEqual([0, 1]);
    expect(f.owner.module.memory.dataView(78008, 4).getInt32(0, true)).toBe(50);
    expect(f.owner.module.memory.dataView(78012, 4).getFloat32(0, true)).toBe(30);
    f.elapsed(0); await f.owner.advance(2);
    expect(f.calls).toEqual([0, 1, 1]); expect(f.owner.module.memory.dataView(78008, 4).getInt32(0, true)).toBe(0);
  } finally { f.owner.close(); }
});

test("raw original player/configstring writers preserve legacy private values while normalized writers retain translation", () => {
  const view = new DataView(new ArrayBuffer(444)), raw = readSourceQvmPlayerState(view, "q3-1.16n-base");
  const powerups = [...raw.powerups]; powerups[12] = 12345;
  const persistent = [...raw.persistent]; persistent[5] = 123; persistent[7] = 17;
  const original = { ...raw, externalEvent: 69 | 256, powerups, persistent };
  writeSourceQvmPlayerState(view, original, "q3-1.16n-base");
  expect(readSourceQvmPlayerState(view, "q3-1.16n-base")).toEqual(original);
  expect(() => readQvmPlayerState(view, "q3-1.16n-base")).toThrow("event");
  writeSourceQvmPlayerState(view, { ...raw, externalEvent: 61 | 256, persistent }, "q3-1.16n-base");
  const normalized = readQvmPlayerState(view, "q3-1.16n-base");
  expect(normalized.externalEvent).toBe(63 | 256); expect(normalized.persistent[6]).toBe(17);
  writeQvmPlayerState(view, normalized, "q3-1.16n-base");
  expect(view.getInt32(128, true)).toBe(61 | 256); expect(view.getInt32(248 + 5 * 4, true)).toBe(0);
  const state = new ClientGameStateStorage(message => { throw new Error(message); }); state.beginEntries(); state.append(20, "private");
  const memory = new QvmMemory(new Uint8Array(65536));
  writeSourceQvmGameState(memory, memory.dataView(0, 20100), state.copySourceRecord());
  expect(memory.dataView(80, 4).getInt32(0, true)).toBe(1);
  writeQvmGameState(memory, memory.dataView(0, 20100), state.copySourceRecord(), "q3-1.16n-base");
  expect(memory.dataView(80, 4).getInt32(0, true)).toBe(0); expect(memory.dataView(48, 4).getInt32(0, true)).toBe(1);
});
