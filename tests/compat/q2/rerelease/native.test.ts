import { NativeInputBinding } from "../../../../src/compat/q2/native-input.ts";
import { ModClientApplications } from "../../../../src/world/session/mod-client-applications.ts";
import { createNumericOperations } from "../../../../src/core/numeric.ts";
import { X86AbiAdapter } from "../../../../src/guest/abi/adapter.ts";
import { captureAbiProcessorState, restoreAbiProcessorState } from "../../../../src/guest/abi/runner.ts";
import { nativeCombatSignature, nativeRereleaseModLayout } from "../../../../src/compat/q2/native-combat-call.ts";
import { rereleaseAbi } from "../../../../src/compat/q2/rerelease/api.ts";
import { SaveReader } from "../../../../src/persistence/value.ts";
import { readRereleasePrimaryWorldProfile, rereleasePrimaryWorldProfile } from "../../../../src/compat/q2/rerelease/world-profile.ts";
import { builtinNativePrimary } from "../../../../src/compat/q2/native-primary.ts";
import type { RereleaseDebugShapesEvent } from "../../../../src/compat/q2/rerelease/debug-shapes.ts";
import { WorldTextStore } from "../../../../src/text/world.ts";
import type { RereleaseWorldTextEvent } from "../../../../src/compat/q2/rerelease/world-text.ts";
// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, expect, spyOn, test } from "bun:test";
import { createMountPlanId } from "../../../../src/contracts/content.ts";
import type { GuestAddress } from "../../../../src/contracts/execution.ts";
import type { AttackProvenance, DamageOutcome } from "../../../../src/contracts/gameplay.ts";
import type { OwnedActor } from "../../../../src/contracts/identity.ts";
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
import { rereleaseInventoryItems } from "../../../../src/compat/q2/rerelease/semantics.ts";
import { RereleaseSourceEdict } from "../../../../src/compat/q2/rerelease/source-state.ts";
import { resultPointer } from "../../../../src/compat/q2/rerelease/module.ts";
import { rereleaseFreeSignature, rereleaseSpawnSignature } from "../../../../src/compat/q2/rerelease/native-entries.ts";
import type { RereleaseQ2GuestHost } from "../../../../src/compat/q2/rerelease/host.ts";
import type { RereleaseForeignDamageServices } from "../../../../src/compat/q2/rerelease/foreign-actors.ts";
import { createQ2CombatPolicy } from "../../../../src/world/gameplay/policies.ts";
import { absorbNativeArmor } from "../../../../src/world/gameplay/armor.ts";
import { SizeBuf, SZ_Init } from "../../../../src/network/q2/message.ts";
import type { RereleaseUnicast, RereleaseMulticast } from "../../../../src/compat/q2/rerelease/messages.ts";
import { cgameExportLayout, cgameImportLayout, clientLayout, cvarLayout, edictLayout, entityStateLayout, fieldOffset, gameExportLayout, gameImportLayout, gameImports, guestBool, guestPointer, playerStateLayout, pmoveLayout, pmoveStateLayout, privateClientLayout, privateEdictPrefixLayout, readRereleasePlayerState, RereleaseCgame, RereleaseSourceClient, retailRereleaseClientProfile, signature, traceLayout, usercmdLayout } from "../../../../src/compat/q2/rerelease/index.ts";

