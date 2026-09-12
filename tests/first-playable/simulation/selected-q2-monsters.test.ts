import type { ProviderReference } from "../../../src/contracts/content.ts";
import { Q2Monsters } from "../../../src/content/q2/foundation/monsters/index.ts";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "bun:test";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import { q2MonsterSources } from "../../../src/content/monsters/q2.ts";
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
  return { authored: saved.authored, source };
}

function continuation(simulation: ReturnType<typeof createSimulation>): string {
  return JSON.stringify(selected(simulation), (key: string, value: unknown) => key === "generation" ? 0 : value);
}

const corpus = resolve(import.meta.dir, "../../../../qfiles");

test.skipIf(!existsSync(resolve(corpus, "q2/baseq2/pak0.pak")))("retail mine1 selected Q2 roster preserves authored actors and restores a source-triggered mutant jump", async () => {
  const command = parseApplicationCommand(["--content-root", corpus, "--game", "q2-classic-baseq2", "--map", "mine1", "--dedicated", "--mode", "singleplayer"]);
  if (command.kind !== "run") throw new Error("Expected Q2 launch");
  const catalog = await discoverInstalledContent({ corpusRoot: command.options.corpusRoot, discoverMods: false }), preset = applicationPreset(catalog, command.options);
  const classic = q2MonsterSources.find(source => source.edition === "classic");
  if (classic === undefined) throw new Error("Missing classic Q2 monsters");
  const source = { provider: classic.provider, content: catalog.require("q2-classic-baseq2").id };
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), enemies: { kind: "selected", value: {
    kind: "replace", default: { source, classname: "monster_infantry" },
    byClassname: Object.fromEntries(Object.keys(classic.creatures).map(classname => [classname, { source, classname }])),
  } } } });
  const content = await loadApplicationContent(command.options, recipe), identity = createIdentityOwner("selected-q2-mutant-save"), client = identity.client(0, 0);
  const options: Parameters<typeof createSimulation>[0] = { identity, recipe: content.recipe, world: content.world, mounts: content.mounts, skill: 1, mode: command.options.mode, seed: 1, maxClients: 1 };
  const original = createSimulation(options);
  try {
    const human = original.admitPlayer(client);
    const captured: { monsters: Q2Monsters | null } = { monsters: null };
    const beginFrame = Q2Monsters.prototype.beginFrame;
    Q2Monsters.prototype.beginFrame = function (this: Q2Monsters, game) {
      if (game.options.provider === source.provider) captured.monsters = this;
      return beginFrame.call(this, game);
    };
    try {
      for (let frame = 0; frame < 15; frame++) original.step({ elapsedMilliseconds: 100, commands: [] });
    } finally { Q2Monsters.prototype.beginFrame = beginFrame; }
    const admitted = selected(original);
    for (const entry of admitted.authored) {
      expect(entry.definition.classname).toBe(entry.classname);
      const actor = original.actors.resolveSaved(entry.actor);
      if (actor === null) throw new Error("Authored shared actor missing");
      expect(actor.owner).toBe(recipe.map.entities.provider);
      expect(original.actors.observe(actor.id)?.definition).toBe(`${classic.provider}/${entry.classname}`);
    }
    const routedMutant = admitted.authored.find(entry => entry.classname === "monster_mutant" && entry.route !== "");
    const mutant = admitted.source.entities.entities.find(entity => entity.actor.slot === routedMutant?.actor.slot);
    if (mutant === undefined) throw new Error("Authored mine1 mutant missing");
    const owner = original.actors.resolveSaved(mutant.actor), player = original.actors.resolveOwned(human.actor);
    if (owner === null || player === null) throw new Error("Missing shared actors");
    const body = original.bodies.read(owner.id), playerBody = original.bodies.read(player.id);
    if (body === null || playerBody === null) throw new Error("Missing shared bodies");
    const radians = body.angles.y * Math.PI / 180;
    original.bodies.write(player, { ...playerBody, origin: { x: body.origin.x + 200 * Math.cos(radians), y: body.origin.y + 200 * Math.sin(radians), z: body.origin.z } });
    original.bodies.link(player); original.combat.setHealth(player, 10000);
    const context = captured.monsters?.context(owner.id);
    if (context == null) throw new Error("Selected authored mutant source missing");
    context.attack();
    let jumping = selected(original).source.entities.entities.find(entity => entity.actor.slot === mutant.actor.slot && entity.callbacks.touch === "classic_mutant_jump_touch");
    for (let frame = 0; frame < 12 && jumping === undefined; frame++) {
      original.step({ elapsedMilliseconds: 100, commands: [] });
      jumping = selected(original).source.entities.entities.find(entity => entity.actor.slot === mutant.actor.slot && entity.callbacks.touch === "classic_mutant_jump_touch");
    }
    if (jumping === undefined) throw new Error("Source mutant attack did not launch its jump");
    const jumpingBody = original.bodies.read(owner.id);
    expect(jumpingBody?.ground).toBeNull();
    expect(jumpingBody?.velocity.z).not.toBe(0);
    const image = decodeSaveImage(encodeSaveImage(original.checkpoint()));
    const restored = createSimulation({ ...options, restore: image, restoredClients: [client] });
    try {
      expect(continuation(restored)).toEqual(continuation(original));
      const restoredMutant = restored.actors.resolveSaved(mutant.actor), restoredPlayer = restored.players()[0];
      if (restoredMutant === null || restoredPlayer === undefined) throw new Error("Restored mutant missing");
      expect(restoredMutant.id.equals(owner.id)).toBe(false);
      let hits = 0;
      for (let frame = 0; frame < 20; frame++) {
        original.step({ elapsedMilliseconds: 100, commands: [] });
        const resumedStep = restored.step({ elapsedMilliseconds: 100, commands: [] });
        for (const event of resumedStep.events) {
          if (event.payload.kind !== "damage" || event.payload.outcome.kind !== "committed") continue;
          const request = event.payload.outcome.decision.request;
          if (!request.attack.inflictor?.equals(restoredMutant.id)) continue;
          expect(request.attack.attacker?.equals(restoredMutant.id)).toBe(true);
          expect(request.target.equals(restoredPlayer)).toBe(true);
          expect(request.amount).toBeGreaterThanOrEqual(40);
          hits++;
        }
        expect(continuation(restored)).toEqual(continuation(original));
        const continuous = original.bodies.read(owner.id), resumed = restored.bodies.read(restoredMutant.id);
        expect(resumed?.origin).toEqual(continuous?.origin);
        expect(resumed?.velocity).toEqual(continuous?.velocity);
      }
      expect(hits).toBeGreaterThan(0);
      expect(selected(restored).source.entities.entities.find(entity => entity.actor.slot === mutant.actor.slot)?.callbacks.touch).toBeNull();
      const map = restored.q2Source();
      if (map === null) throw new Error("Restored map/player missing");
      const restoredBody = restored.bodies.read(restoredMutant.id);
      if (restoredBody === null) throw new Error("Restored mutant body missing");
      const kills = map.game.counters.killedMonsters, health = restored.combat.read(restoredMutant.id)?.health;
      if (health === undefined) throw new Error("Restored mutant health missing");
      map.game.damage(restoredMutant.id, restoredPlayer, restoredPlayer, health + 1, 0, { x: 0, y: 0, z: 0 }, restoredBody.origin, { x: 0, y: 0, z: 0 }, 0);
      expect(map.game.counters.killedMonsters).toBe(kills + 1);
      expect(selected(restored).authored.find(entry => entry.actor.slot === mutant.actor.slot)?.countedDeath).toBe(true);
    } finally { restored.close(); }
  } finally { original.close(); await content.close(); }
}, 30000);

