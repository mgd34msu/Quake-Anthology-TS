import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { applicationPreset } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { preservesAuthoredQ1Placement } from "../../../src/app/bootstrap/simulation/monster-placement.ts";
import { simulationProviderCheckpoint } from "../../../src/app/bootstrap/simulation/save.ts";
import { readSelectedMonstersCheckpoint } from "../../../src/app/bootstrap/simulation/monster-checkpoint.ts";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import { q1MonsterSources } from "../../../src/content/monsters/q1.ts";
import { parseQ1Entities } from "../../../src/formats/q1-map/index.ts";
import { decodeCheckpointValue, SaveReader } from "../../../src/persistence/value.ts";

const corpus = resolve(import.meta.dir, "../../../../qfiles");
test.skipIf(!existsSync(resolve(corpus, "q1/rerelease/id1/pak0.pak")))("retail rerelease e1m3 preserves the native authored flying overlap with exact geometry", async () => {
  const command = parseApplicationCommand(["--content-root", corpus, "--game", "q1-rerelease-id1", "--map", "e1m3", "--dedicated", "--mode", "singleplayer"]);
  if (command.kind !== "run") throw new Error("Missing rerelease launch");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false }), preset = applicationPreset(catalog, command.options);
  const rr = q1MonsterSources.find(source => source.edition === "rerelease");
  if (rr === undefined) throw new Error("Missing rerelease creatures");
  const source = { provider: rr.provider, content: catalog.require("q1-rerelease-id1").id };
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), enemies: { kind: "selected", value: {
    kind: "replace", default: { source, classname: "monster_army" },
    byClassname: Object.fromEntries(Object.keys(rr.creatures).map(classname => [classname, { source, classname }])),
  } } } });
  const native = await Application.open(command.options, { print: () => undefined });
  try {
    for (let frame = 0; frame < 15; frame++) await native.step(100);
    const game = native.simulation.q1Source()?.game, entity = game === undefined ? undefined : [...game.entities.values()].find(entity => entity.sourceOrdinal === 382);
    if (game === undefined || entity === undefined) throw new Error("Missing authored native wizard");
    const body = game.body(entity), authored = parseQ1Entities(native.simulation.sourceEntityText)[382];
    expect(entity.classname).toBe("monster_wizard");
    expect(entity.model).toBe("progs/wizard.mdl");
    expect(entity.movement).toBe("step");
    expect(entity.movementFlags & 3).toBe(1);
    expect(body.origin).toEqual({ x: -528, y: -304, z: -64 });
    const obstruction = game.host.trace({ start: body.origin, end: body.origin, bounds: body.bounds, ignore: entity.actor.id, monsters: true });
    expect(obstruction.startSolid).toBe(true);
    expect(obstruction.allSolid).toBe(true);
    expect(obstruction.fraction).toBe(1);
    const definition = { source, classname: "monster_wizard" }, input = { map: recipe.map, authored, definition, game, entity, body };
    expect(preservesAuthoredQ1Placement(input)).toBe(true);
    expect(preservesAuthoredQ1Placement({ ...input, body: { ...body, bounds: { ...body.bounds, max: { ...body.bounds.max, x: 32 } } } })).toBe(false);
    expect(preservesAuthoredQ1Placement({ ...input, body: { ...body, origin: { ...body.origin, x: body.origin.x + 1 } } })).toBe(false);
    expect(preservesAuthoredQ1Placement({ ...input, definition: { ...definition, classname: "monster_ogre" } })).toBe(false);
    expect(preservesAuthoredQ1Placement({ ...input, definition: { ...definition, source: { provider: "q1:monsters/classic/id1", content: catalog.require("q1-classic-id1").id } } })).toBe(false);
    const selected = await Application.open(command.options, { print: () => undefined }, recipe);
    try {
      for (let frame = 0; frame < 15; frame++) await selected.step(100);
      const read = () => {
        const checkpoint = simulationProviderCheckpoint(selected.simulation.checkpoint(), "world:simulation");
        return readSelectedMonstersCheckpoint(new SaveReader(decodeCheckpointValue(checkpoint.bytes)).field("selectedMonsters"));
      };
      const checkpoint = read(), entry = checkpoint.authored.find(entry => entry.sourceOrdinal === 382);
      if (entry === undefined) throw new Error("Missing selected authored wizard");
      const actor = selected.simulation.actors.resolveSaved(entry.actor), selectedSource = checkpoint.sources.find(entry => entry.kind === "q1");
      if (actor === null || selectedSource?.kind !== "q1") throw new Error("Missing selected source actor");
      const wizard = selectedSource.entities.entities.find(entity => entity.actor.slot === actor.id.slot);
      if (wizard === undefined) throw new Error("Missing selected wizard state");
      expect(actor.owner).toBe(recipe.map.entities.provider);
      expect(selected.simulation.actors.observe(actor.id)?.definition).toBe(`${source.provider}/monster_wizard`);
      expect(selected.simulation.bodies.read(actor.id)).toEqual(body);
      expect(wizard.callbacks.think).toBe("base:monster_frame");
      for (let frame = 0; frame < 5; frame++) await selected.step(100);
      const continued = read().sources.find(entry => entry.kind === "q1");
      if (continued?.kind !== "q1") throw new Error("Missing continuing source");
      expect(continued.entities.entities.find(entity => entity.actor.slot === actor.id.slot)?.state.nextThink).toBeGreaterThan(wizard.state.nextThink);
    } finally { await selected.close(); }
  } finally { await native.close(); }
}, 30000);

