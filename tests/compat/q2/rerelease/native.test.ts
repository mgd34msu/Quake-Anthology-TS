import { WorldTextStore } from "../../../../src/text/world.ts";
import type { RereleaseWorldTextEvent } from "../../../../src/compat/q2/rerelease/world-text.ts";
// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, expect, spyOn, test } from "bun:test";
import { createMountPlanId } from "../../../../src/contracts/content.ts";
import type { GuestAddress } from "../../../../src/contracts/execution.ts";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import { CvarRegistry } from "../../../../src/core/cvars/index.ts";
import { GuestCallStopped } from "../../../../src/guest/abi/index.ts";
import { integer, pointer, requiredPointer } from "../../../../src/guest/runtime/common/memory.ts";
import { readGuestString } from "../../../../src/compat/q2/rerelease/imports.ts";
import type { RereleaseCoreServices } from "../../../../src/compat/q2/rerelease/imports.ts";
import { prepareRereleaseGuest, RereleaseGuestSource } from "../../../../src/app/bootstrap/simulation/rerelease-guest-source.ts";
import { discoverInstalledContent } from "../../../../src/content/catalog/index.ts";
import { openMountPlan } from "../../../../src/content/mounts/index.ts";
import type { RereleaseSoundEvent } from "../../../../src/compat/q2/rerelease/sounds.ts";
import { nativeWorld } from "./world.ts";
import { SizeBuf, SZ_Init } from "../../../../src/network/q2/message.ts";
import type { RereleaseUnicast, RereleaseMulticast } from "../../../../src/compat/q2/rerelease/messages.ts";
import { cgameExportLayout, cgameImportLayout, clientLayout, cvarLayout, edictLayout, entityStateLayout, fieldOffset, gameExportLayout, gameImportLayout, gameImports, guestBool, guestPointer, playerStateLayout, pmoveLayout, pmoveStateLayout, privateClientLayout, privateEdictPrefixLayout, readRereleasePlayerState, RereleaseCgame, RereleaseSourceClient, retailRereleaseClientProfile, signature, traceLayout, usercmdLayout } from "../../../../src/compat/q2/rerelease/index.ts";

