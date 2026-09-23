import { expect, test } from "bun:test";
import type { ActorId, ClientId } from "../../../src/contracts/identity.ts";
import type { FrameContext } from "../../../src/contracts/time.ts";
import type { ModActorField, ModCallbackDeclaration, ModCallbackInput, ModRuntimeValue, ModSourceCall } from "../../../src/contracts/mod-callbacks.ts";
import type { ModClientEvent, ModClientServices } from "../../../src/world/session/mod-clients.ts";
import type { SourcePresentationEvent, SimulationPresentationEvent } from "../../../src/app/bootstrap/simulation/types.ts";
import type { NetworkEvent } from "../../../src/contracts/protocol.ts";
import { encodeUnifiedPresentationEvents, decodeUnifiedPresentationEvents } from "../../../src/app/bootstrap/network/unified-event-codec.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { ActorCallbackTable, SessionActorRegistry, SharedBodyTable, translatedBodyBounds } from "../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable } from "../../../src/world/gameplay/index.ts";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { prepareQuakeCResources } from "../../../src/app/bootstrap/simulation/quakec-source.ts";
import { SourceRandom } from "../../../src/app/bootstrap/simulation/random.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";
import { QcModProvider } from "../../../src/compat/qc/mod-provider.ts";
import { loadQcProgram } from "../../../src/compat/qc/program.ts";
import { QcModClientBindings } from "../../../src/compat/qc/mod-clients.ts";
import { readModCallbacks } from "../../../src/content/mods/callbacks.ts";
import { Q1_DONOR_PROFILE } from "../../../src/core/numeric.ts";

const copper = "/home/buzzkill/.local/share/quake-typescript/content/q1/rerelease/copper/progs.dat";
const selfGlobal = [{ name: "self", value: { kind: "input", name: "self" } }] satisfies ModSourceCall["globals"];
const inputs = (actor: ActorId) => new Map<ModCallbackInput, ModRuntimeValue>([["self", { kind: "actor", value: actor }]]);
function clients() {
  const entries = new Map<ClientId, { actor: ActorId; info: string }>(), listeners = new Set<(event: ModClientEvent) => undefined>();
  const require = (client: ClientId) => { const value = entries.get(client); if (value === undefined) throw new Error("Stale client"); return value; };
  const services: ModClientServices = { maximum: 8, clients: () => [...entries].map(([client, value]) => ({ client, actor: value.actor })),
    forActor: actor => [...entries].find(([, entry]) => entry.actor.equals(actor))?.[0] ?? null, actor: client => entries.get(client)?.actor ?? null,
    userinfo: client => require(client).info, setUserinfo: (client, info) => { require(client).info = info; }, command: () => null,
    subscribeApplication: () => () => undefined,
    drop: () => { throw new Error("No source drop expected"); }, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); return undefined; }; } };
  return { services, entries, listeners, notify: (kind: ModClientEvent["kind"], client: ClientId) => {
    for (const listener of listeners) listener({ kind, identity: { client, actor: require(client).actor } });
  } };
}

