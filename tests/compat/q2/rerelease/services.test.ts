import { expect, test } from "bun:test";
import { createContentDigest } from "../../../../src/contracts/content.ts";
import type { GuestAddress, GuestFieldLayout, GuestLayout, ModuleIdentity } from "../../../../src/contracts/execution.ts";
import { CvarRegistry } from "../../../../src/core/cvars/index.ts";
import { createNumericOperations, Q2_DONOR_PROFILE } from "../../../../src/core/numeric.ts";
import { GuestCallRunner } from "../../../../src/guest/abi/index.ts";
import { createGuestProcessorState, GuestCallbackTable, SparseGuestMemory } from "../../../../src/guest/core/index.ts";
import { X64Cpu } from "../../../../src/guest/x64/index.ts";
import { cgameExportLayout, edictLayout, fieldOffset, gameExportLayout, gameImportLayout, gameImports, guestInt, guestPointer, RereleaseQ2GuestHost } from "../../../../src/compat/q2/rerelease/index.ts";
import { clientLayout } from "../../../../src/compat/q2/rerelease/layouts.ts";
import { RereleasePublicEdict } from "../../../../src/compat/q2/rerelease/public-state.ts";
import { RereleaseGuestServices } from "../../../../src/app/bootstrap/simulation/rerelease-guest-services.ts";
import { readGuestString } from "../../../../src/compat/q2/rerelease/imports.ts";
import { nativeWorld } from "./world.ts";

