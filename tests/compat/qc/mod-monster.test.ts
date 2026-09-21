import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { DamageOutcome } from "../../../src/contracts/gameplay.ts";
import type { ModActorField, ModCallbackDeclaration, ModCallbackInput, ModRuntimeValue } from "../../../src/contracts/mod-callbacks.ts";
import { SessionActorRegistry, ActorCallbackTable } from "../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable } from "../../../src/world/gameplay/index.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";
import { SharedPhysics } from "../../../src/app/bootstrap/simulation/physics.ts";
import { Q2_DONOR_PROFILE } from "../../../src/core/numeric.ts";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { prepareQuakeCResources } from "../../../src/app/bootstrap/simulation/quakec-source.ts";
import { SourceRandom } from "../../../src/app/bootstrap/simulation/random.ts";
import { QcModProvider } from "../../../src/compat/qc/mod-provider.ts";
import { loadQcProgram } from "../../../src/compat/qc/program.ts";
import { parseEntities } from "../../../src/core/common-parse.ts";

const path = "/home/buzzkill/.local/share/quake-typescript/content/q1/rerelease/copper/progs.dat";
test.skipIf(!await Bun.file(path).exists())("original Copper monster spawns, acquires a canonical Q2 client and runs source AI", async () => {
  const command = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1"]);
  if (command.kind !== "run") throw new Error("Missing Q2 destination");
  const content = await loadApplicationContent(command.options), program = loadQcProgram(await Bun.file(path).bytes());
  const coordinates = parseEntities(content.world.entities).find(entity => entity.get("classname") === "info_player_start")?.get("origin")?.split(/\s+/).map(Number);
  const [x, y, z] = coordinates ?? [];
  if (x === undefined || y === undefined || z === undefined) throw new Error("Destination has no player start");
  const origin = { x, y, z: z + 32 };
  const actors = new SessionActorRegistry(createIdentityOwner("qc-combat-mod")), callbacks = new ActorCallbackTable(actors), world = actors.allocate("q2:map", "q2:world");
  const scene = createSceneQueries(content.world), physics = new SharedPhysics({ actors, callbacks, scene, numeric: Q2_DONOR_PROFILE,
    worldActor: () => world.id, sourceOrder: (a, b) => a.slot - b.slot, onBlocked: () => undefined });
  const outcomes: DamageOutcome[] = [], sounds: string[] = [];
  let now = 3, notarget = true, lightstyles = 0;
  const player = actors.allocate("q2:players", "q2:player");
  const playerOrigin = scene.trace({ start: { x, y: y + 48, z }, end: { x, y: y + 48, z: z - 512 },
    shape: { kind: "box", bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } } }, target: { kind: "world" },
    policy: { kind: "q2", contentsMask: 1, leafContents: "merged" }, numeric: Q2_DONOR_PROFILE, passActor: player.id }).end;
  physics.bodies.create(player, { origin: playerOrigin, angles: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, ground: world.id, bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } } });
  const combat = new GameplayAuthority(actors, callbacks, { impulse: () => { throw new Error("Source velocity must not be replayed"); },
    beforeReaction: () => undefined, confirmed: outcome => { outcomes.push(outcome); return undefined; } });
  combat.create(player, { health: 100, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 200, canTakeDamage: true, invulnerable: false, team: null });
  const occupied = new Set<number>(), actorFields: ModActorField[] = [];
  for (const field of program.fields) {
    const width = field.type === "vector" ? 3 : 1;
    if (field.name === "" || Array.from({ length: width }, (_, index) => field.offset + index).some(word => occupied.has(word))) continue;
    for (let index = 0; index < width; index++) occupied.add(field.offset + index);
    const binding = field.name === "health" ? "health" : field.name === "origin" ? "origin" : field.name === "angles" ? "angles"
      : field.name === "velocity" ? "velocity" : field.name === "mins" ? "bounds-min" : field.name === "maxs" ? "bounds-max"
      : field.name === "classname" ? "classname" : field.name === "flags" ? "client-flags" : field.name === "view_ofs" ? "view-offset" : "private";
    actorFields.push({ field: field.name, binding });
  }
  const declaration: ModCallbackDeclaration = { version: 1, runtime: "quakec", program: { path: "progs.dat", digest: program.digest }, actorFields, callbacks: [],
    initialize: [{ function: "InitLightStyles", arguments: [], globals: [] }],
    frame: { function: "StartFrame", arguments: [], globals: [{ name: "self", value: { kind: "input", name: "self" } }, { name: "time", value: { kind: "input", name: "time" } }] },
    combat: { damage: { function: "T_Damage", arguments: [{ kind: "input", name: "self" }, { kind: "input", name: "inflictor" },
      { kind: "input", name: "attacker" }, { kind: "input", name: "amount" }, { kind: "float", value: 0 }],
      globals: [{ name: "time", value: { kind: "input", name: "time" } }] } } };
  const random = new SourceRandom(17);
  const source = new QcModProvider(program, { id: "mod:copper-combat", artifactPath: "progs.dat", digest: program.digest, revision: "test" }, declaration,
    { actors, callbacks, bodies: physics.bodies, combat, inventory: new SharedInventoryTable(actors), seed: 17, time: () => ({ kind: "seconds", value: now }),
      damageContext: provider => ({ sequence: outcomes.length, weaponProvider: provider, combatProvider: provider, inventoryProvider: provider, movementProvider: "q2:movement" }),
      engine: { scene, physics, world: () => world.id, print: () => undefined, message: () => undefined,
        environment: { skill: 2, mode: "singleplayer", maxClients: 1, gravity: 800 },
        classname: actor => actor.equals(player.id) ? "player" : "worldspawn",
        clients: { maximum: 1, visibility: scene, at: slot => ({ actor: slot === 1 ? player.id : null, free: slot !== 1, health: slot === 1 ? combat.read(player.id)?.health ?? 0 : 0, notarget, origin: playerOrigin, viewOffset: { x: 0, y: 0, z: 22 } }) },
        presentation: { map: "maps/base1.bsp", players: () => [player.id], camera: () => ({ origin: { x: 0, y: 0, z: 0 }, angles: { x: 0, y: 0, z: 0 } }) },
        events: { registerResource: () => undefined, emit: (_content, event) => {
          if (event.kind === "q1" && event.event.kind === "sound") sounds.push(event.event.path);
          if (event.kind === "q1" && event.event.kind === "lightstyle") lightstyles++; return undefined;
        } } } },
    { nextInteger: () => random.nextInteger(), nextUnit: () => random.nextUnit(), checkpoint: () => random.checkpoint(), restore: state => {
      if (state.kind !== "glibc-random") throw new Error("Invalid RNG"); return random.restore(state);
    } }, { content: "q1:rerelease:copper:installed", resources: await prepareQuakeCResources(program, await content.forContent("q1:classic:id1:installed")) });
  try {
    source.initialize();
    expect(source.machine.globals.float(source.machine.globalOffset("skill"))).toBe(2);
    expect(lightstyles).toBeGreaterThan(0);
    source.invoke({ function: "spawn", arguments: [], globals: [] }, new Map<ModCallbackInput, ModRuntimeValue>());
    const target = actors.ownedBy("mod:copper-combat")[0], slot = target === undefined ? null : actors.sourceOf(target.id);
    if (target === undefined || slot === null) throw new Error("Original source did not allocate its monster");
    const inputs = new Map<ModCallbackInput, ModRuntimeValue>([["self", { kind: "actor", value: target.id }]]);
    source.invoke({ function: "setorigin", arguments: [{ kind: "input", name: "self" }, { kind: "vector", value: origin }], globals: [] }, inputs);
    source.invoke({ function: "monster_knight_spawn", arguments: [], globals: [{ name: "self", value: { kind: "input", name: "self" } }] }, inputs);
    const words = source.machine.entities.at(slot.slot), field = (name: string) => source.machine.fieldOffset(name);
    expect(combat.read(target.id)?.health).toBe(72);
    let frame = 0;
    const advance = () => { now += 0.1; source.advance({ frame: ++frame, time: { kind: "seconds", value: now }, elapsed: { kind: "seconds", value: 0.1 }, phase: "frame-exit" }); };
    for (let tick = 0; tick < 4; tick++) advance();
    expect(words.int(field("enemy"))).toBe(0);
    expect(words.float(field("movetype"))).toBe(4);
    expect(words.float(field("takedamage"))).toBe(2);
    notarget = false;
    for (let tick = 0; tick < 10 && words.int(field("enemy")) === 0; tick++) advance();
    const enemySlot = source.machine.entities.slot(words.int(field("enemy")));
    expect(source.machine.strings.get(source.machine.entities.at(enemySlot).int(field("classname")))).toBe("player");
    expect(words.float(field("nextthink"))).toBeGreaterThan(now - 0.1);
    expect(sounds).toContain("knight/ksight.wav");
    expect(source.presentations().some(model => model.actor.equals(target.id) && model.path === "progs/knight.mdl")).toBe(true);
    const count = source.machine.globals.float(source.machine.globalOffset("framecount")), saved = source.checkpoint();
    source.machine.globals.setFloat(source.machine.globalOffset("framecount"), 999);
    source.restore(saved);
    expect(source.machine.globals.float(source.machine.globalOffset("framecount"))).toBe(count);
    expect(() => source.initialize()).toThrow("once");
  } finally { source.close(); actors.close(); await content.close(); }
}, 30000);
