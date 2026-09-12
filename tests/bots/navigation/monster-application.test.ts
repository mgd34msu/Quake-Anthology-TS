import type { EnemySelection, MonsterDefinitionReference, MonsterSelectionTarget } from "../../../src/contracts/content.ts";
import { preservesAuthoredQ1Placement } from "../../../src/app/bootstrap/simulation/monster-placement.ts";
import { parseQ1Entities } from "../../../src/formats/q1-map/index.ts";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import { applicationPreset } from "../../../src/app/bootstrap/content.ts";
import { q1MonsterSources } from "../../../src/content/monsters/q1.ts";
import { simulationProviderCheckpoint } from "../../../src/app/bootstrap/simulation/save.ts";
import { readSelectedMonstersCheckpoint } from "../../../src/app/bootstrap/simulation/monster-checkpoint.ts";
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { ordinaryAddonMonster } from "../../../src/content/q1/addons/monsters/ordinary/index.ts";
import { Mg3PathResult, walkMg3PathToGoal } from "../../../src/content/q1/addons/monsters/ai/path.ts";
import { preloadNavigation } from "../../../src/bots/navigation/load.ts";
import { decodeCheckpointValue, SaveReader } from "../../../src/persistence/value.ts";

function routeState(bytes: Uint8Array) {
  return new SaveReader(decodeCheckpointValue(bytes)).list(reader =>
    Object.fromEntries(["goal", "cursor", "map", "nodes", "edges", "points", "seconds", "generation"].map(key => [key, reader.field(key).value])));
}
const corpus = resolve(import.meta.dir, "../../../../qfiles");
test.skipIf(!existsSync(join(corpus, "q1/rerelease/mg3/pak0.pak")))("retail MG3 application installs monster navigation before think and restores an active path", async () => {
  const launch = parseApplicationCommand(["--content-root", corpus, "--game", "q1-rerelease-mg3", "--map", "dm1", "--dedicated", "--mode", "singleplayer"]);
  if (launch.kind !== "run") throw new Error("Expected MG3 application options");
  const application = await Application.open(launch.options, { print: () => undefined }), directory = await mkdtemp(join(tmpdir(), "mg3-navigation-"));
  try {
    const source = application.simulation.q1Source();
    if (source === null || source.composition.addon === null) throw new Error("MG3 source was not installed");
    expect(source.game.stateExtensions.has("mg3:monster-navigation")).toBe(true);
    const spot = [...source.game.entities.values()].find(entity => entity.classname === "info_player_start");
    if (spot === undefined) throw new Error("Retail spawn point missing");
    const origin = source.game.body(spot).origin;
    const entity = source.game.create("monster_knight", { properties: [{ key: "classname", value: "monster_knight" },
      { key: "origin", value: `${origin.x} ${origin.y} ${origin.z}` }] });
    source.game.spawnEntity(entity);
    for (let frame = 0; frame < 16; frame++) await application.step(25);
    const monster = ordinaryAddonMonster(source.composition.addon, entity);
    if (monster === undefined) throw new Error("Source knight was not admitted");
    const before = monster.origin, goal = { ...before, x: before.x - 64 };
    expect(walkMg3PathToGoal(monster, 4, goal)).toBe(Mg3PathResult.IN_PROGRESS);
    expect(monster.origin.x).toBe(before.x - 4);
    const extension = source.game.stateExtensions.get("mg3:monster-navigation");
    if (extension === undefined) throw new Error("Navigation extension missing");
    const path = routeState(extension.capture()), savedOrigin = monster.origin;
    await application.saveGame(join(directory, "active.sav"));
    const nextResult = walkMg3PathToGoal(monster, 4, goal), nextOrigin = monster.origin;
    expect(nextResult).toBe(Mg3PathResult.IN_PROGRESS);
    await application.loadGame(join(directory, "active.sav"));
    const restored = application.simulation.q1Source();
    if (restored === null || restored.composition.addon === null) throw new Error("Restored MG3 source missing");
    const restoredEntity = [...restored.game.entities.values()].find(value => value.actor.id.slot === entity.actor.id.slot);
    if (restoredEntity === undefined) throw new Error("Restored knight missing");
    const continued = ordinaryAddonMonster(restored.composition.addon, restoredEntity), restoredExtension = restored.game.stateExtensions.get("mg3:monster-navigation");
    if (continued === undefined || restoredExtension === undefined) throw new Error("Restored source navigation missing");
    expect(continued.entity.actor.id.equals(entity.actor.id)).toBe(false);
    expect(continued.origin).toEqual(savedOrigin);
    expect(routeState(restoredExtension.capture())).toEqual(path);
    expect(walkMg3PathToGoal(continued, 4, goal)).toBe(nextResult);
    expect(continued.origin).toEqual(nextOrigin);
    await application.step(25);

    // This mounted namespace inherits id1/start.nav, but MG3/start.bsp is a different map.
    const resources = await application.content.forContent(application.content.recipe.map.geometry.provenance.mount.identity.content);
    const inherited = await resources.open("bots/navigation/start.nav"), start = await resources.open("maps/start.bsp");
    if (inherited === null || start === null) throw new Error("Retail inherited navigation witness missing");
    expect(inherited.reference.provenance.mount.identity.content).not.toBe(start.reference.provenance.mount.identity.content);
    const prepared = await preloadNavigation({ resources, map: { name: "maps/start.bsp", format: "q1-bsp", digest: start.reference.digest },
      mapBytes: start.bytes, navigationContent: start.reference.provenance.mount.identity.content });
    expect(prepared.asset).toBeNull();
  } finally { await application.close(); await rm(directory, { recursive: true, force: true }); }
}, 30000);

