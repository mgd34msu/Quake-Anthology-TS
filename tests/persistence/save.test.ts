import { builtInRereleaseWeaponDeclaration, rereleaseWeaponDefinition } from "../../src/compat/q2/rerelease/weapon-behavior-profile.ts";
import { q2EaksWeaponDigest } from "../../src/compat/q2/rerelease/q2eaks-weapon-profile.ts";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecutableRecipe, ProviderReference, ResolvedResourceReference } from "../../src/contracts/content.ts";
import { createContentDigest, createResourceId } from "../../src/contracts/content.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { SaveImage } from "../../src/contracts/session.ts";
import { ActorCallbackTable, SessionActorRegistry, SharedBodyTable, translatedBodyBounds } from "../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable } from "../../src/world/gameplay/index.ts";
import { createNumericOperations, Q3_BINARY32_PROFILE } from "../../src/core/numeric.ts";
import { captureSharedBodies, restoreSharedWorldState, restoreSharedBodyLinks } from "../../src/persistence/world-state.ts";
import { decodeSaveImage, encodeSaveImage, readSaveImage, sourceActorsCheckpoint, writeSaveImage } from "../../src/persistence/save-image.ts";
import { decodeCheckpointValue, encodeCheckpointValue, SaveReader } from "../../src/persistence/value.ts";
import { readRecipe } from "../../src/persistence/recipe.ts";
import { decodeQ2ClassicLevel, encodeQ2ClassicLevel, restoreQ2ClassicRecord } from "../../src/persistence/q2-classic.ts";
import type { Q2ClassicSaveLayout } from "../../src/persistence/q2-classic.ts";
import { decodeQ3ClientSession, encodeQ3ClientSession } from "../../src/persistence/q3.ts";
import { validateSimulationSave } from "../../src/app/bootstrap/simulation/save.ts";

function recipe(): ExecutableRecipe {
  const content = "q1:classic:id1:fixture";
  const provider = (role: string): ProviderReference => ({ provider: `q1:${role}`, content });
  const raw: Omit<ResolvedResourceReference, "id"> = { requestedPath: "maps/start.bsp", provenance: { kind: "loose", memberPath: "maps/start.bsp", mount: { kind: "loose", identity: { id: "mount:q1:fixture", content, generation: 2 }, rootPath: "/fixture" } },
    digest: createContentDigest("0".repeat(64)), byteLength: 123, resolution: { kind: "default-order", plan: "mount-plan:fixture:1", rank: 0 } };
  const geometry = { ...raw, id: createResourceId(raw) };
  return { schemaVersion: 3, id: "recipe:fixture:1", preset: "recipe:fixture:1", map: { geometryContent: content, geometry, entities: provider("game") }, campaign: { kind: "campaign", mission: provider("mission"), gamecode: provider("game") },
    movement: provider("movement"), character: { definition: provider("character"), appearance: provider("appearance") }, weapons: [provider("weapons")], equipment: { grapple: { kind: "disabled" }, handGrenades: { kind: "disabled" } }, enemies: { kind: "map-defined" },
    presentation: { doppler: { kind: "source" }, environment: { kind: "audio-content" }, assets: content, hud: provider("hud"), effects: provider("effects"), audio: provider("audio") }, engineBehavior: provider("engine"), combat: provider("combat"), inventory: provider("inventory"), match: provider("match"), transition: provider("transition"),
    execution: [{ kind: "typescript", owner: provider("game"), implementation: "q1:official", role: "server-game", api: { kind: "q1-netquake", programVersion: 6, systemCrc: 5927 } }],
    mounts: { id: "mount-plan:fixture:1", mounts: [raw.provenance.mount], defaultOrder: [raw.provenance.mount.identity.id], prefixOrders: [] }, resources: [geometry], timing: [],
    ordering: { kind: "native", traversal: "source-slot-order", clock: { kind: "q1-netquake", minimumFrameSeconds: 0.001, maximumFrameSeconds: 0.1, fixedFrameSeconds: null } } };
}