test.skipIf(!await Bun.file(copper).exists())("original Copper client callbacks reserve edicts and retain private state and targeted stuffcmd through save", async () => {
  const options = parseApplicationCommand(["--content-root", "/home/buzzkill/Projects/qfiles", "--game", "q2-classic-baseq2", "--map", "base1"]);
  if (options.kind !== "run") throw new Error("Missing destination");
  const content = await loadApplicationContent(options.options), program = loadQcProgram(await Bun.file(copper).bytes());
  const resources = await prepareQuakeCResources(program, await content.forContent("q1:classic:id1:installed")), occupied = new Set<number>(), actorFields: ModActorField[] = [];
  for (const field of program.fields) {
    const width = field.type === "vector" ? 3 : 1;
    if (field.name === "" || Array.from({ length: width }, (_, index) => field.offset + index).some(word => occupied.has(word))) continue;
    for (let index = 0; index < width; index++) occupied.add(field.offset + index);
    actorFields.push(field.name === "netname" ? { field: field.name, binding: "userinfo", key: "name" } : { field: field.name, binding: "private" });
  }
  const declaration = readModCallbacks(new TextEncoder().encode(JSON.stringify({ version: 1, runtime: "quakec", program: { path: "progs.dat", digest: program.digest }, actorFields, callbacks: [],
    clients: { maximum: 2, admit: [{ function: "ClientConnect", arguments: [], globals: selfGlobal }],
      userinfo: [{ function: "autosave", arguments: [{ kind: "input", name: "self" }, { kind: "string", value: "component-client" }], globals: [] }],
      disconnect: [{ function: "ClientDisconnect", arguments: [], globals: selfGlobal }] } } satisfies ModCallbackDeclaration)));
  const create = (actors: SessionActorRegistry, world: ActorId) => {
    const port = clients(), callbacks = new ActorCallbackTable(actors), bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
    const messages: { actor: ActorId | null; event: NetworkEvent }[] = [], prints: string[] = [], rng = new SourceRandom(17);
    const source = new QcModProvider(program, { id: "mod:qc-clients", artifactPath: "progs.dat", digest: program.digest, revision: "original-client-witness" }, declaration,
      { actors, callbacks, bodies, clients: port.services, combat: new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined }),
        inventory: new SharedInventoryTable(actors), time: () => ({ kind: "seconds", value: 3 }), seed: 17,
        engine: { scene: createSceneQueries(content.world), world: () => world, print: text => { prints.push(text); return undefined; },
          events: { emit: () => undefined, registerResource: () => undefined }, message: (event, actor) => { messages.push({ actor, event }); return undefined; },
          presentation: { map: "maps/base1.bsp", players: () => [...port.entries.values()].map(value => value.actor), camera: () => ({ origin: { x: 0, y: 0, z: 0 }, angles: { x: 0, y: 0, z: 0 } }) } } },
      { nextInteger: () => rng.nextInteger(), nextUnit: () => rng.nextUnit(), checkpoint: () => rng.checkpoint(), restore: state => { if (state.kind !== "glibc-random") throw new Error("Wrong RNG"); return rng.restore(state); } },
      { content: "q1:rerelease:copper:installed", resources });
    return { source, port, messages, prints };
  };
  const ids = createIdentityOwner("qc-clients"), actors = new SessionActorRegistry(ids), world = actors.allocate("q2:map", "q2:world");
  const first = actors.allocate("q2:game", "q2:player"), second = actors.allocate("q2:game", "q2:player"), npc = actors.allocate("q2:game", "q2:monster");
  const f = create(actors, world.id), a = ids.client(7, 2), b = ids.client(3, 4);
  let restored: ReturnType<typeof create> | null = null, restoredActors: SessionActorRegistry | null = null;
  try {
    f.port.entries.set(a, { actor: first.id, info: "\\name\\Alice\\custom\\kept" }); f.port.entries.set(b, { actor: second.id, info: "\\name\\Bob" });
    f.source.initialize();
    expect(f.source.machine.globals.float(f.source.machine.globalOffset("clients"))).toBe(2);
    expect(f.prints.join("")).toBe("Alice entered the game\nBob entered the game\n");
    f.source.invoke({ function: "SUB_Null", arguments: [], globals: selfGlobal }, inputs(npc.id));
    expect(f.source.machine.entities.count).toBe(4);
    f.source.invoke({ function: "spawn", arguments: [], globals: [] }, new Map<ModCallbackInput, ModRuntimeValue>());
    expect(actors.ownedBy("mod:qc-clients").map(actor => actors.sourceOf(actor.id)?.slot)).toEqual([4]);
    const version = f.source.machine.fieldOffset("version"); f.source.machine.entities.at(1).setFloat(version, 77);
    const vm = f.source.machine, npcReference = vm.entities.reference(3);
    vm.setEntityInt(npcReference, "netname", vm.strings.allocate("Private monster"));
    vm.setEntityInt(0, "netname", vm.strings.allocate("Private world"));
    expect(vm.strings.get(vm.entityInt(npcReference, "netname"))).toBe("Private monster");
    expect(vm.strings.get(vm.entityInt(0, "netname"))).toBe("Private world");
    vm.globals.setInt(4, 0); vm.globals.setInt(7, vm.fieldOffset("netname")); vm.globals.setInt(10, vm.strings.allocate("Private monster"));
    vm.execute(program.functionNamed("find").index, 3);
    expect(vm.globals.int(1)).toBe(npcReference);
    vm.setEntityInt(vm.entities.reference(1), "netname", vm.strings.allocate("Renamed"));
    expect(f.port.services.userinfo(a)).toBe("\\custom\\kept\\name\\Renamed");
    expect(f.messages).toEqual([]);
    f.port.notify("userinfo", a);
    expect(f.messages.filter(message => message.event.kind === "command-text").map(message => ({ actor: message.actor, text: message.event.kind === "command-text" ? message.event.text : "" }))).toEqual([
      { actor: first.id, text: "echo Autosaving...; wait; save " }, { actor: first.id, text: "component-client" }, { actor: first.id, text: "\n" }]);
    const image = f.source.checkpoint(), saved = actors.checkpoint(), slots = actors.sourceCheckpoint(), newIds = createIdentityOwner("qc-clients-restored");
    restoredActors = SessionActorRegistry.restore(newIds, saved, slots);
    const restoredWorld = restoredActors.referenceSaved(world.id, "current"), restoredFirst = restoredActors.referenceSaved(first.id, "current"), restoredSecond = restoredActors.referenceSaved(second.id, "current");
    restored = create(restoredActors, restoredWorld);
    const newA = newIds.client(7, 12), newB = newIds.client(3, 14);
    restored.port.entries.set(newA, { actor: restoredFirst, info: "\\name\\Renamed\\custom\\kept" }); restored.port.entries.set(newB, { actor: restoredSecond, info: "\\name\\Bob" });
    restored.source.restore(image);
    expect(restored.prints).toEqual([]); expect(restored.source.machine.globals.float(restored.source.machine.globalOffset("clients"))).toBe(2);
    expect(restored.source.machine.entities.at(1).float(version)).toBe(77);
    restored.port.notify("userinfo", newB); expect(restored.messages.every(message => message.actor?.equals(restoredSecond))).toBe(true);
    restored.port.notify("disconnecting", newA); restored.port.entries.delete(newA);
    expect(restored.source.machine.globals.float(restored.source.machine.globalOffset("clients"))).toBe(1);
    const oldOwner = restoredActors.resolveOwned(restoredFirst); if (oldOwner === null) throw new Error("Missing restored actor"); restoredActors.release(oldOwner);
    const replacement = restoredActors.allocate("q2:game", "q2:player"), replacementClient = newIds.client(7, 13);
    restored.port.entries.set(replacementClient, { actor: replacement.id, info: "\\name\\Carol" }); restored.port.notify("admitted", replacementClient);
    expect(restored.source.machine.entities.at(1).float(version)).toBe(0);
    expect(restored.source.machine.globals.float(restored.source.machine.globalOffset("clients"))).toBe(2);
    expect(() => restored?.source.invoke({ function: "SUB_Null", arguments: [], globals: selfGlobal }, inputs(restoredFirst))).toThrow("stale");
    restored.source.close(); expect(restored.port.listeners.size).toBe(0); expect(restoredActors.isLive(replacement.id)).toBe(true);
  } finally { restored?.source.close(); restoredActors?.close(); f.source.close(); actors.close(); await content.close(); }
});