async function openSelectedId1(map: string, wizardClassname = "monster_wizard", edition: "classic" | "rerelease" = "classic") {
  const command = parseApplicationCommand(["--content-root", corpus, "--game", `q1-${edition}-id1`, "--map", map, "--dedicated", "--mode", "singleplayer"]);
  if (command.kind !== "run") throw new Error("Expected Q1 application options");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false }), preset = applicationPreset(catalog, command.options);
  const selectedSource = q1MonsterSources.find(source => source.edition === edition);
  if (selectedSource === undefined) throw new Error("Missing selected Q1 creatures");
  const source = { provider: selectedSource.provider, content: catalog.require(`q1-${edition}-id1`).id };
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), enemies: { kind: "selected", value: {
    kind: "replace", default: { source, classname: "monster_army" },
    byClassname: Object.fromEntries(Object.keys(selectedSource.creatures).map(classname => [classname, { source, classname: classname === "monster_wizard" ? wizardClassname : classname }])),
  } } } });
  return Application.open(command.options, { print: () => undefined }, recipe);
}
function selectedId1(application: Application) {
  const checkpoint = simulationProviderCheckpoint(application.simulation.checkpoint(), "world:simulation");
  const selected = readSelectedMonstersCheckpoint(new SaveReader(decodeCheckpointValue(checkpoint.bytes)).field("selectedMonsters"));
  const source = selected.sources.find(source => source.kind === "q1");
  if (source === undefined || source.kind !== "q1") throw new Error("Missing selected Q1 source checkpoint");
  return { authored: selected.authored, source };
}