test("prebound restore verifies exact source values and retains writable authority", () => {
  const identity = createIdentityOwner("prebound-save"), original = new SessionActorRegistry(identity);
  const actor = original.allocateAtSource("q1:game", 1, "q1:player"), ground = original.allocateAtSource("q1:game", 0, "q1:world");
  const savedActor = { slot: actor.id.slot, generation: actor.id.generation }, savedGround = { slot: ground.id.slot, generation: ground.id.generation };
  const zero = { x: 0, y: 0, z: 0 };
  const body = { origin: { ...zero, x: -0 }, angles: zero, velocity: zero, bounds: { min: zero, max: zero }, ground: savedGround };
  const state = { health: 73, armor: { kind: "none" }, mass: 200, canTakeDamage: true, invulnerable: false, team: null } satisfies SaveImage["combat"][number]["state"];
  const entry = { item: "q1:ammo/nails", count: -3, capacity: 200, countPolicy: { kind: "source-counter", arithmetic: "binary32" } } satisfies SaveImage["inventories"][number]["entries"][number];
  const image: SaveImage = { schemaVersion: 2, recipe: recipe(), frame: { frame: 1, time: { kind: "seconds", value: 0.1 }, elapsed: { kind: "seconds", value: 0.1 }, phase: "frame-exit" },
    nextEventSequence: 0, clocks: [], random: [], actors: original.checkpoint(),
    bodies: [{ actor: savedActor, body, attachment: null, linked: null, linkCount: 0 }], combat: [{ actor: savedActor, state }],
    inventories: [{ actor: savedActor, entries: [entry] }], configurations: [], thinks: [], providers: [], guests: [] };
  const actors = SessionActorRegistry.restore(identity, image.actors, original.sourceCheckpoint());
  original.close();
  const restored = actors.resolveSaved(savedActor), restoredGround = actors.resolveSaved(savedGround);
  if (restored === null || restoredGround === null) throw new Error("Missing restored actors");
  const bytes = new ArrayBuffer(12), words = new DataView(bytes);
  words.setFloat32(0, -0, true); words.setFloat32(4, 73, true); words.setFloat32(8, -3, true);
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
  bodies.bind(restored, { read: () => ({ ...body, origin: { ...zero, x: words.getFloat32(0, true) }, ground: restoredGround.id }),
    write: value => { words.setFloat32(0, value.origin.x, true); return undefined; } });
  const combat = new GameplayAuthority(actors, new ActorCallbackTable(actors), { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined });
  combat.bind(restored, { read: () => ({ ...state, health: words.getFloat32(4, true) }), writeHealth: value => { words.setFloat32(4, value, true); return undefined; }, writeArmor: () => undefined });
  const inventory = new SharedInventoryTable(actors);
  inventory.bind(restored, { read: () => [{ ...entry, count: words.getFloat32(8, true) }], write: value => { words.setFloat32(8, value.count, true); return undefined; } });
  const host = { actors, bodies, combat, inventory, storage: () => "prebound" } satisfies Parameters<typeof restoreSharedWorldState>[1];
  restoreSharedWorldState(decodeSaveImage(encodeSaveImage(image)), host);
  expect(bodies.read(restored.id)?.ground?.equals(restoredGround.id)).toBe(true);
  expect(() => restoreSharedWorldState({ ...image, bodies: [] }, host)).toThrow("coverage");
  expect(() => restoreSharedWorldState({ ...image, bodies: image.bodies.map(record => ({ ...record, body: { ...body, origin: zero } })) }, host)).toThrow("source body disagrees");
  expect(() => restoreSharedWorldState({ ...image, combat: [{ actor: savedActor, state: { ...state, health: 74 } }] }, host)).toThrow("source combat disagrees");
  expect(() => restoreSharedWorldState({ ...image, inventories: [{ actor: savedActor, entries: [{ ...entry, countPolicy: { kind: "source-counter", arithmetic: "int32" } }] }] }, host)).toThrow("source inventory disagrees");
  expect(Object.is(words.getFloat32(0, true), -0)).toBe(true);
  expect(words.getFloat32(4, true)).toBe(73);
  expect(inventory.adjustSourceCounter(restored, entry.item, -1)).toBe(-4);
  expect(words.getFloat32(8, true)).toBe(-4);
  bodies.write(restored, { ...body, ground: restoredGround.id, origin: { ...zero, x: 5 } });
  expect(words.getFloat32(0, true)).toBe(5);
  words.setFloat32(4, 21, true);
  expect(combat.read(restored.id)?.health).toBe(21);
  actors.close();
});

