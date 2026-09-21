import { expect, test } from "bun:test";
import type { ModActorField, ModCallbackDeclaration, ModSourceCall } from "../../../src/contracts/mod-callbacks.ts";
import type { ModClientApplication, ModClientEvent, ModClientServices } from "../../../src/world/session/mod-clients.ts";
import type { UserCommand } from "../../../src/contracts/protocol.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { ActorCallbackTable, SessionActorRegistry, SharedBodyTable, translatedBodyBounds } from "../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable } from "../../../src/world/gameplay/index.ts";
import { ModClientApplications } from "../../../src/world/session/mod-client-applications.ts";
import { QcModProvider } from "../../../src/compat/qc/mod-provider.ts";
import { loadQcProgram } from "../../../src/compat/qc/program.ts";
import { readModCallbacks } from "../../../src/content/mods/callbacks.ts";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { SourceRandom } from "../../../src/app/bootstrap/simulation/random.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";

const copper = "/home/buzzkill/.local/share/quake-typescript/content/q1/rerelease/copper/progs.dat";
const zero = { x: 0, y: 0, z: 0 };
const globals = [
  { name: "self", value: { kind: "input", name: "self" } },
  { name: "time", value: { kind: "input", name: "time" } },
  { name: "frametime", value: { kind: "input", name: "elapsed" } },
] satisfies ModSourceCall["globals"];

