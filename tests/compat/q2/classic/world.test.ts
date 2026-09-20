import { expect, test, spyOn } from "bun:test";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ClassicGuestWorld, classicGuestUserCommand, type ClassicGuestMap, type ClassicGuestRevisit } from "../../../../src/app/bootstrap/simulation/classic-guest-world.ts";
import { prepareClassicGuest, type PreparedClassicGuest } from "../../../../src/app/bootstrap/simulation/classic-guest-source.ts";
import { SharedPhysics } from "../../../../src/app/bootstrap/simulation/physics.ts";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { openMountPlan } from "../../../../src/content/mounts/index.ts";
import { createMountIdentity } from "../../../../src/contracts/content.ts";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import type { Q2WorldGeometry } from "../../../../src/contracts/scene.ts";
import type { Q2UserCommand } from "../../../../src/contracts/protocol.ts";
import { CvarRegistry } from "../../../../src/core/cvars/index.ts";
import { createNumericOperations, Q2_DONOR_PROFILE } from "../../../../src/core/numeric.ts";
import { parseEntities } from "../../../../src/core/common-parse.ts";
import { decodeQ2Map } from "../../../../src/formats/q2-map/index.ts";
import { ActorCallbackTable, SessionActorRegistry } from "../../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable } from "../../../../src/world/gameplay/index.ts";
import { createSceneQueries } from "../../../../src/world/collision/index.ts";
import { ClassicOriginalSaveFiles, encodeQ2ClassicOriginalSave, decodeQ2ClassicOriginalSave } from "../../../../src/persistence/q2-classic-guest.ts";
import { encodeCheckpointValue, decodeCheckpointValue } from "../../../../src/persistence/value.ts";

