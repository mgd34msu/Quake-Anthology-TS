// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import type { TraceHit } from "../../../../src/contracts/scene.ts";
import { createContentDigest } from "../../../../src/contracts/content.ts";
import type { GuestAddress, GuestCallValue, ModuleIdentity } from "../../../../src/contracts/execution.ts";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import { CvarRegistry } from "../../../../src/core/cvars/index.ts";
import { GuestCallRunner } from "../../../../src/guest/abi/index.ts";
import { createGuestProcessorState, GuestCallbackTable, SparseGuestMemory } from "../../../../src/guest/core/index.ts";
import { X64Cpu } from "../../../../src/guest/x64/index.ts";
import { ActorCallbackTable, SessionActorRegistry, SharedBodyTable, translatedBodyBounds } from "../../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable } from "../../../../src/world/gameplay/index.ts";
import { cgameExportLayout, edictLayout, fieldOffset, gameExportLayout, gameImportLayout, gameImports, guestInt, guestPointer, privateClientPrefixLayout, RereleaseQ2GuestHost, RereleaseSourceClient, RereleaseSourceEdict, sourceRereleaseClientProfile } from "../../../../src/compat/q2/rerelease/index.ts";

function unavailable(): never { throw new Error("This binding check does not provide gameplay, assets or transport"); }
function stateFixture(budgets: { readonly instructionBudget?: number; readonly loadingInstructionBudget?: number } = {}, registry?: SessionActorRegistry) {
  const module: ModuleIdentity = { id: "test:rr-bindings", artifactPath: "authored-abi-bytes", revision: "1", digest: createContentDigest("58".repeat(32)) };
  const memory = new SparseGuestMemory({ module, pointerBytes: 8 });
  const callbacks = new GuestCallbackTable(memory);
  const stack = memory.allocate({ byteLength: 65536 });
  const returned = memory.allocate({ byteLength: 16, permissions: "read-execute" });
  const cpu = new X64Cpu({ memory, state: createGuestProcessorState({ architecture: "x86-64", instructionPointer: 0n, stackPointer: stack.byteOffset + 65536n, flags: 2n, x87ControlWord: 0x37f, mxcsr: 0x1f80, mxcsrMask: 0xffff }), isHostCall: address => callbacks.resolve(address) !== null });
  const runner = new GuestCallRunner({ cpu, callbacks, returnAddress: returned });
  const edicts = memory.allocate({ byteLength: 3688 * 3, alignment: 8n });
  const game = memory.allocate({ byteLength: gameExportLayout.byteLength, alignment: 8n });
  memory.writeInt32(game, 2023); memory.writePointer(memory.offset(game, 160n), edicts); memory.writeUint64(memory.offset(game, 168n), 3688n);
  memory.writeUint32(memory.offset(game, 176n), 3); memory.writeUint32(memory.offset(game, 180n), 3);
  const cgame = memory.allocate({ byteLength: cgameExportLayout.byteLength, alignment: 8n }); memory.writeInt32(cgame, 2022);
  const code = (bytes: Uint8Array): GuestAddress => { const address = memory.allocate({ byteLength: bytes.length }); memory.write(address, bytes); memory.protect(address, bytes.length, "read-execute"); return address; };
  const getter = (address: GuestAddress): GuestAddress => { const bytes = new Uint8Array(11); bytes.set([0x48, 0xb8]); new DataView(bytes.buffer).setBigUint64(2, address.byteOffset, true); bytes[10] = 0xc3; return code(bytes); };
  const actors = registry ?? new SessionActorRegistry(createIdentityOwner("native-body-bindings"));
  const actorCallbacks = new ActorCallbackTable(actors);
  const links: string[] = [];
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: value => { links.push(`link:${value.actor.slot}`); return undefined; }, onUnlink: value => { links.push(`unlink:${value.slot}`); return undefined; } });
  const combat = new GameplayAuthority(actors, actorCallbacks, { impulse: unavailable, beforeReaction: unavailable, confirmed: unavailable });
  const inventory = new SharedInventoryTable(actors);
  const cvars = new CvarRegistry({ dialect: "q2-rerelease", context: { session: actors.session, origin: { kind: "server-console" } } });
  const host = new RereleaseQ2GuestHost({ ...budgets, runner, getGameApi: getter(game), getCgameApi: getter(cgame),
    engine: { actors, callbacks: actorCallbacks, bodies, combat, inventory, trace: unavailable, pointContents: unavailable, setAreaPortal: unavailable, setSolid: () => undefined, inlineModelBounds: unavailable, worldActor: unavailable },
    services: { cvars, print: unavailable, getConfigstring: unavailable, setConfigstring: unavailable, resourceIndex: unavailable, serverFrame: () => 17, commandArguments: () => [], commandTail: () => "", addCommand: unavailable, extension: () => null },
    spatial: { areasConnected: unavailable, visibility: unavailable, surfaceId: unavailable, boxEdicts: () => actors.ownedBy(module.id).map(value => value.id), inlineModel: unavailable, linkMetadata: () => ({ area: 0, area2: 0, networkSolid: 0 }) },
    semantics: { generation: view => memory.readInt32(memory.offset(view.address, 1472n)), foreignAddress: unavailable,
      bind: (raw, _actor, guest) => { const source = new RereleaseSourceEdict(raw, guest); return { body: source.body({ actor: address => guest.entities().fromPointer(address).currentActor(), address: unavailable }), combat: null, inventory: null, powerArmorCells: null,
        callbacks: { think: null, touch: null, pain: null, die: null, use: () => { source.call("use", [guestPointer(null), guestPointer(null)]); return undefined; } } }; } },
  });
  const table = host.module.entities();
  const first = new RereleaseSourceEdict(table.atSlot(1), host.module), second = new RereleaseSourceEdict(table.atSlot(2), host.module);
  for (const source of [first, second]) { memory.writeUint8(source.at("shared.inuse"), 1); memory.writeInt32(source.at("spawn_count"), 1); }
  const invokeImport = (name: typeof gameImports[number]["name"], args: Parameters<RereleaseQ2GuestHost["module"]["invoke"]>[2]) => {
    const entry = gameImports.find(value => value.name === name);
    if (entry === undefined) throw new Error("Unknown test import");
    const address = memory.readPointer(memory.offset(host.module.gameImportAddress, BigInt(fieldOffset(gameImportLayout, name))));
    if (address === null) throw new Error("Missing test import trap");
    return host.module.invoke(address, entry.signature, args);
  };
  return { host, memory, runner, actors, actorCallbacks, bodies, first, second, invokeImport, code, links, cvars };
}