test.skipIf(!existsSync(resolve(corpus, "q1/rerelease/id1/pak0.pak")))("retail rerelease e1m6 preserves the native failed floor drop and continues the authored demon", async () => {
  const command = parseApplicationCommand(["--content-root", corpus, "--game", "q1-rerelease-id1", "--map", "e1m6", "--dedicated", "--mode", "singleplayer"]);
  if (command.kind !== "run") throw new Error("Missing rerelease launch");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false }), preset = applicationPreset(catalog, command.options);
  const rr = q1MonsterSources.find(source => source.edition === "rerelease");
  if (rr === undefined) throw new Error("Missing rerelease creatures");
  const source = { provider: rr.provider, content: catalog.require("q1-rerelease-id1").id };
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), enemies: { kind: "selected", value: {
    kind: "replace", default: { source, classname: "monster_army" },
    byClassname: Object.fromEntries(Object.keys(rr.creatures).map(classname => [classname, { source, classname }])),
  } } } });
  const native = await Application.open(command.options, { print: () => undefined });
  try {
    for (let frame = 0; frame < 15; frame++) await native.step(100);
    const game = native.simulation.q1Source()?.game, entity = game === undefined ? undefined : [...game.entities.values()].find(entity => entity.sourceOrdinal === 390);
    if (game === undefined || entity === undefined) throw new Error("Missing authored native demon");
    const body = game.body(entity), authored = parseQ1Entities(native.simulation.sourceEntityText)[390];
    expect(entity.classname).toBe("monster_demon1");
    expect(entity.model).toBe("progs/demon.mdl");
    expect(entity.movement).toBe("step");
    expect(entity.movementFlags).toBe(32);
    expect(body.ground).toBeNull();
    expect(body.origin).toEqual({ x: 728, y: 880, z: 33 });
    const obstruction = game.host.trace({ start: body.origin, end: body.origin, bounds: body.bounds, ignore: entity.actor.id, monsters: true });
    expect(obstruction.startSolid).toBe(true);
    expect(obstruction.allSolid).toBe(true);
    expect(obstruction.fraction).toBe(1);
    const start = { x: 728, y: 880, z: 33 };
    const floor = game.host.trace({ start, end: { ...start, z: start.z - 256 }, bounds: body.bounds, ignore: entity.actor.id, monsters: true });
    expect(floor.fraction).toBe(1); expect(floor.allSolid).toBe(true);
    const definition = { source, classname: "monster_demon1" }, input = { map: recipe.map, authored, definition, game, entity, body };
    expect(preservesAuthoredQ1Placement(input)).toBe(true);
    expect(preservesAuthoredQ1Placement({ ...input, body: { ...body, bounds: { ...body.bounds, max: { ...body.bounds.max, x: 48 } } } })).toBe(false);
    expect(preservesAuthoredQ1Placement({ ...input, body: { ...body, origin: { ...body.origin, x: body.origin.x + 1 } } })).toBe(false);
    expect(preservesAuthoredQ1Placement({ ...input, definition: { ...definition, classname: "monster_ogre" } })).toBe(false);
    expect(preservesAuthoredQ1Placement({ ...input, definition: { ...definition, source: { provider: "q1:monsters/classic/id1", content: catalog.require("q1-classic-id1").id } } })).toBe(false);
    const selected = await Application.open(command.options, { print: () => undefined }, recipe);
    try {
      for (let frame = 0; frame < 15; frame++) await selected.step(100);
      const read = () => {
        const checkpoint = simulationProviderCheckpoint(selected.simulation.checkpoint(), "world:simulation");
        return readSelectedMonstersCheckpoint(new SaveReader(decodeCheckpointValue(checkpoint.bytes)).field("selectedMonsters"));
      };
      const checkpoint = read(), entry = checkpoint.authored.find(entry => entry.sourceOrdinal === 390);
      if (entry === undefined) throw new Error("Missing selected authored demon");
      const actor = selected.simulation.actors.resolveSaved(entry.actor), selectedSource = checkpoint.sources.find(entry => entry.kind === "q1");
      if (actor === null || selectedSource?.kind !== "q1") throw new Error("Missing selected source actor");
      const demon = selectedSource.entities.entities.find(entity => entity.actor.slot === actor.id.slot);
      if (demon === undefined) throw new Error("Missing selected demon state");
      expect(actor.owner).toBe(recipe.map.entities.provider);
      expect(selected.simulation.actors.observe(actor.id)?.definition).toBe(`${source.provider}/monster_demon1`);
      expect(selected.simulation.bodies.read(actor.id)).toEqual(body);
      expect(demon.callbacks.think).toBe("base:monster_frame");
      for (let frame = 0; frame < 5; frame++) await selected.step(100);
      const continued = read().sources.find(entry => entry.kind === "q1");
      if (continued?.kind !== "q1") throw new Error("Missing continuing source");
      expect(continued.entities.entities.find(entity => entity.actor.slot === actor.id.slot)?.state.nextThink).toBeGreaterThan(demon.state.nextThink);
    } finally { await selected.close(); }
  } finally { await native.close(); }
}, 30000);
