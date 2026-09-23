import { expect, test } from "bun:test";
import { QvmModProvider } from "../../../src/compat/qvm/mod-provider.ts";
import { resolveQvmArtifact } from "../../../src/compat/qvm/artifacts.ts";
import { QvmOpcode } from "../../../src/compat/qvm/image.ts";
import { BinaryWriter } from "../../../src/core/binary/index.ts";
import { digestBytes } from "../../../src/content/mounts/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { ModHostServices } from "../../../src/world/session/mods.ts";
import type { QvmModCallbackDeclaration } from "../../../src/contracts/qvm-mod-callbacks.ts";
import type { ModCallbackInput, ModRuntimeValue } from "../../../src/contracts/mod-callbacks.ts";
import { ActorCallbackTable, SessionActorRegistry } from "../../../src/world/actors/index.ts";
import { SharedBodyTable, translatedBodyBounds } from "../../../src/world/actors/body.ts";
import { GameplayAuthority } from "../../../src/world/gameplay/authority.ts";
import { SharedInventoryTable } from "../../../src/world/gameplay/inventory.ts";
import { SharedOriginalPickupAdmission } from "../../../src/world/gameplay/original-pickups.ts";

async function fixture() {
  const instructions: readonly (readonly [QvmOpcode, number?])[] = [
    [QvmOpcode.OP_ENTER, 8], [QvmOpcode.OP_CONST, 0], [QvmOpcode.OP_LEAVE, 8],
    [QvmOpcode.OP_ENTER, 8], [QvmOpcode.OP_CONST, 64], [QvmOpcode.OP_CONST, 10], [QvmOpcode.OP_STORE4],
    [QvmOpcode.OP_CONST, 68], [QvmOpcode.OP_CONST, 68], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_CONST, 1], [QvmOpcode.OP_ADD], [QvmOpcode.OP_STORE4],
    [QvmOpcode.OP_CONST, 1], [QvmOpcode.OP_LEAVE, 8],
    [QvmOpcode.OP_ENTER, 8], [QvmOpcode.OP_CONST, 72], [QvmOpcode.OP_CONST, 77], [QvmOpcode.OP_STORE4],
    [QvmOpcode.OP_CONST, 68], [QvmOpcode.OP_CONST, 40], [QvmOpcode.OP_STORE4], [QvmOpcode.OP_CONST, 0], [QvmOpcode.OP_LEAVE, 8],
  ];
  const code = new BinaryWriter(256);
  for (const [opcode, operand] of instructions) { code.u8(opcode); if (operand !== undefined) code.i32(operand); }
  const bytes = code.finish(), output = new BinaryWriter(32 + bytes.length);
  for (const word of [0x12721444, instructions.length, 32, bytes.length, 32 + bytes.length, 0, 0, 135168]) output.i32(word);
  output.bytes(bytes); const program = output.finish(), module = { id: "mod:compound", artifactPath: "vm/qagame.qvm", digest: digestBytes(program), revision: "test" } satisfies import("../../../src/contracts/execution.ts").ModuleIdentity;
  const artifact = resolveQvmArtifact({ module, role: "qagame", bytes: program, abiProfile: "q3-modern" });
  if (artifact.kind !== "bytecode") throw new Error("Missing source program");
  const identity = createIdentityOwner("compound-qvm"), actors = new SessionActorRegistry(identity), target = actors.allocate("q1:world", "q1:player"), pickup = actors.allocate("q1:world", "q1:pickup"), client = identity.client(0, 0);
  const callbacks = new ActorCallbackTable(actors), combat = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined });
  const inventory = new SharedInventoryTable(actors); inventory.create(target, [{ item: "test:first", count: 0, capacity: 100 }, { item: "test:second", count: 0, capacity: 100 }, { item: "test:third", count: 0, capacity: 100 }]);
  const services: ModHostServices = { actors, callbacks, combat, inventory, seed: 1, time: () => ({ kind: "seconds", value: 1 }),
    bodies: new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined }), clients: {
      maximum: 1, clients: () => [{ actor: target.id, client }], forActor: actor => actor.equals(target.id) ? client : null, actor: current => current.equals(client) ? target.id : null,
      userinfo: () => "", setUserinfo: () => {}, command: () => null, drop: () => {}, subscribe: () => () => undefined, subscribeApplication: () => () => undefined,
    } };
  const declaration: QvmModCallbackDeclaration = { version: 1, runtime: "qvm", program: { path: module.artifactPath, digest: module.digest }, abiProfile: "q3-modern", entityRecord: "entity",
    actorRecords: [{ id: "entity", address: 64, stride: 12, capacity: 2, fields: [{ binding: "inventory", offset: 0, encoding: "int32", item: "test:first" }, { binding: "inventory", offset: 4, encoding: "int32", item: "test:second" }, { binding: "inventory", offset: 8, encoding: "int32", item: "test:third" }] },
      { id: "player", address: 128, stride: 468, capacity: 1, fields: [{ binding: "private", offset: 0, byteLength: 468 }] }],
    clients: { maximum: 1, records: ["player"], playerStateRecord: "player", admit: [], userinfo: [], disconnect: [] }, initialize: [], callbacks: [],
    pickups: [{ id: "compound", offered: ["q1:pickup"], writes: [{ kind: "inventory", item: "test:first", fields: "count" }, { kind: "inventory", item: "test:second", fields: "count" }], context: [],
      operation: { kind: "boolean-grant", grant: { entry: 3, arguments: [], globals: [], returns: "int32" } } }],
  };
  const source = new QvmModProvider(artifact, declaration, services, () => {}, "q3:classic:compound:test");
  await source.initialize(); source.activateProtection(); const admission = new SharedOriginalPickupAdmission(actors, combat, inventory);
  let completed = 0;
  return { source, inventory, target, take: () => admission.touch({ recipient: target.id, pickup: pickup.id, source: "q1:world", item: "q1:pickup", defaultResource: null,
    count: { kind: "default" }, dropped: false, time: services.time() }, { original: () => { throw new Error("Unexpected fallback"); }, complete: () => { completed++; } }),
    completed: () => completed, close: () => { source.close(); actors.close(); } };
}