test.skipIf(!existsSync(join(corpus, "q1/id1/PAK0.PAK")))("retail e1m2 selected Q1 ogre attacks through shared physics and restores a live grenade", async () => {
  const application = await openSelectedId1("e1m2"), directory = await mkdtemp(join(tmpdir(), "q1-selected-roster-"));
  try {
    const classic = q1MonsterSources.find(source => source.edition === "classic");
    if (classic === undefined) throw new Error("Missing classic Q1 source");
    const resources = await application.content.forContent(application.content.catalog.require("q1-classic-id1").id);
    for (const path of new Set(Object.values(classic.creatures).flatMap(creature => creature.resources))) {
      expect(await resources.open(path)).not.toBeNull();
    }
    expect(Object.hasOwn(classic.creatures, "monster_boss")).toBe(false);
    expect(Object.hasOwn(classic.creatures, "monster_oldone")).toBe(false);
    const marksman = parseQ1Entities('{ "classname" "monster_ogre_marksman" }')[0];
    if (marksman === undefined) throw new Error("Missing ogre alias source entity");
    expect(application.simulation.q1Source()?.game.monsterAdmission?.resolve("monster_ogre_marksman", marksman)).toEqual({
      source: { provider: classic.provider, content: application.content.catalog.require("q1-classic-id1").id }, classname: "monster_ogre_marksman",
    });
    const client = application.session.createClient(0), human = application.simulation.admitPlayer(client.id);
    for (let frame = 0; frame < 15; frame++) await application.step(100);
    const selected = selectedId1(application);
    expect(selected.authored.length).toBeGreaterThan(0);
    for (const entry of selected.authored) {
      expect(entry.definition.classname).toBe(entry.classname);
      const actor = application.simulation.actors.resolveSaved(entry.actor);
      if (actor === null) throw new Error("Missing shared authored actor");
      expect(actor.owner).toBe(application.content.recipe.map.entities.provider);
      expect(application.simulation.actors.observe(actor.id)?.definition).toBe(`${classic.provider}/${entry.classname}`);
      expect(application.simulation.bodies.read(actor.id)).not.toBeNull();
    }
    const ogre = selected.source.entities.entities.find(entity => entity.classname === "monster_ogre");
    if (ogre === undefined) throw new Error("Authored ogre missing");
    const ogreActor = application.simulation.actors.resolveSaved(ogre.actor), player = application.simulation.actors.resolveOwned(human.actor);
    if (ogreActor === null || player === null) throw new Error("Missing shared actors");
    const body = application.simulation.bodies.read(ogreActor.id), playerBody = application.simulation.bodies.read(player.id);
    if (body === null || playerBody === null) throw new Error("Missing bodies");
    application.simulation.bodies.write(player, { ...playerBody, origin: { ...body.origin, x: body.origin.x + 300 } });
    application.simulation.bodies.link(player);
    application.simulation.combat.setHealth(player, 10000);
    let grenade = selectedId1(application).source.entities.entities.find(entity => entity.classname === "ogre_grenade" && entity.callbacks.touch === "base:ogre_grenade_touch");
    for (let frame = 0; frame < 50 && grenade === undefined; frame++) {
      await application.step(100);
      grenade = selectedId1(application).source.entities.entities.find(entity => entity.classname === "ogre_grenade" && entity.callbacks.touch === "base:ogre_grenade_touch");
    }
    if (grenade === undefined) throw new Error("Authored ogre did not naturally launch a grenade");
    expect(grenade.owner).toEqual(ogre.actor);
    expect(grenade.callbacks.think).toBe("base:ogre_grenade_explode");
    const grenadeActor = application.simulation.actors.resolveSaved(grenade.actor);
    if (grenadeActor === null) throw new Error("Grenade has no shared actor");
    const grenadeBody = application.simulation.bodies.read(grenadeActor.id);
    expect(grenadeBody).not.toBeNull();
    const save = join(directory, "grenade.sav");
    await application.saveGame(save);
    const beforeHealth = application.simulation.combat.read(player.id)?.health;
    for (let frame = 0; frame < 8; frame++) await application.step(100);
    const afterHealth = application.simulation.combat.read(player.id)?.health;
    expect(afterHealth).toBeLessThan(beforeHealth ?? 0);
    const continued = selectedId1(application).source.entities.entities.map(entity => ({ slot: entity.actor.slot, classname: entity.classname, state: entity.state, callbacks: entity.callbacks }));
    await application.loadGame(save);
    const restored = selectedId1(application), restoredGrenade = restored.source.entities.entities.find(entity => entity.actor.slot === grenade.actor.slot);
    expect(restoredGrenade?.callbacks).toEqual(grenade.callbacks);
    const restoredActor = application.simulation.actors.observations().find(actor => actor.id.slot === grenade.actor.slot);
    if (restoredActor === undefined) throw new Error("Restored grenade actor missing");
    expect(application.simulation.bodies.read(restoredActor.id)).toEqual(grenadeBody);
    for (let frame = 0; frame < 8; frame++) await application.step(100);
    const restoredPlayer = application.simulation.players()[0];
    if (restoredPlayer === undefined) throw new Error("Restored player missing");
    expect(application.simulation.combat.read(restoredPlayer)?.health).toBe(afterHealth);
    expect(selectedId1(application).source.entities.entities.map(entity => ({ slot: entity.actor.slot, classname: entity.classname, state: entity.state, callbacks: entity.callbacks }))).toEqual(continued);
    const mapSource = application.simulation.q1Source(), restoredOgre = application.simulation.actors.observations().find(actor => actor.id.slot === ogre.actor.slot);
    if (mapSource === null || restoredOgre === undefined) throw new Error("Missing restored authored ogre");
    const kills = mapSource.game.killedMonsters, health = application.simulation.combat.read(restoredOgre.id)?.health;
    if (health === undefined) throw new Error("Ogre health missing");
    mapSource.game.damage(restoredOgre.id, restoredPlayer, restoredPlayer, health + 1);
    expect(mapSource.game.killedMonsters).toBe(kills + 1);
    expect(selectedId1(application).authored.find(entry => entry.actor.slot === ogre.actor.slot)?.countedDeath).toBe(true);
    for (let frame = 0; frame < 5; frame++) await application.step(100);
    expect(selectedId1(application).source.entities.entities.some(entity => entity.classname === "item_backpack")).toBe(true);
  } finally { await application.close(); await rm(directory, { recursive: true, force: true }); }
}, 30000);