test("QC userinfo field writes preserve other keys and do not recursively publish lifecycle callbacks", () => {
  const ids = createIdentityOwner("qc-userinfo"), actor = ids.actor(42, 4), client = ids.client(7, 9), port = clients();
  port.entries.set(client, { actor, info: "\\name\\Alice\\rate\\25000" }); let calls = 0;
  const binding = new QcModClientBindings({ services: port.services, declaration: { maximum: 1, admit: [{ function: "Original", arguments: [], globals: [] }], userinfo: [], disconnect: [] }, project: () => {}, release: () => "released", invoke: () => { calls++; } });
  binding.start(); binding.setUserinfo(actor, "name", "Carol");
  expect(port.services.userinfo(client)).toBe("\\rate\\25000\\name\\Carol"); expect(calls).toBe(1); expect(binding.userinfo(actor, "name")).toBe("Carol");
  binding.close();
});

test("QC client frame thinks precede calls and retirement stops the old actor's call list", () => {
  const ids = createIdentityOwner("qc-client-frames"), old = ids.actor(42, 4), replacement = ids.actor(42, 5), client = ids.client(7, 9), nextClient = ids.client(7, 10), port = clients();
  const seen: string[] = [], frame: FrameContext = { frame: 7, phase: "frame-exit", time: { kind: "seconds", value: 0.7 }, elapsed: { kind: "seconds", value: 0.1 } };
  port.entries.set(client, { actor: old, info: "" });
  const binding = new QcModClientBindings({ services: port.services,
    declaration: { maximum: 1, admit: [], userinfo: [], disconnect: [], frame: ["First", "Second"].map(name => ({ function: name, arguments: [], globals: [] })) },
    project: () => {}, release: () => "released", think: actor => { seen.push(`think:${actor.generation}`); },
    invoke: (call, actor, sourceFrame) => {
      expect(sourceFrame).toBe(frame); seen.push(`${call.function}:${actor.generation}`);
      if (actor.equals(old)) {
        port.notify("disconnecting", client); port.entries.delete(client);
        port.entries.set(nextClient, { actor: replacement, info: "" }); port.notify("admitted", nextClient);
      }
    } });
  binding.start();
  expect(binding.frame(1, frame)).toBe(true); expect(seen).toEqual(["think:4", "First:4"]);
  expect(binding.frame(1, frame)).toBe(true); expect(seen).toEqual(["think:4", "First:4", "think:5", "First:5", "Second:5"]);
  binding.close(); expect(binding.frame(1, frame)).toBe(false);
});