const dll = new URL("../../../../../qfiles/q2/rerelease/baseq2/game_x64.dll", import.meta.url);
const available = await Bun.file(dll).exists();
const activeSources: RereleaseGuestSource[] = [];
afterEach(() => { for (const source of activeSources.splice(0)) source.close(); });
async function nativeFixture(worldText?: (event: RereleaseWorldTextEvent) => void) {
  const catalog = await discoverInstalledContent({ corpusRoot: new URL("../../../../../qfiles", import.meta.url).pathname, discoverMods: false });
  const product = catalog.require("q2-rerelease-baseq2");
  using mounts = await openMountPlan(await catalog.createMountPlan({ id: createMountPlanId("test", "native-rerelease"), assets: product.id, geometry: product.id }));
  const artifact = await mounts.resolve("game_x64.dll"); if (artifact === null) throw new Error("Missing mounted native DLL");
  expect(artifact.digest).toBe("sha256:045d49c53722d9b922caf14f168dd28a97d4c514a6e443a3140560f8668baccd");
  const prepared = await prepareRereleaseGuest({ kind: "native", owner: { provider: "q2:rerelease-native-host", content: product.id }, role: "server-game",
    artifact, api: { kind: "q2-rerelease-game", version: 2023 }, profile: { kind: "windows-x86-64", image: "pe32+", pointerBytes: 8, call: "microsoft-x64" } }, mounts);
  const cvars = new CvarRegistry({ dialect: "q2-rerelease", context: { session: createIdentityOwner("rerelease-native").session, origin: { kind: "server-console" } } });
  const prints: string[] = [], configstrings = new Map<number, string>(), reached: string[] = [];
  const localized: { readonly destination: GuestAddress | null; readonly level: number; readonly base: string; readonly arguments: readonly string[] }[] = [];
  const resources = new Map<string, Map<string, number>>();
  const services = (memory: import("../../../../src/guest/core/index.ts").MappedGuestMemory): RereleaseCoreServices => ({
    cvars, print: text => { prints.push(text); return undefined; }, getConfigstring: index => configstrings.get(index) ?? "",
    setConfigstring: (index, text) => { configstrings.set(index, text); return undefined; },
    resourceIndex: (kind, name) => {
      if (name.length === 0) return 0;
      let table = resources.get(kind);
      if (table === undefined) { table = new Map<string, number>(); resources.set(kind, table); }
      const previous = table.get(name);
      if (previous !== undefined) return previous;
      const index = table.size + 1; table.set(name, index); return index;
    },
    serverFrame: () => 123, commandArguments: () => [], commandTail: () => "",
    addCommand: () => { throw new Error("This fixture has no command executor"); }, extension: () => null,
    invoke: call => {
      reached.push(`${call.api}.${call.name}`);
      if (call.api === "cgame" && call.name === "CL_ClientRealTime") return { kind: "uint64", value: 1_700_000_000_000n };
      if (call.name === "Loc_Print") {
        const count = Number(integer(call.arguments, 4)), array = pointer(call.arguments, 3), arguments_: string[] = [];
        for (let index = 0; index < count; index++) {
          if (array === null) throw new Error("Missing localization argument array");
          const text = memory.readPointer(memory.offset(array, BigInt(index * 8)));
          if (text === null) throw new Error("Missing localization string");
          arguments_.push(readGuestString(memory, text));
        }
        localized.push({ destination: pointer(call.arguments, 0), level: Number(integer(call.arguments, 1)), base: readGuestString(memory, requiredPointer(call.arguments, 2)), arguments: arguments_ });
        return { kind: "void" };
      }
      return undefined;
    },
  });
  const world = await nativeWorld(index => { for (const [name, value] of resources.get("model") ?? []) if (value === index) return name; return undefined; });
  const releaseListeners = { active: 0 }, subscribe = world.engine.actors.onRelease.bind(world.engine.actors);
  spyOn(world.engine.actors, 'onRelease').mockImplementation(callback => {
    releaseListeners.active++; const unsubscribe = subscribe(callback);
    return () => { releaseListeners.active--; return unsubscribe(); };
  });
  // SV_SpawnServer reserves source resource indices for the loaded BSP and inline models.
  const resourceIndex = (name: string): void => { let table = resources.get("model"); if (table === undefined) { table = new Map<string, number>(); resources.set("model", table); } if (!table.has(name)) table.set(name, table.size + 1); };
  resourceIndex("maps/base1.bsp");
  for (let index = 1; index < world.world.models.length; index++) resourceIndex(`*${index}`);
  const buffer = new SizeBuf();
  SZ_Init(buffer, new Uint8Array(65536), 65536);
  const sounds: RereleaseSoundEvent[] = [];
  const unicasts: RereleaseUnicast[] = [], multicasts: RereleaseMulticast[] = [];
  const source = RereleaseGuestSource.create(prepared, { services,
    clock: { nowMilliseconds: () => 1_700_000_000_000, performanceCounter: () => 12345678n, performanceFrequency: 10000000n },
    ...(worldText === undefined ? {} : { worldText }),
    sound: event => { sounds.push(event); },
    messages: { buffer, acceptsClient: slot => slot === 1, unicast: message => { unicasts.push(message); }, multicast: message => { multicasts.push(message); } },
    engine: world.engine, spatial: world.spatial, semantics: world.semantics, instructionBudget: Bun.env["Q2_RR_FULL_MAP"] === "1" ? 20_000_000 : 5_000_000 });
  activeSources.push(source);
  const { host, memory, runtime } = source;
  expect(host.options.engine).toBe(world.engine); expect(host.options.spatial).toBe(world.spatial); expect(host.options.semantics).toBe(world.semantics);
  world.attach(host);
  const guest = host.module, core = host.core;
  return { source, prepared, services, releaseListeners, guest, core, host, world, memory, runtime, cvars, prints, reached, resources, configstrings, localized, unicasts, multicasts, sounds };
}