test("simulation restore rejects missing, duplicate and foreign source records before construction", () => {
  const frame = { frame: 1, time: { kind: "seconds", value: 0.1 }, elapsed: { kind: "seconds", value: 0.1 }, phase: "frame-exit" } satisfies SaveImage["frame"];
  const image: SaveImage = { schemaVersion: 2, recipe: recipe(), frame, nextEventSequence: 0,
    clocks: [{ provider: "q1:game", time: frame.time }], random: [{ provider: "q1:game", state: { kind: "msvcrt-rand", seed: 1, draws: 0 } }],
    actors: [], bodies: [], combat: [], inventories: [], configurations: [], thinks: [], guests: [],
    providers: [sourceActorsCheckpoint([]), { provider: "q1:game", schema: "world:simulation", version: 11, bytes: encodeCheckpointValue({}) },
      { provider: "q1:game", schema: "q1:foundation", version: 1, bytes: encodeCheckpointValue([]) }] };
  validateSimulationSave(image);
  expect(() => validateSimulationSave({ ...image, providers: image.providers.filter(record => record.schema !== "q1:foundation") })).toThrow("q1:foundation");
  expect(() => validateSimulationSave({ ...image, providers: [...image.providers, ...image.providers] })).toThrow("Duplicate");
  expect(() => validateSimulationSave({ ...image, providers: image.providers.map(record => record.schema === "q1:foundation" ? { ...record, provider: "q2:game" } : record) })).toThrow("different owner");
  expect(() => validateSimulationSave({ ...image, clocks: [{ provider: "q1:game", time: { kind: "seconds", value: 2 } }] })).toThrow("clock");
  const execution = { kind: "quakec", owner: image.recipe.map.entities, role: "server-game", artifact: image.recipe.map.geometry,
    api: { kind: "q1-netquake", programVersion: 6, systemCrc: 5927 } } satisfies ExecutableRecipe["execution"][number];
  const module = { id: execution.owner.provider, artifactPath: execution.artifact.requestedPath, digest: execution.artifact.digest, revision: execution.artifact.digest };
  const guest = { kind: "quakec", module, api: execution.api, random: [], callbacks: [], globals: new Uint8Array(), entities: new Uint8Array(),
    entityStrideBytes: 4, entityCount: 0, strings: new Uint8Array(), statement: 0, functionIndex: 0, argumentCount: 0,
    callStack: [], locals: new Uint8Array(), hostState: { module, format: "quakec:host-v1", bytes: new Uint8Array() } } satisfies SaveImage["guests"][number];
  const qc: SaveImage = { ...image, recipe: { ...image.recipe, execution: [execution] }, guests: [guest], providers: image.providers.filter(record => record.schema !== "q1:foundation") };
  validateSimulationSave(qc);
  expect(() => validateSimulationSave({ ...qc, guests: [] })).toThrow("exactly one");
  expect(() => validateSimulationSave({ ...qc, guests: [guest, guest] })).toThrow("exactly one");
  expect(() => validateSimulationSave({ ...qc, guests: [{ ...guest, api: { kind: "q1-quakeworld", programVersion: 6, systemCrc: 54730 } }] })).toThrow("artifact and API");
  expect(() => validateSimulationSave({ ...qc, guests: [{ ...guest, hostState: { ...guest.hostState, module: { ...module, revision: "wrong" } } }] })).toThrow("artifact and API");
});