test("shared body and callbacks mutate live private bytes, retain link snapshots and replace source lifetimes", () => {
  const { host, memory, actors, actorCallbacks, bodies, first, invokeImport, code } = stateFixture();
  first.writeVector("shared.s.origin", { x: 1, y: 2, z: 3 }); first.writeVector("velocity", { x: 10, y: 20, z: 30 });
  first.writeVector("shared.mins", { x: -1, y: -2, z: -3 }); first.writeVector("shared.maxs", { x: 1, y: 2, z: 3 });
  memory.writeFloat32(first.at("shared.sv.velocity"), 999); first.health = 50;
  host.reconcile();
  const actor = actors.atSource(memory.module.id, 1);
  if (actor === null) throw new Error("Shared actor was not bound");
  expect(bodies.read(actor.id)?.velocity.x).toBe(10);
  invokeImport("linkentity", [guestPointer(first.raw.address)]);
  first.writeVector("shared.s.origin", { x: 100, y: 2, z: 3 });
  expect(bodies.read(actor.id)?.origin.x).toBe(100);
  expect(bodies.linked(actor.id)?.absoluteBounds.min.x).toBe(0);
  const state = bodies.read(actor.id);
  if (state === null) throw new Error("Missing source body");
  bodies.write(actor, { ...state, velocity: { x: 7, y: 8, z: 9 } });
  expect(memory.readFloat32(first.at("velocity"))).toBe(7);
  expect(memory.readFloat32(first.at("shared.sv.velocity"))).toBe(999);
  const increment = code(new Uint8Array([0xff, 0x81, 0x78, 0x07, 0, 0, 0xc3])); // INC [RCX+health=1912]
  memory.writePointer(first.at("use.value"), increment);
  expect(actorCallbacks.use(actor, null, null)).toBe(true);
  expect(first.health).toBe(51);
  memory.writeInt32(first.at("spawn_count"), 2); host.reconcile();
  expect(actors.isLive(actor.id)).toBe(false);
  expect(first.raw.currentActor()?.generation).not.toBe(actor.id.generation);
});