test("source x64 public layouts retain padded bools, float movement and full trace fields", () => {
  expect([gameImportLayout.byteLength, gameExportLayout.byteLength, cgameImportLayout.byteLength, cgameExportLayout.byteLength]).toEqual([576, 272, 296, 152]);
  expect([traceLayout.byteLength, cvarLayout.byteLength, pmoveStateLayout.byteLength, usercmdLayout.byteLength, pmoveLayout.byteLength]).toEqual([96, 56, 52, 28, 3320]);
  expect([entityStateLayout.byteLength, playerStateLayout.byteLength, clientLayout.byteLength]).toEqual([120, 296, 300]);
  expect(fieldOffset(gameExportLayout, "edict_size")).toBe(168);
  expect(fieldOffset(playerStateLayout, "stats")).toBe(166);
  expect(fieldOffset(edictLayout, "sv.health")).not.toBe(fieldOffset(edictLayout, "s.origin"));
});

test.skipIf(!available)("retail DLL attaches and returns both source API tables; cgame reads the supplied player bytes", async () => {
  const { guest, core, memory, runtime, cvars } = await nativeFixture();
  expect(memory.readInt32(guest.bindGame())).toBe(2023);
  expect(memory.readInt32(guest.bindCgame())).toBe(2022);
  expect(memory.readUint64(memory.offset(guest.bindGame(), 168n))).toBe(0xe68n);
  const player = memory.allocate({ byteLength: playerStateLayout.byteLength, alignment: 4n });
  // bg_local.h: owned weapon words are stats32/33; cg_main.cpp combines their raw uint16 bits.
  memory.writeInt16(memory.offset(player, 166n + 32n * 2n), -32767);
  memory.writeInt16(memory.offset(player, 166n + 33n * 2n), -32766);
  expect(guest.callCgame("GetOwnedWeaponWheelWeapons", [guestPointer(player)])).toEqual({ kind: "uint32", value: 0x80028001 });
  memory.writeInt16(memory.offset(player, 166n + 32n * 2n), 2);
  expect(guest.callCgame("GetOwnedWeaponWheelWeapons", [guestPointer(player)])).toEqual({ kind: "uint32", value: 0x80020002 });
  const cgame = new RereleaseCgame({ module: guest, refreshCvars: () => core.refreshCvars(), splitIndex: () => { throw new Error("This query has no seat"); }, withSeat: () => { throw new Error("This query does not draw"); } });
  cgame.init();
  expect(cvars.variableString("scr_centertime")).toBe("5.0");
  memory.writeInt16(memory.offset(player, 166n + 13n * 2n), -1);
  expect(cgame.layoutFlags(readRereleasePlayerState(memory, player))).toBe(-1);
  expect(cgame.monsterFlashOffset(1)).toEqual({ x: Math.fround(28.7), y: -18.5, z: Math.fround(28.7) });
  const movement = memory.allocate({ byteLength: pmoveLayout.byteLength, alignment: 8n });
  memory.writeInt32(movement, 2); // PM_NOCLIP: no collision services are exercised.
  memory.writeUint8(memory.offset(movement, 52n), 25);
  memory.writeFloat32(memory.offset(movement, 68n), 200);
  cgame.pmoveRaw(movement);
  const frameSeconds = Math.fround(25 * Math.fround(0.001));
  const speed = Math.fround(Math.fround(10 * frameSeconds) * 400);
  expect(memory.readFloat32(memory.offset(movement, 16n))).toBe(speed);
  expect(memory.readFloat32(memory.offset(movement, 4n))).toBe(Math.fround(frameSeconds * speed));
  expect(memory.readInt8(memory.offset(movement, 48n))).toBe(22);
  expect(runtime.coverage.filter(value => value.reached > 0).every(value => value.supported)).toBe(true);
});

test.skipIf(!available)("production guest lifecycle unwinds attach and Init failures without retaining shared release listeners", async () => {
  const { source, prepared, services, host, world, releaseListeners, memory } = await nativeFixture();
  expect(releaseListeners.active).toBe(1);
  const failed: { memory: import("../../../../src/guest/core/index.ts").MappedGuestMemory | null } = { memory: null };
  expect(() => RereleaseGuestSource.create(prepared, { ...host.options,
    services: value => { failed.memory = value; return services(value); }, instructionBudget: 1,
    clock: { nowMilliseconds: () => 0, performanceCounter: () => 0n, performanceFrequency: 1000n } })).toThrow();
  expect(failed.memory?.mappings()).toEqual([]); expect(releaseListeners.active).toBe(1);
  spyOn(host.module, 'init').mockImplementation(() => { throw new Error('Injected Init failure'); });
  expect(() => source.init()).toThrow('Injected Init failure');
  expect(memory.mappings()).toEqual([]); expect(releaseListeners.active).toBe(0);
  const later = world.engine.actors.allocate('q2:unrelated', 'q2:later-world-actor');
  expect(() => world.engine.actors.release(later)).not.toThrow();
  expect(() => source.close()).not.toThrow();
});