test.skipIf(!existsSync(join(corpus, "q1/id1/PAK0.PAK")))("retail e1m3 preserves native authored flying overlap but rejects different selected geometry", async () => {
  const application = await openSelectedId1("e1m3");
  try {
    for (let frame = 0; frame < 15; frame++) await application.step(100);
    const selected = selectedId1(application), wizard = selected.source.entities.entities.find(entity => entity.actor.slot === selected.authored.find(entry => entry.sourceOrdinal === 383)?.actor.slot);
    if (wizard === undefined) throw new Error("Authored wizard missing");
    expect(wizard.classname).toBe("monster_wizard");
    expect(wizard.callbacks.think).toBe("base:monster_frame");
    const actor = application.simulation.actors.resolveSaved(wizard.actor);
    if (actor === null) throw new Error("Wizard shared actor missing");
    expect(application.simulation.bodies.read(actor.id)?.origin).toEqual({ x: -528, y: -304, z: -64 });
    const previousThink = wizard.state.nextThink;
    for (let frame = 0; frame < 5; frame++) await application.step(100);
    expect(selectedId1(application).source.entities.entities.find(entity => entity.actor.slot === wizard.actor.slot)?.state.nextThink).toBeGreaterThan(previousThink);
    const native = await Application.open(application.options, { print: () => undefined });
    try {
      const game = native.simulation.q1Source()?.game, entity = game === undefined ? undefined : [...game.entities.values()].find(entity => entity.sourceOrdinal === 383);
      if (game === undefined || entity === undefined) throw new Error("Native authored wizard missing");
      const body = game.body(entity), authored = parseQ1Entities(native.simulation.sourceEntityText)[383];
      const definition: MonsterDefinitionReference = { source: { provider: "q1:monsters/classic/id1", content: application.content.recipe.map.entities.content }, classname: "monster_wizard" } satisfies Parameters<typeof preservesAuthoredQ1Placement>[0]["definition"];
      const input = { map: application.content.recipe.map, authored, definition, game, entity, body };
      expect(preservesAuthoredQ1Placement(input)).toBe(true);
      expect(preservesAuthoredQ1Placement({ ...input, body: { ...body, bounds: { ...body.bounds, max: { ...body.bounds.max, x: 32 } } } })).toBe(false);
      expect(preservesAuthoredQ1Placement({ ...input, body: { ...body, origin: { ...body.origin, x: body.origin.x + 1 } } })).toBe(false);
      expect(preservesAuthoredQ1Placement({ ...input, definition: { ...definition, source: { ...definition.source, provider: "q1:monsters/rerelease/id1", content: application.content.catalog.require("q1-rerelease-id1").id } } })).toBe(false);
    } finally { await native.close(); }
  } finally { await application.close(); }
  const different = await openSelectedId1("e1m3", "monster_ogre");
  try {
    await expect((async () => { for (let frame = 0; frame < 15; frame++) await different.step(100); })()).rejects.toThrow("monster_wizard -> q1:monsters/classic/id1/monster_ogre");
  } finally { await different.close(); }
}, 30000);


