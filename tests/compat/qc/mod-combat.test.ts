import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { DamageOutcome, DamageRequest } from "../../../src/contracts/gameplay.ts";
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
test.skipIf(!await Bun.file(path).exists())("original Copper combat owns health and authored pain/death callbacks inside shared Q2 authority", async () => {
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
  const outcomes: DamageOutcome[] = [], sounds: string[] = [], kills: number[] = [];
  const combat = new GameplayAuthority(actors, callbacks, { impulse: () => { throw new Error("Source velocity must not be replayed"); },
    beforeReaction: () => undefined, confirmed: outcome => { outcomes.push(outcome); return undefined; } });
  const occupied = new Set<number>(), actorFields: ModActorField[] = [];
  for (const field of program.fields) {
    const width = field.type === "vector" ? 3 : 1;
    if (field.name === "" || Array.from({ length: width }, (_, index) => field.offset + index).some(word => occupied.has(word))) continue;
    for (let index = 0; index < width; index++) occupied.add(field.offset + index);
    actorFields.push({ field: field.name, binding: "private" });
  }
  const declaration: ModCallbackDeclaration = { version: 1, runtime: "quakec", program: { path: "progs.dat", digest: program.digest }, actorFields, callbacks: [],
    combat: { damage: { function: "T_Damage", arguments: [{ kind: "input", name: "self" }, { kind: "input", name: "inflictor" },
      { kind: "input", name: "attacker" }, { kind: "input", name: "amount" }, { kind: "float", value: 0 }],
      globals: [{ name: "time", value: { kind: "input", name: "time" } }] } } };
  const random = new SourceRandom(17);
  const source = new QcModProvider(program, { id: "mod:copper-combat", artifactPath: "progs.dat", digest: program.digest, revision: "test" }, declaration,
    { actors, callbacks, bodies: physics.bodies, combat, inventory: new SharedInventoryTable(actors), seed: 17, time: () => ({ kind: "seconds", value: 3 }),
      damageContext: provider => ({ sequence: outcomes.length, weaponProvider: provider, combatProvider: provider, inventoryProvider: provider, movementProvider: "q2:movement" }),
      engine: { scene, physics, world: () => world.id, print: () => undefined, message: () => undefined,
        presentation: { map: "maps/base1.bsp", players: () => [world.id], camera: () => ({ origin: { x: 0, y: 0, z: 0 }, angles: { x: 0, y: 0, z: 0 } }) },
        events: { registerResource: () => undefined, emit: (_content, event) => {
          if (event.kind === "q1" && event.event.kind === "sound") sounds.push(event.event.path);
          if (event.kind === "q1" && event.event.kind === "monster-killed") kills.push(event.event.found); return undefined;
        } } } },
    { nextInteger: () => random.nextInteger(), nextUnit: () => random.nextUnit(), checkpoint: () => random.checkpoint(), restore: state => {
      if (state.kind !== "glibc-random") throw new Error("Invalid RNG"); return random.restore(state);
    } }, { content: "q1:rerelease:copper:installed", resources: await prepareQuakeCResources(program, await content.forContent("q1:classic:id1:installed")) });
  try {
    source.invoke({ function: "bubble_spawn", arguments: [{ kind: "vector", value: origin }], globals: [] }, new Map<ModCallbackInput, ModRuntimeValue>());
    const target = actors.ownedBy("mod:copper-combat")[0], slot = target === undefined ? null : actors.sourceOf(target.id);
    if (target === undefined || slot === null) throw new Error("Original source did not allocate an owned actor");
    const words = source.machine.entities.at(slot.slot), field = (name: string) => source.machine.fieldOffset(name);
    // This witness installs the source Knight callback fields, not its map spawn/AI lifecycle.
    words.setFloat(field("health"), 72); words.setFloat(field("takedamage"), 2); words.setFloat(field("movetype"), 0);
    words.setFloat(field("nextthink"), 0);
    words.setFloat(field("flags"), 32);
    source.invoke({ function: "droptofloor", arguments: [{ kind: "float", value: 0 }, { kind: "float", value: 0 }], globals: [{ name: "self", value: { kind: "input", name: "self" } }] },
      new Map([["self", { kind: "actor", value: target.id }]]));
    source.invoke({ function: "ai_forward", arguments: [{ kind: "float", value: 4 }], globals: [{ name: "self", value: { kind: "input", name: "self" } }] },
      new Map([["self", { kind: "actor", value: target.id }]]));
    expect(physics.bodies.read(target.id)?.origin.x).toBe(origin.x + 4);
    words.setFloat(field("flags"), 32);
    words.setInt(field("classname"), source.machine.strings.allocate("monster_knight"));
    words.setInt(field("th_pain"), program.functionNamed("knight_pain").index);
    words.setInt(field("th_die"), program.functionNamed("knight_die").index);
    let pain = 0, death = 0, transformed = 0;
    callbacks.operations.pain.register({ provider: "test:observer", id: "test:pain", order: 0, kind: "observe", observe: () => { pain++; return undefined; } });
    callbacks.operations.die.register({ provider: "test:observer", id: "test:death", order: 0, kind: "observe", observe: () => { death++; return undefined; } });
    combat.damageOperation.register({ provider: "test:transform", id: "test:once", order: 0, kind: "transform", transform: request => { transformed++; return { ...request, amount: request.amount + 2 }; } });
    const request = (amount: number): DamageRequest => ({ target: target.id, amount, knockback: 0,
      direction: { x: 0, y: 0, z: 0 }, point: origin, normal: { x: 0, y: 0, z: 0 }, delivery: "direct",
      attack: { sequence: outcomes.length, time: { kind: "seconds", value: 3 }, attacker: null, inflictor: null, weapon: "q2:weapon_blaster",
        weaponProvider: "q2:weapons", combatProvider: "q2:combat", inventoryProvider: "q2:inventory", movementProvider: "q2:movement",
        cause: { kind: "q2", meansOfDeath: 1, damageFlags: 0 } } });
    const first = combat.apply(request(10));
    expect(first.kind).toBe("committed"); expect(combat.read(target.id)?.health).toBe(60); expect(outcomes).toHaveLength(1);
    expect(pain).toBe(1); expect(transformed).toBe(1); expect(sounds).toContain("knight/khurt.wav");
    const saved = source.checkpoint();
    combat.apply(request(70));
    expect(combat.read(target.id)?.health).toBe(-12); expect(outcomes).toHaveLength(2); expect(death).toBe(1); expect(transformed).toBe(2);
    expect(sounds).toContain("knight/kdeath.wav");
    expect(kills).toEqual([1]);
    source.restore(saved); expect(combat.read(target.id)?.health).toBe(60);
    words.setInt(field("use"), program.functionNamed("SUB_RemoveSoon").index);
    callbacks.use(target, world.id, world.id);
    source.advance({ frame: 1, time: { kind: "seconds", value: 3.2 }, elapsed: { kind: "seconds", value: 0.1 }, phase: "frame-exit" });
    expect(actors.isLive(target.id)).toBe(false); expect(combat.read(target.id)).toBeNull();
  } finally { source.close(); actors.close(); await content.close(); }
}, 30000);