test.skipIf(!available)("rerelease positioned sound callback preserves source floats through the guest ABI", async () => {
  const { guest, memory, sounds } = await nativeFixture();
  const address = memory.readPointer(memory.offset(guest.gameImportAddress, BigInt(fieldOffset(gameImportLayout, "positioned_sound"))));
  const entry = gameImports.find(entry => entry.name === "positioned_sound");
  if (address === null || entry === undefined) throw new Error("Missing positioned sound callback");
  const origin = memory.allocate({ byteLength: 12, alignment: 4n });
  memory.writeFloat32(origin, 1.25); memory.writeFloat32(memory.offset(origin, 4n), -2.5); memory.writeFloat32(memory.offset(origin, 8n), 3.75);
  guest.invoke(address, entry.signature, [guestPointer(origin), guestPointer(null), { kind: "uint32", value: 129 }, { kind: "int32", value: 513 }, { kind: "float32", value: 0.5 }, { kind: "float32", value: 2 }, { kind: "float32", value: 0.125 }]);
  expect(sounds).toEqual([{ entitySlot: null, origin: { x: 1.25, y: -2.5, z: 3.75 }, channel: 129, soundIndex: 513, volume: 0.5, attenuation: 2, timeOffset: 0.125, audience: { kind: "world" } }]);
});

test.skipIf(!available)("rerelease message callbacks encode floats and preserve multicast arguments through the guest ABI", async () => {
  const { guest, core, memory, multicasts } = await nativeFixture();
  const invoke = (name: "WriteByte" | "WriteShort" | "WriteLong" | "WriteFloat" | "WritePosition" | "WriteDir" | "WriteString" | "multicast", args: Parameters<typeof guest.invoke>[2]) => {
    const address = memory.readPointer(memory.offset(guest.gameImportAddress, BigInt(fieldOffset(gameImportLayout, name))));
    if (address === null) throw new Error("Missing message callback");
    const entry = gameImports.find(entry => entry.name === name);
    if (entry === undefined) throw new Error("Missing message signature");
    return guest.invoke(address, entry.signature, args);
  };
  const vector = memory.allocate({ byteLength: 12, alignment: 4n });
  memory.writeFloat32(vector, 1); memory.writeFloat32(memory.offset(vector, 4n), 0); memory.writeFloat32(memory.offset(vector, 8n), 0);
  invoke("WriteByte", [{ kind: "int32", value: 255 }]);
  invoke("WriteShort", [{ kind: "int32", value: -2 }]);
  invoke("WriteLong", [{ kind: "int32", value: 0x12345678 }]);
  invoke("WriteFloat", [{ kind: "float32", value: 1.5 }]);
  invoke("WritePosition", [guestPointer(vector)]);
  invoke("WriteDir", [guestPointer(vector)]);
  invoke("WriteString", [guestPointer(core.string("ok"))]);
  invoke("multicast", [guestPointer(vector), { kind: "int32", value: 2 }, guestBool(true)]);
  expect(multicasts).toEqual([{ origin: { x: 1, y: 0, z: 0 }, destination: "pvs", reliable: true, bytes: new Uint8Array([255,254,255,120,86,52,18,0,0,192,63,0,0,128,63,0,0,0,0,0,0,0,0,52,111,107,0]) }]);
});