test.skipIf(!existsSync(join(corpus, "q1/rerelease/id1/pak0.pak")))("retail rerelease e1m2 selected ogre restores grenade damage and authored kill credit", async () => {
  const application = await openSelectedId1("e1m2", "monster_wizard", "rerelease"), directory = await mkdtemp(join(tmpdir(), "q1-rerelease-ogre-"));
  function continuation() {
    return JSON.stringify({ selected: selectedId1(application), bodies: application.simulation.checkpoint().bodies },
      (key: string, value: unknown) => key === "generation" ? 0 : value instanceof Uint8Array ? decodeCheckpointValue(value) : value);
  }
  try {
    const client = application.session.createClient(0), human = application.simulation.admitPlayer(client.id);
    for (let frame = 0; frame < 15; frame++) await application.step(100);
    const selected = selectedId1(application), provider = "q1:monsters/rerelease/id1";
    expect(selected.source.reference.provider).toBe(provider);
    expect(selected.authored.length).toBeGreaterThan(0);
    for (const entry of selected.authored) {
      expect(entry.definition.classname).toBe(entry.classname);
      const actor = application.simulation.actors.resolveSaved(entry.actor);
      if (actor === null) throw new Error("Missing authored actor");
      expect(actor.owner).toBe(application.content.recipe.map.entities.provider);
      expect(application.simulation.actors.observe(actor.id)?.definition).toBe(`${provider}/${entry.classname}`);
    }
    const ogre = selected.source.entities.entities.find(entity => entity.classname === "monster_ogre");
    if (ogre === undefined) throw new Error("Missing authored rerelease ogre");
    const owner = application.simulation.actors.resolveSaved(ogre.actor), player = application.simulation.actors.resolveOwned(human.actor);
    if (owner === null || player === null) throw new Error("Missing shared actors");
    const body = application.simulation.bodies.read(owner.id), playerBody = application.simulation.bodies.read(player.id);
    if (body === null || playerBody === null) throw new Error("Missing shared bodies");
    // Put only the player in the authored ogre's open firing lane.
    application.simulation.bodies.write(player, { ...playerBody, origin: { ...body.origin, x: body.origin.x + 300 } });
    application.simulation.bodies.link(player); application.simulation.combat.setHealth(player, 1000);
    let grenade = selectedId1(application).source.entities.entities.find(entity => entity.classname === "ogre_grenade" && entity.owner?.slot === owner.id.slot);
    for (let frame = 0; frame < 50 && grenade === undefined; frame++) {
      await application.step(100);
      grenade = selectedId1(application).source.entities.entities.find(entity => entity.classname === "ogre_grenade" && entity.owner?.slot === owner.id.slot);
    }
    if (grenade === undefined) throw new Error("Authored rerelease ogre did not naturally launch a grenade");
    expect(grenade.owner).toEqual(ogre.actor);
    expect(grenade.callbacks.touch).toBe("base:ogre_grenade_touch");
    expect(grenade.callbacks.think).toBe("base:ogre_grenade_explode");
    const projectile = application.simulation.actors.resolveSaved(grenade.actor);
    if (projectile === null) throw new Error("Missing live projectile");
    const projectileBody = application.simulation.bodies.read(projectile.id);
    if (projectileBody === null) throw new Error("Missing projectile body");
    expect(Math.hypot(projectileBody.velocity.x, projectileBody.velocity.y, projectileBody.velocity.z)).toBeGreaterThan(0);
    const save = join(directory, "live.sav"), before = continuation();
    await application.saveGame(save);
    const outcomes: string[] = [], frames: string[] = [];
    for (let frame = 0; frame < 10; frame++) {
      const output = await application.step(100);
      for (const event of output.events) if (event.payload.kind === "damage" && event.payload.outcome.kind === "committed") {
        const decision = event.payload.outcome.decision, request = decision.request;
        if (request.attack.inflictor?.equals(projectile.id) && request.target.equals(player.id) && decision.appliedDamage > 0) {
          expect(request.attack.attacker?.equals(owner.id)).toBe(true);
          expect(request.attack.weaponProvider).toBe(provider);
          outcomes.push(JSON.stringify({ damage: decision.appliedDamage, cause: request.attack.cause }));
        }
      }
      frames.push(continuation());
    }
    expect(outcomes.length).toBeGreaterThan(0);
    await application.loadGame(save);
    expect(continuation()).toEqual(before);
    const restoredOwner = application.simulation.actors.resolveSaved(ogre.actor), restoredProjectile = application.simulation.actors.resolveSaved(grenade.actor), restoredPlayer = application.simulation.players()[0];
    if (restoredOwner === null || restoredProjectile === null || restoredPlayer === undefined) throw new Error("Missing fresh restored actors");
    expect(restoredOwner.id.equals(owner.id)).toBe(false);
    expect(application.simulation.bodies.read(restoredProjectile.id)).toEqual(projectileBody);
    const restoredOutcomes: string[] = [];
    for (let frame = 0; frame < 10; frame++) {
      const output = await application.step(100);
      for (const event of output.events) if (event.payload.kind === "damage" && event.payload.outcome.kind === "committed") {
        const decision = event.payload.outcome.decision, request = decision.request;
        if (request.attack.inflictor?.equals(restoredProjectile.id) && request.target.equals(restoredPlayer) && decision.appliedDamage > 0) {
          expect(request.attack.attacker?.equals(restoredOwner.id)).toBe(true);
          expect(request.attack.weaponProvider).toBe(provider);
          restoredOutcomes.push(JSON.stringify({ damage: decision.appliedDamage, cause: request.attack.cause }));
        }
      }
      const expected = frames[frame];
      if (expected === undefined) throw new Error("Missing original continuation frame");
      expect(continuation()).toEqual(expected);
    }
    expect(restoredOutcomes).toEqual(outcomes);
    const map = application.simulation.q1Source(), health = application.simulation.combat.read(restoredOwner.id)?.health;
    if (map === null || health === undefined) throw new Error("Missing map mission or ogre health");
    const kills = map.game.killedMonsters;
    map.game.damage(restoredOwner.id, restoredPlayer, restoredPlayer, health + 1);
    expect(map.game.killedMonsters).toBe(kills + 1);
    expect(selectedId1(application).authored.find(entry => entry.actor.slot === ogre.actor.slot)?.countedDeath).toBe(true);
  } finally { await application.close(); await rm(directory, { recursive: true, force: true }); }
}, 60000);