const dll = new URL("../../../../../qfiles/q2/rerelease/baseq2/game_x64.dll", import.meta.url);
export const available = await Bun.file(dll).exists();
const activeSources: RereleaseGuestSource[] = [];
afterEach(() => { for (const source of activeSources.splice(0)) source.close(); });
export async function nativeFixture(worldText?: (event: RereleaseWorldTextEvent) => void, nativeBindings = false, commandArguments: () => readonly string[] = () => [], foreignDamage?: RereleaseForeignDamageServices, debugShapes?: (event: RereleaseDebugShapesEvent) => void, debugDrawing?: "headless", declaredWorld = false) {
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
    serverFrame: () => 123, commandArguments, commandTail: () => commandArguments().slice(1).join(" "),
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
  let attached: RereleaseQ2GuestHost | null = null;
  let inventoryItems: ReturnType<typeof rereleaseInventoryItems> | null = null;
  const owner = (): RereleaseQ2GuestHost => { if (attached === null) throw new Error("Fixture host is not attached"); return attached; };
  const semantics = !nativeBindings ? world.semantics : { ...world.semantics, bind: (view: import("../../../../src/contracts/execution.ts").RawEntityView, actor: import("../../../../src/contracts/identity.ts").OwnedActor, module: import("../../../../src/compat/q2/rerelease/module.ts").RereleaseGuestModule) => {
    const base = world.semantics.bind(view, actor, module), edict = new RereleaseSourceEdict(view, module);
    const client = edict.client === null ? null : new RereleaseSourceClient(edict.client, module, retailRereleaseClientProfile);
    if (client !== null && inventoryItems === null) inventoryItems = rereleaseInventoryItems(module, value => owner().core.string(value));
    const classname = module.memory.readPointer(edict.at("classname"));
    const barrel = foreignDamage !== undefined && classname !== null && ["misc_explobox", "monster_soldier"].includes(readGuestString(module.memory, classname));
    return { ...base, combat: !barrel ? base.combat : edict.combat({ armor: () => ({ regular: { kind: "none" }, powered: { kind: "none" } }), writeArmor: () => { throw new Error("Native barrel has no armor"); }, traits: () => ({ invulnerable: false, team: null, noKnockback: false }) }),
      inventory: client === null || inventoryItems === null ? null : client.inventory(inventoryItems),
      callbacks: edict.callbacks({ address: id => owner().addressForActor(id), actor: address => owner().actor(module.entities().fromPointer(address))?.id ?? null }, trace => owner().encodeTrace(trace)) };
  } };
  const profile = declaredWorld ? builtinNativePrimary(artifact.digest, "rerelease") : null;
  if (declaredWorld && profile?.edition !== "rerelease") throw new Error("Missing original primary fixture profile");
  const selected = profile?.edition !== "rerelease" ? prepared : { ...prepared,
    primary: { declaration: artifact, profile: { ...profile, world: readRereleasePrimaryWorldProfile(new SaveReader(profile.world), artifact.digest) } } };
  const source = RereleaseGuestSource.create(selected, { services,
    ...(foreignDamage === undefined ? {} : { foreignDamage }),
    clock: { nowMilliseconds: () => 1_700_000_000_000, performanceCounter: () => 12345678n, performanceFrequency: 10000000n },
    ...(worldText === undefined ? {} : { worldText }),
    ...(debugShapes === undefined ? {} : { debugShapes }),
    ...(debugDrawing === undefined ? {} : { debugDrawing }),
    sound: event => { sounds.push(event); },
    messages: { buffer, acceptsClient: slot => slot === 1, unicast: message => { unicasts.push(message); }, multicast: message => { multicasts.push(message); } },
    engine: world.engine, spatial: world.spatial, semantics, instructionBudget: Bun.env["Q2_RR_FULL_MAP"] === "1" ? 20_000_000 : 5_000_000 });
  activeSources.push(source);
  const { host, memory, runtime } = source;
  attached = host;
  expect(host.options.engine).toBe(world.engine); expect(host.options.spatial).toBe(world.spatial); expect(host.options.semantics).toBe(semantics);
  world.attach(host);
  const guest = host.module, core = host.core;
  return { source, prepared, services, releaseListeners, guest, core, host, world, memory, runtime, cvars, prints, reached, resources, configstrings, localized, unicasts, multicasts, sounds };
}