test.skipIf(!available)("retail PreInit through ClientThink and active RunFrame use shared BSP, body and inventory authorities", async () => {
  const { source, guest, core, host, world, memory, cvars, prints, reached, unicasts, multicasts, releaseListeners } = await nativeFixture();
  host.preInit();
  expect(cvars.variableString("maxclients")).toBe("8");
  try { source.init(); } catch (error) {
    if (error instanceof GuestCallStopped) throw new Error(`Init ${JSON.stringify(error.stop, (_key, value: unknown) => typeof value === "bigint" ? value.toString(16) : value)} RIP ${guest.options.runner.options.cpu.state.instructionPointer.toString(16)} imports ${reached.slice(-10).join(",")}`);
    throw error;
  }
  expect(prints).toContain("==== InitGame ====\n");
  const table = guest.entities();
  expect(table.strideBytes).toBe(3688);
  expect(table.count).toBe(9);
  expect(table.capacity).toBe(8192);
  expect(reached).toContain("game.TagMalloc");
  // This retail build has two additional item IDs compared with the supplied source.
  // Record the measured allocation without selecting the source-private client layout.
  expect(["item_compass", "item_flashlight", "ammo_cells", "ammo_flechettes", "weapon_blaster"].map(name => guest.callGame("Bot_GetItemID", [guestPointer(core.string(name))]))).toEqual([83, 82, 30, 34, 8].map(value => ({ kind: "int32", value })));
  expect(privateClientLayout.byteLength).toBe(7328);
  expect(memory.mappings().filter(value => value.label === "Q2 tag 765").map(value => value.byteLength).sort((a, b) => a - b)).toEqual([8192 * 3688, 8 * 7344, 8 * 80 * 12].sort((a, b) => a - b));
  const ignore = memory.allocate({ byteLength: 8, alignment: 8n });
  memory.writePointer(ignore, table.atSlot(1).address);
  expect(guest.callGame("ClientChooseSlot", [guestPointer(core.string("\\name\\guest")), guestPointer(core.string("test-social")), guestBool(false), guestPointer(ignore), { kind: "uint64", value: 1n }, guestBool(false)])).toEqual(guestPointer(table.atSlot(2).address));
  // g_main.cpp: a main-loop frame returns until a native client has spawned.
  guest.runFrame(true);
  expect(guest.entities().count).toBe(9);
  memory.writeUint8(memory.offset(table.atSlot(8).address, 84n), 42);
  memory.writeUint8(memory.offset(table.atSlot(8).address, 3687n), 0xa7);
  guest.prepFrame();
  expect(memory.readUint8(memory.offset(table.atSlot(8).address, 84n))).toBe(0);
  expect(memory.readUint8(memory.offset(table.atSlot(8).address, 3687n))).toBe(0xa7);
  const fullMap = Bun.env["Q2_RR_FULL_MAP"] === "1";
  try { host.spawnEntities("base1", fullMap ? world.world.entities : `{\n"classname" "worldspawn"\n}\n{\n"classname" "info_player_start"\n"origin" "${world.origin}"\n}\n`, ""); }
  catch (error) { console.log("SpawnEntities stopped", { ip: guest.options.runner.options.cpu.state.instructionPointer.toString(16), count: guest.entities().count, prints: prints.slice(-5), imports: reached.slice(-8) }); throw error; }
  host.runFrame(false);
  if (fullMap) console.log("full source spawn", guest.entities().count, prints.slice(-10));
  else expect(guest.entities().count).toBe(18); // Eight body-queue edicts and the real map's player start.
  expect(world.traceCalls).toBeGreaterThan(0);
  expect(memory.readUint8(memory.offset(guest.entities().atSlot(0).address, BigInt(fieldOffset(edictLayout, "inuse"))))).toBe(1);
  expect(host.clientConnect(1, "\\name\\Native Guest\\skin\\male/grunt\\ip\\127.0.0.1", "native-social", false).accepted).toBe(true);
  const client = memory.readPointer(memory.offset(guest.entities().atSlot(1).address, 120n));
  if (client === null) throw new Error("Native ClientConnect left no client pointer");
  const privateClient = new RereleaseSourceClient(client, guest, retailRereleaseClientProfile);
  expect(Array.from({ length: 12 }, (_, index) => memory.readInt16(memory.offset(privateClient.at("pers.max_ammo"), BigInt(index * 2))))).toEqual([200, 100, 50, 50, 200, 50, 50, 5, 200, 5, 12, 50]);
  expect(memory.readInt32(memory.offset(privateClient.at("pers.inventory"), 83n * 4n))).toBe(1);
  expect(() => privateClient.at("fog")).toThrow("Unknown");
  host.clientBegin(1);
  if (fullMap) expect([...unicasts, ...multicasts].some(message => message.bytes.length > 0)).toBe(true);
  const actor = host.actor(guest.entities().atSlot(1));
  if (actor === null) throw new Error("ClientBegin did not create the shared player actor");
  const before = world.engine.bodies.read(actor.id);
  if (before === null) throw new Error("ClientBegin left no shared body");
  expect(world.scene.spatial.get(actor.id)?.body.actor).toEqual(actor.id);
  expect(memory.readInt32(memory.offset(guest.entities().atSlot(1).address, 1912n))).toBe(100);
  expect(world.engine.inventory.count(actor.id, "q2:blaster")).toBe(1);
  expect(world.engine.inventory.give(actor, "q2:cells", 17)).toBe(17);
  expect(privateClient.powerArmorCells().read()).toBe(17);
  host.clientThink(1, { kind: "q2-rerelease", milliseconds: 25, buttons: 0, angles: { x: 0, y: 0, z: 0 }, forwardMove: 200, sideMove: 0, serverFrame: 123 });
  host.runFrame(true);
  expect(world.engine.bodies.read(actor.id)?.origin).not.toEqual(before.origin);
  expect(host.botEntities().some(value => value.currentActor() === actor.id)).toBe(true);
  expect(memory.readInt32(memory.offset(guest.entities().atSlot(1).address, BigInt(fieldOffset(edictLayout, "sv.inventory") + 30 * 4)))).toBe(17);
  const target = guest.entities().atSlot(17), callbackOrder: string[] = [];
  const targetUse = memory.offset(target.address, BigInt(fieldOffset(privateEdictPrefixLayout, "use.value"))), targetTouch = memory.offset(target.address, BigInt(fieldOffset(privateEdictPrefixLayout, "touch.value")));
  const previousUse = memory.readPointer(targetUse), previousTouch = memory.readPointer(targetTouch);
  const playerFlags = memory.offset(guest.entities().atSlot(1).address, BigInt(fieldOffset(edictLayout, "svflags"))), previousFlags = memory.readUint32(playerFlags);
  const P = { kind: "scalar", storage: "pointer" } satisfies import("../../../../src/contracts/execution.ts").GuestValueLayout;
  const use = guest.options.runner.options.callbacks.bind({ id: "native:source-use", signature: signature([P, P, P]), invoke: (_context, args) => {
    callbackOrder.push("use"); expect(args).toEqual([guestPointer(target.address), guestPointer(guest.entities().atSlot(1).address), guestPointer(guest.entities().atSlot(1).address)]);
    expect(guest.callCgame("GetOwnedWeaponWheelWeapons", [guestPointer(client)]).kind).toBe("uint32");
    expect(guest.options.runner.depth).toBe(1);
    return { kind: "void" };
  } });
  const touch = guest.options.runner.options.callbacks.bind({ id: "native:source-touch", signature: signature([P, P, P, { kind: "scalar", storage: "uint8" }]), invoke: (_context, args) => {
    callbackOrder.push("touch"); expect(pointer(args, 0)).toEqual(target.address); expect(pointer(args, 1)).toEqual(guest.entities().atSlot(1).address);
    memory.check(requiredPointer(args, 2), traceLayout.byteLength, "read"); expect(integer(args, 3)).toBe(1n);
    return { kind: "void" };
  } });
  try {
    memory.writePointer(targetUse, use); memory.writePointer(targetTouch, touch); memory.writeUint32(playerFlags, previousFlags | 16);
    guest.callGame("Bot_TriggerEdict", [guestPointer(guest.entities().atSlot(1).address), guestPointer(target.address)], guest.entities().atSlot(1), target);
    expect(callbackOrder).toEqual(["use", "touch"]);
  } finally { memory.writePointer(targetUse, previousUse); memory.writePointer(targetTouch, previousTouch); memory.writeUint32(playerFlags, previousFlags); }
  if (Bun.env["Q2_RR_SAVE_PROBE"] === "1") {
    try { const saved = host.writeSave("level", false); console.log("native level JSON", saved.length, new TextDecoder().decode(saved).slice(0, 500)); }
    catch (error) {
      const registers = guest.options.runner.options.cpu.state.registers;
      const format = memory.pointer(registers.read("r9", 64)), stack = memory.pointer(registers.read("rsp", 64));
      if (format !== null && stack !== null) {
        const locale = memory.readUint64(memory.offset(stack, 40n)), values = memory.readPointer(memory.offset(stack, 48n));
        console.log("save formatter", { options: registers.read("rcx", 64).toString(16), buffer: registers.read("rdx", 64).toString(16), size: registers.read("r8", 64).toString(16), format: readGuestString(memory, format), formatAddress: format.byteOffset.toString(16), locale: locale.toString(16), vaList: values?.byteOffset.toString(16), arguments: values === null ? [] : [...memory.copy(values, 48)] });
      }
      throw error;
    }
  }
  expect(world.engine.actors.ownedBy(memory.module.id).length).toBeGreaterThan(0);
  const unrelated = world.engine.actors.allocate('q2:unrelated', 'q2:survives-guest');
  source.close();
  expect(world.engine.actors.ownedBy(memory.module.id)).toEqual([]); expect(memory.mappings()).toEqual([]);
  expect(releaseListeners.active).toBe(0); expect(world.engine.actors.isLive(unrelated.id)).toBe(true);
  expect(() => world.engine.actors.release(unrelated)).not.toThrow();
});


