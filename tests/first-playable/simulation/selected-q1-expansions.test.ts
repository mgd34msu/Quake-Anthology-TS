import { expect, test } from "bun:test";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import { q1ExpansionMonsterSources, q1AddonMonsterSources } from "../../../src/content/monsters/expansions.ts";
import { applicationPreset, loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { ProviderReference } from "../../../src/contracts/content.ts";
import { encodeSaveImage, decodeSaveImage } from "../../../src/persistence/index.ts";
import { decodeCheckpointValue, SaveReader } from "../../../src/persistence/value.ts";
import { simulationProviderCheckpoint } from "../../../src/app/bootstrap/simulation/save.ts";
import { readSelectedMonstersCheckpoint } from "../../../src/app/bootstrap/simulation/monster-checkpoint.ts";

function selected(simulation: ReturnType<typeof createSimulation>) {
  const checkpoint = simulationProviderCheckpoint(simulation.checkpoint(), "world:simulation");
  return readSelectedMonstersCheckpoint(new SaveReader(decodeCheckpointValue(checkpoint.bytes)).field("selectedMonsters"));
}
function continuation(simulation: ReturnType<typeof createSimulation>): string {
  return JSON.stringify(selected(simulation), (key: string, value: unknown) => key === "generation" ? 0 : value instanceof Uint8Array ? decodeCheckpointValue(value) : value);
}
const models: Readonly<Record<string, string>> = {
  monster_scourge: "scor", monster_gremlin: "grem", monster_armagon: "armalegs", monster_eel: "eel2",
  monster_sword: "sword", monster_wrath: "wrath", monster_mummy: "mummy", monster_super_wrath: "s_wrath", monster_lava_man: "lavaman",
};
const addonModels: Readonly<Record<string, string>> = { monster_army: "soldier", monster_ogre: "ogre", monster_knight: "knight", monster_fish: "fish" };

for (const source of [...q1ExpansionMonsterSources, ...q1AddonMonsterSources]) test(`${source.provider} actual selected expansion controllers preserve foreign authored actors and save continuation`, async () => {
  const catalog = await discoverInstalledContent({ corpusRoot: "/home/buzzkill/Projects/qfiles", discoverMods: false });
  const addon = source.program === "dopa" || source.program === "mg1", expectedModels = addon ? addonModels : models;
  for (const classname of Object.keys(source.creatures).filter(name => Object.hasOwn(expectedModels, name))) {
    const aquatic = classname === "monster_eel" || classname === "monster_fish";
    const command = parseApplicationCommand(["--game", aquatic ? "q1-classic-id1" : "q2-classic-baseq2", "--map", aquatic ? "e2m3" : "base1", "--dedicated"]);
    if (command.kind !== "run") throw new Error("Expected launch command");
    const preset = applicationPreset(catalog, command.options), reference = { provider: source.provider, content: catalog.require(`q1-${source.edition}-${source.program}`).id };
    const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), enemies: { kind: "selected", value: {
      kind: "replace", default: { kind: "map-defined" }, byClassname: { [aquatic ? "monster_fish" : "monster_soldier_light"]: { source: reference, classname } },
    } } } });
    const content = await loadApplicationContent(command.options, recipe), identity = createIdentityOwner(`expansion-${source.edition}-${classname}`);
    const options: Parameters<typeof createSimulation>[0] = { identity, recipe, world: content.world, mounts: content.mounts, skill: 1, mode: "singleplayer", seed: 1, maxClients: 1 };
    const original = createSimulation(options);
    try {
      for (let frame = 0; frame < 12; frame++) original.step({ elapsedMilliseconds: 100, commands: [] });
      const saved = selected(original), controller = saved.sources[0];
      expect(saved.authored.length).toBeGreaterThan(0);
      if (classname === "monster_sword") expect(saved.authored.some(entry => entry.route !== "")).toBe(true);
      if (controller?.kind !== "q1") throw new Error("Expected selected Q1 source");
      expect(controller.entities.extensions.some(extension => extension.id === (addon ? `${source.program}:ordinary` : `q1:${source.program}:monsters`))).toBe(true);
      for (const entry of saved.authored) {
        const actor = original.actors.resolveSaved(entry.actor);
        if (actor === null) throw new Error("Missing authored actor");
        expect(actor.owner).toBe(recipe.map.entities.provider);
        expect(original.actors.observe(actor.id)?.definition).toBe(`${source.provider}/${classname}`);
        if (entry.activation.kind === "active") expect(controller.entities.entities.find(entity => entity.actor.slot === entry.actor.slot)?.state.model).toBe(`progs/${expectedModels[classname]}.mdl`);
      }
      const restored = createSimulation({ ...options, restore: decodeSaveImage(encodeSaveImage(original.checkpoint())), restoredClients: [] });
      try {
        expect(continuation(restored)).toBe(continuation(original));
        for (let frame = 0; frame < 5; frame++) {
          original.step({ elapsedMilliseconds: 100, commands: [] }); restored.step({ elapsedMilliseconds: 100, commands: [] });
          expect(continuation(restored)).toBe(continuation(original));
        }
        const alive = saved.authored.find(entry => entry.activation.kind === "active" && !entry.countedDeath);
        if (alive === undefined) throw new Error("Expected active authored monster");
        const owner = restored.actors.resolveSaved(alive.actor);
        if (owner === null) throw new Error("Expected live selected monster");
        const body = restored.bodies.read(owner.id), health = restored.combat.read(owner.id)?.health;
        if (body === null || health === undefined) throw new Error("Missing shared selected body/combat");
        const q2 = restored.q2Source(), q1 = restored.q1Source();
        if (q2 !== null) q2.game.damage(owner.id, owner.id, owner.id, health + 1, 0, { x: 0, y: 0, z: 0 }, body.origin, { x: 0, y: 0, z: 0 }, 0);
        else if (q1 !== null) q1.game.damage(owner.id, owner.id, owner.id, health + 1);
        else throw new Error("Expected authored Q1/Q2 map");
        expect(selected(restored).authored.find(entry => entry.actor.slot === alive.actor.slot)?.countedDeath).toBe(true);
      } finally { restored.close(); }
    } finally { original.close(); await content.close(); }
  }
}, 120000);

test("an explicit authored Armagon replacement reports its map-script obligation", async () => {
  const catalog = await discoverInstalledContent({ corpusRoot: "/home/buzzkill/Projects/qfiles", discoverMods: false });
  const command = parseApplicationCommand(["--game", "q1-classic-hipnotic", "--map", "hipend", "--dedicated"]);
  if (command.kind !== "run") throw new Error("Expected launch command");
  const preset = applicationPreset(catalog, command.options), source: ProviderReference = { provider: "q1:monsters/rerelease/hipnotic", content: catalog.require("q1-rerelease-hipnotic").id };
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), enemies: { kind: "selected", value: {
    kind: "replace", default: { kind: "map-defined" }, byClassname: { monster_armagon: { source, classname: "monster_armagon" } },
  } } } });
  const content = await loadApplicationContent(command.options, recipe);
  try {
    expect(() => createSimulation({ identity: createIdentityOwner("authored-armagon-obligation"), recipe, world: content.world, mounts: content.mounts, skill: 1, mode: "singleplayer", seed: 1, maxClients: 1 }))
      .toThrow("Selected monster admission does not yet preserve authored monster_armagon obligations");
  } finally { await content.close(); }
}, 30000);
