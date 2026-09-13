import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import { applicationPreset, loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { providerTiming } from "../../../src/app/bootstrap/simulation/players.ts";
import { simulationProviderCheckpoint } from "../../../src/app/bootstrap/simulation/save.ts";
import { readSelectedMonstersCheckpoint } from "../../../src/app/bootstrap/simulation/monster-checkpoint.ts";
import type { ProviderReference } from "../../../src/contracts/content.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { parseQ2Entities } from "../../../src/content/q2/foundation/fields.ts";
import { decodeCheckpointValue, SaveReader } from "../../../src/persistence/value.ts";

const corpus = resolve(import.meta.dir, "../../../../qfiles");
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
