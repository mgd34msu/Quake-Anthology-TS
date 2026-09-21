import { expect, test } from "bun:test";
import type { ActorId, OwnedActor } from "../../../src/contracts/identity.ts";
import type { ModHostServices } from "../../../src/world/session/mods.ts";
import type { ModClientEvent } from "../../../src/world/session/mod-clients.ts";
import type { NetworkEvent } from "../../../src/contracts/protocol.ts";
import type { SourcePresentationEvent } from "../../../src/app/bootstrap/simulation/types.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { ActorCallbackTable, SessionActorRegistry, SharedBodyTable, translatedBodyBounds } from "../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable } from "../../../src/world/gameplay/index.ts";
import { Q1_DONOR_PROFILE, createNumericOperations } from "../../../src/core/numeric.ts";
import { QcEntityMemory, QcMachine, classicQcEntityLayout, createQcBuiltins, loadQcProgram } from "../../../src/compat/qc/index.ts";
import type { QcHostBuiltinName } from "../../../src/compat/qc/index.ts";
import { QcModMessages } from "../../../src/compat/qc/mod-messages.ts";
import { SaveReader, encodeCheckpointValue, decodeCheckpointValue } from "../../../src/persistence/value.ts";
import { receivesQuakeWorldMessage } from "../../../src/compat/qc/message-routing.ts";