test("saved body attachments remap anchor generations and preserve their follow rule", () => {
  const identity = createIdentityOwner("attached-save"), actors = new SessionActorRegistry(identity);
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
  const anchor = actors.allocate("q3:game", "q3:mover"), child = actors.allocate("q2:equipment", "q2:hook");
  const zero = { x: 0, y: 0, z: 0 }, state = { origin: zero, angles: zero, velocity: zero, bounds: { min: zero, max: zero }, ground: null };
  bodies.create(anchor, state); bodies.create(child, { ...state, origin: { x: 8, y: 0, z: 0 } });
  bodies.attach(child, { anchor: anchor.id, follow: { kind: "translation", offset: { x: 8, y: 0, z: 0 } } });
  bodies.link(anchor); bodies.link(child);
  const image: SaveImage = { schemaVersion: 2, recipe: recipe(), frame: { frame: 1, time: { kind: "seconds", value: 0.1 }, elapsed: { kind: "seconds", value: 0.1 }, phase: "frame-exit" },
    nextEventSequence: 0, clocks: [], random: [], actors: actors.checkpoint(), bodies: captureSharedBodies(actors, bodies), combat: [], inventories: [], configurations: [], thinks: [], providers: [], guests: [] };
  const saved = decodeSaveImage(encodeSaveImage(image));
  actors.close();
  const restored = SessionActorRegistry.restore(identity, saved.actors, []), callbacks = new ActorCallbackTable(restored);
  const restoredBodies = new SharedBodyTable(restored, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
  restoreSharedWorldState(saved, { actors: restored, bodies: restoredBodies, combat: new GameplayAuthority(restored, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined }), inventory: new SharedInventoryTable(restored), storage: () => "copied" });
  restoreSharedBodyLinks(saved, { actors: restored, bodies: restoredBodies });
  const restoredAnchor = restored.resolveSaved(anchor.id), restoredChild = restored.resolveSaved(child.id);
  if (restoredAnchor === null || restoredChild === null) throw new Error("Missing restored attachment actors");
  expect(restoredAnchor.id.generation).not.toBe(anchor.id.generation);
  expect(restoredBodies.attachment(restoredChild.id)?.anchor).toBe(restoredAnchor.id);
  restoredBodies.write(restoredAnchor, { ...state, origin: { x: 94, y: 0, z: 0 } });
  restoredBodies.transportAttachments(createNumericOperations(Q3_BINARY32_PROFILE));
  expect(restoredBodies.read(restoredChild.id)?.origin.x).toBe(102);
  const oldSignature = encodeSaveImage(image); oldSignature[6] = 49;
  expect(() => decodeSaveImage(oldSignature)).toThrow("signature/version");
});

test("saved gameplay selections cannot silently restart without their private checkpoint", () => {
  const image: SaveImage = { schemaVersion: 2, recipe: recipe(), frame: { frame: 1, time: { kind: "seconds", value: 0.1 }, elapsed: { kind: "seconds", value: 0.1 }, phase: "frame-exit" },
    nextEventSequence: 0, clocks: [], random: [], actors: [], bodies: [], combat: [], inventories: [], configurations: [], thinks: [], providers: [], guests: [] };
  expect(decodeSaveImage(encodeSaveImage(image)).mods).toBeUndefined();
  expect(decodeSaveImage(encodeSaveImage({ ...image, recipe: { ...image.recipe, mods: [] } })).mods).toBeUndefined();
  const digest = createContentDigest("0".repeat(64));
  const selected: SaveImage = { ...image, recipe: { ...image.recipe, mods: [{ selection: { product: "fixture", id: "health" },
    source: { provider: "q1:official", content: "q1:classic:id1:fixture" }, title: "Health", sourceTitle: "Quake", requires: [], conflicts: [], declarationDigest: digest,
    declaration: { version: 1, runtime: "quakec", program: { path: "progs.dat", digest }, actorFields: [], callbacks: [] } }] } };
  expect(() => decodeSaveImage(encodeSaveImage(selected))).toThrow("selected gameplay mods require their saved checkpoint");
});

