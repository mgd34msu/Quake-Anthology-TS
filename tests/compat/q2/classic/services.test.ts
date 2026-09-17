import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { classicGuestFiles } from "../../../../src/app/bootstrap/simulation/classic-guest-files.ts";
import { ClassicGuestServices } from "../../../../src/app/bootstrap/simulation/classic-guest-services.ts";
import { ClassicGuestSource, prepareClassicGuest } from "../../../../src/app/bootstrap/simulation/classic-guest-source.ts";
import { SharedPhysics } from "../../../../src/app/bootstrap/simulation/physics.ts";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { openMountPlan } from "../../../../src/content/mounts/index.ts";
import { createMountIdentity } from "../../../../src/contracts/content.ts";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import { CvarRegistry } from "../../../../src/core/cvars/index.ts";
import { createNumericOperations, Q2_DONOR_PROFILE } from "../../../../src/core/numeric.ts";
import { decodeQ2Map } from "../../../../src/formats/q2-map/index.ts";
import { ActorCallbackTable, SessionActorRegistry } from "../../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable } from "../../../../src/world/gameplay/index.ts";
import { createSceneQueries } from "../../../../src/world/collision/index.ts";
import type { Q2PresentationEvent } from "../../../../src/content/q2/foundation/host.ts";
import { CLASSIC_Q2_ABI } from "../../../../src/compat/q2/classic/layout.ts";
import { allocateClassicString } from "../../../../src/compat/q2/classic/records.ts";
import type { GuestCallContext } from "../../../../src/contracts/execution.ts";
import { parseEntities } from "../../../../src/core/common-parse.ts";