const quakeworld = "/home/buzzkill/Projects/qfiles/q1/qw/qwprogs.dat";
test.skipIf(!await Bun.file(quakeworld).exists())("original QuakeWorld clients, media and shotgun aim use destination identities and collision", async () => {
  const program = loadQcProgram(await Bun.file(quakeworld).bytes()); expect(program.api.kind).toBe("q1-quakeworld");
  const occupied = new Set<number>(), actorFields: ModActorField[] = [];
  for (const field of program.fields) {
    const width = field.type === "vector" ? 3 : 1;
    if (field.name === "" || Array.from({ length: width }, (_, index) => field.offset + index).some(word => occupied.has(word))) continue;
    for (let index = 0; index < width; index++) occupied.add(field.offset + index);
    actorFields.push({ field: field.name, binding: "private" });
  }
  const declaration: ModCallbackDeclaration = { version: 1, runtime: "quakec", program: { path: "qwprogs.dat", digest: program.digest }, actorFields, callbacks: [],
    clients: { maximum: 2, admit: [], userinfo: [], disconnect: [] } };
  const options = parseApplicationCommand(["--content-root", "/home/buzzkill/Projects/qfiles", "--game", "q2-classic-baseq2", "--map", "base1"]);
  if (options.kind !== "run") throw new Error("Missing destination");
  const content = await loadApplicationContent(options.options), resources = await prepareQuakeCResources(program, await content.forContent("q1:classic:id1:installed")), ids = createIdentityOwner("qc-qw-clients"), actors = new SessionActorRegistry(ids), callbacks = new ActorCallbackTable(actors);
  const world = actors.allocate("q2:map", "q2:world"), first = actors.allocate("q2:game", "q2:player"), second = actors.allocate("q2:game", "q2:player");
  const scene = createSceneQueries(content.world), bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds,
    onLink: body => {
      // A decoded destination reference has value identity without sharing the QC projection's object.
      scene.link({ ...body, actor: ids.actor(body.actor.slot, body.actor.generation) }, { family: "q2", shape: { kind: "box" }, contents: 0x02000000, owner: null, role: "solid", monster: true, deadMonster: false });
      return undefined;
    },
    onUnlink: actor => { scene.unlink(actor); return undefined; } }), port = clients();
  scene.bindActorState(actor => bodies.read(actor));
  const points = scene.geometry.leaves.map(leaf => ({
    x: (leaf.bounds.min.x + leaf.bounds.max.x) / 2, y: (leaf.bounds.min.y + leaf.bounds.max.y) / 2, z: (leaf.bounds.min.z + leaf.bounds.max.z) / 2
  })).filter(point => scene.leafCluster(scene.pointLeaf(point)) >= 0);
  const origin = points[0]; if (origin === undefined) throw new Error("Missing visible map leaf");
  const distant = points.find(point => !scene.clusterVisible(scene.leafCluster(scene.pointLeaf(origin)), scene.leafCluster(scene.pointLeaf(point)), "pvs"));
  if (distant === undefined) throw new Error("Missing separated map visibility clusters");
  const zero = { x: 0, y: 0, z: 0 };
  for (const { actor, position } of [{ actor: first, position: origin }, { actor: second, position: distant }])
    bodies.create(actor, { origin: position, angles: zero, velocity: zero, bounds: { min: zero, max: zero }, ground: null });
  const effects: { readonly recipient: ActorId | undefined; readonly source: SourcePresentationEvent }[] = [];
  const a = ids.client(7, 2), b = ids.client(3, 4), messages: { actor: ActorId | null; event: NetworkEvent }[] = [], rng = new SourceRandom(17);
  port.entries.set(a, { actor: first.id, info: "\\name\\Alice\\team\\red" }); port.entries.set(b, { actor: second.id, info: "\\name\\Bob\\team\\red" });
  const source = new QcModProvider(program, { id: "mod:qw-clients", artifactPath: "qwprogs.dat", digest: program.digest, revision: "original-qw-client-witness" }, declaration,
    { actors, callbacks, bodies, clients: port.services, combat: new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined }),
      inventory: new SharedInventoryTable(actors), seed: 17, time: () => ({ kind: "seconds", value: 3 }),
      engine: { scene, world: () => world.id, print: () => undefined,
        clients: { maximum: 8, visibility: scene, at: () => { throw new Error("No checkclient in this witness"); } },
        presentation: { map: "maps/base1.bsp", players: () => [...port.entries.values()].map(value => value.actor), camera: actor => {
          const body = bodies.read(actor); if (body === null) throw new Error("Missing camera body"); return body;
        } },
        events: { emit: (_content, source, _time, recipient) => { effects.push({ source, recipient }); return undefined; }, registerResource: () => undefined },
        message: (event, actor) => { messages.push({ event, actor }); return undefined; } } },
    { nextInteger: () => rng.nextInteger(), nextUnit: () => rng.nextUnit(), checkpoint: () => rng.checkpoint(), restore: state => { if (state.kind !== "glibc-random") throw new Error("Wrong RNG"); return rng.restore(state); } }, { content: "q1:classic:id1:installed", resources });
  try {
    source.initialize(); const vm = source.machine, target = vm.entities.at(1), attacker = vm.entities.at(2), field = (name: string) => vm.fieldOffset(name);
    vm.globals.setFloat(vm.globalOffset("teamplay"), 1);
    for (const words of [target, attacker]) { words.setInt(field("classname"), vm.strings.allocate("player")); words.setFloat(field("health"), 100); }
    target.setFloat(field("takedamage"), 1);
    const damage: ModSourceCall = { function: "T_Damage", arguments: [{ kind: "input", name: "self" }, { kind: "input", name: "other" }, { kind: "input", name: "other" }, { kind: "float", value: 10 }],
      globals: [...selfGlobal, { name: "time", value: { kind: "float", value: 3 } }] };
    const input = inputs(first.id); input.set("other", { kind: "actor", value: second.id });
    source.invoke(damage, input); expect(target.float(field("health"))).toBe(100);
    port.services.setUserinfo(b, "\\name\\Bob\\team\\blue");
    source.invoke(damage, input); expect(target.float(field("health"))).toBe(90);
    target.setFloat(field("impulse"), 1); target.setFloat(field("items"), 0);
    source.invoke({ function: "W_ChangeWeapon", arguments: [], globals: selfGlobal }, inputs(first.id));
    expect(messages).toEqual([{ actor: first.id, event: { kind: "print", level: 2, text: "no weapon.\n" } }]);
    expect(target.float(field("impulse"))).toBe(0);
    source.invoke({ function: "bprint", arguments: [{ kind: "float", value: 3 }, { kind: "string", value: "chat level\n" }], globals: [] }, new Map<ModCallbackInput, ModRuntimeValue>());
    expect(messages.at(-1)).toEqual({ actor: null, event: { kind: "print", level: 3, text: "chat level\n" } });
    source.invoke({ function: "SpawnBlood", arguments: [{ kind: "vector", value: origin }, { kind: "float", value: 20 }], globals: [] }, new Map<ModCallbackInput, ModRuntimeValue>());
    expect(effects).toEqual([{ recipient: first.id, source: { kind: "q1", event: { kind: "particles", color: 73, count: 20, direction: zero, origin } } }]);
    effects.length = 0;
    target.setInt(field("noise1"), vm.strings.allocate("ambience/water1.wav"));
    source.invoke({ function: "door_hit_bottom", arguments: [], globals: selfGlobal }, inputs(first.id));
    expect(effects.map(effect => effect.recipient)).toEqual([first.id, second.id]);
    expect(effects.every(effect => effect.source.kind === "q1" && effect.source.event.kind === "sound")).toBe(true);
    effects.length = 0; target.setVector(field("origin"), origin);
    source.invoke({ function: "player_shot1", arguments: [], globals: selfGlobal }, inputs(first.id));
    expect(effects).toEqual([{ recipient: first.id, source: { kind: "q1", event: { kind: "effect", effect: "muzzleflash", actor: first.id,
      origin, amount: 1, muzzle: { origin, angles: zero } } } }]);
    const flashes: SimulationPresentationEvent[] = effects.map((effect, sequence) => ({ ...effect.source, ...(effect.recipient === undefined ? {} : { recipient: effect.recipient }),
      sequence, content: "q1:classic:id1:installed", seconds: 3, sourceEntity: 1 }));
    expect(decodeUnifiedPresentationEvents(encodeUnifiedPresentationEvents(flashes), { session: actors.session, actor: (slot, generation) => ids.actor(slot, generation),
      client: (slot, generation) => ids.client(slot, generation), seat: index => ids.seat(index), resourceId: id => id })).toEqual(flashes);
    const saved = source.checkpoint(); source.restore(saved); effects.length = 0;
    source.invoke({ function: "SpawnBlood", arguments: [{ kind: "vector", value: origin }, { kind: "float", value: 20 }], globals: [] }, new Map<ModCallbackInput, ModRuntimeValue>());
    expect(effects.map(effect => effect.recipient)).toEqual([first.id]);

    // Find a real clear volume in the destination BSP, without assuming its spawn or room coordinates.
    const bounds = { min: { x: -16, y: -16, z: -16 }, max: { x: 16, y: 16, z: 32 } };
    bodies.unlink(first); bodies.unlink(second);
    const lane = points.flatMap(start => [0, 90, 180, 270].map(yaw => {
      const radians = yaw * Math.PI / 180, forward = { x: Math.round(Math.cos(radians)), y: Math.round(Math.sin(radians)), z: 0 };
      return { start, yaw, forward, end: { x: start.x + forward.x * 128, y: start.y + forward.y * 128, z: start.z + 48 } };
    })).find(candidate => {
      const trace = scene.trace({ start: candidate.start, end: candidate.end, shape: { kind: "box", bounds }, target: { kind: "world" },
        policy: { kind: "q1", move: "normal", hull: null }, numeric: Q1_DONOR_PROFILE, passActor: null });
      return !trace.startSolid && trace.fraction === 1;
    });
    if (lane === undefined) throw new Error("Missing destination shotgun test volume");
    for (const { actor, position, words } of [{ actor: first, position: lane.start, words: target }, { actor: second, position: lane.end, words: attacker }]) {
      bodies.write(actor, { origin: position, angles: zero, velocity: zero, bounds, ground: null }); bodies.link(actor);
      words.setVector(field("origin"), position); words.setVector(field("mins"), bounds.min); words.setVector(field("maxs"), bounds.max);
      words.setVector(field("absmin"), { x: position.x - 16, y: position.y - 16, z: position.z - 16 });
      words.setVector(field("size"), { x: 32, y: 32, z: 48 }); words.setFloat(field("health"), 100);
      words.setFloat(field("takedamage"), 2); words.setFloat(field("team"), 0);
      words.setInt(field("th_pain"), program.functionNamed("SUB_Null").index);
    }
    target.setVector(field("v_angle"), { x: 0, y: lane.yaw, z: 0 });
    target.setFloat(field("ammo_shells"), 8); target.setFloat(field("currentammo"), 8);
    vm.globals.setFloat(vm.globalOffset("teamplay"), 0); vm.globals.setVector(vm.globalOffset("v_forward"), lane.forward);
    const aim = () => {
      vm.globals.setInt(4, vm.entities.reference(1)); vm.globals.setFloat(7, 100000);
      vm.execute(program.functionNamed("aim").index, 2);
      return vm.globals.vector(1);
    };
    expect(source.cvars.variableValue("sv_aim")).toBe(2); expect(aim()).toEqual(lane.forward);
    source.cvars.set("sv_aim", "0.93"); expect(aim().z).toBeGreaterThan(0.3);
    attacker.setFloat(field("takedamage"), 1); expect(aim()).toEqual(lane.forward); attacker.setFloat(field("takedamage"), 2);
    source.cvars.set("teamplay", "1"); target.setFloat(field("team"), 1); attacker.setFloat(field("team"), 1);
    expect(aim()).toEqual(lane.forward); source.cvars.set("teamplay", "0");
    port.services.setUserinfo(a, "\\name\\Alice\\noaim\\1"); expect(aim()).toEqual(lane.forward);
    port.services.setUserinfo(a, "\\name\\Alice\\noaim\\0"); expect(aim().z).toBeGreaterThan(0.3);
    const blocker = actors.allocate("q2:game", "q2:blocker");
    bodies.create(blocker, { origin: { x: lane.start.x + lane.forward.x * 64, y: lane.start.y + lane.forward.y * 64, z: lane.start.z + 32 },
      angles: zero, velocity: zero, bounds: { min: { x: -24, y: -24, z: -32 }, max: { x: 24, y: 24, z: 32 } }, ground: null }); bodies.link(blocker);
    expect(aim()).toEqual(lane.forward);
    const fire: ModSourceCall = { function: "W_FireShotgun", arguments: [], globals: selfGlobal };
    source.invoke(fire, inputs(first.id)); expect(attacker.float(field("health"))).toBe(100); expect(target.float(field("ammo_shells"))).toBe(7);
    bodies.unlink(blocker); actors.release(blocker);
    source.invoke(fire, inputs(first.id)); expect(attacker.float(field("health"))).toBeLessThan(100); expect(target.float(field("ammo_shells"))).toBe(6);
    const armed = source.checkpoint(); source.invoke(fire, inputs(first.id));
    const nextHealth = attacker.float(field("health")), nextAmmo = target.float(field("ammo_shells"));
    source.restore(armed); expect(source.cvars.variableValue("sv_aim")).toBe(Math.fround(0.93));
    source.invoke(fire, inputs(first.id)); expect(attacker.float(field("health"))).toBe(nextHealth); expect(target.float(field("ammo_shells"))).toBe(nextAmmo);
  } finally { source.close(); actors.close(); await content.close(); }
});