test("QVM pickup committed observers update a later source operand before original code reads it", async () => {
  const f = await fixture();
  const remove = f.inventory.operations.configure.register({ provider: "test:observer", id: "test:nested", order: 0, kind: "observe", observe: ([actor, entry]) => {
    if (actor === f.target && entry.item === "test:first") {
      f.source.invoke({ entry: 15, arguments: [], globals: [], returns: "void" }, new Map<ModCallbackInput, ModRuntimeValue>());
      expect(f.inventory.count(actor.id, "test:third")).toBe(77);
    }
    return undefined;
  } });
  try { expect(f.take()).toBe("accepted"); expect(f.inventory.count(f.target.id, "test:second")).toBe(41); expect(f.completed()).toBe(1); }
  finally { remove(); f.close(); }
});

test("QVM pickup publication failure leaves committed bytes and never flushes or replays the queued grant", async () => {
  const f = await fixture(), failure = new Error("read-only publication failed");
  const remove = f.source.module.memory.observeWrites([{ byteOffset: 64, byteLength: 4 }], event => { if (event.ranges[0]?.after[0] === 10) throw failure; return undefined; });
  try {
    expect(() => f.take()).toThrow(failure); expect(f.inventory.count(f.target.id, "test:first")).toBe(0); expect(f.inventory.count(f.target.id, "test:second")).toBe(0);
    expect(f.source.module.memory.dataView(64, 4).getInt32(0, true)).toBe(10); expect(f.completed()).toBe(0);
    remove(); expect(f.take()).toBe("accepted"); expect(f.inventory.count(f.target.id, "test:first")).toBe(10); expect(f.inventory.count(f.target.id, "test:second")).toBe(1);
  } finally { remove(); f.close(); }
});
