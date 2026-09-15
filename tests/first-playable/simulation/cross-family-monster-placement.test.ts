import type { TraceQuery, TraceResult } from "../../../src/contracts/scene.ts";
import { nearbyMonsterPlacement } from "../../../src/app/bootstrap/simulation/monster-placement.ts";
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import { applicationPreset, loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import type { SimulationOptions } from "../../../src/app/bootstrap/simulation/index.ts";
import { providerTiming } from "../../../src/app/bootstrap/simulation/players.ts";
import { simulationProviderCheckpoint } from "../../../src/app/bootstrap/simulation/save.ts";
import { readSelectedMonstersCheckpoint } from "../../../src/app/bootstrap/simulation/monster-checkpoint.ts";
import type { ProviderReference } from "../../../src/contracts/content.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { parseQ2Entities } from "../../../src/content/q2/foundation/fields.ts";
import { defaultMonsterRoster } from "../../../src/content/catalog/monsters.ts";
import { decodeCheckpointValue, SaveReader } from "../../../src/persistence/value.ts";


for (const centerBlocked of [false, true]) test("airborne overlapping hull requires a clear center route (blocked=" + centerBlocked + ")", () => {
  const origin = { x: 0, y: 0, z: 0 };
  const bounds = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } };
  const placed = nearbyMonsterPlacement({ body: { origin, bounds, angles: origin, velocity: origin, ground: null },
    authored: { origin, bounds, locomotion: "fly" }, locomotion: "fly", worldActor: null, sameMedium: () => true,
    query: { target: { kind: "world" }, passActor: null, policy: { kind: "q1", move: "normal", hull: null },
      numeric: { id: "test:binary32", arithmetic: { kind: "binary32", round: "each-operation" }, scalarStorage: "binary32", floatToInt: "checked-c-truncation", integerOverflow: "wrap32" } },
    trace: query => {
      const point = query.shape.kind === "point";
      const startSolid = !point && query.start.x === 0 && query.start.y === 0;
      const endSolid = !point && query.end.x === 0 && query.end.y === 0;
      return { kind: "q1", fraction: point && centerBlocked ? 0 : 1, end: query.end, startSolid, allSolid: startSolid && endSolid,
        contact: { kind: "none" }, hit: { kind: "none" }, inOpen: true, inWater: false, sourcePlane: { normal: { x: 0, y: 0, z: 1 }, distance: 0 } };
    } });
  if (centerBlocked) expect(placed).toBeNull();
  else expect(placed).not.toBeNull();
});