test.skipIf(!await Bun.file(copper).exists())("original Copper applied callbacks use effective input and retain private continuation in a Q2 world", async () => {
  const options = parseApplicationCommand(["--content-root", "/home/buzzkill/Projects/qfiles", "--game", "q2-classic-baseq2", "--map", "base1"]);
  if (options.kind !== "run") throw new Error("Missing destination");
  const content = await loadApplicationContent(options.options), scene = createSceneQueries(content.world);
  const program = loadQcProgram(await Bun.file(copper).bytes());
  const fields: readonly ModActorField[] = [
    { field: "health", binding: "health" }, { field: "max_health", binding: "constant", value: { kind: "float", value: 100 } },
    { field: "healthtime", binding: "private" }, { field: "waterlevel", binding: "private" }, { field: "dmg", binding: "private" },
    { field: "flags", binding: "client-flags", grounded: true, privateMask: 2048 }, { field: "velocity", binding: "velocity" },
    { field: "deadflag", binding: "private" }, { field: "lifetime_finished", binding: "private" }, { field: "wait", binding: "private" },
    { field: "button0", binding: "client-input", input: "attack", update: "always" }, { field: "button1", binding: "private" },
    { field: "button2", binding: "client-input", input: "jump", update: "always" },
    { field: "impulse", binding: "client-input", input: "impulse", update: "nonzero" },
    { field: "v_angle", binding: "client-input", input: "view-angles", update: "always" },
  ];
  const make = (fn: "PlayerHealthTick" | "PlayerDeathThink", health: number) => {
    const ids = createIdentityOwner(`qc-input-${fn}`), actors = new SessionActorRegistry(ids);
    const world = actors.allocate("q2:map", "q2:world"), player = actors.allocate("q2:game", "q2:player"), client = ids.client(7, 3);
    let currentPlayer = player, currentClient = client;
    const lifecycle = new Set<(event: ModClientEvent) => undefined>();
    const callbacks = new ActorCallbackTable(actors), bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
    bodies.create(player, { origin: zero, angles: zero, velocity: { x: 100, y: 0, z: 0 }, bounds: { min: zero, max: zero }, ground: world.id });
    const combat = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined });
    combat.create(player, { health, mass: 200, canTakeDamage: true, invulnerable: false, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, team: null });
    const applications = new ModClientApplications(identity => actors.isLive(identity.actor) && identity.actor.equals(currentPlayer.id) && identity.client.equals(currentClient));
    const port: ModClientServices = { maximum: 1, clients: () => [{ client: currentClient, actor: currentPlayer.id }],
      forActor: actor => actors.isLive(actor) && actor.equals(currentPlayer.id) ? currentClient : null,
      actor: id => actors.isLive(currentPlayer.id) && id.equals(currentClient) ? currentPlayer.id : null,
      userinfo: () => "\\name\\Corpse", setUserinfo: () => undefined, command: () => null,
      grounded: () => { const body = bodies.read(player.id); if (body === null) throw new Error("Missing player body"); return body.ground !== null; },
      drop: () => { throw new Error("No source drop expected"); }, subscribe: listener => { lifecycle.add(listener); return () => { lifecycle.delete(listener); return undefined; }; },
      subscribeApplication: listener => applications.subscribe(listener) };
    const declaration = readModCallbacks(new TextEncoder().encode(JSON.stringify({ version: 1, runtime: "quakec", program: { path: "progs.dat", digest: program.digest },
      actorFields: fields, callbacks: [], clients: { maximum: 1, admit: [], userinfo: [], disconnect: [],
        input: [{ scope: "client-command", phase: "after", calls: [{ function: fn, arguments: [], globals }] }] } } satisfies ModCallbackDeclaration)));
    const rng = new SourceRandom(17), source = new QcModProvider(program,
      { id: "mod:copper-input", artifactPath: "progs.dat", digest: program.digest, revision: "original-input-callback" }, declaration,
      { actors, callbacks, bodies, clients: port, combat, inventory: new SharedInventoryTable(actors), time: () => ({ kind: "seconds", value: 99 }), seed: 17,
        engine: { scene, world: () => world.id, print: () => undefined, events: { emit: () => undefined, registerResource: () => undefined },
          clients: { maximum: 1, visibility: scene, at: () => ({ actor: player.id, origin: zero, viewOffset: zero, free: false, health: combat.read(player.id)?.health ?? 0, notarget: false }) } } },
      { nextInteger: () => rng.nextInteger(), nextUnit: () => rng.nextUnit(), checkpoint: () => rng.checkpoint(), restore: state => {
        if (state.kind !== "glibc-random") throw new Error("Wrong RNG"); return rng.restore(state);
      } });
    source.initialize();
    const input = (time: number, command: UserCommand): Omit<ModClientApplication, "invocation" | "parentInvocation"> => ({ identity: { client, actor: player.id },
      scope: "client-command", command, angleSpace: "absolute", absoluteAim: { x: 13, y: 42, z: 0 }, accepted: null,
      frame: { frame: 1, phase: "client-command", time: { kind: "milliseconds", value: time }, elapsed: { kind: "milliseconds", value: 50 } } });
    const command: UserCommand = { kind: "q2-classic", milliseconds: 50, angleShorts: [0, 0, 0], buttons: 1, impulse: 7, lightLevel: 0, forwardMove: 0, sideMove: 0, upMove: 10 };
    const apply = (time: number, value: UserCommand = command) => { const event = applications.begin(input(time, value)); applications.finish(event); };
    return { source, actors, player, bodies, combat, applications, input, command, apply,
      notify: (kind: ModClientEvent["kind"]) => { for (const listener of lifecycle) listener({ kind, identity: { client: currentClient, actor: currentPlayer.id } }); },
      replace: () => { actors.release(currentPlayer); currentPlayer = actors.allocate("q2:game", "q2:player"); currentClient = ids.client(7, 4); },
      value: (name: string) => source.machine.entities.at(1).float(source.machine.fieldOffset(name)),
      set: (name: string, value: number) => source.machine.entities.at(1).setFloat(source.machine.fieldOffset(name), value),
      close: () => { source.close(); applications.close(); actors.close(); } };
  };
  try {
    const healing = make("PlayerHealthTick", 151);
    try {
      const outer = healing.applications.begin(healing.input(3000, healing.command));
      expect(() => healing.source.checkpoint()).toThrow("idle callback");
      healing.set("impulse", 0); // Source consumption during the application must not be restaged for after.
      healing.applications.finish(outer);
      expect(healing.combat.read(healing.player.id)?.health).toBe(150);
      expect(healing.value("healthtime")).toBe(4);
      expect(healing.value("impulse")).toBe(0);
      expect(healing.value("button0")).toBe(1); expect(healing.value("button2")).toBe(1);
      expect(healing.source.machine.entities.at(1).vector(healing.source.machine.fieldOffset("v_angle"))).toEqual({ x: 13, y: 42, z: 0 });
      const saved = healing.source.checkpoint();
      healing.apply(3500); expect(healing.combat.read(healing.player.id)?.health).toBe(150);
      healing.apply(4000); expect(healing.combat.read(healing.player.id)?.health).toBe(149);
      healing.source.restore(saved); expect(healing.value("healthtime")).toBe(4);
      healing.apply(3500); expect(healing.combat.read(healing.player.id)?.health).toBe(149);
      healing.apply(4000); expect(healing.combat.read(healing.player.id)?.health).toBe(148);
      const failed = healing.applications.begin(healing.input(6000, healing.command)); healing.applications.finish(failed, true);
      expect(healing.combat.read(healing.player.id)?.health).toBe(148);
    } finally { healing.close(); }
    const corpse = make("PlayerDeathThink", 0);
    try {
      corpse.set("flags", 2048);
      corpse.apply(3000);
      expect(corpse.bodies.read(corpse.player.id)?.velocity).toEqual({ x: 80, y: 0, z: 0 });
      expect(corpse.value("flags")).toBe(8 | 512 | 2048); expect(corpse.value("wait")).toBe(1);
      corpse.set("lifetime_finished", 100);
      const event = corpse.applications.begin(corpse.input(3100, corpse.command));
      const nestedCommand: UserCommand = { kind: "q3", serverTimeMilliseconds: 3150, angleWords: [0, 0, 0], buttons: 0, weapon: 1, forwardMove: 0, rightMove: 0, upMove: 0 };
      const nested = corpse.applications.begin(corpse.input(3150, nestedCommand));
      expect(corpse.value("button0")).toBe(0); expect(corpse.value("impulse")).toBe(7);
      corpse.applications.finish(nested); expect(corpse.value("button0")).toBe(1);
      corpse.applications.finish(event);
      expect(corpse.bodies.read(corpse.player.id)?.velocity).toEqual({ x: 40, y: 0, z: 0 });
      const body = corpse.bodies.read(corpse.player.id); if (body === null) throw new Error("Missing corpse");
      let current = body;
      corpse.bodies.rebind(corpse.player, { read: () => current, write: value => {
        current = value;
        corpse.actors.release(corpse.player); corpse.applications.release(corpse.player.id);
        return undefined;
      } });
      const removed = corpse.applications.begin(corpse.input(3200, corpse.command));
      const retiring = corpse.applications.begin(corpse.input(3250, nestedCommand));
      expect(() => corpse.applications.finish(retiring)).toThrow("expired actor projection");
      corpse.applications.finish(removed);
      expect(corpse.source.checkpoint()).toBeDefined();
    } finally { corpse.close(); }
    const disconnected = make("PlayerHealthTick", 151);
    try {
      const pending = disconnected.applications.begin(disconnected.input(3000, disconnected.command));
      disconnected.set("impulse", 91);
      disconnected.notify("disconnecting"); disconnected.replace();
      expect(() => disconnected.notify("admitted")).toThrow("capacity exceeded");
      expect(disconnected.value("impulse")).toBe(91);
      disconnected.applications.release(disconnected.player.id); disconnected.applications.finish(pending);
      disconnected.notify("admitted");
      expect(disconnected.value("impulse")).toBe(0);
      expect(disconnected.source.checkpoint()).toBeDefined();
    } finally { disconnected.close(); }
  } finally { await content.close(); }
});