test("API2023 services retain public records, ordered native messages and exact unlinked clip target", async () => {
  let services: RereleaseGuestServices | null = null;
  const world = await nativeWorld(index => services?.resource("model", index));
  const module: ModuleIdentity = { id: "test:rr-public-services", artifactPath: "authored-public-api", revision: "1", digest: createContentDigest("92".repeat(32)) };
  const memory = new SparseGuestMemory({ module, pointerBytes: 8 }), callbacks = new GuestCallbackTable(memory);
  const stack = memory.allocate({ byteLength: 65536 }), returned = memory.allocate({ byteLength: 16, permissions: "read-execute" });
  const cpu = new X64Cpu({ memory, state: createGuestProcessorState({ architecture: "x86-64", instructionPointer: 0n, stackPointer: stack.byteOffset + 65536n, flags: 2n, x87ControlWord: 0x37f, mxcsr: 0x1f80, mxcsrMask: 0xffff }), isHostCall: address => callbacks.resolve(address) !== null });
  const runner = new GuestCallRunner({ cpu, callbacks, returnAddress: returned });
  const edicts = memory.allocate({ byteLength: edictLayout.byteLength * 3 }), game = memory.allocate({ byteLength: gameExportLayout.byteLength });
  memory.writeInt32(game, 2023); memory.writePointer(memory.offset(game, BigInt(fieldOffset(gameExportLayout, "edicts"))), edicts);
  memory.writeUint64(memory.offset(game, BigInt(fieldOffset(gameExportLayout, "edict_size"))), BigInt(edictLayout.byteLength));
  memory.writeUint32(memory.offset(game, BigInt(fieldOffset(gameExportLayout, "num_edicts"))), 3); memory.writeUint32(memory.offset(game, BigInt(fieldOffset(gameExportLayout, "max_edicts"))), 3);
  const getterBytes = new Uint8Array(11); getterBytes.set([0x48, 0xb8]); new DataView(getterBytes.buffer).setBigUint64(2, game.byteOffset, true); getterBytes[10] = 0xc3;
  const getter = memory.allocate({ byteLength: getterBytes.length }); memory.write(getter, getterBytes); memory.protect(getter, getterBytes.length, "read-execute");
  const cgame = memory.allocate({ byteLength: cgameExportLayout.byteLength }); memory.writeInt32(cgame, 2022);
  const cgetterBytes = getterBytes.slice(); new DataView(cgetterBytes.buffer).setBigUint64(2, cgame.byteOffset, true); const cgetter = memory.allocate({ byteLength: cgetterBytes.length }); memory.write(cgetter, cgetterBytes); memory.protect(cgetter, cgetterBytes.length, "read-execute");
  const prints: string[] = [], cvars = new CvarRegistry({ dialect: "q2-rerelease", context: { session: world.engine.actors.session, origin: { kind: "server-console" } } });
  services = new RereleaseGuestServices({ scene: world.scene, cvars, numeric: createNumericOperations(Q2_DONOR_PROFILE), maxClients: 2, mapPath: "maps/base1.bsp", frameMilliseconds: 25,
    engine: { ...world.engine, emit: () => undefined, inPvs: (a, b) => world.spatial.visibility("pvs", a, b, true), inPhs: (a, b) => world.spatial.visibility("phs", a, b, true) },
    admit: () => undefined, collision: () => undefined, print: text => { prints.push(text); }, command: () => ({ arguments: [], args: "" }), addCommand: () => undefined, debugGraph: () => undefined,
    navigation: { runtime: () => null, moveToPoint: () => 0, followActor: () => 0 },
    clipboard: { kind: "dedicated" }, localize: (key, args) => [key, ...args].join(":"), debugShapes: () => undefined, worldText: () => undefined,
  });
  const adapter = services, { pickups, ...hostOptions } = adapter.hostOptions;
  if (pickups !== undefined) throw new Error("Public API fixture has no private pickup profile");
  const host = new RereleaseQ2GuestHost({ ...hostOptions, services: adapter.bindMemory(memory), runner, getGameApi: getter, getCgameApi: cgetter }); adapter.bindHost(host); world.attach(host);
  const invoke = (name: typeof gameImports[number]["name"], args: Parameters<RereleaseQ2GuestHost["module"]["invoke"]>[2]) => {
    const entry = gameImports.find(value => value.name === name); if (entry === undefined) throw new Error("Missing import signature");
    const address = memory.readPointer(memory.offset(host.module.gameImportAddress, BigInt(fieldOffset(gameImportLayout, name)))); if (address === null) throw new Error("Missing import address"); return host.module.invoke(address, entry.signature, args);
  };
  const string = (text: string): GuestAddress => { const bytes = new TextEncoder().encode(text), address = memory.allocate({ byteLength: Math.max(2048, bytes.length + 1) }); memory.write(address, bytes); return address; };
  try {
    const worldView = new RereleasePublicEdict(memory, host.module.entities().atSlot(0)), view = new RereleasePublicEdict(memory, host.module.entities().atSlot(1));
    memory.writeUint8(worldView.address("inuse"), 1); memory.writeUint8(view.address("inuse"), 1); memory.writeUint8(view.address("solid"), 2);
    view.setVector("s.origin", { x: 4000, y: 4000, z: 4000 }); view.setVector("mins", { x: -16, y: -16, z: -16 }); view.setVector("maxs", { x: 16, y: 16, z: 16 });
    host.reconcile(); const actor = host.actor(view.record); if (actor === null) throw new Error("Missing public actor");
    expect(world.engine.bodies.read(actor.id)?.origin.x).toBe(4000);
    expect(adapter.resourceIndex("model", "*1")).toBe(2); expect(adapter.entityState(1).number).toBe(1);
    const start = string(""), end = string(""); memory.writeFloat32(start, 4100); memory.writeFloat32(memory.offset(start, 4n), 4000); memory.writeFloat32(memory.offset(start, 8n), 4000);
    memory.writeFloat32(end, 4200); memory.writeFloat32(memory.offset(end, 4n), 4000); memory.writeFloat32(memory.offset(end, 8n), 4000);
    const trace = invoke("clip", [guestPointer(view.record.address), guestPointer(start), guestPointer(null), guestPointer(null), guestPointer(end), { kind: "uint32", value: 0xffffffff }]);
    if (trace.kind !== "aggregate") throw new Error("Missing trace result"); expect(new DataView(trace.bytes.buffer).getBigUint64(56, true)).toBe(view.record.address.byteOffset); expect(new DataView(trace.bytes.buffer).getFloat32(4, true)).toBe(1);
    expect(adapter.modelAppearance(1).attachedModels).toEqual(["", "", ""]);
    const attachment = adapter.resourceIndex("model", "models/objects/laser/tris.md2");
    memory.writeInt32(view.address("s.modelindex3"), attachment);
    expect(adapter.modelAppearance(1).attachedModels).toEqual(["", "models/objects/laser/tris.md2", ""]);
    memory.writeInt32(view.address("s.modelindex3"), 0); memory.writeInt32(view.address("s.modelindex4"), attachment);
    expect(adapter.modelAppearance(1).attachedModels).toEqual(["", "", "models/objects/laser/tris.md2"]);
    const previousState = view.state();
    memory.writeInt32(view.address("s.modelindex4"), 0);
    memory.writeInt32(view.address("s.skinnum"), 7);
    memory.writeUint64(view.address("s.effects"), 0x123456789abcdef0n);
    memory.protect(edicts, edictLayout.byteLength * 3, "read");
    try {
      const state = view.state();
      expect(state.modelIndexes).toEqual([0, 0, 0, 0]); expect(state.skin).toBe(7); expect(state.effects).toBe(0x123456789abcdef0n);
      expect(view.modelState()).toEqual({ modelIndexes: state.modelIndexes, skin: state.skin });
      expect(view.vector("s.origin")).toEqual(state.origin); expect(previousState.modelIndexes[3]).toBe(attachment);
    } finally { memory.protect(edicts, edictLayout.byteLength * 3, "read-write"); }
    memory.writeUint64(view.address("s.effects"), 0n);
    const client = memory.allocate({ byteLength: clientLayout.byteLength }); memory.writePointer(view.address("client"), client);
    const clientField = (name: string): GuestAddress => memory.offset(client, BigInt(fieldOffset(clientLayout, name)));
    const velocity = clientField("ps.pmove.velocity"); memory.writeFloat32(velocity, 12); memory.writeFloat32(memory.offset(velocity, 4n), -3); memory.writeFloat32(memory.offset(velocity, 8n), 4);
    memory.writeUint16(clientField("ps.pmove.pm_flags"), 5); memory.writeInt8(clientField("ps.pmove.viewheight"), -2);
    const offset = clientField("ps.viewoffset"); memory.writeFloat32(offset, 1); memory.writeFloat32(memory.offset(offset, 4n), 2); memory.writeFloat32(memory.offset(offset, 8n), 3);
    const player = view.playerState();
    memory.protect(client, clientLayout.byteLength, "read");
    try {
      expect(view.playerVelocity()).toEqual(player.movement.velocity);
      expect(view.playerMovementFlags()).toBe(player.movement.flags);
      expect(view.playerView()).toEqual({ viewOffset: player.viewOffset, viewHeight: player.movement.viewHeight, movementFlags: player.movement.flags });
      expect(adapter.playerGrounded(1, actor.id)).toBe(true); expect(adapter.playerView(1, actor.id)).toEqual({ viewOffset: { x: 1, y: 2, z: 1 }, crouched: true });
      expect(world.engine.bodies.read(actor.id)?.velocity).toEqual(player.movement.velocity);
    } finally { memory.protect(client, clientLayout.byteLength, "read-write"); }
    memory.writeFloat32(velocity, 20); expect(view.playerVelocity().x).toBe(20); expect(player.movement.velocity.x).toBe(12);
    memory.writePointer(view.address("client"), null);
    expect(Object.isFrozen(edictLayout) && Object.isFrozen(edictLayout.fields) && edictLayout.fields.every(Object.isFrozen)).toBe(true);
    const fields: GuestFieldLayout[] = [{ name: "value", byteOffset: 0, storage: "int32", count: 1 }];
    const external: GuestLayout = { ...edictLayout, fields }; expect(fieldOffset(external, "value")).toBe(0);
    fields[0] = { name: "value", byteOffset: 4, storage: "int32", count: 1 }; expect(fieldOffset(external, "value")).toBe(4);
    const info = string("\\name\\old\\name\\duplicate"); expect(invoke("Info_RemoveKey", [guestPointer(info), guestPointer(string("name"))])).toEqual({ kind: "uint32", value: 1 }); expect(readGuestString(memory, info)).toBe("");
    const longValue = "v".repeat(200); invoke("Info_SetValueForKey", [guestPointer(info), guestPointer(string("name")), guestPointer(string(longValue))]); expect(readGuestString(memory, info)).toBe(`\\name\\${longValue}`);
    host.reserveClient(1); adapter.completeSpawn(); adapter.setConfigstring(60, "2"); invoke("WriteByte", [guestInt(42)]); invoke("unicast", [guestPointer(view.record.address), { kind: "uint32", value: 1 }, { kind: "uint32", value: 7 }]);
    const messages = adapter.drainMessages(); expect(messages).toHaveLength(2); expect(messages[0]?.bytes[0]).toBe(13); expect(messages[1]?.dupeKey).toBe(7); expect(messages[1]?.sourceDialect).toBe("q2-multicast-float"); expect(messages[1]?.bytes).toEqual(Uint8Array.of(42));
    memory.writeUint8(view.address("inuse"), 0); host.reserveClient(1); host.reconcile(); expect(host.actor(view.record)?.id).toBe(actor.id); host.releaseClientReservation(1); expect(host.actor(view.record)).toBeNull();
  } finally { host.shutdown(); }
});