test.skipIf(!existsSync(join(corpus, "q1/rerelease/id1/pak0.pak")))("retail e2m3 selected fish swim, bite and restore in authored water in both editions", async () => {
  for (const edition of ["classic", "rerelease"]) {
    const application = await openSelectedId1("e2m3", "monster_wizard", edition === "classic" ? "classic" : "rerelease");
    const directory = await mkdtemp(join(tmpdir(), "q1-selected-fish-"));
    try {
      const map = application.simulation.q1Source();
      if (map === null) throw new Error("Missing Q1 map source");
      const selected = selectedId1(application), entry = selected.authored.find(value => value.sourceOrdinal === (edition === "classic" ? 530 : 523));
      if (entry === undefined || entry.classname !== "monster_fish") throw new Error("Missing authored water-lane fish");
      const fish = application.simulation.actors.resolveSaved(entry.actor);
      if (fish === null) throw new Error("Missing shared fish actor");
      const body = application.simulation.bodies.read(fish.id);
      if (body === null) throw new Error("Missing fish body");
      expect(body.origin).toEqual({ x: -48, y: 800, z: -336 });
      expect(map.game.host.contents(body.origin)).toBe("water");
      const client = application.session.createClient(0), human = application.simulation.admitPlayer(client.id);
      const player = application.simulation.actors.resolveOwned(human.actor);
      if (player === null) throw new Error("Missing player");
      const playerBody = application.simulation.bodies.read(player.id);
      if (playerBody === null) throw new Error("Missing player body");
      const playerOrigin = { ...body.origin, x: body.origin.x + 80 };
      expect(map.game.host.contents(playerOrigin)).toBe("water");
      application.simulation.bodies.write(player, { ...playerBody, origin: playerOrigin });
      application.simulation.bodies.link(player); application.simulation.combat.setHealth(player, 1000);
      let bites = 0;
      for (let frame = 0; frame < 40 && bites === 0; frame++) {
        const output = await application.step(100);
        for (const event of output.events) if (event.payload.kind === "damage" && event.payload.outcome.kind === "committed") {
          const decision = event.payload.outcome.decision;
          if (decision.request.attack.attacker?.equals(fish.id) && decision.request.target.equals(player.id) && decision.appliedDamage > 0) bites++;
        }
      }
      expect(bites).toBeGreaterThan(0);
      const moved = application.simulation.bodies.read(fish.id);
      if (moved === null) throw new Error("Missing swimming fish");
      expect(moved.origin).not.toEqual(body.origin);
      expect(map.game.host.contents(moved.origin)).toBe("water");
      const continuation = () => JSON.stringify({ source: selectedId1(application), bodies: application.simulation.checkpoint().bodies }, (key: string, value: unknown) => key === "generation" ? 0 : value instanceof Uint8Array ? decodeCheckpointValue(value) : value);
      const saved = continuation(), path = join(directory, "swimming.sav");
      await application.saveGame(path);
      const frames: string[] = [];
      for (let frame = 0; frame < 8; frame++) { await application.step(100); frames.push(continuation()); }
      await application.loadGame(path);
      expect(continuation()).toEqual(saved);
      const restored = application.simulation.actors.resolveSaved(entry.actor);
      if (restored === null) throw new Error("Missing restored fish");
      expect(restored.id.equals(fish.id)).toBe(false);
      for (const expected of frames) { await application.step(100); expect(continuation()).toEqual(expected); }
    } finally { await application.close(); await rm(directory, { recursive: true, force: true }); }
  }
}, 60000);