const programPath = "/home/buzzkill/Projects/qfiles/q1/qw/qwprogs.dat";
test.skipIf(!await Bun.file(programPath).exists())("QW component signon and buffered owner survive save without replaying other clients or following reused edicts", async () => {
  const program = loadQcProgram(await Bun.file(programPath).bytes()), ids = createIdentityOwner("qw-component-messages"), actors = new SessionActorRegistry(ids);
  const callbacks = new ActorCallbackTable(actors), bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
  const worldActor = actors.allocate("q2:map", "q2:world"), first = actors.allocate("q2:game", "q2:player"), sourceActor = actors.allocate("mod:qw", "quakec:entity");
  const sourceSlots = new Map<number, OwnedActor>([[0, worldActor], [1, first], [2, sourceActor]]), entities = new QcEntityMemory(classicQcEntityLayout(program), 16, 3);
  const firstClient = ids.client(7, 3), clients = new Map([[firstClient, first.id]]), listeners = new Set<(event: ModClientEvent) => undefined>();
  const effects: { readonly source: SourcePresentationEvent; readonly recipient: ActorId | undefined }[] = [], prints: { readonly event: NetworkEvent; readonly actor: ActorId | null }[] = [];
  const zero = { x: 0, y: 0, z: 0 };
  const services: ModHostServices = { actors, callbacks, bodies,
    combat: new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined }),
    inventory: new SharedInventoryTable(actors), time: () => ({ kind: "seconds", value: 3 }), seed: 1,
    clients: { maximum: 8, clients: () => [...clients].map(([client, actor]) => ({ client, actor })), forActor: actor => [...clients].find(([, value]) => actor.equals(value))?.[0] ?? null,
      actor: client => clients.get(client) ?? null, userinfo: () => "", setUserinfo: () => {}, command: () => null, drop: () => {},
      subscribeApplication: () => () => undefined,
      subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); return undefined; }; } },
    engine: { scene: { trace: () => { throw new Error("No component collision in message witness"); }, pointContents: () => { throw new Error("No component contents query in message witness"); } },
      world: () => worldActor.id, print: () => undefined, message: (event, actor) => { prints.push({ event, actor }); return undefined; },
      presentation: { map: "maps/base1.bsp", players: () => [...clients.values()], camera: () => ({ origin: zero, angles: zero }) },
      events: { emit: (_content, source, _time, recipient) => { effects.push({ source, recipient }); return undefined; }, registerResource: () => undefined } } };
  const world = { options: { program, entities, slots: { at: (slot: number) => sourceSlots.get(slot) ?? null } }, actor: (slot: number) => {
    const value = sourceSlots.get(slot); if (value === undefined) throw new Error("Unknown source entity"); return value;
  } };
  let loading = true;
  const original = new QcModMessages(world, services, "q1:classic:id1:installed", () => "unused", { loading: () => loading, phs: () => true });
  let active = original;
  const vm = new QcMachine({ program, entities, numeric: createNumericOperations(Q1_DONOR_PROFILE), builtins: createQcBuiltins({ kind: "quakeworld", host: original.messages.host }), serverActive: () => !loading });
  const write = (name: QcHostBuiltinName, destination: number, value: number | string) => {
    vm.globals.setFloat(4, destination);
    if (typeof value === "string") vm.globals.setInt(7, vm.strings.allocate(value)); else vm.globals.setFloat(7, value);
    const builtin = active.messages.host.get(name); if (builtin === undefined) throw new Error("Missing source writer"); builtin(vm);
  };
  let restored: QcModMessages | null = null;
  try {
    write("WriteByte", 3, 8); write("WriteByte", 3, 3); write("WriteString", 3, "component signon\n"); original.messages.flush();
    expect(prints).toEqual([{ actor: first.id, event: { kind: "print", level: 3, text: "component signon\n" } }]);
    write("WriteByte", 4, 23); write("WriteByte", 4, 5); write("WriteShort", 4, 2);
    for (const value of [1, 2, 3, 4, 5, 6]) write("WriteCoord", 4, value);
    vm.globals.setInt(vm.globalOffset("msg_entity"), entities.reference(1));
    write("WriteByte", 1, 34); write("WriteByte", 1, 35);
    original.messages.flush(); expect(effects).toEqual([]);
    const saved = decodeCheckpointValue(encodeCheckpointValue(original.capture())); original.close();
    expect(listeners.size).toBe(0);
    actors.release(sourceActor); const replacement = actors.allocate("mod:qw", "quakec:replacement"); sourceSlots.set(2, replacement);
    loading = false;
    restored = new QcModMessages(world, services, "q1:classic:id1:installed", () => "unused", { loading: () => loading, phs: () => true });
    restored.restore(new SaveReader(saved), actor => actors.referenceSaved(actor, "current")); restored.start();
    expect(prints).toHaveLength(1);
    const late = actors.allocate("q2:game", "q2:player"), client = ids.client(3, 9); clients.set(client, late.id);
    for (const listener of listeners) listener({ kind: "admitted", identity: { client, actor: late.id } });
    expect(prints).toHaveLength(2); expect(prints[1]?.actor).toBe(late.id);
    vm.globals.setVector(4, zero); vm.globals.setFloat(7, 0);
    const multicast = restored.messages.host.get("multicast"); if (multicast === undefined) throw new Error("Missing source multicast"); multicast(vm);
    expect(effects.map(effect => effect.recipient)).toEqual([first.id, late.id]);
    expect(effects.every(effect => effect.source.kind === "q1" && effect.source.event.kind === "beam" && effect.source.event.actor.equals(sourceActor.id))).toBe(true);
    expect(replacement.id.equals(sourceActor.id)).toBe(false);
    active = restored;
    vm.globals.setInt(vm.globalOffset("msg_entity"), entities.reference(1));
    write("WriteByte", 1, 8); write("WriteByte", 1, 2); write("WriteString", 1, "expired private message\n");
    for (const listener of listeners) listener({ kind: "disconnecting", identity: { client: firstClient, actor: first.id } });
    clients.delete(firstClient); actors.release(first);
    expect(() => write("WriteByte", 1, 1)).toThrow("not a client");
    const rejoined = actors.allocate("q2:game", "q2:player"), rejoinedClient = ids.client(7, 4);
    clients.set(rejoinedClient, rejoined.id); sourceSlots.set(1, rejoined);
    for (const listener of listeners) listener({ kind: "admitted", identity: { client: rejoinedClient, actor: rejoined.id } });
    restored.messages.flush();
    expect(prints).toHaveLength(3);
    expect(prints[2]).toEqual({ actor: rejoined.id, event: { kind: "print", level: 3, text: "component signon\n" } });
    restored.close(); expect(listeners.size).toBe(0);
    const after = actors.allocate("q2:game", "q2:player"); clients.set(ids.client(2, 1), after.id);
    expect(prints).toHaveLength(3); expect(actors.isLive(rejoined.id)).toBe(true);
  } finally { restored?.close(); original.close(); actors.close(); }
});

test("QW multicast keeps original near-PHS and visibility distinction", () => {
  const actor = createIdentityOwner("qw-recipients").actor(7, 2), origin = { x: 0, y: 0, z: 0 };
  let queries = 0;
  const visibility = () => ({ pointLeaf: () => 1, leafCluster: () => 2, clusterVisible: () => { queries++; return false; } });
  expect(receivesQuakeWorldMessage(actor, { kind: "multicast", origin, visibility: "phs", reliable: false }, () => ({ x: 1024, y: 0, z: 0 }), visibility)).toBe(true);
  expect(queries).toBe(0);
  expect(receivesQuakeWorldMessage(actor, { kind: "multicast", origin, visibility: "pvs", reliable: true }, () => ({ x: 1, y: 0, z: 0 }), visibility)).toBe(false);
  expect(receivesQuakeWorldMessage(actor, { kind: "multicast", origin, visibility: "phs", reliable: true }, () => ({ x: 1025, y: 0, z: 0 }), visibility)).toBe(false);
  expect(queries).toBe(2);
});
