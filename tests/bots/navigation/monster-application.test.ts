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