const locomotions: readonly ("walk" | "fly" | "swim")[] = ["walk", "fly", "swim"];
for (const authoredMovement of locomotions) for (const selectedMovement of locomotions) for (const overlap of [false, true]) {
  test("shared placement " + authoredMovement + " to " + selectedMovement + " with overlap=" + overlap, () => {
    const origin = { x: overlap ? 0 : 4, y: 0, z: 0 };
    const bounds = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } };
    const trace = (query: TraceQuery): TraceResult => {
      const min = query.shape.kind === "point" ? { x: 0, y: 0, z: 0 } : query.shape.bounds.min;
      const solid = (x: number, z: number) => x + min.x < -0.5 || z + min.z < -8;
      const startSolid = solid(query.start.x, query.start.z), endSolid = solid(query.end.x, query.end.z);
      const floorFraction = query.end.z < query.start.z ? (-8 - min.z - query.start.z) / (query.end.z - query.start.z) : 1;
      const fraction = !startSolid && floorFraction >= 0 && floorFraction < 1 ? floorFraction : 1;
      const end = { x: query.start.x + (query.end.x - query.start.x) * fraction, y: query.start.y + (query.end.y - query.start.y) * fraction, z: query.start.z + (query.end.z - query.start.z) * fraction };
      return { kind: "q1", fraction, end, startSolid, allSolid: startSolid && endSolid,
        contact: fraction < 1 ? { kind: "plane", plane: { normal: { x: 0, y: 0, z: 1 }, distance: -8 } } : { kind: "none" },
        hit: fraction < 1 ? { kind: "world", model: 0 } : { kind: "none" }, inOpen: true, inWater: false, sourcePlane: { normal: { x: 0, y: 0, z: 1 }, distance: -8 } };
    };
    const input = { body: { origin, bounds, angles: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, ground: null },
      authored: { origin, bounds, locomotion: authoredMovement }, locomotion: selectedMovement, worldActor: null,
      query: { target: { kind: "world" }, passActor: null, policy: { kind: "q1", move: "normal", hull: null },
        numeric: { id: "test:binary32", arithmetic: { kind: "binary32", round: "each-operation" }, scalarStorage: "binary32", floatToInt: "checked-c-truncation", integerOverflow: "wrap32" } },
      sameMedium: () => true, trace } satisfies Parameters<typeof nearbyMonsterPlacement>[0];
    const placed = nearbyMonsterPlacement(input);
    expect(placed).not.toBeNull();
    if (placed === null) throw new Error("Expected connected placement");
    const fit = trace({ ...input.query, start: placed.origin, end: placed.origin, shape: { kind: "box", bounds } });
    expect(fit.startSolid).toBe(false); expect(fit.allSolid).toBe(false);
    if (selectedMovement === "walk") expect(placed.origin.z).toBe(-7);
    expect(nearbyMonsterPlacement({ ...input, sameMedium: () => false })).toBeNull();
    if (overlap) expect(nearbyMonsterPlacement({ ...input, trace: query => query.shape.kind === "point" ? { ...trace(query), fraction: 0 } : trace(query) })).toBeNull();
    if (selectedMovement === "walk") expect(nearbyMonsterPlacement({ ...input,
      trace: query => query.end.z < query.start.z ? { ...trace(query), fraction: 1 } : trace(query) })).toBeNull();
  });
}

const corpus = resolve(import.meta.dir, "../../../../qfiles");
test.skipIf(!existsSync(resolve(corpus, "q1/rerelease/id1/pak0.pak")))("retail e1m1 dog slots spawn visible rerelease parasites with source AI", async () => {
  const command = parseApplicationCommand(["--content-root", corpus, "--game", "q1-classic-id1", "--map", "e1m1", "--dedicated", "--mode", "singleplayer"]);
  if (command.kind !== "run") throw new Error("Expected Q1 launch");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false });
  const preset = applicationPreset(catalog, command.options);
  const reference: ProviderReference = { provider: "q2:monsters/rerelease/baseq2", content: catalog.require("q2-rerelease-baseq2").id };
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), enemies: { kind: "selected", value: defaultMonsterRoster("q1", reference) } } });
  const content = await loadApplicationContent(command.options, recipe);
  const identity = createIdentityOwner("q1-dog-q2-parasite");
  const simulation = createSimulation({ identity, recipe, world: content.world, mounts: content.mounts, skill: 1, mode: "singleplayer", seed: 1, maxClients: 1 });
  try {
    if (content.world.kind !== "q1-bsp") throw new Error("Expected Q1 map");
    const dogs = content.world.entityList.flatMap((entity, ordinal) => {
      const classname = entity.properties.find(property => property.key === "classname")?.value;
      const flags = Number(entity.properties.find(property => property.key === "spawnflags")?.value ?? 0);
      return classname === "monster_dog" && (flags & 512) === 0 ? [ordinal] : [];
    });
    expect(dogs.length).toBeGreaterThan(0);
    for (let frame = 0; frame < 10; frame++) simulation.step({ elapsedMilliseconds: 100, commands: [] });
    const checkpoint = simulationProviderCheckpoint(simulation.checkpoint(), "world:simulation");
    const selected = readSelectedMonstersCheckpoint(new SaveReader(decodeCheckpointValue(checkpoint.bytes)).field("selectedMonsters"));
    const source = selected.sources.find(source => source.reference.provider === reference.provider);
    if (source?.kind !== "q2") throw new Error("Missing Q2 source behavior");
    expect(selected.authored.filter(entry => entry.classname === "monster_dog").length).toBe(dogs.length);
    for (const ordinal of dogs) {
      const entry = selected.authored.find(entry => entry.sourceOrdinal === ordinal);
      if (entry === undefined) throw new Error(`Dropped authored dog ${ordinal}`);
      expect(entry.definition).toEqual({ source: reference, classname: "monster_parasite" });
      expect(entry.placement.kind).toBe("ready");
      const actor = simulation.actors.resolveSaved(entry.actor);
      if (actor === null) throw new Error(`Dropped parasite actor ${ordinal}`);
      expect(simulation.actors.observe(actor.id)?.definition).toBe(`${reference.provider}/monster_parasite`);
      expect(source.entities.entities.find(entity => entity.actor.slot === actor.id.slot)?.spawn.classname).toBe("monster_parasite");
      expect(source.monsters.actors.find(entity => entity.actor.slot === actor.id.slot)?.definition).toBe("monster_parasite");
      expect(simulation.presentations().some(presentation => presentation.actor.equals(actor.id))).toBe(true);
      expect(simulation.combat.read(actor.id)?.health).toBeGreaterThan(0);
    }
  } finally { simulation.close(); await content.close(); }
}, 30000);