test("unified save reconstructs actors, bytes, source clocks and callback identities in a fresh Bun process", async () => {
  const actors = new SessionActorRegistry(createIdentityOwner("before-save"));
  const actor = actors.allocateAtSource("q1:game", 7, "q1:player");
  const module = { id: "q3:fixture", artifactPath: "vm/qagame.qvm", digest: createContentDigest("1".repeat(64)), revision: "1" } satisfies Q2ClassicSaveLayout["module"];
  const image: SaveImage = { schemaVersion: 2, recipe: recipe(), frame: { frame: 3, time: { kind: "seconds", value: 2.5 }, elapsed: { kind: "seconds", value: 0.1 }, phase: "frame-exit" }, nextEventSequence: 19,
    clocks: [{ provider: "q1:game", time: { kind: "seconds", value: 2.5 } }], random: [{ provider: "q1:game", state: { kind: "msvcrt-rand", seed: 1234, draws: 17 } }], actors: actors.checkpoint(),
    bodies: [{ actor: actor.id, attachment: null, linkCount: 0, linked: null, body: { origin: { x: 12, y: 20, z: -0 }, angles: { x: 0, y: 45, z: 0 }, velocity: { x: 10, y: 0, z: 0 }, bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } }, ground: null } }],
    combat: [{ actor: { slot: actor.id.slot, generation: actor.id.generation }, state: { health: 73, armor: { kind: "none" }, mass: 100, canTakeDamage: true, invulnerable: false, noKnockback: true, team: null } }],
    inventories: [{ actor: { slot: actor.id.slot, generation: actor.id.generation }, entries: [{ item: "q1:ammo/nails", count: -3, capacity: 200, countPolicy: { kind: "source-counter", arithmetic: "binary32" } }] }], configurations: [], thinks: [{ actor: { slot: actor.id.slot, generation: actor.id.generation }, callback: "q1:door-think", due: { kind: "seconds", value: 2.6 }, boundary: "after-physics", provider: "q1:game", sequence: 4 }],
    providers: [sourceActorsCheckpoint(actors.sourceCheckpoint()), { provider: "fixture:private", schema: "fixture:bytes", version: 7, bytes: new Uint8Array([0, 255, 17]) }],
    guests: [{ kind: "qvm", module, abiProfile: "q3-modern", api: { kind: "q3-qagame", version: 8 }, data: new Uint8Array([255, 0, 1, 128]), instructionIndex: 0, programStack: 4, operandStack: [], random: [], callbacks: [{ id: "q3:callback", reference: { kind: "native-guest", module, byteOffset: 0xffffffffffffffffn, abi: { kind: "linux-x86-64", image: "elf64", pointerBytes: 8, call: "system-v-x86-64" } }, parameters: [], result: "void" }], hostState: { module, format: "fixture:host", bytes: new Uint8Array([9, 8, 7]) } }] };
  // A structural SavedActorId must be encoded as fields, never as a live identity class.
  const body = image.bodies[0]; if (body === undefined) throw new Error("missing body");
  const saved: SaveImage = { ...image, bodies: [{ ...body, actor: { slot: actor.id.slot, generation: actor.id.generation }, linkCount: 7,
    linked: { state: { ...body.body, origin: { x: 0, y: 0, z: 0 } }, absoluteBounds: body.body.bounds } }] };
  expect(() => encodeSaveImage(image)).toThrow("live objects");
  const decoded = decodeSaveImage(encodeSaveImage(saved));
  expect(decoded).toEqual(saved);
  expect(Object.is(decoded.bodies[0]?.body.origin.z, -0)).toBe(true);
  const directory = await mkdtemp(join(tmpdir(), "quake-save-"));
  try {
    const path = join(directory, "session.qts"); await writeSaveImage(path, saved);
    expect((await readSaveImage(path)).combat[0]?.state.health).toBe(73);
    const child = Bun.spawn([process.execPath, "-e", `
      import { readSaveImage,readSourceActorsCheckpoint } from './src/persistence/save-image.ts';
      import { SessionActorRegistry } from './src/world/actors/index.ts';
      import { SharedBodyTable, ActorCallbackTable, translatedBodyBounds } from './src/world/actors/index.ts';
      import { GameplayAuthority, SharedInventoryTable } from './src/world/gameplay/index.ts';
      import { restoreSharedWorldState,restoreSharedBodyLinks } from './src/persistence/world-state.ts';
      import { createIdentityOwner } from './src/contracts/identity.ts';
      const save=await readSaveImage(process.argv[1]);
      const source=save.providers.find(p=>p.provider==='world:actors');
      if(!source) throw new Error('missing source slots');
      const registry=SessionActorRegistry.restore(createIdentityOwner('fresh'),save.actors,readSourceActorsCheckpoint(source));
      const bodies=new SharedBodyTable(registry,{absoluteBounds:translatedBodyBounds,onLink:()=>{},onUnlink:()=>{}});
      const combat=new GameplayAuthority(registry,new ActorCallbackTable(registry),{impulse:()=>{},beforeReaction:()=>{},confirmed:()=>{}});
      const inventory=new SharedInventoryTable(registry);
      restoreSharedWorldState(save,{actors:registry,bodies,combat,inventory,storage:()=> 'copied'});
      restoreSharedBodyLinks(save,{actors:registry,bodies});
      const actor=registry.atSource('q1:game',7);
      if(actor===null||combat.read(actor.id)?.health!==73||combat.read(actor.id)?.noKnockback!==true||bodies.read(actor.id)?.origin.x!==12||save.guests[0]?.kind!=='qvm'||save.guests[0].data[3]!==128) throw new Error('restore failed');
      if(bodies.linked(actor.id)?.state.origin.x!==0||bodies.linked(actor.id)?.absoluteBounds.min.x!==-16||bodies.linked(actor.id)?.linkCount!==7) throw new Error('saved link state lost');
      bodies.link(actor);
      if(bodies.linked(actor.id)?.linkCount!==8||bodies.linked(actor.id)?.state.origin.x!==12) throw new Error('source link continuation failed');
      if(inventory.count(actor.id,'q1:ammo/nails')!==-3||inventory.adjustSourceCounter(actor,'q1:ammo/nails',-1)!==-4) throw new Error('signed source counter lost');
      process.stdout.write('restored');
    `, path], { cwd: join(import.meta.dir, "../.."), stdout: "pipe", stderr: "pipe" });
    const [status, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ status, stdout, stderr }).toEqual({ status: 0, stdout: "restored", stderr: "" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("recipe map product survives base geometry fallback and rejects the old schema", () => {
  const base = recipe();
  const selected: ExecutableRecipe = { ...base, map: { ...base.map, geometryContent: "q1:rerelease:hipnotic:fixture" } };
  expect(readRecipe(new SaveReader(selected, "recipe"))).toEqual(selected);
  expect(selected.map.geometryContent).not.toBe(selected.map.geometry.provenance.mount.identity.content);
  expect(() => readRecipe(new SaveReader({ ...selected, schemaVersion: 1 }, "recipe"))).toThrow();
});

test("provider checkpoint values retain 64-bit bytes and reject live Maps", () => {
  const value = { flags: 18446744069414584320n, bytes: new Uint8Array([255, 0, 3]), number: NaN };
  expect(decodeCheckpointValue(encodeCheckpointValue(value))).toEqual(value);
  expect(() => encodeCheckpointValue(new Map([["live", 1]]))).toThrow("live objects");
});

test("classic native records preserve private bytes and relocate typed saved pointer fields", () => {
  const module = { id: "q2:fixture", artifactPath: "game.so", digest: createContentDigest("2".repeat(64)), revision: "fixture" } satisfies Q2ClassicSaveLayout["module"];
  const layout: Q2ClassicSaveLayout = { module, pointerBytes: 4, gameBytes: 4, clientCountOffset: 0, client: { byteLength: 4, fields: [] }, level: { byteLength: 4, fields: [] },
    entity: { byteLength: 12, fields: [{ name: "classname", offset: 0, kind: "string" }, { name: "enemy", offset: 4, kind: "entity" }] } };
  const body = new Uint8Array(12); body[11] = 231;
  const record = { bytes: body, strings: [{ field: "classname", bytes: new Uint8Array([111, 103, 114, 101, 0]) }], references: [{ field: "enemy", index: 7 }] };
  const original = encodeQ2ClassicLevel({ functionBase: 0x12345678n, level: { bytes: new Uint8Array(4), strings: [], references: [] }, entities: [{ slot: 3, record }] }, layout);
  const decoded = decodeQ2ClassicLevel(original, layout);
  expect(encodeQ2ClassicLevel(decoded, layout)).toEqual(original);
  const saved = decoded.entities[0]?.record; if (saved === undefined) throw new Error("missing entity");
  const restored = restoreQ2ClassicRecord(saved, layout.entity, { pointerBytes: 4, string: () => 0x10000n, reference: (_field, index) => 0x20000n + BigInt(index * 12) });
  expect(new DataView(restored.buffer).getUint32(4, true)).toBe(0x20000 + 7 * 12);
  expect(restored[11]).toBe(231);
});

test("Q3 session cvars use original seven signed integer fields", () => {
  const text = "2 1200 3 -1 15 7 1";
  expect(encodeQ3ClientSession(decodeQ3ClientSession(text))).toBe(text);
  expect(decodeQ3ClientSession("4294967298 0 0 0 0 0 0").team).toBe(2);
});

test("schema 3 monster targets retain old references and encode native defaults and exceptions", () => {
  const base = recipe(), definition = { source: base.map.entities, classname: "monster_army" };
  for (const enemies of [
    { kind: "replace", default: definition, byClassname: { monster_ogre: definition } },
    { kind: "replace", default: { kind: "map-defined" }, byClassname: { monster_army: definition } },
    { kind: "replace", default: definition, byClassname: { monster_ogre: { kind: "map-defined" } } },
  ] satisfies readonly ExecutableRecipe["enemies"][]) {
    const selected = { ...base, enemies };
    expect(readRecipe(new SaveReader(decodeCheckpointValue(encodeCheckpointValue(selected))))).toEqual(selected);
  }
  for (const target of [{ kind: "unknown" }, { kind: "map-defined", source: definition.source }, { kind: "map-defined", classname: "monster_army" }]) {
    expect(() => readRecipe(new SaveReader({ ...base, enemies: { kind: "replace", default: target, byClassname: {} } }))).toThrow();
  }
});


test("environment selection roundtrips and older recipes retain game defaults", () => {
  const base = recipe();
  for (const environment of [{ kind: "audio-content" }, { kind: "disabled" }, { kind: "selected", resource: { content: base.presentation.audio.content, path: "sound/default.environments" } }] satisfies readonly ExecutableRecipe["presentation"]["environment"][]) {
    const selected = { ...base, presentation: { ...base.presentation, environment } };
    expect(readRecipe(new SaveReader(decodeCheckpointValue(encodeCheckpointValue(selected))))).toEqual(selected);
  }
  const { environment: _environment, ...presentation } = base.presentation;
  expect(readRecipe(new SaveReader({ ...base, presentation })).presentation.environment).toEqual({ kind: "audio-content" });
  for (const environment of [null, { kind: "automatic-fallback" }, { kind: "selected", resource: { content: base.presentation.audio.content } }]) {
    expect(() => readRecipe(new SaveReader({ ...base, presentation: { ...base.presentation, environment } }))).toThrow();
  }
});


test("Doppler choice survives saves and legacy omission preserves source behavior", () => {
  const base = recipe();
  const selected = { ...base, presentation: { ...base.presentation, doppler: { kind: "disabled" } } };
  expect(readRecipe(new SaveReader(decodeCheckpointValue(encodeCheckpointValue(selected)))).presentation.doppler).toEqual({ kind: "disabled" });
  const { doppler: _doppler, ...presentation } = base.presentation;
  expect(readRecipe(new SaveReader({ ...base, presentation })).presentation.doppler).toEqual({ kind: "source" });
  expect(() => readRecipe(new SaveReader({ ...base, presentation: { ...presentation, doppler: { kind: "realistic" } } }))).toThrow();
});

test("QVM behavior recipes preserve declared private layout and reject missing or aliased fields",()=>{
  const base=recipe(),raw={...base.map.geometry,requestedPath:"vm/qagame.qvm"},artifact={...raw,id:createResourceId(raw)};
  const module:import("../../src/contracts/execution.ts").ModuleIdentity={id:"weapon-behavior:fixture",artifactPath:artifact.requestedPath,digest:artifact.digest,revision:artifact.digest};
  const selection:NonNullable<ExecutableRecipe["weaponBehaviors"]>[number]={source:{provider:module.id,content:base.map.geometryContent},artifact,
    definition:{id:"qvm:declared",title:"Declared ABI",module,role:"rocket",aspect:"trajectory",fire:{kind:"qvm",module,instructionIndex:9},activate:null},
    component:{kind:"qvm",abiProfile:"q3-modern",layout:{entityStride:544,levelTime:4,allocate:3,free:6,fields:{inuse:516,nextthink:520,think:524,health:528},fireAbi:"entity-pointer-start-direction"}}};
  const restore=(value:unknown)=>readRecipe(new SaveReader(decodeCheckpointValue(encodeCheckpointValue(value)),"recipe"));
  expect(restore({...base,weaponBehaviors:[selection]}).weaponBehaviors?.[0]).toEqual(selection);
  expect(()=>restore({...base,weaponBehaviors:[{source:selection.source,artifact,definition:selection.definition}]})).toThrow("source layout");
  const component=selection.component;if(component?.kind !== "qvm")throw new Error("Missing test layout");
  expect(()=>restore({...base,weaponBehaviors:[{...selection,component:{...component,layout:{...component.layout,fields:{...component.layout.fields,think:528}}}}]})).toThrow("overlapping");
});

test("native recipe saves retain declaration identity and normalize only the known legacy profile", () => {
  const base = recipe(), raw = { ...base.map.geometry, requestedPath: "game_x64.dll", digest: q2EaksWeaponDigest }, artifact = { ...raw, id: createResourceId(raw) };
  const module = { id: "weapon-behavior:fixture", artifactPath: artifact.requestedPath, digest: artifact.digest, revision: artifact.digest } satisfies import("../../src/contracts/execution.ts").ModuleIdentity;
  const declaration = builtInRereleaseWeaponDeclaration(module), definition = rereleaseWeaponDefinition(module);
  if (declaration === null || definition === null) throw new Error("Missing builtin profile");
  const legacy = { source: { provider: module.id, content: base.map.geometryContent }, artifact, definition };
  const selection = { ...legacy, component: { kind: "rerelease-native", declaration } } satisfies NonNullable<ExecutableRecipe["weaponBehaviors"]>[number];
  const restore = (value: unknown) => readRecipe(new SaveReader(decodeCheckpointValue(encodeCheckpointValue(value)), "recipe")).weaponBehaviors?.[0];
  expect(restore({ ...base, weaponBehaviors: [selection] })).toEqual(selection);
  expect(restore({ ...base, weaponBehaviors: [legacy] })).toEqual(selection);
  expect(() => restore({ ...base, weaponBehaviors: [{ ...selection, component: { ...selection.component, declaration: { ...declaration, id: "test:changed" } } }] })).toThrow("differs");
});
