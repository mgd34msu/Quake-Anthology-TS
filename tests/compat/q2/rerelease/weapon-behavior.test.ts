import { expect, test } from "bun:test";
import { rereleaseWeaponInitializationEntities, withRereleaseWeaponProvisioning } from "../../../../src/compat/q2/rerelease/weapon-behavior-profile.ts";
import { parseQ1Entities, q1EntityValue } from "../../../../src/formats/q1-map/entities.ts";
import { CvarRegistry, Q2CvarFlag } from "../../../../src/core/cvars/index.ts";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";

test("native component initialization retains authored world and admission fields without taking world actor ownership", () => {
  const source = '{"classname" "worldspawn" "custom_policy" "keep"}\n{"classname" "info_player_start" "origin" "10 20 30" "targetname" "entry"}\n{"classname" "func_door" "model" "*1"}\n{"classname" "custom_monster" "script" "authored"}';
  const profile = { initializationClasses: ["worldspawn", "info_player_start"] };
  const entities = parseQ1Entities(rereleaseWeaponInitializationEntities(source, profile));
  expect(entities.map(entity => q1EntityValue(entity, "classname"))).toEqual(["worldspawn", "info_player_start"]);
  expect(entities.map(entity => q1EntityValue(entity, "custom_policy"))).toEqual(["keep", null]);
  expect(entities.map(entity => q1EntityValue(entity, "origin"))).toEqual([null, "10 20 30"]);
  expect(entities.map(entity => q1EntityValue(entity, "targetname"))).toEqual([null, "entry"]);
  expect(() => rereleaseWeaponInitializationEntities('{"classname" "info_player_start"}', profile)).toThrow("one authored worldspawn");
});

test("native multiplayer provisioning scopes its declared private cheat capability and restores a pending latch on failure", () => {
  const identity = createIdentityOwner("native-provisioning");
  const source = new CvarRegistry({ dialect: "q2-rerelease", context: { session: identity.session, origin: { kind: "server-console" } } });
  source.register("cheats", "0", Q2CvarFlag.ServerInfo | Q2CvarFlag.Latch); source.register("maxclients", "8"); source.register("unrelated", "0");
  source.setServerActive(true); source.set("cheats", "2"); const before = source.captureWorldTransferState();
  const profile = { provisioningCvars: [{ name: "cheats", value: "1" }] }, observed: number[] = [];
  const refresh = () => { observed.push(source.variableValue("cheats")); };
  expect(() => withRereleaseWeaponProvisioning(profile, source, refresh, () => {
    expect(source.variableValue("maxclients")).toBe(8); expect(source.variableValue("cheats")).toBe(1); throw new Error("authored command failure");
  })).toThrow("authored command failure");
  expect(source.captureWorldTransferState()).toEqual(before); expect(observed).toEqual([1, 0]);
  expect(() => withRereleaseWeaponProvisioning(profile, source, refresh, () => source.set("unrelated", "1"))).toThrow("undeclared source cvar");
  expect(source.captureWorldTransferState()).toEqual(before);
});

import { retireRereleaseWeaponActor } from "../../../../src/app/bootstrap/simulation/rerelease-weapon-behavior.ts";
import type { ActorId } from "../../../../src/contracts/identity.ts";
import type { WeaponTrajectoryUpdate } from "../../../../src/contracts/weapon-behavior.ts";
import { SessionActorRegistry } from "../../../../src/world/actors/registry.ts";

test("native mirrors retire once across actor release, reentrant source-slot reuse and later attachment disposal", () => {
  const actors = new SessionActorRegistry(createIdentityOwner("native-retirement"));
  const state: Parameters<typeof retireRereleaseWeaponActor>[1] = { slots: new Map<ActorId, number>(), bindings: new Map<number, Parameters<Parameters<typeof retireRereleaseWeaponActor>[2]>[1]>(), retired: new Map<ActorId, WeaponTrajectoryUpdate>() };
  const original = actors.allocate("test:primary", "test:rocket"), replacement = actors.allocate("test:primary", "test:target");
  state.slots.set(original.id, 5); state.bindings.set(5, { actor: original, kind: "projectile", generation: 1 });
  let disposals = 0;
  const dispose = () => {
    disposals++;
    expect(state.slots.has(original.id)).toBe(false);
    expect(state.bindings.has(5)).toBe(false);
    state.slots.set(replacement.id, 5); state.bindings.set(5, { actor: replacement, kind: "target", generation: 2 });
  };
  const unsubscribe = actors.onRelease(actor => { retireRereleaseWeaponActor(actor.id, state, dispose); return undefined; });
  actors.release(original);
  retireRereleaseWeaponActor(original.id, state, dispose);
  expect(disposals).toBe(1); expect(state.bindings.get(5)?.actor).toBe(replacement);
  unsubscribe(); actors.release(replacement);
  expect(disposals).toBe(1);
});

