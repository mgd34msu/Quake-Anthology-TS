import { expect, test } from "bun:test";
import { openArchive } from "../../../src/content/archive/index.ts";
import { loadQcProgram } from "../../../src/compat/qc/program.ts";
import { QcModProvider } from "../../../src/compat/qc/mod-provider.ts";
import type { ModActorField, ModCallbackDeclaration } from "../../../src/contracts/mod-callbacks.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { SessionActorRegistry, ActorCallbackTable, SharedBodyTable, translatedBodyBounds } from "../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable } from "../../../src/world/gameplay/index.ts";
import { ModClientApplications } from "../../../src/world/session/mod-client-applications.ts";
import type { ModClientServices } from "../../../src/world/session/mod-clients.ts";
import { SourceRandom } from "../../../src/app/bootstrap/simulation/random.ts";
import type { ResolvedResourceReference } from "../../../src/contracts/content.ts";
import type { Bounds } from "../../../src/contracts/math.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import type { UserCommand } from "../../../src/contracts/protocol.ts";

const path = "/home/buzzkill/Projects/qfiles/q1/rerelease/hipnotic/pak0.pak", zero = { x: 0, y: 0, z: 0 };
test.skipIf(!await Bun.file(path).exists())("original Hipnotic full preThink owns only actually entered jump decisions", async () => {
  const archive = await openArchive(path);
  const entry = archive.findEntries("progs.dat").at(-1); if (entry === undefined) throw new Error("Missing original source");
  const program = loadQcProgram(await archive.readEntry(entry)); await archive.close();
  const launch = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1"]);
  if (launch.kind !== "run") throw new Error("Missing map");
  const content = await loadApplicationContent(launch.options), scene = createSceneQueries(content.world);
  const ids = createIdentityOwner("original-input-output"), actors = new SessionActorRegistry(ids), callbacks = new ActorCallbackTable(actors);
  const world = actors.allocate("q2:map", "q2:world"), player = actors.allocate("q2:game", "q2:player"), client = ids.client(0, 0);
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
  bodies.create(player, { origin: zero, angles: zero, velocity: zero, bounds: { min: zero, max: zero }, ground: world.id });
  const combat = new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined });
  combat.create(player, { health: 100, mass: 200, canTakeDamage: true, invulnerable: false, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, team: null });
  const applications = new ModClientApplications(identity => actors.isLive(identity.actor));
  const clients: ModClientServices = { maximum: 1, clients: () => [{ actor: player.id, client }], actor: () => player.id, forActor: () => client,
    userinfo: () => "", setUserinfo: () => undefined, command: () => null, drop: () => undefined,
    grounded: () => bodies.read(player.id)?.ground !== null, subscribe: () => () => undefined, subscribeApplication: listener => applications.subscribe(listener) };
  const declared: ModActorField[] = [
    { field: "health", binding: "health" }, { field: "velocity", binding: "velocity" }, { field: "origin", binding: "origin" },
    { field: "flags", binding: "client-flags", grounded: true, privateMask: 16 | 2048 | 4096 },
    { field: "button0", binding: "client-input", input: "attack", update: "always" },
    { field: "button2", binding: "client-input", input: "jump", update: "always" },
    { field: "impulse", binding: "client-input", input: "impulse", update: "nonzero" },
    { field: "v_angle", binding: "client-input", input: "view-angles", update: "always" },
  ];
  // Every remaining original player field is retained private source storage for the full function.
  const used = new Set<number>();
  for (const field of declared) { const definition = program.fieldsByName.get(field.field); if (definition === undefined) throw new Error("Missing field");
    for (let i = 0; i < (definition.type === "vector" ? 3 : 1); i++) used.add(definition.offset + i); }
  for (const field of program.fields) if (field.name !== "" && !used.has(field.offset)) {
    declared.push({ field: field.name, binding: "private" });
    for (let i = 0; i < (field.type === "vector" ? 3 : 1); i++) used.add(field.offset + i);
  }
  const declaration: ModCallbackDeclaration = { version: 1, runtime: "quakec", program: { path: "progs.dat", digest: program.digest }, actorFields: declared, callbacks: [],
    clients: { maximum: 1, admit: [], disconnect: [], userinfo: [], input: [{ phase: "before", scope: "client-command",
      calls: [{ function: "PlayerPreThink", arguments: [], globals: [{ name: "self", value: { kind: "input", name: "self" } }, { name: "time", value: { kind: "input", name: "time" } }, { name: "frametime", value: { kind: "input", name: "elapsed" } }] }],
      outputs: [{ kind: "handler", function: "PlayerJump", inputs: ["jump"] }, { kind: "field", field: "button2" }, { kind: "field", field: "impulse" }] }] } };
  const rng = new SourceRandom(17), source = new QcModProvider(program, { id: "mod:hipnotic-input", artifactPath: "progs.dat", digest: program.digest, revision: "original" }, declaration,
    { actors, callbacks, bodies, clients, combat, inventory: new SharedInventoryTable(actors), seed: 17, time: () => ({ kind: "seconds", value: 3 }),
      engine: { scene, world: () => world.id, print: () => undefined, events: { emit: () => undefined, registerResource: () => undefined },
        clients: { maximum: 1, visibility: scene, at: () => ({ actor: player.id, origin: zero, viewOffset: { x: 0, y: 0, z: 22 }, free: false, health: 100, notarget: false }) } } },
    { nextInteger: () => rng.nextInteger(), nextUnit: () => rng.nextUnit(), checkpoint: () => rng.checkpoint(), restore: value => { if (value.kind !== "glibc-random") throw new Error("Wrong RNG"); return rng.restore(value); } },
    { content: "q1:rerelease:hipnotic:game", resources: new Map<string, { readonly resource: ResolvedResourceReference; readonly modelBounds: Bounds | null }>() });
  try {
    source.initialize(); const words = source.machine.entities.at(1), field = (name: string) => source.machine.fieldOffset(name);
    words.setVector(field("view_ofs"), { x: 0, y: 0, z: 22 }); words.setFloat(field("attack_finished"), 999); words.setFloat(field("air_finished"), 999);
    const pose = (grounded: boolean, z = 0) => { const body = bodies.read(player.id); if (body === null) throw new Error("Missing body"); bodies.write(player, { ...body, velocity: { x: 0, y: 0, z }, ground: grounded ? world.id : null }); };
    const apply = (command: UserCommand) => { const app = applications.begin({ identity: { actor: player.id, client }, scope: "client-command", command, accepted: null, angleSpace: "absolute", absoluteAim: zero,
      frame: { frame: 1, phase: "client-command", time: { kind: "seconds", value: 3 }, elapsed: { kind: "seconds", value: 0.02 } } }); applications.finish(app); return app?.command; };
    const kinds: readonly ("q2-classic" | "q3")[] = ["q2-classic", "q3"];
    for (const kind of kinds) {
      const command: UserCommand = kind === "q3" ? { kind, serverTimeMilliseconds: 20, angleWords: [0, 0, 0], buttons: 0, weapon: 2, forwardMove: 0, rightMove: 0, upMove: 127 }
        : { kind, milliseconds: 20, angleShorts: [0, 0, 0], buttons: 0, impulse: 7, lightLevel: 33, forwardMove: 0, sideMove: 0, upMove: 200 };
      words.setFloat(field("waterlevel"), 0); words.setFloat(field("flags"), 4096); pose(true);
      expect(apply(command)).toEqual({ ...command, upMove: 0 }); expect(bodies.read(player.id)?.velocity.z).toBe(270); expect(bodies.read(player.id)?.ground).toBeNull();
      expect(command.upMove).toBe(kind === "q3" ? 127 : 200);
      pose(true); expect(apply(command)).toEqual({ ...command, upMove: 0 }); expect(bodies.read(player.id)?.velocity.z).toBe(0); // original no-pogo decision
      apply({ ...command, upMove: 0 }); expect(words.float(field("flags")) & 4096).toBe(4096);
      pose(false, 15); expect(apply(command)).toEqual({ ...command, upMove: 0 }); expect(bodies.read(player.id)?.velocity.z).toBe(15);
      pose(true); expect(apply(command)).toEqual({ ...command, upMove: 0 }); expect(bodies.read(player.id)?.velocity.z).toBe(270);
      words.setFloat(field("waterlevel"), 3); words.setFloat(field("watertype"), -3); pose(false);
      expect(apply(command)).toEqual({ ...command, upMove: 0 }); expect(bodies.read(player.id)?.velocity.z).toBe(100);
      words.setVector(field("view_ofs"), zero); pose(true);
      expect(apply(command)).toEqual(command); expect(bodies.read(player.id)?.velocity.z).toBe(0); // original early return never enters PlayerJump
      words.setVector(field("view_ofs"), { x: 0, y: 0, z: 22 });
    }
  } finally { source.close(); applications.close(); actors.close(); await content.close(); }
});
