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
test.skipIf(!existsSync(resolve(corpus, "q2/rerelease/baseq2/pak0.pak")) || !existsSync(resolve(corpus, "q2/baseq2/pak0.pak")))("retail command selects ordinary rerelease heavies and restores a source-fired chick rocket", async () => {
  const command = parseApplicationCommand(["--content-root", corpus, "--game", "q2-classic-baseq2", "--map", "command", "--dedicated", "--mode", "singleplayer"]);
  if (command.kind !== "run") throw new Error("Expected Q2 launch");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false }), preset = applicationPreset(catalog, command.options);
  const rerelease = q2MonsterSources.find(source => source.edition === "rerelease");
  if (rerelease === undefined) throw new Error("Missing Q2 monster sources");
  const source = { provider: rerelease.provider, content: catalog.require("q2-rerelease-baseq2").id };
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), enemies: { kind: "selected", value: {
    kind: "replace", default: { source, classname: "monster_infantry" },
    byClassname: Object.fromEntries(["monster_gladiator", "monster_floater", "monster_tank", "monster_chick", "monster_soldier_light", "monster_gunner"].map(classname => [classname, { source, classname }])),
  } } } });
  const content = await loadApplicationContent(command.options, recipe), identity = createIdentityOwner("selected-rerelease-heavy-save"), client = identity.client(0, 0);
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
    const admitted = selected(original);
    for (const classname of ["monster_chick", "monster_tank", "monster_gladiator"]) {
      const entity = admitted.entities.entities.find(entity => entity.values.classname === classname);
      if (entity === undefined) throw new Error(`Missing authored ${classname}`);
      const actor = original.actors.resolveSaved(entity.actor);
      if (actor === null) throw new Error("Missing authored owner");
      expect(actor.owner).toBe(recipe.map.entities.provider);
      expect(original.actors.observe(actor.id)?.definition).toBe(`${source.provider}/${classname}`);
    }
    const chick = admitted.entities.entities.find(entity => entity.values.classname === "monster_chick");
    if (chick === undefined) throw new Error("Missing authored chick");
    const owner = original.actors.resolveSaved(chick.actor), player = original.actors.resolveOwned(human.actor);
    if (owner === null || player === null) throw new Error("Missing shared actors");
    const body = original.bodies.read(owner.id), playerBody = original.bodies.read(player.id), context = captured.monsters?.context(owner.id);
    if (body === null || playerBody === null || context == null) throw new Error("Missing shared body or source behavior");
    expect(context.game.sourceCallbacks.think.resolve("rerelease/heat_think")).not.toBeNull();
    expect(context.game.sourceCallbacks.touch.resolve("plasma_touch")).not.toBeNull();
    const radians = body.angles.y * Math.PI / 180;
    original.bodies.write(player, { ...playerBody, origin: { x: body.origin.x + 250 * Math.cos(radians), y: body.origin.y + 250 * Math.sin(radians), z: body.origin.z } });
    original.bodies.link(player); original.combat.setHealth(player, 1000);
    // Enter the ordinary source attack; its animation fires through the shared engine.
    context.entity.enemy = player.id; context.attack();
    let rocket = selected(original).entities.entities.find(entity => entity.values.classname === "rocket" && entity.links.owner?.slot === owner.id.slot);
    for (let frame = 0; frame < 80 && rocket === undefined; frame++) {
      original.step({ elapsedMilliseconds: 25, commands: [] });
      rocket = selected(original).entities.entities.find(entity => entity.values.classname === "rocket" && entity.links.owner?.slot === owner.id.slot);
    }
    if (rocket === undefined) throw new Error("Ordinary rerelease chick did not launch a live rocket");
    expect(rocket.values.projectile).toBe(true);
    expect(rocket.values.motion).toBe("fly-missile");
    expect(rocket.values.damage).toBe(50);
    expect(rocket.callbacks.touch).toBe("rocket_touch");
    expect(rocket.callbacks.think).toBe("G_FreeEdict");
    const rocketActor = original.actors.resolveSaved(rocket.actor);
    if (rocketActor === null) throw new Error("Missing projectile actor");
    const velocity = original.bodies.read(rocketActor.id)?.velocity;
    if (velocity === undefined) throw new Error("Missing projectile body");
    expect(Math.hypot(velocity.x, velocity.y, velocity.z)).toBeCloseTo(650, 3);
    const image = decodeSaveImage(encodeSaveImage(original.checkpoint()));
    const restored = createSimulation({ ...options, restore: image, restoredClients: [client] });
    try {
      const restoredOwner = restored.actors.resolveSaved(chick.actor), restoredRocket = restored.actors.resolveSaved(rocket.actor), restoredPlayer = restored.players()[0];
      if (restoredOwner === null || restoredRocket === null || restoredPlayer === undefined) throw new Error("Missing restored actors");
      expect(restoredOwner.id.equals(owner.id)).toBe(false);
      expect(continuation(restored)).toEqual(continuation(original));
      let hits = 0;
      for (let frame = 0; frame < 12; frame++) {
        original.step({ elapsedMilliseconds: 100, commands: [] });
        const output = restored.step({ elapsedMilliseconds: 100, commands: [] });
        for (const event of output.events) if (event.payload.kind === "damage" && event.payload.outcome.kind === "committed") {
          const decision = event.payload.outcome.decision, request = decision.request;
          if (request.attack.inflictor?.equals(restoredRocket.id) && request.target.equals(restoredPlayer) && decision.appliedDamage > 0) {
            expect(request.attack.attacker?.equals(restoredOwner.id)).toBe(true);
            expect(request.attack.cause.kind).toBe("q2");
            expect(request.attack.weaponProvider).toBe(source.provider); hits++;
          }
        }
        expect(continuation(restored)).toEqual(continuation(original));
        expect(restored.combat.read(restoredPlayer)?.health).toBe(original.combat.read(player.id)?.health);
      }
      expect(hits).toBeGreaterThan(0);
      expect(restored.actors.resolveSaved(rocket.actor)).toBeNull();
    } finally { restored.close(); }
  } finally { original.close(); await content.close(); }
}, 60000);
