import type { ProviderReference } from "../../../src/contracts/content.ts";
import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { Q2Monsters } from "../../../src/content/q2/foundation/monsters/index.ts";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
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
  return JSON.stringify(selected(simulation), (key: string, value: unknown) => key === "generation" ? 0 : value);
}
const cases = [
  { edition: "classic", program: "xatrix", classname: "monster_soldier_ripper", packs: 1, game: "q1-classic-id1", map: "e1m1" },
  { edition: "classic", program: "rogue", classname: "monster_stalker", packs: 1, game: "q2-classic-baseq2", map: "base1" },
  { edition: "rerelease", program: "mg2", classname: "monster_guncmdr", packs: 2, game: "q2-classic-baseq2", map: "base1" },
];
for (const fixture of cases) test(`selected ${fixture.program} ${fixture.classname} executes and restores on ${fixture.game}/${fixture.map}`, async () => {
  const corpus = resolve(import.meta.dir, "../../../../qfiles");
  const command = parseApplicationCommand(["--content-root", corpus, "--game", fixture.game, "--map", fixture.map, "--dedicated", "--mode", "singleplayer"]);
  if (command.kind !== "run") throw new Error("Expected launch");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false });
  const preset = applicationPreset(catalog, command.options);
  const source: ProviderReference = { provider: `q2:monsters/${fixture.edition}/${fixture.program}`, content: catalog.require(`q2-${fixture.edition}-${fixture.program}`).id };
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), enemies: { kind: "selected", value: {
    kind: "replace", default: { source, classname: fixture.classname }, byClassname: {},
  } } } });
  const content = await loadApplicationContent(command.options, recipe), identity = createIdentityOwner(`selected-${fixture.program}`), client = identity.client(0, 0);
  const options: Parameters<typeof createSimulation>[0] = { identity, recipe: content.recipe, world: content.world, mounts: content.mounts, skill: 1, mode: command.options.mode, seed: 1, maxClients: 1 };
  const original = createSimulation(options);
  try {
    const human = original.admitPlayer(client), captured: { monsters: Q2Monsters | null } = { monsters: null };
    const beginFrame = Q2Monsters.prototype.beginFrame;
    Q2Monsters.prototype.beginFrame = function (this: Q2Monsters, game) {
      if (game.options.provider === source.provider) captured.monsters = this;
      return beginFrame.call(this, game);
    };
    try { for (let frame = 0; frame < 15; frame++) original.step({ elapsedMilliseconds: 100, commands: [] }); }
    finally { Q2Monsters.prototype.beginFrame = beginFrame; }
    const state = selected(original);
    expect(state.packs.length).toBe(fixture.packs);
    expect(state.movers).not.toBeNull();
    const monster = state.entities.entities.find(entity => entity.values.classname === fixture.classname);
    if (monster === undefined) throw new Error("Missing selected expansion actor");
    const owner = original.actors.resolveSaved(monster.actor), player = original.actors.resolveOwned(human.actor);
    if (owner === null || player === null) throw new Error("Missing actors");
    const context = captured.monsters?.context(owner.id), body = original.bodies.read(owner.id), playerBody = original.bodies.read(player.id);
    if (context == null || body === null || playerBody === null) throw new Error("Missing controller");
    expect(owner.owner).toBe(recipe.map.entities.provider);
    expect(original.actors.observe(owner.id)?.definition).toBe(`${source.provider}/${fixture.classname}`);
    original.bodies.write(player, { ...playerBody, origin: { x: body.origin.x + 180, y: body.origin.y, z: body.origin.z } });
    original.bodies.link(player); original.combat.setHealth(player, 10000);
    context.entity.enemy = player.id; context.state.standGround = true; context.attack();
    const attackMove = context.state.move.name;
    expect(attackMove.includes("attack") || attackMove.includes("shoot")).toBe(true);
    const image = decodeSaveImage(encodeSaveImage(original.checkpoint()));
    const restored = createSimulation({ ...options, restore: image, restoredClients: [client] });
    try {
      expect(continuation(restored)).toEqual(continuation(original));
      let fired = false;
      for (let frame = 0; frame < 15; frame++) {
        original.step({ elapsedMilliseconds: 100, commands: [] });
        restored.step({ elapsedMilliseconds: 100, commands: [] });
        for (const event of original.drainPresentationEvents()) if (event.kind === "q2" && event.event.kind === "monster-muzzleflash" && event.event.actor.equals(owner.id)) fired = true;
        expect(continuation(restored)).toEqual(continuation(original));
      }
      expect(fired).toBe(true);
      expect(context.state.move.name !== attackMove || context.entity.frame !== monster.values.frame).toBe(true);
    } finally { restored.close(); }
  } finally { original.close(); await content.close(); }
}, 30000);