test.skipIf(!existsSync(join(corpus, "q1/id1/PAK0.PAK")))("retail e1m2 mixes native and selected classes across fresh saves", async () => {
  for (const nativeDefault of [true, false]) {
    const command = parseApplicationCommand(["--content-root", corpus, "--game", "q1-classic-id1", "--map", "e1m2", "--dedicated"]);
    if (command.kind !== "run") throw new Error("Expected Q1 options");
    const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false }), preset = applicationPreset(catalog, command.options);
    const registered = q1MonsterSources.find(source => source.edition === "classic");
    if (registered === undefined) throw new Error("Missing classic creatures");
    const definition = { source: { provider: registered.provider, content: catalog.require("q1-classic-id1").id }, classname: "monster_army" };
    const enemies: EnemySelection = nativeDefault
      ? { kind: "replace", default: { kind: "map-defined" }, byClassname: { monster_army: definition } }
      : { kind: "replace", default: definition, byClassname: Object.fromEntries(Object.keys(registered.creatures).filter(name => name !== "monster_army").map((name): readonly [string, MonsterSelectionTarget] => [name, { kind: "map-defined" }])) };
    const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), enemies: { kind: "selected", value: enemies } } });
    const application = await Application.open(command.options, { print: () => undefined }, recipe), directory = await mkdtemp(join(tmpdir(), "native-selected-roster-"));
    try {
      const client = application.session.createClient(0), human = application.simulation.admitPlayer(client.id);
      for (let frame = 0; frame < 5; frame++) await application.step(100);
      const map = application.simulation.q1Source();
      if (map === null) throw new Error("Missing native map");
      const native = [...map.game.entities.values()].find(entity => entity.classname === "monster_ogre");
      const selected = selectedId1(application), soldier = selected.authored.find(entry => entry.classname === "monster_army");
      if (native === undefined || soldier === undefined) throw new Error("Actual mixed roster missing");
      expect(selected.authored.every(entry => entry.classname === "monster_army")).toBe(true);
      expect(selected.source.entities.entities.some(entity => entity.classname === "monster_ogre")).toBe(false);
      expect(application.simulation.actors.observe(native.actor.id)?.definition).toBe("q1:monster_ogre");
      const selectedActor = application.simulation.actors.resolveSaved(soldier.actor);
      if (selectedActor === null) throw new Error("Missing selected actor");
      expect(map.game.entity(selectedActor.id)).toBeNull();
      const total = map.game.totalMonsters, nativeId = native.actor.id;
      const continuation = () => {
        const source = application.simulation.q1Source();
        if (source === null) throw new Error("Missing native continuation");
        const value: unknown = JSON.parse(JSON.stringify({ native: source.game.capture(), selected: selectedId1(application), bodies: application.simulation.checkpoint().bodies }, (key: string, value: unknown) => key === "generation" ? 0 : value instanceof Uint8Array ? decodeCheckpointValue(value) : value));
        return value;
      };
      const path = join(directory, "mixed.sav"); await application.saveGame(path);
      for (let frame = 0; frame < 3; frame++) await application.step(100);
      const expected = continuation(); await application.loadGame(path);
      const restored = application.simulation.q1Source();
      if (restored === null) throw new Error("Missing restored map");
      const restoredNative = [...restored.game.entities.values()].find(entity => entity.actor.id.slot === nativeId.slot);
      const restoredSelected = application.simulation.actors.resolveSaved(soldier.actor);
      if (restoredNative === undefined || restoredSelected === null) throw new Error("Missing restored mixed actors");
      expect(restoredNative.actor.id.equals(nativeId)).toBe(false);
      expect(restored.game.entity(restoredSelected.id)).toBeNull(); expect(restored.game.totalMonsters).toBe(total);
      for (let frame = 0; frame < 3; frame++) await application.step(100);
      expect(continuation()).toEqual(expected);
      const player = application.simulation.actors.atSource(recipe.map.entities.provider, human.actor.slot);
      if (player === null) throw new Error("Missing restored player");
      const kills = restored.game.killedMonsters;
      for (const victim of [restoredNative.actor, restoredSelected]) {
        const health = application.simulation.combat.read(victim.id)?.health;
        if (health === undefined) throw new Error("Missing victim health");
        restored.game.damage(victim.id, player.id, player.id, health + 1);
      }
      expect(restored.game.killedMonsters).toBe(kills + 2);
      const boss = parseQ1Entities('{ "classname" "monster_boss" "spawnflags" "1" }')[0];
      if (boss === undefined) throw new Error("Missing boss fields");
      if (nativeDefault) expect(restored.game.monsterAdmission?.resolve("monster_boss", boss)).toBeNull();
      else expect(() => restored.game.monsterAdmission?.resolve("monster_boss", boss)).toThrow("obligations");
    } finally { await application.close(); await rm(directory, { recursive: true, force: true }); }
  }
}, 60000);

test.skipIf(!existsSync(join(corpus, "q1/id1/PAK1.PAK")))("retail e1m7 keeps the native boss with native roster defaults and exceptions", async () => {
  const command = parseApplicationCommand(["--content-root", corpus, "--game", "q1-classic-id1", "--map", "e1m7", "--dedicated"]);
  if (command.kind !== "run") throw new Error("Expected Q1 options");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false }), preset = applicationPreset(catalog, command.options);
  const definition: MonsterDefinitionReference = { source: { provider: "q1:monsters/classic/id1", content: catalog.require("q1-classic-id1").id }, classname: "monster_army" };
  for (const nativeDefault of [true, false]) {
    const enemies: EnemySelection = nativeDefault
      ? { kind: "replace", default: { kind: "map-defined" }, byClassname: { monster_army: definition } }
      : { kind: "replace", default: definition, byClassname: { monster_boss: { kind: "map-defined" } } };
    const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), enemies: { kind: "selected", value: enemies } } });
    const application = await Application.open(command.options, { print: () => undefined }, recipe);
    try {
      for (let frame = 0; frame < 3; frame++) await application.step(100);
      const map = application.simulation.q1Source();
      if (map === null) throw new Error("Missing native map");
      const boss = [...map.game.entities.values()].find(entity => entity.classname === "monster_boss");
      if (boss === undefined) throw new Error("Actual authored boss missing");
      expect(application.simulation.actors.observe(boss.actor.id)?.definition).toBe("q1:monster_boss");
      expect(boss.use).not.toBeNull();
      expect(selectedId1(application).authored.some(entry => entry.classname === "monster_boss")).toBe(false);
      const selectedFlags = parseQ1Entities('{ "classname" "monster_army" "spawnflags" "4096" }')[0];
      if (selectedFlags === undefined) throw new Error("Missing selected flag fields");
      expect(() => map.game.monsterAdmission?.resolve("monster_army", selectedFlags)).toThrow("spawn flags");
    } finally { await application.close(); }
  }
}, 60000);