test("BoxEdicts synchronous filters return Keep/Skip/End and capacity zero counts without an output pointer", () => {
  const { host, memory, first, invokeImport, code } = stateFixture(); host.reconcile();
  const bounds = memory.allocate({ byteLength: 24 });
  const output = memory.allocate({ byteLength: 16 });
  const args = [guestPointer(bounds), guestPointer(memory.offset(bounds, 12n)), guestPointer(null), { kind: "uint64", value: 0n }, guestInt(1), guestPointer(null), guestPointer(null)] satisfies readonly [GuestCallValue, GuestCallValue, GuestCallValue, GuestCallValue, GuestCallValue, GuestCallValue, GuestCallValue];
  expect(invokeImport("BoxEdicts", args)).toEqual({ kind: "uint64", value: 2n });
  const end = code(new Uint8Array([0xb8, 64, 0, 0, 0, 0xc3]));
  expect(invokeImport("BoxEdicts", [args[0], args[1], guestPointer(output), { kind: "uint64", value: 2n }, guestInt(1), guestPointer(end), guestPointer(null)])).toEqual({ kind: "uint64", value: 1n });
  expect(memory.readPointer(output)?.byteOffset).toBe(first.raw.address.byteOffset);
  const skipEnd = code(new Uint8Array([0xb8, 65, 0, 0, 0, 0xc3]));
  expect(invokeImport("BoxEdicts", [args[0], args[1], guestPointer(null), { kind: "uint64", value: 0n }, guestInt(1), guestPointer(skipEnd), guestPointer(null)])).toEqual({ kind: "uint64", value: 0n });
});

test("source tag cleanup retires raw actors before a native level may reuse its same address", () => {
  const { host, memory, actors, first, invokeImport } = stateFixture(); host.reconcile();
  const previous = first.raw.currentActor(); if (previous === null) throw new Error("Missing first source lifetime");
  invokeImport("FreeTags", [guestInt(766)]);
  expect(actors.isLive(previous)).toBe(false);
  host.reconcile();
  expect(first.raw.currentActor()?.generation).not.toBe(previous.generation);
  expect(memory.readUint8(memory.offset(first.raw.address, BigInt(fieldOffset(edictLayout, "inuse"))))).toBe(1);
});

test("original source reconstruction retires saved edicts never materialized by the candidate", () => {
  const identity = createIdentityOwner("native-original-placeholders"), original = new SessionActorRegistry(identity);
  const world = original.allocateAtSource("q1:world", 0, "q1:worldspawn");
  const firstSaved = original.allocateAtSource("test:rr-bindings", 1, "q2-rerelease:native-edict");
  const secondSaved = original.allocateAtSource("test:rr-bindings", 2, "q2-rerelease:native-edict");
  const actors = SessionActorRegistry.restore(identity, original.checkpoint(), original.sourceCheckpoint());
  const restoredWorld = actors.resolveSaved(world.id), unseen = actors.resolveSaved(secondSaved.id);
  if (restoredWorld === null || unseen === null) throw new Error("Missing restored placeholders");
  const { host, first, second, invokeImport } = stateFixture({}, actors);
  try {
    host.actor(first.raw);
    expect(() => actors.rebindRestoredSource("test:rr-bindings")).toThrow("not been retired");
    invokeImport("FreeTags", [guestInt(766)]);
    expect(actors.isLive(unseen.id)).toBe(false);
    expect(actors.resolveSaved(firstSaved.id)).toBeNull(); expect(actors.resolveSaved(secondSaved.id)).toBeNull();
    expect(actors.isLive(restoredWorld.id)).toBe(true);
    host.reconcile(); actors.rebindRestoredSource("test:rr-bindings");
    expect(actors.resolveSaved(firstSaved.id)?.id ?? null).toBe(first.raw.currentActor());
    expect(actors.resolveSaved(secondSaved.id)?.id ?? null).toBe(second.raw.currentActor());
    expect(actors.resolveSaved(secondSaved.id)?.id.generation).not.toBe(unseen.id.generation);
    expect(actors.resolveSaved(world.id)).toBe(restoredWorld);
  } finally { host.shutdown(); }
  expect(actors.isLive(restoredWorld.id)).toBe(true);
});