function required<T>(value: T | null | undefined): T { if (value === null || value === undefined) throw new Error("Missing fixture value"); return value; }
test("native CRT files preserve dispositions, cursor-independent IO and contained mounted reads", () => {
  const root = mkdtempSync(join(tmpdir(), "classic-files-"));
  try {
    const open = classicGuestFiles(root, new Map([["settings.cfg", Uint8Array.of(7, 8, 9)]]));
    const file = required(open("save\\game.sav", { read: true, write: true, creation: 2 }));
    expect(file.write(3, Uint8Array.of(10, 20))).toBe(2); expect(file.read(0, 5)).toEqual(Uint8Array.of(0, 0, 0, 10, 20));
    file.flush(); file.close(); file.close(); expect(() => file.size()).toThrow("closed");
    expect(open("save/game.sav", { read: true, write: true, creation: 1 })).toBeNull();
    const resumed = required(open("save/game.sav", { read: true, write: true, creation: 3 }));
    expect(resumed.size()).toBe(5); resumed.truncate(2); resumed.close();
    expect(readFileSync(join(root, "save/game.sav"))).toHaveLength(2);
    const mounted = required(open("settings.cfg", { read: true, write: false, creation: 3 }));
    expect(mounted.read(1, 3)).toEqual(Uint8Array.of(8, 9)); expect(() => mounted.write(0, Uint8Array.of(1))).toThrow("read-only"); mounted.close();
    expect(() => open("../escape", { read: true, write: true, creation: 2 })).toThrow();
    symlinkSync(tmpdir(), join(root, "outside"));
    expect(open("outside/native-test", { read: true, write: true, creation: 2 })).toBeNull();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
const dll = "/home/buzzkill/Projects/qfiles/q2/ctf/gamex86.dll", pak = "/home/buzzkill/Projects/qfiles/q2/baseq2/pak0.pak";
test.skipIf(!existsSync(dll) || !existsSync(pak))("actual DLL shares BSP collision, borrowed actors, player state, wire messages and disk lifetime", async () => {
  const archive = await openArchive(pak);
  const geometry = decodeQ2Map(await archive.readEntry(required(archive.findEntries("maps/base1.bsp")[0])), "base1");
  await archive.close();
  const identity = createMountIdentity("mount:test:classic-services", "q2:classic:ctf:installed", 1);
  const mounts = await openMountPlan({ id: "mount-plan:test:classic-services", mounts: [{ kind: "loose", identity, rootPath: dirname(dll) }], defaultOrder: [identity.id], prefixOrders: [] });
  const root = mkdtempSync(join(tmpdir(), "classic-services-"));
  let source: ClassicGuestSource | null = null;
  try {
    const artifact = required(await mounts.open("gamex86.dll"));
    const prepared = await prepareClassicGuest({ kind: "native", owner: { provider: "q2:ctf-native", content: identity.content }, role: "server-game", api: { kind: "q2-classic-game", version: 3 }, profile: { kind: "windows-i386", image: "pe32", pointerBytes: 4, call: "cdecl" }, artifact: artifact.reference }, mounts);
    const actors = new SessionActorRegistry(createIdentityOwner("classic-services")), callbacks = new ActorCallbackTable(actors), scene = createSceneQueries(geometry);
    let services: ClassicGuestServices | null = null;
    const getServices = (): ClassicGuestServices => { if (services === null) throw new Error("Missing native services"); return services; };
    const physics = new SharedPhysics({ actors, callbacks, scene, numeric: Q2_DONOR_PROFILE, sourceOrder: (a, b) => a.slot - b.slot,
      worldActor: () => required(getServices().host.edicts.at(0).currentActor()), onBlocked: () => undefined });
    const combat = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined }), inventory = new SharedInventoryTable(actors);
    const cvars = new CvarRegistry({ dialect: "q2-classic", context: { session: actors.session, origin: { kind: "server-console" } } });
    cvars.register("maxclients", "4");
    let clientCommand: { readonly arguments: readonly string[]; readonly args: string } = { arguments: [], args: "" };
    const prints: string[] = [], events: Q2PresentationEvent[] = [], commands: string[] = [], graph: { value: number; color: number }[] = [];
    source = ClassicGuestSource.create(prepared, { capabilities: { openFile: classicGuestFiles(root) }, services: memory => {
      services = new ClassicGuestServices(memory, { numeric: createNumericOperations(Q2_DONOR_PROFILE), scene, cvars, maxClients: 4, mapPath: "maps/base1.bsp",
        admit: () => undefined, collision: (actor, value) => physics.setCollision(actor, value), print: text => { prints.push(text); },
        command: () => clientCommand, addCommand: text => { commands.push(text); return undefined; }, debugGraph: (value, color) => { graph.push({ value, color }); return undefined; },
        engine: { actors, callbacks, bodies: physics.bodies, combat, inventory, trace: request => physics.trace(request),
          pointContents: point => { const result = scene.pointContents({ point, target: { kind: "world" }, policy: { kind: "q2", contentsMask: -1, leafContents: "merged" }, numeric: Q2_DONOR_PROFILE, passActor: null }); return result.kind === "q2" ? result.merged : result.contents; },
          inPvs: (first, second) => scene.clusterVisible(scene.leafCluster(scene.pointLeaf(first)), scene.leafCluster(scene.pointLeaf(second)), "pvs"),
          inPhs: (first, second) => scene.clusterVisible(scene.leafCluster(scene.pointLeaf(first)), scene.leafCluster(scene.pointLeaf(second)), "phs"),
          setAreaPortal: (portal, open) => { scene.setAreaPortalState(portal, open); return undefined; },
          setSolid: (actor, solid, model) => physics.setSolid(actor, solid, model, "q2"), inlineModelBounds: model => scene.modelBounds(model),
          emit: event => { events.push(event); return undefined; } } });
      return services.services;
    }, instructionBudget: 8_000_000 });
    const adapter = getServices(); adapter.bindHost(source.host); source.init();
    const spawn = required(parseEntities(geometry.entities).find(entity => entity.get("classname") === "info_player_start")).get("origin") ?? "0 0 128";
    source.host.spawnEntities("base1", `{ "classname" "worldspawn" "message" "Real native shared scene" } { "classname" "info_player_deathmatch" "origin" "${spawn}" }`, "");
    adapter.completeSpawn();
    expect(adapter.configstrings().get(5)?.length).toBeGreaterThan(64);
    expect(adapter.resourceIndex("model", "*1")).toBe(2);
    expect(source.host.clientConnect(1, "\\name\\Native\\skin\\male/grunt\\ip\\127.0.0.1").allowed).toBe(true);
    source.host.clientEvent("ClientBegin", 1);
    clientCommand = { arguments: ["team", "red"], args: "red" }; source.host.clientEvent("ClientCommand", 1);
    clientCommand = { arguments: [], args: "" };
    for (let frame = 0; frame < 4; frame++) { const command = new Uint8Array(16); command[0] = 100; new DataView(command.buffer).setInt16(8, 100, true); source.host.clientThink(1, command); source.host.runFrame(); }
    adapter.publishEntities();
    const actor = required(source.host.edicts.at(1).currentActor()), linked = required(physics.bodies.linked(actor));
    expect(adapter.playerState(1).fov).toBeGreaterThan(0);
    expect(linked.absoluteBounds.min.x).toBe(source.host.edicts.at(1).bytes.getFloat32(212, true));
    expect(scene.spatial.get(actor)?.body.linkCount).toBe(linked.linkCount);
    expect(adapter.drainMessages().some(message => message.bytes.length > 0)).toBe(true);
    expect(events.some(event => event.kind === "model")).toBe(true);
    const sound = adapter.resourceIndex("sound", "world/test.wav"); adapter.drainMessages();
    adapter.services.sound(null, source.host.edicts.at(1).address, 16, sound, 0.5, 0, 0.05);
    const packet = required(adapter.drainMessages()[0]);
    expect(packet.bytes).toEqual(Uint8Array.of(9, 27, sound, 127, 0, 50, 8, 0)); expect(packet.reliable).toBe(true);
    const context: GuestCallContext = { module: source.memory.module, callback: { kind: "native-guest", module: source.memory.module, address: source.host.imports, abi: CLASSIC_Q2_ABI }, parent: null, self: null, other: null };
    source.host.importCall("WriteLong", context, [{ kind: "int32", value: 0x12345678 }]);
    source.host.importCall("unicast", context, [{ kind: "pointer", value: null }, { kind: "int32", value: 1 }]);
    expect(adapter.drainMessages()).toHaveLength(0);
    source.host.importCall("unicast", context, [{ kind: "pointer", value: source.host.edicts.at(1).address }, { kind: "int32", value: 1 }]);
    expect(required(adapter.drainMessages()[0]).bytes).toEqual(Uint8Array.of(0x78, 0x56, 0x34, 0x12));
    const brush = source.host.edicts.at(5); brush.bytes.setInt32(248, 3, true); brush.bytes.setFloat32(20, 45, true);
    source.host.importCall("setmodel", context, [{ kind: "pointer", value: brush.address }, { kind: "pointer", value: allocateClassicString(source.memory, "*1") }]);
    const brushLink = required(physics.bodies.linked(required(brush.currentActor())));
    expect(brushLink.absoluteBounds.max.x).toBe(brush.bytes.getFloat32(224, true));
    const radius = Math.max(...[188, 192, 196, 200, 204, 208].map(offset => Math.abs(brush.bytes.getFloat32(offset, true))));
    expect(brushLink.absoluteBounds.max.x).toBe(Math.fround(Math.fround(brush.bytes.getFloat32(4, true) + radius) + 1));
    source.host.save("WriteGame", "save/game.sav"); expect(readFileSync(join(root, "save/game.sav")).length).toBeGreaterThan(1000);
    source.close(); expect(actors.ownedBy("q2:ctf-native")).toHaveLength(0); expect(source.memory.mappings()).toHaveLength(0); source = null;
  } finally { source?.discard(); await mounts.close(); rmSync(root, { recursive: true, force: true }); }
});