import { tmpdir } from "node:os";
import type { WindowsCapabilities } from "../../../../src/guest/runtime/windows/index.ts";
import type { ClassicGuestServicesOptions } from "../../../../src/app/bootstrap/simulation/classic-guest-services.ts";
import { classicGuestFiles } from "../../../../src/app/bootstrap/simulation/classic-guest-files.ts";
type CandidateAction = { readonly kind: "create"; readonly openFile?: WindowsCapabilities["openFile"] } | { readonly kind: "travel"; readonly from: ClassicGuestWorld; readonly map: ClassicGuestMap; readonly revisit?: ClassicGuestRevisit };
const command: Q2UserCommand = { kind: "q2-classic", milliseconds: 100, angleShorts: [0, 0, 0], forwardMove: 100, sideMove: 0, upMove: 0, buttons: 0, impulse: 0, lightLevel: 128 };
function required<T>(value: T | null | undefined): T { if (value === null || value === undefined) throw new Error("Missing native world fixture value"); return value; }
test("classic public command encoding preserves wire-width signed fields", () => {
  const bytes = classicGuestUserCommand({ ...command, angleShorts: [-32768, 32767, 65535], forwardMove: -20 });
  expect([...bytes]).toEqual([100, 0, 0, 128, 255, 127, 255, 255, 236, 255, 0, 0, 0, 0, 0, 128]);
});
async function candidate(prepared: PreparedClassicGuest, geometry: Q2WorldGeometry, savedCvars?: Uint8Array, reconstruction?: { actors: ReturnType<SessionActorRegistry["checkpoint"]>; sources: ReturnType<SessionActorRegistry["sourceCheckpoint"]> }, deathmatch = false, action: CandidateAction = { kind: "create" }) {
  const identity = createIdentityOwner("classic-original-candidate");
  const actors = reconstruction === undefined ? new SessionActorRegistry(identity) : SessionActorRegistry.restore(identity, reconstruction.actors, reconstruction.sources);
  const callbacks = new ActorCallbackTable(actors), scene = createSceneQueries(geometry);
  const physics = new SharedPhysics({ actors, callbacks, scene, numeric: Q2_DONOR_PROFILE, sourceOrder: (a, b) => a.slot - b.slot,
    worldActor: () => required(actors.atSource(prepared.execution.owner.provider, 0)).id, onBlocked: () => undefined });
  const combat = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined }), inventory = new SharedInventoryTable(actors);
  const cvars = action.kind === "travel" ? action.from.services.options.cvars : new CvarRegistry({ dialect: "q2-classic", context: { session: actors.session, origin: { kind: "server-console" } } });
  if (action.kind === "create" && savedCvars === undefined) { cvars.register("ctf", deathmatch ? "1" : "0"); cvars.register("deathmatch", deathmatch ? "1" : "0"); cvars.register("coop", "0"); }
  else if (savedCvars !== undefined) cvars.restoreSaveState(decodeCheckpointValue(savedCvars));
  const portals = new Map<number, boolean>(), files = new ClassicOriginalSaveFiles(action.kind === "create" ? action.openFile : undefined), commands: string[] = [], prints: string[] = [];
  const services: ClassicGuestServicesOptions = { numeric: createNumericOperations(Q2_DONOR_PROFILE), scene, cvars, maxClients: 1, mapPath: "maps/base1.bsp",
      admit: () => undefined, collision: (actor, value) => physics.setCollision(actor, value), print: text => { prints.push(text); },
      command: () => ({ arguments: [], args: "" }), addCommand: text => { commands.push(text); return undefined; }, debugGraph: (value, color) => { prints.push(`graph:${value}:${color}`); return undefined; },
      engine: { actors, callbacks, bodies: physics.bodies, combat, inventory, trace: request => physics.trace(request),
        pointContents: point => { const result = scene.pointContents({ point, target: { kind: "world" }, policy: { kind: "q2", contentsMask: -1, leafContents: "merged" }, numeric: Q2_DONOR_PROFILE, passActor: null }); return result.kind === "q2" ? result.merged : result.contents; },
        inPvs: (first, second) => scene.clusterVisible(scene.leafCluster(scene.pointLeaf(first)), scene.leafCluster(scene.pointLeaf(second)), "pvs"),
        inPhs: (first, second) => scene.clusterVisible(scene.leafCluster(scene.pointLeaf(first)), scene.leafCluster(scene.pointLeaf(second)), "phs"),
        setAreaPortal: (portal, open) => { portals.set(portal, open); scene.setAreaPortalState(portal, open); return undefined; },
        setSolid: (actor, solid, model) => physics.setSolid(actor, solid, model, "q2"), inlineModelBounds: model => scene.modelBounds(model),
        emit: event => { if (event.kind === "print") prints.push(event.text); return undefined; } } };
  const world = action.kind === "create" ? ClassicGuestWorld.create({ prepared, capabilities: { openFile: files.openFile }, instructionBudget: 8_000_000, services })
    : await action.from.travelLoading(action.map, services, async () => { await Bun.sleep(0); }, action.revisit);
  return { world, actors, physics, files, scene, cvars, portals };
}
const pak = "/home/buzzkill/Projects/qfiles/q2/baseq2/pak0.pak";
test.skipIf(!existsSync("/home/buzzkill/Projects/qfiles/q2/xatrix/gamex86.dll") || !existsSync(pak))("classic external player velocity enters source Pmove and remains source owned", async () => {
  const archive = await openArchive(pak);
  const geometry = decodeQ2Map(await archive.readEntry(required(archive.findEntries("maps/base1.bsp")[0])), "base1"); await archive.close();
  const identity = createMountIdentity("mount:test:native-movement", "q2:classic:xatrix:installed", 1);
  using mounts = await openMountPlan({ id: "mount-plan:test:native-movement", mounts: [{ kind: "loose", identity, rootPath: "/home/buzzkill/Projects/qfiles/q2/xatrix" }], defaultOrder: [identity.id], prefixOrders: [] });
  const artifact = required(await mounts.open("gamex86.dll"));
  const prepared = await prepareClassicGuest({ kind: "native", owner: { provider: "q2:classic-native", content: identity.content }, role: "server-game", api: { kind: "q2-classic-game", version: 3 }, profile: { kind: "windows-i386", image: "pe32", pointerBytes: 4, call: "cdecl" }, artifact: artifact.reference }, mounts);
  const running = await candidate(prepared, geometry);
  try {
    const origin = required(parseEntities(geometry.entities).find(entity => entity.get("classname") === "info_player_start")).get("origin") ?? "0 0 128";
    await running.world.initLoading(async () => { await Bun.sleep(0); });
    await running.world.spawnLoading("base1", `{ "classname" "worldspawn" } { "classname" "info_player_start" "origin" "${origin}" }`, async () => { await Bun.sleep(0); }, "");
    expect(running.world.connect(1, "\\name\\Hook test\\skin\\male/grunt\\ip\\127.0.0.1").allowed).toBe(true);
    running.world.begin(1);
    const actor = required(running.world.actor(1)), body = () => required(running.physics.bodies.read(actor));
    const idle = { ...command, milliseconds: 25, forwardMove: 0 };
    const before = body();
    running.world.think(1, idle, { velocity: { x: 0, y: 0, z: 600 }, gravityScale: 1, predictionSuppressed: false });
    expect(body().origin.z).toBeGreaterThan(before.origin.z);
    expect(body().velocity.z).toBeGreaterThan(500);
    const pulled = body();
    running.world.think(1, idle);
    expect(body().origin.z).toBeGreaterThan(pulled.origin.z);
    expect(body().velocity.z).toBeLessThan(pulled.velocity.z);
    expect(body().velocity.z).toBe(running.world.playerState(1).movement.velocityEighths[2] * 0.125);
    running.world.think(1, idle, { velocity: { x: 0, y: 0, z: 0 }, gravityScale: 0, predictionSuppressed: true });
    expect(body().velocity.z).toBe(0);
    expect(running.world.playerState(1).movement.gravity).toBe(0);
    expect(running.world.playerState(1).movement.flags & 64).toBe(64);
    running.world.think(1, idle, { velocity: { x: 0, y: 0, z: 0 }, gravityScale: 1, predictionSuppressed: false });
    expect(body().velocity.z).toBeLessThan(1);
    running.world.think(1, idle);
    expect(body().velocity.z).toBeLessThan(0);
  } finally { running.world.close(); }
});
for (const fixture of [{ name: "ctf", deathmatch: true }, { name: "xatrix", deathmatch: false }]) {
const dll = `/home/buzzkill/Projects/qfiles/q2/${fixture.name}/gamex86.dll`;
test.skipIf(!existsSync(dll) || !existsSync(pak))(`actual native world restores ${fixture.name} original callback files into fresh source actors`, async () => {
  const archive = await openArchive(pak), geometry = decodeQ2Map(await archive.readEntry(required(archive.findEntries("maps/base1.bsp")[0])), "base1"); await archive.close();
  const identity = createMountIdentity("mount:test:native-original", `q2:classic:${fixture.name}:installed`, 1);
  const mounts = await openMountPlan({ id: "mount-plan:test:native-original", mounts: [{ kind: "loose", identity, rootPath: dirname(dll) }], defaultOrder: [identity.id], prefixOrders: [] });
  let initial: Awaited<ReturnType<typeof candidate>> | null = null, restored: Awaited<ReturnType<typeof candidate>> | null = null;
  try {
    const artifact = required(await mounts.open("gamex86.dll"));
    const prepared = await prepareClassicGuest({ kind: "native", owner: { provider: "q2:classic-native", content: identity.content }, role: "server-game", api: { kind: "q2-classic-game", version: 3 }, profile: { kind: "windows-i386", image: "pe32", pointerBytes: 4, call: "cdecl" }, artifact: artifact.reference }, mounts);
    const spawn = required(parseEntities(geometry.entities).find(entity => entity.get("classname") === "info_player_start")).get("origin") ?? "0 0 128";
    const map = { map: "base1", spawnPoint: "", entities: `{ "classname" "worldspawn" "message" "Native original roundtrip" } { "classname" "info_player_start" "origin" "${spawn}" } { "classname" "info_player_deathmatch" "origin" "${spawn}" }` };
    initial = await candidate(prepared, geometry, undefined, undefined, fixture.deathmatch); await initial.world.initLoading(async () => { await Bun.sleep(0); }); await initial.world.spawnLoading(map.map, map.entities, async () => { await Bun.sleep(0); }, map.spawnPoint);
    const userinfo = "\\name\\Original\\skin\\male/grunt\\ip\\127.0.0.1";
    expect(initial.world.connect(1, userinfo).allowed).toBe(true);
    const connectedActor = required(initial.world.actor(1));
    initial.world.frame(100); expect(initial.world.actor(1)?.equals(connectedActor)).toBe(true);
    initial.world.begin(1); expect(initial.world.actor(1)?.equals(connectedActor)).toBe(true);
    if (fixture.deathmatch) initial.world.command(1, ["team", "red"], "red");
    expect(initial.physics.bodies.linked(connectedActor)).not.toBeNull();
    initial.world.userinfo(1, ";"); expect(initial.world.clients[0]?.userinfo).toContain("badinfo");
    for (let frame = 0; frame < 4; frame++) { initial.world.think(1, command); initial.world.frame(100); }
    expect(initial.world.source.host.edicts.at(1).bytes.getInt32(248, true)).toBe(2);
    const before = initial.world.playerState(1), running = initial;
    const save = running.files.capture({ module: running.world.module, map: map.map }, () => ({ configstrings: [...running.world.configstrings()].map(([index, value]) => ({ index, value })),
      portals: [...running.portals].map(([portal, open]) => ({ portal, open })), cvars: encodeCheckpointValue(running.cvars.captureSaveState()) }),
      (game, level, autosave) => running.world.writeOriginal(game, level, autosave));
    expect(save.game.length).toBeGreaterThan(1000); expect(save.level.length).toBeGreaterThan(1000);
    const record = encodeQ2ClassicOriginalSave(save), decoded = decodeQ2ClassicOriginalSave(record, { module: running.world.module, map: map.map });
    const reconstruction = { actors: running.actors.checkpoint(), sources: running.actors.sourceCheckpoint() };
    running.world.close(); expect(running.actors.isLive(connectedActor)).toBe(false); initial = null;
    restored = await candidate(prepared, geometry, decoded.server.cvars, reconstruction); const loaded = restored;
    await loaded.world.initLoading(async () => { await Bun.sleep(0); }); await loaded.files.restoreLoading(decoded, { module: loaded.world.module, map: map.map }, (game, level) => loaded.world.restoreOriginalLoading(game, level, map, () => {
      loaded.world.restoreConfigstrings(new Map(decoded.server.configstrings.map(entry => [entry.index, entry.value])));
      for (const portal of decoded.server.portals) loaded.world.services.options.engine.setAreaPortal(portal.portal, portal.open);
    }, async () => { await Bun.sleep(0); }));
    expect(loaded.world.playerState(1)).toEqual(before);
    expect(loaded.world.actor(1)?.equals(connectedActor)).toBe(false);
    const admissionState = (stage: string) => ({ stage, solid: loaded.world.source.host.edicts.at(1).bytes.getInt32(248, true), player: loaded.world.playerState(1), messages: loaded.world.rawMessages().filter(message => message.bytes[0] === 10).map(message => new TextDecoder().decode(message.bytes.subarray(2))) });
    const admission = [admissionState("restored")];
    expect(loaded.world.connect(1, userinfo).allowed).toBe(true); admission.push(admissionState("connect"));
    loaded.world.begin(1); admission.push(admissionState("begin"));
    if (fixture.deathmatch) {
      loaded.world.command(1, ["team", "red"], "red"); admission.push(admissionState("team red"));
      // The original server forbids deathmatch saves. CTF's real Begin reinitializes
      // this restored body and KillBox telefrags it; preserve that source behavior.
      expect(admission[0]?.solid).toBe(2);
      expect(admission[1]?.solid).toBe(2);
      expect(admission[2]?.player.movement.type).toBe(2);
      expect(admission[2]?.messages.join(" ")).toContain("killed himself");
      expect(admission[3]?.messages.join(" ")).toContain("already on the RED team");
    } else {
      expect(loaded.world.playerState(1).movement).toEqual(before.movement);
      expect(loaded.physics.bodies.linked(required(loaded.world.actor(1)))).not.toBeNull();
    }
    const generations = loaded.actors.checkpoint();
    loaded.actors.rebindRestoredSource("q2:classic-native");
    expect(loaded.actors.checkpoint()).toEqual(generations);
    for (const source of reconstruction.sources) expect(loaded.actors.resolveSaved(source.actor)).toBe(loaded.actors.atSource(source.provider, source.sourceSlot));
    for (let frame = 0; frame < (fixture.deathmatch ? 16 : 4); frame++) { loaded.world.think(1, { ...command, buttons: fixture.deathmatch ? 1 : 0 }); loaded.world.frame(100); }
    expect(loaded.world.playerState(1).movement.type).toBe(0);
    expect(loaded.world.source.host.edicts.at(1).bytes.getInt32(248, true)).toBe(2);
    expect(loaded.world.entityInfo(1).active).toBe(true); expect(loaded.physics.bodies.linked(required(loaded.world.actor(1)))).not.toBeNull();
    loaded.world.disconnect(1); expect(loaded.world.clients).toHaveLength(0);
    loaded.world.close(); expect(loaded.world.source.memory.mappings()).toHaveLength(0); restored = null;
  } finally { initial?.world.discard(); restored?.world.discard(); await mounts.close(); }
});
}


