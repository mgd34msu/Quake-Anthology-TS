import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Q2Monsters } from "../../../src/content/q2/foundation/monsters/index.ts";
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
  const source = saved.sources.find(source => source.reference.provider === "q2:monsters/rerelease/baseq2");
  if (source === undefined || source.kind !== "q2") throw new Error("Missing selected rerelease Q2 source");
  return source;
}
function continuation(simulation: ReturnType<typeof createSimulation>): string {
  return JSON.stringify({ source: selected(simulation), bodies: simulation.checkpoint().bodies }, (key: string, value: unknown) => key === "generation" ? 0 : value);
}

const corpus = resolve(import.meta.dir, "../../../../qfiles");
test.skipIf(!existsSync(resolve(corpus, "q2/rerelease/baseq2/pak0.pak")) || !existsSync(resolve(corpus, "q2/baseq2/pak0.pak")))("retail base3 selected rerelease parasite restores its source-triggered physical proboscis and drains through shared callbacks", async () => {
  const command = parseApplicationCommand(["--content-root", corpus, "--game", "q2-classic-baseq2", "--map", "base3", "--dedicated", "--mode", "singleplayer"]);
  if (command.kind !== "run") throw new Error("Expected Q2 launch");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false }), preset = applicationPreset(catalog, command.options);
  const classic = q2MonsterSources.find(source => source.edition === "classic"), rerelease = q2MonsterSources.find(source => source.edition === "rerelease");
  if (classic === undefined || rerelease === undefined) throw new Error("Missing Q2 monster sources");
  const source = { provider: rerelease.provider, content: catalog.require("q2-rerelease-baseq2").id }, classicSource = { provider: classic.provider, content: catalog.require("q2-classic-baseq2").id };
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), enemies: { kind: "selected", value: {
    kind: "replace", default: { source: classicSource, classname: "monster_infantry" },
    byClassname: Object.fromEntries(["monster_soldier_ss", "monster_soldier", "monster_flyer", "monster_gunner", "monster_soldier_light", "monster_infantry", "monster_parasite"].map(classname => [classname, { source: classname === "monster_parasite" ? source : classicSource, classname }])),
  } } } });
  const content = await loadApplicationContent(command.options, recipe), identity = createIdentityOwner("selected-rerelease-parasite-save"), client = identity.client(0, 0);
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
    const parasite = selected(original).entities.entities.find(entity => entity.values.classname === "monster_parasite");
    if (parasite === undefined) throw new Error("Missing authored base3 parasite");
    const owner = original.actors.resolveSaved(parasite.actor), player = original.actors.resolveOwned(human.actor);
    if (owner === null || player === null) throw new Error("Missing shared actors");
    expect(owner.owner).toBe(recipe.map.entities.provider);
    expect(original.actors.observe(owner.id)?.definition).toBe(`${source.provider}/monster_parasite`);
    const body = original.bodies.read(owner.id), playerBody = original.bodies.read(player.id), context = captured.monsters?.context(owner.id);
    if (body === null || playerBody === null || context == null) throw new Error("Missing shared body or source behavior");
    original.bodies.write(player, { ...playerBody, origin: { x: body.origin.x + 160, y: body.origin.y, z: body.origin.z } });
    original.bodies.link(player); original.combat.setHealth(player, 1000);
    // Enter the actual source attack; movement, contacts and drain callbacks run in the engine.
    context.entity.enemy = player.id; context.attack();
    let tip = selected(original).entities.entities.find(entity => entity.values.classname === "parasite_proboscis" && entity.links.owner?.slot === owner.id.slot);
    for (let frame = 0; frame < 40 && tip === undefined; frame++) {
      original.step({ elapsedMilliseconds: 25, commands: [] });
      tip = selected(original).entities.entities.find(entity => entity.values.classname === "parasite_proboscis" && entity.links.owner?.slot === owner.id.slot);
    }
    if (tip === undefined || tip.links.proboscus === null) throw new Error("Source parasite did not launch its physical proboscis");
    const segment = selected(original).entities.entities.find(entity => entity.actor.slot === tip.links.proboscus?.slot);
    if (segment === undefined) throw new Error("Missing physical proboscis segment");
    expect(tip.values.projectile).toBe(true);
    expect(tip.values.speed).toBe(1250);
    expect(tip.values.motion).toBe("fly-missile");
    expect(tip.values.style).toBe(0);
    expect(tip.callbacks.touch).toBe("rerelease.parasite.proboscis_touch");
    expect(tip.callbacks.think).toBe("rerelease.parasite.proboscis_think");
    expect(tip.callbacks.die).toBe("rerelease.parasite.proboscis_die");
    expect(segment.callbacks.postthink).toBe("rerelease.parasite.proboscis_segment_draw");
    expect(segment.links.owner).toEqual(tip.actor);
    expect(selected(original).entities.entities.find(entity => entity.actor.slot === owner.id.slot)?.links.proboscus).toEqual(tip.actor);
    const image = decodeSaveImage(encodeSaveImage(original.checkpoint()));
    const restored = createSimulation({ ...options, restore: image, restoredClients: [client] });
    try {
      const restoredOwner = restored.actors.resolveSaved(parasite.actor), restoredTip = restored.actors.resolveSaved(tip.actor), restoredPlayer = restored.players()[0];
      if (restoredOwner === null || restoredTip === null || restoredPlayer === undefined) throw new Error("Missing restored actors");
      expect(restoredOwner.id.equals(owner.id)).toBe(false);
      expect(continuation(restored)).toEqual(continuation(original));
      let drains = 0;
      for (let frame = 0; frame < 12 && drains < 2; frame++) {
        original.step({ elapsedMilliseconds: 100, commands: [] });
        const output = restored.step({ elapsedMilliseconds: 100, commands: [] });
        for (const event of output.events) if (event.payload.kind === "damage" && event.payload.outcome.kind === "committed") {
          const decision = event.payload.outcome.decision, request = decision.request;
          if (request.attack.inflictor?.equals(restoredTip.id) && decision.appliedDamage > 0) {
            expect(request.attack.attacker?.equals(restoredOwner.id)).toBe(true);
            expect(request.target.equals(restoredPlayer)).toBe(true);
            expect(request.attack.cause.kind).toBe("q2");
            if (request.amount === 2) drains++;
          }
        }
        expect(continuation(restored)).toEqual(continuation(original));
        expect(restored.combat.read(restoredPlayer)?.health).toBe(original.combat.read(player.id)?.health);
      }
      expect(drains).toBeGreaterThanOrEqual(2);
      expect(selected(restored).entities.entities.find(entity => entity.actor.slot === restoredTip.id.slot)?.links.enemy?.slot).toBe(restoredPlayer.slot);
      original.actors.release(owner); restored.actors.release(restoredOwner);
      for (let frame = 0; frame < 4; frame++) {
        original.step({ elapsedMilliseconds: 100, commands: [] }); restored.step({ elapsedMilliseconds: 100, commands: [] });
        expect(continuation(restored)).toEqual(continuation(original));
      }
      expect(restored.actors.resolveSaved(tip.actor)).toBeNull();
      expect(restored.actors.resolveSaved(segment.actor)).toBeNull();
      expect(selected(restored).entities.entities.some(entity => entity.values.classname.startsWith("parasite_proboscis") && (entity.links.owner?.slot === owner.id.slot || entity.links.owner?.slot === tip.actor.slot))).toBe(false);
    } finally { restored.close(); }
  } finally { original.close(); await content.close(); }
}, 30000);
