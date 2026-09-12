import type { ProviderReference } from "../../../src/contracts/content.ts";
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
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

function selected(simulation: ReturnType<typeof createSimulation>, provider: string) {
  const checkpoint = simulationProviderCheckpoint(simulation.checkpoint(), "world:simulation");
  const saved = readSelectedMonstersCheckpoint(new SaveReader(decodeCheckpointValue(checkpoint.bytes)).field("selectedMonsters"));
  const source = saved.sources.find(source => source.reference.provider === provider);
  if (source === undefined || source.kind !== "q2") throw new Error("Missing selected Q2 aquatic source");
  return source;
}
function continuation(simulation: ReturnType<typeof createSimulation>, provider: string): string {
  return JSON.stringify({ source: selected(simulation, provider), bodies: simulation.checkpoint().bodies }, (key: string, value: unknown) => key === "generation" ? 0 : value);
}
const corpus = resolve(import.meta.dir, "../../../../qfiles");
for (const edition of ["classic", "rerelease"]) test.skipIf(!existsSync(resolve(corpus, "q2/rerelease/baseq2/pak0.pak")) || !existsSync(resolve(corpus, "q2/baseq2/pak0.pak")))(`retail train selected ${edition} flipper swims from its authored water placement, bites and restores`, async () => {
  const command = parseApplicationCommand(["--content-root", corpus, "--game", `q2-${edition}-baseq2`, "--map", "train", "--dedicated", "--mode", "singleplayer"]);
  if (command.kind !== "run") throw new Error("Expected Q2 launch");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false }), preset = applicationPreset(catalog, command.options);
  const source: ProviderReference = { provider: `q2:monsters/${edition}/baseq2`, content: catalog.require(`q2-${edition}-baseq2`).id };
  const classic: ProviderReference = { provider: "q2:monsters/classic/baseq2", content: catalog.require("q2-classic-baseq2").id };
  const nativeRecipe = await resolveLaunch({ catalog, preset, choice: presetChoice(preset.id) });
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), enemies: { kind: "selected", value: {
    kind: "replace", default: { source: classic, classname: "monster_infantry" },
    byClassname: Object.fromEntries(["monster_infantry", "monster_soldier_light", "monster_soldier", "monster_parasite", "monster_flyer", "monster_flipper"].map(classname => [classname, { source: classname === "monster_flipper" ? source : classic, classname }])),
  } } } });
  const content = await loadApplicationContent(command.options, recipe), identity = createIdentityOwner(`selected-${edition}-flipper`), client = identity.client(0, 0);
  const options: Parameters<typeof createSimulation>[0] = { identity, recipe: content.recipe, world: content.world, mounts: content.mounts, skill: 1, mode: command.options.mode, seed: 1, maxClients: 1, playerIdentity: client => ({ seat: client.slot, socialId: "" }) };
  const original = createSimulation(options), native = createSimulation({ ...options, identity: createIdentityOwner(`native-${edition}-flipper`), recipe: nativeRecipe });
  try {
    const human = original.admitPlayer(client), captured: { monsters: Q2Monsters | null } = { monsters: null }, beginFrame = Q2Monsters.prototype.beginFrame;
    Q2Monsters.prototype.beginFrame = function (this: Q2Monsters, game) { if (game.options.provider === source.provider) captured.monsters = this; return beginFrame.call(this, game); };
    try { for (let frame = 0; frame < 3; frame++) original.step({ elapsedMilliseconds: 100, commands: [] }); }
    finally { Q2Monsters.prototype.beginFrame = beginFrame; }
    for (let frame = 0; frame < 3; frame++) native.step({ elapsedMilliseconds: 100, commands: [] });
    const flipper = selected(original, source.provider).entities.entities.find(entity => entity.values.classname === "monster_flipper");
    if (flipper === undefined) throw new Error("Missing authored train flipper");
    const owner = original.actors.resolveSaved(flipper.actor), player = original.actors.resolveOwned(human.actor);
    if (owner === null || player === null) throw new Error("Missing shared actors");
    const body = original.bodies.read(owner.id), playerBody = original.bodies.read(player.id), context = captured.monsters?.context(owner.id);
    const nativeSource = native.q2Source(), nativeFlipper = nativeSource === null ? undefined : [...nativeSource.game.entities.values()].find(entity => entity.classname === "monster_flipper");
    if (body === null || playerBody === null || context == null || nativeSource === null || nativeFlipper === undefined) throw new Error("Missing aquatic behavior");
    expect(body.origin).toEqual(nativeSource.game.body(nativeFlipper).origin);
    expect(body.origin.x).toBe(-492); expect(body.origin.y).toBe(-508);
    expect(context.state.locomotion).toBe("swim"); expect(context.state.waterLevel).toBeGreaterThan(0);
    expect(context.game.host.pointContents(body.origin) & 32).toBe(32);
    expect(owner.owner).toBe(recipe.map.entities.provider);
    const lane = { ...body.origin, y: body.origin.y - 100 };
    const floor = context.game.host.trace({ start: { ...lane, z: lane.z + 40 }, end: { ...lane, z: lane.z - 128 },
      bounds: playerBody.bounds, ignore: player.id, mask: 1 });
    expect(floor.startSolid).toBe(false); expect(floor.allSolid).toBe(false); expect(floor.fraction).toBeLessThan(1);
    const target = floor.end;
    expect(context.game.host.pointContents(target) & 32).toBe(32);
    original.bodies.write(player, { ...playerBody, origin: target }); original.bodies.link(player); original.combat.setHealth(player, 1000);
    let bites = 0, moved = false;
    for (let frame = 0; frame < 400 && bites === 0; frame++) {
      const output = original.step({ elapsedMilliseconds: 100, commands: [] });
      moved ||= original.bodies.read(owner.id)?.origin.y !== body.origin.y;
      for (const event of output.events) if (event.payload.kind === "damage" && event.payload.outcome.kind === "committed") {
        const decision = event.payload.outcome.decision;
        if (decision.request.attack.attacker?.equals(owner.id) && decision.request.target.equals(player.id) && decision.appliedDamage > 0) bites++;
      }
    }
    expect(moved).toBe(true); expect(bites).toBeGreaterThan(0); expect(context.entity.enemy?.equals(player.id)).toBe(true);
    const restored = createSimulation({ ...options, restore: decodeSaveImage(encodeSaveImage(original.checkpoint())), restoredClients: [client] });
    try {
      expect(continuation(restored, source.provider)).toEqual(continuation(original, source.provider));
      for (let frame = 0; frame < 8; frame++) {
        original.step({ elapsedMilliseconds: 100, commands: [] }); restored.step({ elapsedMilliseconds: 100, commands: [] });
        expect(continuation(restored, source.provider)).toEqual(continuation(original, source.provider));
      }
    } finally { restored.close(); }
  } finally { original.close(); native.close(); await content.close(); }
}, 60000);