test.skipIf(!existsSync("/home/buzzkill/Projects/qfiles/q2/xatrix/gamex86.dll") || !existsSync(pak))("actual retained Xatrix gamemap keeps DLL globals and revisits level files without game reload", async () => {
  const directory = mkdtempSync(join(tmpdir(), "q2-retained-travel-"));
  const archive = await openArchive(pak), geometry = decodeQ2Map(await archive.readEntry(required(archive.findEntries("maps/base1.bsp")[0])), "base1"); await archive.close();
  const identity = createMountIdentity("mount:test:native-travel", "q2:classic:xatrix:installed", 1);
  const mounts = await openMountPlan({ id: "mount-plan:test:native-travel", mounts: [{ kind: "loose", identity, rootPath: "/home/buzzkill/Projects/qfiles/q2/xatrix" }], defaultOrder: [identity.id], prefixOrders: [] });
  let current: Awaited<ReturnType<typeof candidate>> | null = null;
  try {
    const artifact = required(await mounts.open("gamex86.dll"));
    const prepared = await prepareClassicGuest({ kind: "native", owner: { provider: "q2:classic-native", content: identity.content }, role: "server-game", api: { kind: "q2-classic-game", version: 3 }, profile: { kind: "windows-i386", image: "pe32", pointerBytes: 4, call: "cdecl" }, artifact: artifact.reference }, mounts);
    const origin = required(parseEntities(geometry.entities).find(entity => entity.get("classname") === "info_player_start")).get("origin") ?? "0 0 128";
    const map: ClassicGuestMap = { map: "base1", spawnPoint: "", entities: `{ "classname" "worldspawn" "message" "Retained module" } { "classname" "info_player_start" "origin" "${origin}" }` };
    current = await candidate(prepared, geometry, undefined, undefined, false, { kind: "create", openFile: classicGuestFiles(directory) });
    const first = current; await first.world.initLoading(async () => { await Bun.sleep(0); }); await first.world.spawnLoading(map.map, map.entities, async () => { await Bun.sleep(0); }, map.spawnPoint);
    expect(first.world.admit(1, "\\name\\Traveler\\skin\\male/grunt").allowed).toBe(true);
    first.world.command(1, ["give", "health", "137"], "health 137"); first.world.frame(100);
    expect(first.world.playerState(1).stats[1]).toBe(137);
    const retained = first.world.source, numeric = first.world.services.options.numeric, cvars = first.cvars;
    const frames = spyOn(retained.host, "callLoading"), connects = spyOn(retained.host, "clientConnect"), initializations = spyOn(retained.host, "initLoading"), saves = spyOn(retained.host, "save"), reads = spyOn(retained.host, "saveLoading");
    const frameCalls = () => frames.mock.calls.filter(call => call[0] === "RunFrame");
    const oldClient = required(first.world.actor(1)), oldHistory = first.actors.checkpoint();
    const configstrings = first.world.configstrings(), portals = [...first.portals];
    first.world.writeTravelLevel("base1.sav");
    expect(readFileSync(join(directory, "base1.sav")).length).toBeGreaterThan(1000);
    expect(first.actors.checkpoint()).toEqual(oldHistory); expect(first.actors.isLive(oldClient)).toBe(true);
    expect(retained.host.edicts.at(1).bytes.getInt32(88, true)).toBe(1);
    current = await candidate(prepared, geometry, undefined, undefined, false, { kind: "travel", from: first.world, map: { ...map, map: "base1_travel" } });
    const second = current;
    expect(second.world.source).toBe(retained); expect(second.world.services.options.numeric).toBe(numeric); expect(second.cvars).toBe(cvars);
    expect(frameCalls()).toHaveLength(2); expect(initializations.mock.calls).toHaveLength(0); expect(connects.mock.calls).toHaveLength(0);
    expect(first.actors.isLive(oldClient)).toBe(false); expect(second.world.clients[0]?.phase).toBe("connected");
    for (const operation of [() => first.world.source, () => first.world.services, () => first.world.clients, () => first.world.rawMessages(), () => first.world.configstrings(), () => first.world.playerState(1), () => first.world.frame(100)]) expect(operation).toThrow();
    first.world.close(); first.world.discard(); expect(retained.memory.mappings().length).toBeGreaterThan(0);
    second.world.begin(1); second.world.frame(100); expect(second.world.playerState(1).stats[1]).toBe(137);
    second.world.command(1, ["give", "health", "149"], "health 149"); second.world.frame(100);
    const beforeRevisit = frameCalls().length;
    current = await candidate(prepared, geometry, undefined, undefined, false, { kind: "travel", from: second.world, map,
      revisit: { levelPath: "base1.sav", restoreServerState: world => {
        world.restoreConfigstrings(configstrings);
        for (const [portal, open] of portals) world.services.options.engine.setAreaPortal(portal, open);
      } } });
    const returned = current;
    expect(returned.world.source).toBe(retained); expect(returned.cvars).toBe(cvars); expect(returned.world.services.options.numeric).toBe(numeric);
    expect(frameCalls().length - beforeRevisit).toBe(102); expect(connects.mock.calls).toHaveLength(0); expect(initializations.mock.calls).toHaveLength(0);
    expect(saves.mock.calls.map(call => call[0])).toEqual(["WriteLevel"]);
    expect(reads.mock.calls.map(call => call[0])).toEqual(["ReadLevel"]);
    expect(returned.world.clients[0]?.phase).toBe("connected"); returned.world.begin(1); returned.world.think(1, command); returned.world.frame(100);
    expect(returned.world.playerState(1).stats[1]).toBe(149); expect(returned.world.playerState(1).movement.type).toBe(0);
    expect(returned.physics.bodies.linked(required(returned.world.actor(1)))).not.toBeNull();
    second.world.close(); second.world.discard(); expect(retained.memory.mappings().length).toBeGreaterThan(0);
    returned.world.close(); expect(retained.memory.mappings()).toHaveLength(0); current = null;
    frames.mockRestore(); connects.mockRestore(); initializations.mockRestore(); saves.mockRestore(); reads.mockRestore();
  } finally { current?.world.discard(); await mounts.close(); rmSync(directory, { recursive: true, force: true }); }
});
