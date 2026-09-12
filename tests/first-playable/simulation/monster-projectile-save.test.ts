import { expect, test } from "bun:test";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import { monsterSources } from "../../../src/content/monsters/definitions.ts";
import { applicationPreset, loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { simulationProviderCheckpoint } from "../../../src/app/bootstrap/simulation/save.ts";
import { readSelectedMonstersCheckpoint } from "../../../src/app/bootstrap/simulation/monster-checkpoint.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { encodeSaveImage, decodeSaveImage } from "../../../src/persistence/index.ts";
import { decodeCheckpointValue, SaveReader } from "../../../src/persistence/value.ts";

function selected(simulation: ReturnType<typeof createSimulation>) {
  const checkpoint = simulationProviderCheckpoint(simulation.checkpoint(), "world:simulation");
  const saved = readSelectedMonstersCheckpoint(new SaveReader(decodeCheckpointValue(checkpoint.bytes)).field("selectedMonsters"));
  const source = saved.sources.find(source => source.kind === "q2");
  if (source === undefined || source.kind !== "q2") throw new Error("Missing selected Q2 source");
  return source;
}

function continuation(simulation: ReturnType<typeof createSimulation>): string {
  return JSON.stringify({ source: selected(simulation), bodies: simulation.checkpoint().bodies }, (key: string, value: unknown) => key === "generation" ? 0 : value);
}

const corpus = resolve(import.meta.dir, "../../../../qfiles");
test.skipIf(!existsSync(join(corpus, "q2/baseq2/pak0.pak")))("selected Q2 soldier blaster restores into a fresh runtime and hits its target with the saved owner", async () => {
  const command = parseApplicationCommand(["--content-root", corpus, "--game", "q2-classic-baseq2", "--map", "base1", "--dedicated", "--mode", "singleplayer"]);
  if (command.kind !== "run") throw new Error("Expected Q2 launch");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false }), preset = applicationPreset(catalog, command.options);
  const classic = monsterSources.find(source => source.family === "q2" && source.edition === "classic");
  if (classic === undefined) throw new Error("Missing classic Q2 monsters");
  const source = { provider: classic.provider, content: catalog.require("q2-classic-baseq2").id };
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), enemies: { kind: "selected", value: {
    kind: "replace", default: { source, classname: "monster_soldier_light" },
    byClassname: Object.fromEntries(["monster_soldier_light", "monster_soldier", "monster_infantry"].map(classname => [classname, { source, classname }])),
  } } } });
  const content = await loadApplicationContent(command.options, recipe), identity = createIdentityOwner("selected-q2-projectile-save"), client = identity.client(0, 0);
  const options = { identity, recipe: content.recipe, world: content.world, mounts: content.mounts, skill: command.options.skill, mode: command.options.mode, seed: 1, maxClients: 1 };
  const original = createSimulation(options);
  try {
    const human = original.admitPlayer(client);
    for (let frame = 0; frame < 15; frame++) original.step({ elapsedMilliseconds: 100, commands: [] });
    const soldier = selected(original).entities.entities.find(entity => entity.values.classname === "monster_soldier_light" && entity.actor.slot === 273);
    if (soldier === undefined) throw new Error("Missing authored soldier");
    const owner = original.actors.resolveSaved(soldier.actor), player = original.actors.resolveOwned(human.actor);
    if (owner === null || player === null) throw new Error("Missing live actors");
    const body = original.bodies.read(owner.id), playerBody = original.bodies.read(player.id);
    if (body === null || playerBody === null) throw new Error("Missing shared bodies");
    const radians = body.angles.y * Math.PI / 180;
    original.bodies.write(player, { ...playerBody, origin: { x: body.origin.x + 300 * Math.cos(radians), y: body.origin.y + 300 * Math.sin(radians), z: body.origin.z } });
    original.bodies.link(player); original.combat.setHealth(player, 10000);
    let bolt = selected(original).entities.entities.find(entity => entity.values.classname === "bolt" && entity.links.owner?.slot === soldier.actor.slot);
    for (let frame = 0; frame < 100 && bolt === undefined; frame++) {
      original.step({ elapsedMilliseconds: 100, commands: [] });
      bolt = selected(original).entities.entities.find(entity => entity.values.classname === "bolt" && entity.links.owner?.slot === soldier.actor.slot);
    }
    if (bolt === undefined) throw new Error("Selected soldier did not fire a live blaster bolt");
    expect(bolt.links.owner).toEqual(soldier.actor);
    expect(bolt.callbacks.touch).toBe("blaster_touch");
    expect(selected(original).ballistics.blasterCauses).toContainEqual({ actor: bolt.actor, meansOfDeath: 1 });
    const image = decodeSaveImage(encodeSaveImage(original.checkpoint()));
    const restored = createSimulation({ ...options, restore: image, restoredClients: [client] });
    try {
      const restoredBolt = restored.actors.resolveSaved(bolt.actor), restoredOwner = restored.actors.resolveSaved(soldier.actor), restoredPlayer = restored.players()[0];
      if (restoredBolt === null || restoredOwner === null || restoredPlayer === undefined) throw new Error("Missing restored actor");
      expect(restoredOwner.id.equals(owner.id)).toBe(false);
      expect(continuation(restored)).toEqual(continuation(original));
      let hits = 0;
      for (let frame = 0; frame < 8; frame++) {
        const continuous = original.step({ elapsedMilliseconds: 100, commands: [] }), resumed = restored.step({ elapsedMilliseconds: 100, commands: [] });
        const damage = resumed.events.flatMap(event => event.payload.kind === "damage" && event.payload.outcome.kind === "committed" ? [event.payload.outcome.decision.request] : []);
        for (const request of damage) if (request.attack.inflictor?.equals(restoredBolt.id)) {
          expect(request.attack.attacker?.equals(restoredOwner.id)).toBe(true);
          expect(request.target.equals(restoredPlayer)).toBe(true);
          expect(request.attack.cause).toEqual({ kind: "q2", meansOfDeath: 1, damageFlags: 4 });
          expect(request.attack.weaponProvider).toBe(classic.provider); hits++;
        }
        expect(resumed.events.map(event => event.payload.kind)).toEqual(continuous.events.map(event => event.payload.kind));
        expect(continuation(restored)).toEqual(continuation(original));
        expect(restored.combat.read(restoredPlayer)?.health).toBe(original.combat.read(player.id)?.health);
      }
      expect(hits).toBe(1);
      expect(restored.actors.resolveSaved(bolt.actor)).toBeNull();
      expect(selected(restored).ballistics.blasterCauses.some(cause => cause.actor.slot === bolt.actor.slot)).toBe(false);
    } finally { restored.close(); }
  } finally { original.close(); await content.close(); }
}, 30000);

test("selected monster save explicitly rejects the old version without projectile state", () => {
  expect(() => readSelectedMonstersCheckpoint(new SaveReader({ version: 1, authored: [], sources: [] }))).toThrow();
  expect(readSelectedMonstersCheckpoint(new SaveReader({ version: 2, authored: [], sources: [] }))).toEqual({ version: 2, authored: [], sources: [] });
});