import { q2EaksWeaponDeclaration, q2EaksWeaponDigest } from '../../../../src/compat/q2/rerelease/q2eaks-weapon-profile.ts';
import { readNativeWeaponDeclaration, serializeNativeWeaponDeclaration, sameNativeWeaponDeclaration } from '../../../../src/compat/q2/rerelease/native-weapon-declaration.ts';
import { builtInRereleaseWeaponDeclaration, rereleaseWeaponDefinition } from '../../../../src/compat/q2/rerelease/weapon-behavior-profile.ts';
import { createContentDigest } from '../../../../src/contracts/content.ts';

test('native declarations preserve built-in source calls and pin every private capability independently of package names', () => {
  const module: ModuleIdentity = { id: 'test:native', artifactPath: 'game_x64.dll', digest: q2EaksWeaponDigest, revision: '1' };
  const profile = readNativeWeaponDeclaration(q2EaksWeaponDeclaration(module.artifactPath), module);
  expect(builtInRereleaseWeaponDeclaration(module)).toEqual(profile);
  const json: unknown = JSON.parse(serializeNativeWeaponDeclaration(profile));
  expect(sameNativeWeaponDeclaration(readNativeWeaponDeclaration(json, module), profile)).toBe(true);
  expect(profile.launch.calls.map(call => call.rva)).toEqual([0xed420, 0xef900]);
  expect(profile.equip.calls.map(call => call.rva)).toEqual([0xed4d0]);
  expect(profile.free.entry.registration?.name).toBe('G_FreeEdict');
  expect(profile.projectileTouch.registration?.tag).toBe(21);
  expect(profile.entity.generation).toBe(0x5c0);
  expect(rereleaseWeaponDefinition(module)?.fire).toMatchObject({ kind: 'native-artifact', imageOffset: 0xef900n });
  const other = { ...module, artifactPath: 'mods/authored.dll', digest: createContentDigest('45'.repeat(32)) };
  const authored = readNativeWeaponDeclaration({ ...profile, artifactPath: other.artifactPath, artifactDigest: other.digest,
    id: 'author:grenade', role: 'grenade', title: 'Authored trajectory' }, other);
  expect(builtInRereleaseWeaponDeclaration(other)).toBeNull();
  expect(rereleaseWeaponDefinition(other, authored)?.role).toBe('grenade');
  expect(() => readNativeWeaponDeclaration(profile, other)).toThrow('artifact identity');
  expect(sameNativeWeaponDeclaration(profile, { ...profile, entity: { ...profile.entity, generation: 0x5c4 } })).toBe(false);
  expect(sameNativeWeaponDeclaration(profile, { ...profile, launch: { ...profile.launch, calls: [...profile.launch.calls].reverse() } })).toBe(false);
  expect(() => readNativeWeaponDeclaration({ ...profile, inferredDamage: true })).toThrow('unsupported declaration field');
  expect(() => readNativeWeaponDeclaration({ ...profile, entity: { ...profile.entity, origin: 32 } })).toThrow('public API2023');
  expect(() => readNativeWeaponDeclaration({ ...profile, launch: { ...profile.launch, signature: 'guessed-abi' } })).toThrow('entity-void');
  expect(() => readNativeWeaponDeclaration({ ...profile, entity: { ...profile.entity, origin: profile.entity.byteLength } })).toThrow('exceeds record');
  expect(() => readNativeWeaponDeclaration({ ...profile, entity: { ...profile.entity, velocity: profile.entity.origin } })).toThrow('overlapping');
});

import { rereleaseWeaponProfile } from '../../../../src/compat/q2/rerelease/weapon-behavior-profile.ts';
import { SparseGuestMemory, GuestCallbackTable, createGuestProcessorState } from '../../../../src/guest/core/index.ts';
import { GuestCallRunner } from '../../../../src/guest/abi/index.ts';
import { X64Cpu } from '../../../../src/guest/x64/index.ts';
import { RereleaseGuestModule } from '../../../../src/compat/q2/rerelease/module.ts';
import { gameExportLayout } from '../../../../src/compat/q2/rerelease/api.ts';
import { edictLayout, fieldOffset } from '../../../../src/compat/q2/rerelease/layouts.ts';
import type { GuestAddress, ModuleIdentity } from '../../../../src/contracts/execution.ts';