test("power armor and shared inventory consume the same private client cells, preserving the server mirror", () => {
  const { host, memory, first, actors } = stateFixture();
  const address = memory.allocate({ byteLength: privateClientPrefixLayout.byteLength, alignment: 8n });
  const client = new RereleaseSourceClient(address, host.module, sourceRereleaseClientProfile);
  memory.writePointer(first.at("shared.client"), address);
  memory.writeInt32(memory.offset(client.at("pers.inventory"), 30n * 4n), 50);
  memory.writeInt16(memory.offset(client.at("pers.max_ammo"), 4n * 2n), 200);
  memory.writeInt32(memory.offset(first.at("shared.sv.inventory"), 30n * 4n), 999);
  host.reconcile();
  const actor = actors.atSource(memory.module.id, 1); if (actor === null) throw new Error("Missing inventory actor");
  const inventory = host.options.engine.inventory;
  inventory.bind(actor, client.inventory([{ item: "q2:cells", sourceIndex: 30, capacity: { kind: "ammo", sourceIndex: 4 } }]));
  expect(inventory.consume(actor, "q2:cells", 7)).toBe(true);
  const armor = client.powerArmorCells();
  expect(armor.read()).toBe(43);
  armor.write(armor.read() - 3);
  expect(inventory.count(actor.id, "q2:cells")).toBe(40);
  // p_weapon.cpp G_RemoveAmmo subtracts a source burst directly from int32.
  expect(inventory.adjustSourceCounter(actor, "q2:cells", -41)).toBe(-1);
  expect(armor.read()).toBe(-1);
  expect(memory.readInt32(memory.offset(first.at("shared.sv.inventory"), 30n * 4n))).toBe(999);
});

test("source info lookup compares exact keys and returns full byte length after bounded copying", () => {
  const { host, memory, invokeImport } = stateFixture();
  const info = host.core.string("\\Name\\wrong-case\\name\\éabc\\name\\duplicate"), output = memory.allocate({ byteLength: 4 });
  memory.write(output, new Uint8Array([0xa7, 0xa7, 0xa7, 0xa7]));
  const result = invokeImport("Info_ValueForKey", [guestPointer(info), guestPointer(host.core.string("name")), guestPointer(output), { kind: "uint64", value: 2n }]);
  expect(result).toEqual({ kind: "uint64", value: 5n });
  expect(memory.copy(output, 4)).toEqual(new Uint8Array([0xc3, 0, 0xa7, 0xa7]));
  expect(invokeImport("Info_ValueForKey", [guestPointer(info), guestPointer(host.core.string("NAME")), guestPointer(null), { kind: "uint64", value: 0n }])).toEqual({ kind: "uint64", value: 0n });
});

test("rerelease loading resumes x64 lifecycle calls between pump slices and unwinds cancellation", async () => {
  const { host, memory, runner, code } = stateFixture({ instructionBudget: 1000, loadingInstructionBudget: 30_000 });
  const game = host.module.bindGame(), returned = code(new Uint8Array([0xc3]));
  const instructions = new Uint8Array(20_001).fill(0x90); instructions[20_000] = 0xc3;
  const expensive = code(instructions);
  for (const name of ["PreInit", "Shutdown"]) memory.writePointer(memory.offset(game, BigInt(fieldOffset(gameExportLayout, name))), returned);
  for (const name of ["Init", "SpawnEntities"]) memory.writePointer(memory.offset(game, BigInt(fieldOffset(gameExportLayout, name))), expensive);
  let pumps = 0;
  const pump = async (): Promise<void> => {
    pumps++; expect(runner.depth).toBe(1);
    expect(() => host.module.callGame("PreInit")).toThrow("suspended");
    await Promise.resolve();
  };
  expect(() => host.module.callGame("SpawnEntities", [guestPointer(null), guestPointer(null), guestPointer(null)])).toThrow("budget");
  expect(runner.depth).toBe(0);
  await host.initLoading(pump);
  await host.spawnEntitiesLoading("base1", "{}", "", pump);
  expect(pumps).toBe(2); expect(runner.depth).toBe(0);
  const cancellation = new Error("loading cancelled");
  await expect(host.spawnEntitiesLoading("base2", "{}", "", async () => { throw cancellation; })).rejects.toBe(cancellation);
  expect(runner.depth).toBe(0);
  await host.spawnEntitiesLoading("base2", "{}", "", pump);
  expect(pumps).toBe(3); host.shutdown();
});