test.skipIf(!existsSync(resolve(corpus, "q2/baseq2/pak0.pak")))("retail base1 retains native soldiers beside selected berserks across fresh restore", async () => {
  const command = parseApplicationCommand(["--content-root", corpus, "--game", "q2-classic-baseq2", "--map", "base1", "--dedicated"]);
  if (command.kind !== "run") throw new Error("Expected Q2 options");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false }), preset = applicationPreset(catalog, command.options);
  const source: ProviderReference = { provider: "q2:monsters/classic/baseq2", content: catalog.require("q2-classic-baseq2").id };
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), enemies: { kind: "selected", value: {
    kind: "replace", default: { kind: "map-defined" }, byClassname: { monster_infantry: { source, classname: "monster_berserk" } },
  } } } });
  const content = await loadApplicationContent(command.options, recipe), identity = createIdentityOwner("q2-native-selected-roster"), client = identity.client(0, 0);
  const options: Parameters<typeof createSimulation>[0] = { identity, recipe: content.recipe, world: content.world, mounts: content.mounts, skill: 1, mode: command.options.mode, seed: 1, maxClients: 1 };
  const original = createSimulation(options);
  try {
    original.admitPlayer(client);
    for (let frame = 0; frame < 5; frame++) original.step({ elapsedMilliseconds: 100, commands: [] });
    const map = original.q2Source();
    if (map === null) throw new Error("Missing native Q2 map");
    const native = [...map.game.entities.values()].find(entity => entity.classname === "monster_soldier_light");
    const replacement = selected(original).authored.find(entry => entry.classname === "monster_infantry");
    if (native === undefined || replacement === undefined) throw new Error("Actual base1 mixed roster missing");
    expect(original.actors.observe(native.actor.id)?.definition).toBe("q2:monster_soldier_light");
    expect(replacement.definition.classname).toBe("monster_berserk");
    expect(selected(original).authored.every(entry => entry.classname === "monster_infantry")).toBe(true);
    const replaced = original.actors.resolveSaved(replacement.actor);
    if (replaced === null) throw new Error("Missing replacement actor");
    expect(map.game.entity(replaced.id)).toBeNull();
    expect(original.actors.observe(replaced.id)?.definition).toBe(`${source.provider}/monster_berserk`);
    const state = (simulation: ReturnType<typeof createSimulation>) => {
      const current = simulation.q2Source();
      if (current === null) throw new Error("Missing Q2 continuation");
      const value: unknown = JSON.parse(JSON.stringify({ native: current.game.capture(), monsters: current.monsters.capture(), selected: selected(simulation), bodies: simulation.checkpoint().bodies },
        (key: string, value: unknown) => key === "generation" ? 0 : value instanceof Uint8Array ? decodeCheckpointValue(value) : value));
      return value;
    };
    const image = decodeSaveImage(encodeSaveImage(original.checkpoint())), restored = createSimulation({ ...options, restore: image, restoredClients: [client] });
    try {
      const restoredMap = restored.q2Source(), restoredNative = restored.actors.resolveSaved({ slot: native.actor.id.slot, generation: native.actor.id.generation }), restoredReplacement = restored.actors.resolveSaved(replacement.actor);
      if (restoredMap === null || restoredNative === null || restoredReplacement === null) throw new Error("Missing restored mixed actors");
      expect(restoredNative.id.equals(native.actor.id)).toBe(false);
      expect(restoredMap.game.entity(restoredNative.id)?.classname).toBe("monster_soldier_light");
      expect(restoredMap.game.entity(restoredReplacement.id)).toBeNull();
      expect(restoredMap.game.counters).toEqual(map.game.counters);
      expect(state(restored)).toEqual(state(original));
      for (let frame = 0; frame < 5; frame++) {
        original.step({ elapsedMilliseconds: 100, commands: [] }); restored.step({ elapsedMilliseconds: 100, commands: [] });
        expect(state(restored)).toEqual(state(original));
      }
    } finally { restored.close(); }
  } finally { original.close(); await content.close(); }
}, 30000);