test.skipIf(!existsSync(resolve(corpus, "q2/rerelease/baseq2/pak0.pak")))("retail e1m3 airborne source383 places and restores full-size rerelease flyer", async () => {
  const command = parseApplicationCommand(["--content-root", corpus, "--game", "q1-classic-id1", "--map", "e1m3", "--movement", "q1", "--character", "q3", "--model", "ranger", "--dedicated"]);
  if (command.kind !== "run") throw new Error("Expected mixed Q1 launch");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false });
  const preset = applicationPreset(catalog, command.options);
  const reference: ProviderReference = { provider: "q2:monsters/rerelease/baseq2", content: catalog.require("q2-rerelease-baseq2").id };
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), enemies: { kind: "selected", value: defaultMonsterRoster("q1", reference) } } });
  const content = await loadApplicationContent(command.options, recipe);
  const options = { identity: createIdentityOwner("e1m3-flyer-placement"), recipe, world: content.world, mounts: content.mounts, skill: 1, mode: command.options.mode, seed: 1, maxClients: 1 } satisfies SimulationOptions;
  let simulation = createSimulation(options);
  try {
    for (let branch = 0; branch < 2; branch++) {
      for (let frame = 0; frame < 50; frame++) simulation.step({ elapsedMilliseconds: 100, commands: [] });
      const saved = simulation.checkpoint();
      const selected = readSelectedMonstersCheckpoint(new SaveReader(decodeCheckpointValue(simulationProviderCheckpoint(saved, "world:simulation").bytes)).field("selectedMonsters"));
      const entry = selected.authored.find(entry => entry.sourceOrdinal === 383);
      if (entry === undefined) throw new Error("Dropped authored wizard383");
      expect(entry.classname).toBe("monster_wizard");
      expect(entry.targetname).toBe("t148");
      expect(entry.spawnflags).toBe(256);
      expect(entry.definition).toEqual({ source: reference, classname: "monster_flyer" });
      expect(entry.placement.kind).toBe("ready");
      const actor = simulation.actors.observe(simulation.actors.referenceSaved(entry.actor, "current"));
      if (actor === null) throw new Error("Dropped flyer383 actor");
      const body = simulation.bodies.read(actor.id);
      if (body === null) throw new Error("Missing flyer body");
      expect(body.bounds).toEqual({ min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 16 } });
      console.log(JSON.stringify({ proof: "e1m3-flyer383", branch, sourceSeconds: simulation.timeSeconds, frames: 50 + branch * 51,
        authored: { x: -528, y: -304, z: -64 }, placed: body.origin, bounds: body.bounds, selectedActors: selected.authored.length,
        displacement: { x: body.origin.x + 528, y: body.origin.y + 304, z: body.origin.z + 64 } }));
      const fit = simulation.scene.geometryTrace({ start: body.origin, end: body.origin, shape: { kind: "box", bounds: body.bounds }, target: { kind: "world" }, passActor: actor.id,
        numeric: providerTiming(recipe, reference.provider).numeric, policy: { kind: "q2", contentsMask: 1, leafContents: "merged" } });
      expect(fit.startSolid).toBe(false); expect(fit.allSolid).toBe(false);
      expect(simulation.presentations().some(value => value.actor.equals(actor.id))).toBe(true);
      const source = selected.sources.find(source => source.reference.provider === reference.provider);
      if (source?.kind !== "q2") throw new Error("Missing flyer source AI");
      expect(source.monsters.actors.find(value => value.actor.slot === actor.id.slot)?.definition).toBe("monster_flyer");
      const animation = source.entities.entities.find(value => value.actor.slot === actor.id.slot)?.values.frame;
      if (animation === undefined) throw new Error("Missing flyer animation");
      simulation.step({ elapsedMilliseconds: 100, commands: [] });
      const advanced = readSelectedMonstersCheckpoint(new SaveReader(decodeCheckpointValue(simulationProviderCheckpoint(simulation.checkpoint(), "world:simulation").bytes)).field("selectedMonsters"));
      const advancedSource = advanced.sources.find(value => value.reference.provider === reference.provider);
      if (advancedSource?.kind !== "q2") throw new Error("Missing advanced flyer source");
      expect(advancedSource.entities.entities.find(value => value.actor.slot === actor.id.slot)?.values.frame).not.toBe(animation);
      const health = simulation.combat.read(actor.id)?.health;
      if (health === undefined) throw new Error("Missing flyer health");
      expect(health).toBeGreaterThan(1);
      simulation.combat.apply({ target: actor.id, amount: 1, knockback: 0, direction: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 0 }, point: body.origin, delivery: "direct",
        attack: { sequence: 9000 + branch, time: { kind: "seconds", value: simulation.timeSeconds }, attacker: null, inflictor: null, weapon: null, weaponProvider: "q1:official",
          combatProvider: recipe.combat.provider, inventoryProvider: recipe.inventory.provider, movementProvider: recipe.movement.provider, cause: { kind: "q1", deathType: "" } } });
      expect(simulation.combat.read(actor.id)?.health).toBe(health - 1);
      if (branch === 0) {
        const restore = simulation.checkpoint();
        simulation.close();
        simulation = createSimulation({ ...options, restore, restoredClients: [] });
      }
    }
  } finally { simulation.close(); await content.close(); }
}, 30000);