test.skipIf(!available)("retail info_world_text RunFrame submits both guest imports into the shared world store", async () => {
  const store = new WorldTextStore(), emitted: RereleaseWorldTextEvent[] = [];
  let now = 0;
  const { source, host, world } = await nativeFixture(event => { emitted.push(event); store.submit({ ...event.text, content: "q2:rerelease:baseq2:pak0" }, now, event.lifetime); });
  try {
    host.preInit(); source.init();
    host.spawnEntities("base1", '{\n"classname" "worldspawn"\n}\n' +
      '{\n"classname" "info_player_start" "origin" "' + world.origin + '"\n}\n' +
      '{\n"classname" "info_world_text" "message" "BILLBOARD" "origin" "1 2 3" "angle" "-3" "radius" "0.5" "sounds" "1"\n}\n' +
      '{\n"classname" "info_world_text" "message" "FIXED" "origin" "4 5 6" "angle" "90" "radius" "1" "sounds" "2"\n}\n');
    expect(host.clientConnect(1, "\\name\\World Text\\skin\\male/grunt\\ip\\127.0.0.1", "text-social", false).accepted).toBe(true);
    host.clientBegin(1);
    for (let frame = 0; frame < 4 && emitted.length < 2; frame++) { now += 0.1; host.runFrame(true); }
    const billboard = emitted.find(event => event.text.text === "BILLBOARD"), fixed = emitted.find(event => event.text.text === "FIXED");
    if (billboard === undefined || fixed === undefined) throw new Error("Native world text did not execute");
    expect(billboard.text.orientation).toEqual({ kind: "billboard" });
    expect(fixed.text.orientation).toEqual({ kind: "fixed", angles: { x: 0, y: 270, z: 0 } });
    expect(billboard.text.origin).toEqual({ x: 1, y: 2, z: 3 });
    expect(fixed.text.origin).toEqual({ x: 4, y: 5, z: 6 });
    expect(billboard.text.color).toEqual({ x: 1, y: 0, z: 0, w: 1 });
    expect(fixed.text.color).toEqual({ x: 0, y: 0, z: 1, w: 1 });
    expect([billboard.text.cellSize, fixed.text.cellSize]).toEqual([4, 8]);
    expect(billboard.text.depthTest).toBe(true); expect(billboard.text.distanceCullFactor).toBe(0.004);
    expect(billboard.lifetime).toBeGreaterThan(0);
    expect(store.snapshot(now, 1)).toHaveLength(2);
    expect(store.snapshot(now + billboard.lifetime + 0.001, 2)).toHaveLength(0);
    now += 0.1; host.runFrame(true); expect(store.snapshot(now, 3).length).toBeGreaterThan(0);
    store.clear(); expect(store.snapshot(now, 3)).toHaveLength(0);
    host.shutdown();
  } finally { store.clear(); }
}, 60000);