test("source world declaration binds artifact identity and rejects invalid private storage", () => {
  const digest = "sha256:045d49c53722d9b922caf14f168dd28a97d4c514a6e443a3140560f8668baccd", profile = rereleasePrimaryWorldProfile(digest);
  if (profile === null) throw new Error("Missing retail fixture world profile");
  expect(readRereleasePrimaryWorldProfile(new SaveReader(profile), digest)).toEqual(profile);
  expect(rereleasePrimaryWorldProfile("sha256:unknown")).toBeNull();
  expect(() => readRereleasePrimaryWorldProfile(new SaveReader({ ...profile, monster: { ...profile.monster, blood: profile.edict.byteLength } }), digest)).toThrow("exceeds its edict");
  expect(() => readRereleasePrimaryWorldProfile(new SaveReader({ ...profile, client: { ...profile.client, inventoryCount: 85 } }), digest)).toThrow("pers.inventory");
  expect(() => readRereleasePrimaryWorldProfile(new SaveReader({ ...profile, regularArmor: { ...profile.regularArmor, target: { kind: "register", register: "rsp", storage: "pointer" } } }), digest)).toThrow();
});

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
  const { pickups, ...hostOptions } = host.options;
  expect(() => RereleaseGuestSource.create(prepared, { ...hostOptions, ...(pickups === undefined ? {} : { pickups: pickups.admission }),
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

test.skipIf(!available)("retail external player velocity enters source Pmove and remains source owned", async () => {
  const { source, guest, host, world } = await nativeFixture(undefined, false, () => [], undefined, undefined, undefined, true);
  host.preInit(); source.init();
  host.spawnEntities("base1", `{ "classname" "worldspawn" } { "classname" "info_player_start" "origin" "${world.origin}" }`, "");
  host.runFrame(false);
  expect(host.clientConnect(1, "\\name\\Hook test\\skin\\male/grunt\\ip\\127.0.0.1", "hook-test", false).accepted).toBe(true);
  host.clientBegin(1);
  const actor = host.actor(guest.entities().atSlot(1));
  if (actor === null) throw new Error("Source player was not admitted");
  const body = () => {
    const value = world.engine.bodies.read(actor.id);
    if (value === null) throw new Error("Source player has no body");
    return value;
  };
  const command = { kind: "q2-rerelease", milliseconds: 25, buttons: 0, angles: { x: 0, y: 0, z: 0 }, forwardMove: 0, sideMove: 0, serverFrame: 123 } satisfies Parameters<typeof host.clientThink>[1];
  let boundaries = 0;
  let requestedBody: import("../../../../src/contracts/math.ts").Bounds | undefined;
  const releaseBoundary = guest.bindInputMovement((_address, run) => { boundaries++; return run({ current: body().bounds,
    ...(requestedBody === undefined ? {} : { requested: requestedBody }), currentActor: () => {
      if (host.actor(guest.entities().atSlot(1))?.id !== actor.id) throw new Error("Original body owner changed");
    } }); }, () => true);
  const before = body();
  host.clientThink(1, command, { velocity: { x: 0, y: 0, z: 600 }, gravityScale: 1, predictionSuppressed: false });
  expect(body().origin.z).toBeGreaterThan(before.origin.z);
  expect(body().velocity.z).toBeGreaterThan(500);
  const pulled = body();
  host.clientThink(1, command);
  expect(body().origin.z).toBeGreaterThan(pulled.origin.z);
  expect(body().velocity.z).toBeLessThan(pulled.velocity.z);
  host.clientThink(1, command, { velocity: { x: 0, y: 0, z: 0 }, gravityScale: 0, predictionSuppressed: true });
  expect(body().velocity.z).toBe(0);
  host.clientThink(1, command, { velocity: { x: 0, y: 0, z: 0 }, gravityScale: 1, predictionSuppressed: false });
  expect(body().velocity.z).toBeLessThan(1);
  host.clientThink(1, command);
  expect(body().velocity.z).toBeLessThan(0);
  const speed = (multiplier: number): number => {
    world.engine.bodies.write(actor, before); world.engine.bodies.link(actor);
    host.clientThink(1, { ...command, forwardMove: 400 }, { velocity: { x: 0, y: 0, z: 0 }, gravityScale: 1, predictionSuppressed: true, speedMultiplier: multiplier });
    return Math.hypot(body().velocity.x, body().velocity.y);
  };
  const ordinary = speed(1), enhanced = speed(1.5), restored = speed(1);
  expect(enhanced).toBeGreaterThan(ordinary); expect(restored).toBe(ordinary);
  requestedBody = { min: { x: -7, y: -9, z: -20 }, max: { x: 8, y: 10, z: 12 } };
  world.engine.bodies.write(actor, before); world.engine.bodies.link(actor);
  host.clientThink(1, { ...command, forwardMove: 400 });
  expect(body().bounds).toEqual(requestedBody); expect(body().origin.x).not.toBe(before.origin.x);
  const acceptedBounds = body().bounds;
  requestedBody = { min: { x: -10000, y: -10000, z: -10000 }, max: { x: 10000, y: 10000, z: 10000 } };
  host.clientThink(1, command); expect(body().bounds).toEqual(acceptedBounds);
  requestedBody = undefined;
  world.engine.bodies.write(actor, before); world.engine.bodies.link(actor);
  host.clientThink(1, command); expect(body().bounds).toEqual(before.bounds);
  const pose = { kind: "fixed", crouched: true, bounds: { min: { x: -42, y: -42, z: -42 }, max: { x: 42, y: 42, z: 42 } }, viewHeight: 26 } satisfies import("../../../../src/contracts/movement.ts").FixedMovementPose;
  const origin = body().origin;
  host.clientThink(1, { ...command, forwardMove: 400 }, { velocity: { x: 100, y: 0, z: 0 }, gravityScale: 1, predictionSuppressed: true, pose });
  expect(body().origin).toEqual(origin); expect(body().velocity).toEqual({ x: 0, y: 0, z: 0 }); expect(body().bounds).toEqual(pose.bounds);
  const client = guest.memory.readPointer(guest.memory.offset(guest.entities().atSlot(1).address, BigInt(fieldOffset(edictLayout, "client"))));
  if (client === null) throw new Error("Missing original client");
  expect(readRereleasePlayerState(guest.memory, client).movement.viewHeight).toBe(26);
  expect(boundaries).toBeGreaterThan(0); releaseBoundary();
  speed(1); expect(body().bounds).not.toEqual(pose.bounds);
  const applications = new ModClientApplications(() => true), clientIdentity = { actor: actor.id, client: createIdentityOwner("native-body-release").client(0, 0) };
  const bridge = new NativeInputBinding({ edition: "rerelease", host: guest, retire: () => { throw new Error("Unexpected retirement"); } }, {
    applications, bodyBounds: () => body().bounds, clientOutputs: () => requestedBody === undefined ? null : { bodyBounds: requestedBody },
    identity: slot => slot === 1 ? clientIdentity : null, live: identity => identity.actor.equals(actor.id), accepted: () => null,
    frame: () => ({ frame: 0, time: { kind: "milliseconds", value: 0 }, elapsed: { kind: "milliseconds", value: 25 }, phase: "client-command" }),
    onRelease: () => () => undefined, retired: () => undefined, movement: (_identity, _projection, run) => run(),
    numeric: createNumericOperations({ id: "q2-rerelease:source-f32", arithmetic: { kind: "binary32", round: "each-operation" }, scalarStorage: "binary32", floatToInt: "checked-c-truncation", integerOverflow: "wrap32" }),
  });
  try {
    expect(applications.active).toBe(false);
    requestedBody = { min: { x: -7, y: -9, z: -20 }, max: { x: 8, y: 10, z: 12 } };
    world.engine.bodies.write(actor, before); world.engine.bodies.link(actor);
    host.clientThink(1, command); expect(body().bounds).toEqual(requestedBody);
    requestedBody = undefined;
    host.clientThink(1, command); expect(body().bounds).toEqual(before.bounds);
  } finally { bridge.close(); applications.close(); }
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
    try { const saved = host.writeSave("level", false); console.log("native level JSON", saved.native.length, new TextDecoder().decode(saved.native).slice(0, 500)); }
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

test.skipIf(!available)("retail inventory roster and native death callbacks bind the injected actor tables", async () => {
  let commands: readonly string[] = [];
  const { source, host, guest, core, world, memory } = await nativeFixture(undefined, true, () => commands);
  host.preInit(); source.init();
  const items = rereleaseInventoryItems(guest, value => core.string(value));
  expect(items).toHaveLength(84);
  expect(items.map(item => item.sourceIndex)).toEqual(Array.from({ length: 84 }, (_, index) => index));
  expect(items.find(item => item.item === "q2:ammo_cells")).toEqual({ item: "q2:ammo_cells", sourceIndex: 30, capacity: { kind: "ammo", sourceIndex: 4 } });
  host.spawnEntities("base1", `{ "classname" "worldspawn" } { "classname" "info_player_start" "origin" "${world.origin}" } { "classname" "misc_explobox" "origin" "0 0 512" }`);
  expect(host.clientConnect(1, "\\name\\Bindings\\skin\\male/grunt\\ip\\127.0.0.1", "bindings", false).accepted).toBe(true);
  host.clientBegin(1);
  const playerView = guest.entities().atSlot(1), player = host.actor(playerView);
  if (player === null) throw new Error("Missing native player");
  const playerSource = new RereleaseSourceEdict(playerView, guest);
  if (playerSource.client === null) throw new Error("Missing native client");
  const client = new RereleaseSourceClient(playerSource.client, guest, retailRereleaseClientProfile);
  expect(client.invincibleUntilMilliseconds()).toBe(0n);
  expect(world.engine.inventory.count(player.id, "q2:weapon_blaster")).toBe(1);
  expect(world.engine.inventory.give(player, "q2:ammo_cells", 17)).toBe(17);
  expect(client.powerArmorCells().read()).toBe(17);
  client.powerArmorCells().write(9);
  expect(world.engine.inventory.count(player.id, "q2:ammo_cells")).toBe(9);
  expect(world.engine.inventory.give(player, "q2:ammo_cells", 1000)).toBe(191);
  expect(client.powerArmorCells().read()).toBe(200);
  const barrelView = guest.entities().atSlot(18), barrel = host.actor(barrelView);
  if (barrel === null) throw new Error("Missing native barrel");
  const barrelSource = new RereleaseSourceEdict(barrelView, guest);
  expect(barrelSource.health).toBe(10);
  const beforeThink = memory.readPointer(barrelSource.at("think.value"));
  expect(memory.readPointer(barrelSource.at("die.value"))).not.toBeNull();
  const attack: AttackProvenance = { sequence: 1, time: { kind: "milliseconds", value: 25 }, attacker: player.id, inflictor: player.id,
    weapon: "q2:weapon_rocketlauncher", weaponProvider: "q2:guest", combatProvider: "q2:guest", inventoryProvider: "q2:guest", movementProvider: "q2:guest",
    cause: { kind: "q2", meansOfDeath: 0x8000000 + 57, damageFlags: 0, native: { edition: "rerelease", id: 22, friendlyFire: true, noPointLoss: true } } };
  const P = { kind: "scalar", storage: "pointer" } satisfies import("../../../../src/contracts/execution.ts").GuestValueLayout;
  const oldPain = memory.readPointer(barrelSource.at("pain.value"));
  let painCalls = 0;
  const pain = guest.options.runner.options.callbacks.bind({ id: "native:semantic-pain-abi", signature: signature([P, P, { kind: "scalar", storage: "float32" }, { kind: "scalar", storage: "int32" }, P]), invoke: (_context, args) => {
    painCalls++;
    expect(pointer(args, 0)).toEqual(barrelView.address); expect(pointer(args, 1)).toEqual(playerView.address);
    expect(args[2]).toEqual({ kind: "float32", value: 1.5 }); expect(integer(args, 3)).toBe(7n);
    expect(memory.copy(requiredPointer(args, 4), 3)).toEqual(new Uint8Array([22, 1, 1]));
    return { kind: "void" };
  } });
  try {
    memory.writePointer(barrelSource.at("pain.value"), pain);
    const regions = memory.mappings().length;
    expect(world.engine.callbacks.pain({ self: barrel, attacker: player.id, damage: 7, kick: 1.5, attack })).toBe(true);
    expect(painCalls).toBe(1); expect(memory.mappings()).toHaveLength(regions);
    memory.writePointer(barrelSource.at("pain.value"), null);
    world.engine.callbacks.pain({ self: barrel, attacker: player.id, damage: 7, kick: 1.5, attack });
    expect(painCalls).toBe(1);
  } finally { memory.writePointer(barrelSource.at("pain.value"), oldPain); }
  const trace = world.engine.trace({ start: { x: 0, y: 0, z: 512 }, end: { x: 0, y: 0, z: -512 }, bounds: null, ignore: player.id, mask: 1 });
  if (trace.kind !== "q2") throw new Error("Expected native Q2 trace");
  const encoded = host.encodeTrace(trace);
  if (encoded.kind !== "aggregate") throw new Error("Expected encoded trace aggregate");
  const oldTouch = memory.readPointer(barrelSource.at("touch.value"));
  const touch = guest.options.runner.options.callbacks.bind({ id: "native:semantic-touch-abi", signature: signature([P, P, P, { kind: "scalar", storage: "uint8" }]), invoke: (_context, args) => {
    expect(pointer(args, 0)).toEqual(barrelView.address); expect(pointer(args, 1)).toEqual(playerView.address);
    expect(memory.copy(requiredPointer(args, 2), traceLayout.byteLength)).toEqual(encoded.bytes);
    expect(integer(args, 3)).toBe(1n);
    throw new Error("Fixture touch failure");
  } });
  try {
    memory.writePointer(barrelSource.at("touch.value"), touch);
    const regions = memory.mappings().length;
    expect(() => world.engine.callbacks.touch({ self: barrel, other: player.id, plane: null, surface: null, sourceTrace: { kind: "q2-rerelease", trace, ent: player.id, inverted: true } })).toThrow("Fixture touch failure");
    expect(memory.mappings()).toHaveLength(regions);
  } finally { memory.writePointer(barrelSource.at("touch.value"), oldTouch); }
  // Calls the retail barrel_delay function through the shared callback table.
  expect(world.engine.callbacks.die({ self: barrel, attacker: player.id, inflictor: player.id, damage: 95, kick: 0, point: { x: 1, y: 2, z: 3 }, attack })).toBe(true);
  expect(memory.readPointer(barrelSource.at("think.value"))).not.toEqual(beforeThink);
  expect(memory.readPointer(barrelSource.at("activator"))).toEqual(playerView.address);
  const foreign = world.engine.actors.allocate("test:foreign", "test:foreign");
  expect(() => world.engine.callbacks.die({ self: barrel, attacker: foreign.id, inflictor: foreign.id, damage: 95, kick: 0, point: { x: 0, y: 0, z: 0 }, attack: null })).toThrow("foreign actors");
  const defender = items.find(item => item.item === "q2:item_sphere_defender");
  if (defender === undefined) throw new Error("Missing native defender item");
  const launch = (): void => {
    world.engine.inventory.give(player, defender.item, 1);
    commands = ["use", "Defender Sphere"];
    guest.callGame("ClientCommand", [guestPointer(playerView.address)]);
    host.reconcile();
  };
  const sphereSlot = guest.entities().count;
  launch();
  const sphereView = guest.entities().atSlot(sphereSlot), sphere = host.actor(sphereView);
  if (sphere === null) throw new Error("Native defender did not spawn");
  const sphereSource = new RereleaseSourceEdict(sphereView, guest), sphereGeneration = sphereSource.generation();
  let releaseCount = 0;
  const unsubscribe = world.engine.actors.onRelease(released => {
    if (released === sphere) { releaseCount++; host.reconcile(); }
    return undefined;
  });
  try {
    expect(world.engine.callbacks.die({ self: sphere, attacker: player.id, inflictor: player.id, damage: 95, kick: 0, point: { x: 0, y: 0, z: 0 }, attack })).toBe(true);
    expect(world.engine.actors.isLive(sphere.id)).toBe(false);
    expect(releaseCount).toBe(1); expect(host.actor(sphereView)).toBeNull();
    expect(sphereSource.generation()).toBe(sphereGeneration + 1);
    launch();
    const reused = host.actor(sphereView);
    if (reused === null) throw new Error("Native sphere slot was not reused");
    expect(reused.id).not.toEqual(sphere.id);
    const nativeDie = memory.readPointer(sphereSource.at("die.value"));
    if (nativeDie === null) throw new Error("Native sphere has no death function");
    const deathSignature = signature([P, P, P, { kind: "scalar", storage: "int32" }, P, P]);
    const throwingDie = guest.options.runner.options.callbacks.bind({ id: "native:free-then-throw", signature: deathSignature, invoke: (_context, args) => {
      guest.invoke(nativeDie, deathSignature, args, sphereView, playerView);
      throw new Error("Fixture error after native free");
    } });
    memory.writePointer(sphereSource.at("die.value"), throwingDie);
    expect(() => world.engine.callbacks.die({ self: reused, attacker: player.id, inflictor: player.id, damage: 95, kick: 0, point: { x: 0, y: 0, z: 0 }, attack })).toThrow("Fixture error after native free");
    expect(world.engine.actors.isLive(reused.id)).toBe(false);
    expect(host.actor(sphereView)).toBeNull();
  } finally { unsubscribe(); }
  source.close();
  expect(world.engine.actors.isLive(foreign.id)).toBe(true);
});

test.skipIf(!available)("retail projectile and native damage share foreign actor health armor and callback ownership", async () => {
  let tick = 0, sequence = 0;
  let commands: readonly string[] = [];
  const { source, host, guest, world, memory, cvars, core } = await nativeFixture(undefined, true, () => commands, { provenance: () => ({ sequence: ++sequence, time: { kind: "milliseconds", value: tick * 25 },
    weapon: "q2:weapon_blaster", weaponProvider: "q2:guest", combatProvider: "test:q2-combat", inventoryProvider: "q2:guest", movementProvider: "q3:movement" }) });
  host.preInit(); source.init();
  host.spawnEntities("base1", `{ "classname" "worldspawn" } { "classname" "info_player_start" "origin" "${world.origin}" } { "classname" "misc_explobox" "origin" "0 0 512" }`);
  expect(host.clientConnect(1, "\\name\\Native Shooter\\skin\\male/grunt\\ip\\127.0.0.1", "mixed", false).accepted).toBe(true); host.clientBegin(1);
  const bridge = host.foreignActors; if (bridge === null) throw new Error("Missing native foreign bridge");
  const playerView = guest.entities().atSlot(1), player = host.actor(playerView);
  if (player === null) throw new Error("Missing native shooter");
  const entries = host.options.nativeEntries; if (entries === undefined) throw new Error("Missing original native entries");
  const { cpu, callbacks } = guest.options.runner.options, savedCpu = captureAbiProcessorState(cpu.state);
  try {
    const signature = nativeCombatSignature(guest.requireWorldProfile().calls.damage, "damage", rereleaseAbi);
    new X86AbiAdapter(rereleaseAbi).enter(cpu, entries.damage, signature, [guestPointer(null), guestPointer(null), guestPointer(null), guestPointer(null), guestPointer(null), guestPointer(null),
      { kind: "int32", value: 1 }, { kind: "int32", value: 0 }, { kind: "int32", value: 0 }, { kind: "aggregate", layout: nativeRereleaseModLayout, bytes: new Uint8Array(3) }], entries.damage);
    const modSlot = memory.pointer(cpu.state.registers.read("rsp", 64) + 80n); if (modSlot === null) throw new Error("Missing original mod_t stack slot");
    memory.writePointer(modSlot, null);
    expect(callbacks.enter(entries.damage)).toBe(false);
    cpu.state.registers.write("rcx", 64, playerView.address.byteOffset);
    expect(callbacks.enter(entries.damage)).toBe(false);
  } finally { restoreAbiProcessorState(cpu.state, savedCpu); }

  // The minimal entity fixture omits base1's moving spawn platform. Hold the native shooter via its own cheat command.
  cvars.set("cheats", "1", true); core.refreshCvars(); commands = ["noclip"]; guest.callGame("ClientCommand", [guestPointer(playerView.address)]);
  for (let index = 0; index < 40; index++) {
    tick++; host.clientThink(1, { kind: "q2-rerelease", milliseconds: 25, buttons: 0, angles: { x: 0, y: 0, z: 0 }, forwardMove: 0, sideMove: 0, serverFrame: tick }); host.runFrame(true);
  }
  const playerBody = world.engine.bodies.read(player.id); if (playerBody === null) throw new Error("Missing player body");
  const start = { ...playerBody.origin, z: playerBody.origin.z + 22 };
  const yaw = [0, 90, 180, 270].find(angle => {
    const end = { x: start.x + Math.cos(angle * Math.PI / 180) * 160, y: start.y + Math.sin(angle * Math.PI / 180) * 160, z: start.z };
    return world.engine.trace({ start, end, bounds: null, ignore: player.id, mask: 1 }).fraction === 1;
  });
  if (yaw === undefined) throw new Error("Fixture player has no clear native firing direction");
  const victim = world.engine.actors.allocate("q3:foreign", "q3:armored-target");
  const origin = { x: playerBody.origin.x + Math.cos(yaw * Math.PI / 180) * 128, y: playerBody.origin.y + Math.sin(yaw * Math.PI / 180) * 128, z: playerBody.origin.z };
  world.engine.bodies.create(victim, { origin, angles: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, bounds: { min: { x: -20, y: -20, z: -24 }, max: { x: 20, y: 20, z: 40 } }, ground: null });
  world.engine.bodies.link(victim);
  world.engine.combat.create(victim, { health: 20, mass: 200, armor: { regular: { kind: "q3", points: 20, protection: 0.66 }, powered: { kind: "none" } }, canTakeDamage: true, invulnerable: false, team: null });
  world.engine.inventory.create(victim, [{ item: "q3:ammo_cells", count: 12, capacity: 200 }]);
  const reactions: AttackProvenance[] = [], drops: OwnedActor[] = [];
  const barrelView = guest.entities().atSlot(18), barrel = host.actor(barrelView);
  if (barrel === null) throw new Error("Missing native barrel");
  const counter: { attack: AttackProvenance | null; outcome: DamageOutcome | null } = { attack: null, outcome: null };
  world.engine.callbacks.bind(victim, { think: null, touch: null, use: null, pain: reaction => {
    if (reaction.attack === null) throw new Error("Missing native attack provenance"); reactions.push(reaction.attack);
    if (counter.outcome === null) {
      counter.attack = { ...reaction.attack, sequence: ++sequence, attacker: victim.id, inflictor: victim.id, weapon: "q2:weapon_rocketlauncher", cause: { kind: "q2", meansOfDeath: 8, damageFlags: 0 } };
      counter.outcome = bridge.damageNative({ attack: counter.attack, target: barrel.id, amount: 95, knockback: 5, direction: { x: 1, y: 0, z: 0 }, point: { x: 0, y: 0, z: 512 }, normal: { x: 0, y: 0, z: 1 }, delivery: "direct" });
    }
    return undefined;
  },
    die: reaction => {
      if (reaction.attack === null) throw new Error("Missing lethal attack provenance"); reactions.push(reaction.attack);
      const count = world.engine.inventory.count(victim.id, "q3:ammo_cells"); world.engine.inventory.consume(victim, "q3:ammo_cells", count);
      const drop = world.engine.actors.allocate("q3:foreign", "q3:item-drop");
      world.engine.inventory.create(drop, [{ item: "q3:ammo_cells", count, capacity: 200 }]); drops.push(drop); return undefined;
    } });
  world.engine.combat.register(createQ2CombatPolicy({ id: "test:q2-combat", armor: (_request, armor, damage, flags) => absorbNativeArmor(armor, damage, flags, { arithmetic: "binary32", screenFacingDot: 1 }),
    context: () => ({ arithmetic: "binary32", player: true, monster: false, attackerPlayer: true, hasEnemy: false, easySkill: false, deathmatch: false, defenderSphere: false,
      teamDamageEnabled: false, friendlyFire: true, nuke: false, noKnockback: false, movable: true, rejectTeamDamage: false, suppressPain: false }) }));
  const projection = bridge.address(victim.id), projectedView = guest.entities().fromPointer(projection);
  expect(host.actor(projectedView)).toBe(victim);
  expect(world.engine.actors.sourceOf(victim.id)).toBeNull();
  const frame = (buttons: number): void => { tick++; host.clientThink(1, { kind: "q2-rerelease", milliseconds: 25, buttons, angles: { x: 0, y: yaw, z: 0 }, forwardMove: 0, sideMove: 0, serverFrame: tick }); host.runFrame(true); };
  for (let index = 0; index < 24; index++) frame(0);
  expect(world.engine.bodies.read(victim.id)?.origin).toEqual(origin);
  for (let index = 0; index < 100 && reactions.length === 0; index++) frame(1);
  expect(reactions.length).toBeGreaterThan(0);
  const first = reactions[0]; if (first === undefined) throw new Error("No real projectile hit");
  expect(first.attacker).toEqual(player.id); expect(first.cause.kind).toBe("q2");
  const victimState = world.engine.combat.read(victim.id);
  if (victimState === null) throw new Error("Foreign combat state was removed");
  expect(victimState.health).toBeLessThan(20);
  const armor = victimState.armor;
  if (armor?.regular.kind !== "q3") throw new Error("Foreign armor was replaced");
  expect(armor.regular.points).toBeLessThan(20);
  expect(world.engine.inventory.count(victim.id, "q3:ammo_cells")).toBe(12);
  expect(new RereleaseSourceEdict(projectedView, guest).health).toBe(victimState.health);
  const outcome = counter.outcome;
  expect(outcome?.kind).toBe("committed");
  if (outcome?.kind !== "committed") throw new Error("Nested native counterattack did not commit");
  const counterAttack = counter.attack;
  if (counterAttack === null) throw new Error("Counterattack provenance was not captured");
  expect(outcome.decision.request.attack).toEqual(counterAttack);
  expect(outcome.decision.mutations).toContainEqual({ kind: "health", before: 10, after: -85 });
  const impulse = outcome.decision.mutations.find(mutation => mutation.kind === "source-velocity");
  if (impulse?.kind !== "source-velocity") throw new Error("Native velocity store was not observed");
  expect(impulse.after.x).toBeGreaterThan(impulse.before.x);
  expect(outcome.decision.reaction).toBe("death");
  expect(new RereleaseSourceEdict(barrelView, guest).health).toBe(-85);
  expect(memory.readPointer(new RereleaseSourceEdict(barrelView, guest).at("activator"))).toEqual(projection);
  for (let index = 0; index < 100 && drops.length === 0; index++) frame(1);
  expect(drops).toHaveLength(1); expect(world.engine.inventory.count(victim.id, "q3:ammo_cells")).toBe(0);
  const drop = drops[0]; if (drop === undefined) throw new Error("Foreign death did not drop its inventory");
  expect(world.engine.inventory.count(drop.id, "q3:ammo_cells")).toBe(12);
  const survivor = world.engine.actors.allocate("q3:foreign", "q3:survivor");
  const body = world.engine.bodies.read(victim.id); if (body === null) throw new Error("Foreign body disappeared");
  world.engine.bodies.create(survivor, body);
  world.engine.combat.create(survivor, { health: 100, mass: 200, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, canTakeDamage: true, invulnerable: false, team: null });
  bridge.address(survivor.id);
  world.engine.actors.release(victim);
  expect(host.actor(projectedView)).toBeNull();
  expect(world.scene.spatial.get(victim.id)).toBeNull();
  source.close();
  expect(world.engine.actors.isLive(survivor.id)).toBe(true); expect(world.engine.combat.read(survivor.id)?.health).toBe(100);
  expect(() => world.engine.actors.release(survivor)).not.toThrow();
  expect(world.engine.actors.isLive(drop.id)).toBe(true); world.engine.actors.release(drop);
});

test.skipIf(!available)("retail reused native slot stops foreign damage interception", async () => {
  const { source, host, guest, world } = await nativeFixture(undefined, true, () => [], {
    provenance: () => ({ sequence: 1, time: { kind: "milliseconds", value: 0 }, weapon: null,
      weaponProvider: "q2:guest", combatProvider: "test:q2-combat", inventoryProvider: "q2:guest", movementProvider: "q3:movement" }),
  });
  host.preInit(); source.init(); host.spawnEntities("base1", '{ "classname" "worldspawn" }');
  const bridge = host.foreignActors; if (bridge === null) throw new Error("No foreign bridge");
  const actor = world.engine.actors.allocate("q3:foreign", "review:reused-slot");
  world.engine.bodies.create(actor, { origin: { x: 0, y: 0, z: 512 }, angles: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
    bounds: { min: { x: -16, y: -16, z: -16 }, max: { x: 16, y: 16, z: 16 } }, ground: null });
  world.engine.combat.create(actor, { health: 100, mass: 200, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, canTakeDamage: true, invulnerable: false, team: null });
  const address = bridge.address(actor.id), view = guest.entities().fromPointer(address);
  const generation = new RereleaseSourceEdict(view, guest).generation();
  const { cpu, callbacks } = guest.options.runner.options;
  cpu.state.registers.write("rcx", 64, address.byteOffset);
  expect(callbacks.resolve(bridge.entries.damage)).not.toBeNull();
  guest.invoke(bridge.entries.free, rereleaseFreeSignature, [guestPointer(address)], view);
  const native = resultPointer(guest.invoke(bridge.entries.spawn, rereleaseSpawnSignature, []));
  if (native === null) throw new Error("Native allocation failed");
  expect(native.byteOffset).toBe(address.byteOffset);
  const reused = guest.entities().fromPointer(native);
  expect(new RereleaseSourceEdict(reused, guest).generation()).not.toBe(generation);
  cpu.state.registers.write("rcx", 64, native.byteOffset);
  expect(callbacks.resolve(bridge.entries.damage)).toBeNull();
  expect(bridge.lookup(reused)).toBeUndefined();
  expect(world.engine.combat.read(actor.id)?.health).toBe(100);
  source.close(); world.engine.actors.release(actor);
});