for (const scenario of [
  { map: "base1", target: "custom", ordinals: [327, 399] },
  { map: "base1", target: "monster_dog", ordinals: [327] },
  { map: "base1", target: "monster_wizard", ordinals: [369] },
  { map: "base2", target: "monster_army", ordinals: [169] },
  { map: "base2", target: "monster_army", ordinals: [169], removeBarrier: true },
  { map: "base2", target: "monster_dog", ordinals: [169] },
  { map: "base2", target: "monster_wizard", ordinals: [169] },
  { map: "base2", target: "custom", ordinals: [169] },
]) test.skipIf(!existsSync(resolve(corpus, "q1/rerelease/id1/pak0.pak")))(`retail ${scenario.map} places ${scenario.target} with full source hull and authored encounter fields${scenario.removeBarrier ? " after barrier removal" : ""}`, async () => {
  const command = parseApplicationCommand(["--content-root", corpus, "--game", "q2-classic-baseq2", "--map", scenario.map, "--dedicated", "--mode", "singleplayer"]);
  if (command.kind !== "run") throw new Error("Expected selected launch");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false });
  const preset = applicationPreset(catalog, command.options);
  const classic: ProviderReference = { provider: "q1:monsters/classic/id1", content: catalog.require("q1-classic-id1").id };
  const rerelease: ProviderReference = { provider: "q1:monsters/rerelease/id1", content: catalog.require("q1-rerelease-id1").id };
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), enemies: { kind: "selected", value: {
    kind: "replace", default: { source: scenario.target === "custom" ? rerelease : classic, classname: scenario.target === "custom" ? "monster_army" : scenario.target },
    byClassname: scenario.target === "custom" ? {
      monster_infantry: { source: classic, classname: "monster_enforcer" },
      monster_soldier: { source: rerelease, classname: "monster_ogre" },
      monster_soldier_light: { source: classic, classname: "monster_shambler" },
    } : {},
  } } } });
  const content = await loadApplicationContent(command.options, recipe);
  const identity = createIdentityOwner(`placement-${scenario.map}-${scenario.target}`);
  const options = { identity, recipe, world: content.world, mounts: content.mounts, skill: command.options.skill, mode: command.options.mode, seed: 1, maxClients: 1 };
  let simulation = createSimulation(options);
  try {
    const initial = simulationProviderCheckpoint(simulation.checkpoint(), "world:simulation");
    const initialMonsters = readSelectedMonstersCheckpoint(new SaveReader(decodeCheckpointValue(initial.bytes)).field("selectedMonsters"));
    const authored = parseQ2Entities(content.world.entities, "classic");
    for (const entry of initialMonsters.authored) expect(entry.target || entry.route).toBe(authored[entry.sourceOrdinal]?.values.get("target") ?? "");
    for (let frame = 0; frame < 10; frame++) simulation.step({ elapsedMilliseconds: 100, commands: [] });
    if (scenario.map === "base2") {
      let saved = simulation.checkpoint();
      const state = readSelectedMonstersCheckpoint(new SaveReader(decodeCheckpointValue(simulationProviderCheckpoint(saved, "world:simulation").bytes)).field("selectedMonsters"));
      const waiting = state.authored.find(entry => entry.sourceOrdinal === 169);
      if (waiting === undefined) throw new Error("Missing sealed ambush");
      expect(waiting.placement.kind).toBe("waiting");
      if (waiting.placement.kind !== "waiting") throw new Error("Expected sealed placement phase");
      const owner = simulation.actors.resolveSaved(waiting.actor);
      if (owner === null) throw new Error("Missing sealed actor");
      expect(simulation.combat.read(owner.id)?.canTakeDamage).toBe(false);
      const originalBody = simulation.bodies.read(owner.id);
      expect(simulation.presentations().some(presentation => presentation.actor.equals(owner.id))).toBe(false);
      let waitingPhysics = 0;
      const physicsStep = simulation.physics.step.bind(simulation.physics);
      simulation.physics.step = (actor, elapsed) => { if (actor.id.equals(owner.id)) waitingPhysics++; return physicsStep(actor, elapsed); };
      for (let frame = 0; frame < 5; frame++) simulation.step({ elapsedMilliseconds: 100, commands: [] });
      expect(simulation.bodies.read(owner.id)).toEqual(originalBody);
      expect(waitingPhysics).toBe(0);
      if (scenario.removeBarrier) {
        const game = simulation.q2Source()?.game;
        if (game === undefined) throw new Error("Missing barrier map program");
        for (const barrier of waiting.placement.barriers) {
          const actor = simulation.actors.resolveSaved(barrier.actor);
          const door = actor === null ? null : game.entity(actor.id);
          if (door === null) throw new Error("Missing barrier to remove");
          game.remove(door);
        }
        saved = simulation.checkpoint();
      }
      simulation.close();
      simulation = createSimulation({ ...options, restore: saved, restoredClients: [] });
      if (!scenario.removeBarrier) {
        const player = simulation.admitPlayer(identity.client(0, 0)).actor;
        const game = simulation.q2Source()?.game;
        if (game === undefined) throw new Error("Missing ambush map program");
        const shotgun = [...game.entities.values()].find(entity => entity.spawn.ordinal === 277);
        if (shotgun?.touch === null || shotgun === undefined) throw new Error("Missing authored shotgun pickup");
        shotgun.touch(shotgun, game, { self: shotgun.actor, other: player, plane: null, surface: null });
        const destinations = waiting.placement.barriers.map(barrier => {
          const door = game.entity(simulation.actors.referenceSaved(barrier.actor));
          if (door === null) throw new Error("Missing restored barrier");
          return { door, destination: simulation.q2Source()?.movers.traversal(door).destination };
        });
        for (let frame = 0; frame < 30; frame++) simulation.step({ elapsedMilliseconds: 100, commands: [] });
        for (const { door, destination } of destinations) {
          if (destination === null || destination === undefined) throw new Error("Authored barrier did not start opening");
          expect(game.body(door).origin).toEqual(destination);
          expect(simulation.q2Source()?.movers.traversal(door).destination).toBeNull();
        }
      } else for (let frame = 0; frame < 5; frame++) simulation.step({ elapsedMilliseconds: 100, commands: [] });
    }
    const checkpoint = simulationProviderCheckpoint(simulation.checkpoint(), "world:simulation");
    const selected = readSelectedMonstersCheckpoint(new SaveReader(decodeCheckpointValue(checkpoint.bytes)).field("selectedMonsters"));
    for (const entry of selected.authored) {
      const fields = authored[entry.sourceOrdinal];
      if (fields === undefined) throw new Error("Missing authored entity");
      expect(entry.targetname).toBe(fields.values.get("targetname") ?? "");
      expect(entry.spawnflags).toBe(Number(fields.values.get("spawnflags") ?? 0));
      expect(entry.activation.kind).toBe((entry.spawnflags & 2) !== 0 ? "dormant" : "active");
    }
    for (const ordinal of scenario.ordinals) {
      const entry = selected.authored.find(value => value.sourceOrdinal === ordinal);
      if (entry === undefined) throw new Error(`Missing selected source ${ordinal}`);
      expect(entry.placement.kind).toBe("ready");
      const actor = simulation.actors.observations().find(value => value.id.slot === entry.actor.slot && value.id.generation === entry.actor.generation);
      if (actor === undefined) throw new Error("Missing selected actor");
      const body = simulation.bodies.read(actor.id);
      if (body === null) throw new Error("Missing selected body");
      const source = selected.sources.find(value => value.reference.provider === entry.definition.source.provider);
      if (source?.kind !== "q1") throw new Error("Missing Q1 creature source");
      const entity = source.entities.entities.find(value => value.actor.slot === actor.id.slot);
      if (entity === undefined) throw new Error("Missing source creature");
      const large = ["monster_ogre", "monster_shambler", "monster_dog"].includes(entry.definition.classname);
      expect(body.bounds.min).toEqual({ x: large ? -32 : -16, y: large ? -32 : -16, z: -24 });
      expect(body.bounds.max).toEqual({ x: large ? 32 : 16, y: large ? 32 : 16, z: ["monster_ogre", "monster_shambler"].includes(entry.definition.classname) ? 64 : 40 });
      const fit = simulation.scene.geometryTrace({ start: body.origin, end: body.origin, shape: { kind: "box", bounds: body.bounds },
        target: { kind: "world" }, passActor: actor.id, numeric: providerTiming(recipe, entry.definition.source.provider).numeric,
        policy: { kind: "q1", move: "normal", hull: null } });
      expect(fit.startSolid).toBe(false); expect(fit.allSolid).toBe(false);
      expect(entity.state.movementFlags & 3).toBe(scenario.target === "monster_wizard" ? 1 : 0);
      expect(simulation.actors.observe(actor.id)?.definition).toBe(`${entry.definition.source.provider}/${entry.definition.classname}`);
    }
  } finally { simulation.close(); await content.close(); }
}, 30000);