test('generic native declaration executes authored callback sequences and retains source generation and typed think checks', () => {
  const identity: ModuleIdentity = { id: 'test:authored-native', artifactPath: 'authored.dll', digest: createContentDigest('67'.repeat(32)), revision: '1' };
  const memory = new SparseGuestMemory({ module: identity, pointerBytes: 8 });
  const image = memory.map({ base: 0x100000n, byteLength: 4096, permissions: 'read-write-execute' });
  const at = (rva: number) => memory.offset(image, BigInt(rva));
  const stack = memory.allocate({ byteLength: 65536 }), returned = memory.allocate({ byteLength: 16, permissions: 'execute' });
  const callbacks = new GuestCallbackTable(memory);
  const cpu = new X64Cpu({ memory, state: createGuestProcessorState({ architecture: 'x86-64', instructionPointer: 0n,
    stackPointer: stack.byteOffset + 65536n, flags: 2n, x87ControlWord: 0x37f, mxcsr: 0x1f80, mxcsrMask: 0xffff }), isHostCall: address => callbacks.resolve(address) !== null });
  const runner = new GuestCallRunner({ cpu, callbacks, returnAddress: returned });
  const original = q2EaksWeaponDeclaration(identity.artifactPath), stride = original.entity.byteLength;
  const edicts = memory.allocate({ byteLength: stride * 3, alignment: 8n }), client = memory.allocate({ byteLength: original.client.byteLength, alignment: 8n }), weapon = memory.allocate({ byteLength: 48, alignment: 8n });
  const table = memory.allocate({ byteLength: gameExportLayout.byteLength, alignment: 8n });
  memory.writeInt32(table, 2023);
  memory.writePointer(memory.offset(table, BigInt(fieldOffset(gameExportLayout, 'edicts'))), edicts);
  memory.writeUint64(memory.offset(table, BigInt(fieldOffset(gameExportLayout, 'edict_size'))), BigInt(stride));
  memory.writeUint32(memory.offset(table, BigInt(fieldOffset(gameExportLayout, 'num_edicts'))), 3);
  memory.writeUint32(memory.offset(table, BigInt(fieldOffset(gameExportLayout, 'max_edicts'))), 3);
  const getter = (rva: number, address: GuestAddress) => {
    const bytes = new Uint8Array(11); bytes.set([0x48, 0xb8]); new DataView(bytes.buffer).setBigUint64(2, address.byteOffset, true); bytes[10] = 0xc3; memory.write(at(rva), bytes);
  };
  getter(0x100, table); getter(0x180, memory.offset(edicts, BigInt(stride * 2)));
  for (const rva of [0x120, 0x130, 0x190, 0x1a0]) memory.write(at(rva), new Uint8Array([0xc3]));
  for (const [rva, amount] of [[0x140, 1], [0x150, 2], [0x160, 4]]) {
    if (rva === undefined || amount === undefined) throw new Error('Missing authored instruction');
    const bytes = new Uint8Array([0x83, 0x81, 0, 0, 0, 0, amount, 0xc3]);
    new DataView(bytes.buffer).setUint32(2, original.entity.generation, true); memory.write(at(rva), bytes);
  }
  const module = new RereleaseGuestModule({ runner, getGameApi: at(0x100), getCgameApi: at(0x100), actorAtSlot: () => null,
    invokeImport: () => { throw new Error('Authored callback unexpectedly imported a service'); } });
  const rawEntry = (rva: number) => ({ rva, registration: null });
  const declaration = readNativeWeaponDeclaration({ ...original, artifactDigest: identity.digest,
    equippedWeapon: { ...original.equippedWeapon, expected: rawEntry(0x120) }, time: { ...original.time, rva: 0x280 },
    allocate: { ...original.allocate, entry: rawEntry(0x180) }, free: { ...original.free, entry: rawEntry(0x190) },
    projectileTouch: rawEntry(0x1a0), equip: { ...original.equip, calls: [rawEntry(0x130)] },
    launch: { ...original.launch, calls: [rawEntry(0x140), rawEntry(0x150)] }, activateRva: 0x130, fireRva: 0x150 }, identity);
  const profile = rereleaseWeaponProfile(module, image, declaration), shooter = module.entities().atSlot(1), projectile = profile.allocate();
  expect(projectile.slot).toBe(2);
  memory.writePointer(memory.offset(shooter.address, BigInt(declaration.entity.client)), client);
  memory.writePointer(memory.offset(client, BigInt(declaration.client.weapon)), weapon);
  memory.writePointer(memory.offset(weapon, BigInt(declaration.equippedWeapon.callback)), at(0x120));
  profile.equip(shooter); profile.launch(shooter); expect(profile.generation(shooter)).toBe(3);
  memory.writePointer(memory.offset(projectile.address, BigInt(declaration.entity.owner)), shooter.address);
  memory.writePointer(memory.offset(projectile.address, BigInt(declaration.entity.touchCallback)), at(0x1a0));
  expect(profile.matches(projectile, shooter)).toBe(true);
  profile.time(1234n); expect(memory.readInt64(at(0x280))).toBe(1234n);
  memory.writePointer(memory.offset(projectile.address, BigInt(declaration.entity.thinkCallback)), at(0x160));
  memory.writePointer(memory.offset(projectile.address, BigInt(declaration.entity.thinkRegistration)), at(0x300));
  memory.writeInt64(memory.offset(projectile.address, BigInt(declaration.entity.nextThink)), 1234n);
  memory.writeUint32(at(0x308), declaration.think.tag); memory.writePointer(at(0x310), at(0x160));
  expect(profile.nextThink(projectile)).toBe(1234n); profile.think(projectile);
  expect(profile.nextThink(projectile)).toBe(0n); expect(profile.generation(projectile)).toBe(4);
  memory.writeUint32(at(0x308), 999);
  expect(() => profile.think(projectile)).toThrow('typed source save registration');
  memory.writeUint8(memory.offset(projectile.address, BigInt(fieldOffset(edictLayout, 'inuse'))), 1);
  profile.free(projectile);
});