test("native tagged strings expose aligned backing and release the complete owned allocation", () => {
  const { host, memory, invokeImport } = stateFixture();
  const before = memory.mappings().length;
  const result = invokeImport("TagMalloc", [{ kind: "uint64", value: 6n }, guestInt(766)]);
  if (result.kind !== "pointer" || result.value === null) throw new Error("Missing tag allocation");
  const address = result.value;
  memory.write(address, new TextEncoder().encode("hello\0"));
  expect(memory.copy(address, 16)).toEqual(new Uint8Array([104, 101, 108, 108, 111, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  expect(address.byteOffset % 4096n).toBe(0n);
  expect(memory.copy(memory.offset(address, 10n), 16)).toEqual(new Uint8Array(16));
  expect(() => memory.copy(address, 4097)).toThrow();
  invokeImport("TagFree", [guestPointer(address)]);
  expect(memory.mappings().length).toBe(before);
  expect(() => memory.copy(address, 1)).toThrow();
  expect(memory.copy(host.core.string("hello"), 16)[5]).toBe(0);
});


test("source traces return the actual world edict before the shared world is published", () => {
  const { host } = stateFixture();
  for (const hit of [{ kind: "none" }, { kind: "world", model: 0 }] satisfies readonly TraceHit[]) {
    const result = host.encodeTrace({ kind: "q2", fraction: 1, end: { x: 0, y: 0, z: 0 }, startSolid: false, allSolid: false,
      contact: { kind: "none" }, hit, contents: 0, surface: null, secondary: null,
      sourcePlane: { normal: { x: 0, y: 0, z: 0 }, distance: 0, type: 0, signbits: 0 } });
    if (result.kind !== "aggregate") throw new Error("Expected source trace aggregate");
    expect(new DataView(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength).getBigUint64(56, true)).toBe(host.module.entities().atSlot(0).address.byteOffset);
  }
});

 test("native JSON save yields independently of frame budget and frees its returned source buffer", async () => {
  const { host, memory, runner, code, invokeImport } = stateFixture({ instructionBudget: 1000, loadingInstructionBudget: 30_000 });
  const allocation = invokeImport("TagMalloc", [{ kind: "uint64", value: 3n }, guestInt(766)]);
  if (allocation.kind !== "pointer" || allocation.value === null) throw new Error("Missing source save allocation");
  const output = allocation.value;
  memory.write(output, new TextEncoder().encode("{}\0"));
  const instructions = new Uint8Array(20_018).fill(0x90);
  instructions.set([0x48, 0xc7, 0x02, 2, 0, 0, 0, 0x48, 0xb8], 20_000);
  new DataView(instructions.buffer).setBigUint64(20_009, output.byteOffset, true);
  instructions[20_017] = 0xc3;
  const game = host.module.bindGame();
  memory.writePointer(memory.offset(game, BigInt(fieldOffset(gameExportLayout, "WriteGameJson"))), code(instructions));
  const before = memory.mappings().length; let pumps = 0;
  const saved = await host.writeSaveLoading("game", false, async () => {
    pumps++; expect(runner.depth).toBe(1);
    expect(() => host.module.callGame("WriteGameJson")).toThrow("suspended");
    await Promise.resolve();
  });
  expect(pumps).toBe(1); expect(runner.depth).toBe(0);
  expect(new TextDecoder().decode(saved.native)).toBe("{}");
  expect(memory.mappings().length).toBe(before - 1);
  expect(() => memory.copy(output, 1)).toThrow();
 });