test.skipIf(!existsSync(join(corpus, "q1/id1/PAK0.PAK")))("native Q1 client visibility preserves source eye PVS through a fresh application save", async () => {
  const command = parseApplicationCommand(["--content-root", corpus, "--game", "q1-classic-id1", "--map", "e1m2", "--dedicated", "--mode", "singleplayer"]);
  if (command.kind !== "run") throw new Error("Expected native Q1 launch");
  const application = await Application.open(command.options, { print: () => undefined });
  const directory = await mkdtemp(join(tmpdir(), "q1-client-pvs-"));
  try {
    const simulation = application.simulation, source = simulation.q1Source();
    if (source === null) throw new Error("Missing native Q1 source");
    const monster = [...source.composition.base.monsters.values()].find(monster => monster.entity.classname === "monster_ogre");
    if (monster === undefined) throw new Error("Missing authored ogre");
    const client = application.session.createClient(0), admitted = simulation.admitPlayer(client.id);
    const player = simulation.actors.resolveOwned(admitted.actor);
    if (player === null) throw new Error("Missing shared player");
    expect(player.id.slot).not.toBe(client.id.slot + 1);
    expect(source.game.host.checkClient(monster.entity.actor)).toBeNull();
    const eye = monster.eye(); if (eye === null) throw new Error("Missing source monster eye");
    const playerBody = simulation.bodies.read(player.id); if (playerBody === null) throw new Error("Missing player body");
    // Player-only pose: establish a visible cached client eye beside the authored ogre.
    simulation.bodies.write(player, { ...playerBody, origin: { ...eye, z: eye.z - 22 } }); simulation.bodies.link(player);
    await application.step(100);
    expect(source.game.host.checkClient(monster.entity.actor)).toEqual(player.id);
    const scene = simulation.scene, observerEye = monster.eye(); if (observerEye === null) throw new Error("Missing current monster eye");
    const cluster = (point: import("../../../src/contracts/math.ts").Vec3) => scene.leafCluster(scene.pointLeaf(point));
    const hidden = [...source.game.entities.values()].map(entity => source.game.body(entity).origin)
      .find(point => cluster(point) >= 0 && !scene.clusterVisible(cluster(point), cluster(observerEye), "pvs"));
    if (hidden === undefined) throw new Error("No actual map position hidden from the authored ogre");
    const currentBody = simulation.bodies.read(player.id); if (currentBody === null) throw new Error("Missing current player body");
    simulation.bodies.write(player, { ...currentBody, origin: { ...hidden, z: hidden.z - 22 }, velocity: { x: 0, y: 0, z: 0 } }); simulation.bodies.link(player);
    expect(source.game.host.checkClient(monster.entity.actor)).toEqual(player.id);
    const image = simulation.checkpoint(), checkpoint = simulationProviderCheckpoint(image, "world:simulation");
    expect(checkpoint.version).toBe(11);
    const state = new SaveReader(decodeCheckpointValue(checkpoint.bytes)).field("q1ClientVisibility").value;
    expect(state).toMatchObject({ lastCheckSlot: 1, lastCheckTime: 0.1 });
    const legacy = { ...image, providers: image.providers.map(provider => provider.schema === "world:simulation" ? { ...provider, version: 10 } : provider) };
    expect(() => simulationProviderCheckpoint(legacy, "world:simulation")).toThrow("unsupported");
    await application.saveGame(join(directory, "cached.sav"));
    await application.loadGame(join(directory, "cached.sav"));
    const restored = application.simulation, restoredSource = restored.q1Source();
    if (restoredSource === null) throw new Error("Missing restored source");
    const restoredMonster = [...restoredSource.composition.base.monsters.values()].find(value => value.entity.actor.id.slot === monster.entity.actor.id.slot);
    const restoredPlayer = restored.players()[0];
    if (restoredMonster === undefined || restoredPlayer === undefined) throw new Error("Missing restored source actors");
    expect(restoredPlayer.equals(player.id)).toBe(false);
    expect(new SaveReader(decodeCheckpointValue(simulationProviderCheckpoint(restored.checkpoint(), "world:simulation").bytes)).field("q1ClientVisibility").value).toEqual(state);
    expect(restoredSource.game.host.checkClient(restoredMonster.entity.actor)).toEqual(restoredPlayer);
    await application.step(100);
    expect(restoredSource.game.host.checkClient(restoredMonster.entity.actor)).toBeNull();
  } finally { await application.close(); await rm(directory, { recursive: true, force: true }); }
}, 30000);
