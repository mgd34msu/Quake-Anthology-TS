import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import { applicationPreset, loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { writeSaveImage } from "../../../src/persistence/save-image.ts";
import { resolve } from "node:path";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";

const corpus = resolve(import.meta.dir, "../../../../qfiles");
const retail = test.skipIf(!existsSync(resolve(corpus, "q2/rerelease/baseq2/pak0.pak")) || !existsSync(resolve(corpus, "q3a/baseq3/pak0.pk3")));

retail("one bot controller moves and fires in Q2 and preserves its real client and shared configuration through travel", async () => {
  const launch = parseApplicationCommand(["--content-root", corpus, "--game", "q2-rerelease-baseq2", "--map", "base1",
    "--movement", "q2", "--character", "q2", "--mode", "deathmatch", "--dedicated"]);
  if (launch.kind !== "run") throw new Error("Expected Q2 launch");
  const application = await Application.open(launch.options, { print: () => undefined });
  try {
    expect(application.botClients).toHaveLength(0);
    expect(application.content.openedMounts().some(mount => mount.plan.mounts.some(source => source.kind === "archive" && source.archivePath.includes("q3a")))).toBe(false);
    const client = application.session.createClient(0), human = application.simulation.admitPlayer(client.id);
    application.queueCommand("addbot", ["Ranger", "5"], null); await application.step(100);
    const bot = application.botClients[0]; if (bot === undefined) throw new Error("Bot was not admitted");
    const actor = application.simulation.players().find(actor => application.simulation.movementPlayer(actor)?.client.equals(bot.client.id));
    if (actor === undefined) throw new Error("Bot has no shared actor");
    const source = application.simulation.q2Source(), origin = application.simulation.bodies.read(actor)?.origin;
    if (source === null || origin === undefined) throw new Error("Missing Q2 world");
    const target = source.game.entity(human.actor); if (target === null) throw new Error("Missing human entity");
    const view = application.simulation.movementPlayer(actor)?.viewAngles;
    if (view === undefined) throw new Error("Missing authored bot view");
    const radians = view.y * Math.PI / 180;
    source.players.teleportPlayer(target, source.game, { x: origin.x + Math.cos(radians) * 160, y: origin.y + Math.sin(radians) * 160, z: origin.z }, { x: 0, y: view.y + 180, z: 0 });
    expect((source.game.entity(actor)?.serverFlags ?? 0) & 16).toBe(16);
    let attacks = 0;
    for (let frame = 0; frame < 80; frame++) {
      await application.step(100);
      if (((application.simulation.movementPlayer(actor)?.buttons ?? 0) & 1) !== 0) attacks++;
    }
    const position = application.simulation.bodies.read(actor)?.origin; if (position === undefined) throw new Error("Lost bot body");
    expect(Math.hypot(position.x - origin.x, position.y - origin.y)).toBeGreaterThan(32);
    expect(attacks).toBeGreaterThan(0);
    expect(application.simulation.combat.read(human.actor)?.health).toBeLessThan(100);
    const configuration = application.simulation.botServices.configuration;
    if (configuration === null) throw new Error("Bot did not borrow application configuration");
    configuration.set("bot_thinktime", "150", true);
    await application.changeLevel("base1");
    expect(application.botClients[0]?.client.id.equals(bot.client.id)).toBe(true);
    expect(application.simulation.botServices.configuration).toBe(configuration);
    expect(configuration.variableValue("bot_thinktime")).toBe(150);
    expect(application.simulation.players().some(current => current.equals(actor))).toBe(false);
    await application.step(100);
    application.queueCommand("removebot", [String(bot.client.id.slot)], null); await application.step(100);
    expect(application.botClients).toHaveLength(0);
    expect(bot.client.isClosed).toBe(true);
    expect(application.simulation.players()).toHaveLength(1);
  } finally { await application.close(); }
}, 120000);


retail("Q1 deathmatch bots use selected Q2 weapons through application commands and actual player movement", async () => {
  const launch = parseApplicationCommand(["--content-root", corpus, "--game", "q1-rerelease-id1", "--map", "dm4",
    "--movement", "q1", "--character", "q2", "--mode", "deathmatch", "--dedicated"]);
  if (launch.kind !== "run") throw new Error("Expected Q1 launch");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false }), preset = applicationPreset(catalog, launch.options);
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: "selected", value: [
    { provider: "q2:official", content: catalog.require("q2-classic-baseq2").id },
  ] } } });
  const content = await loadApplicationContent(launch.options, recipe), temporary = await mkdtemp(resolve(tmpdir(), "q1-bot-recipe-"));
  const simulation = createSimulation({ identity: createIdentityOwner("q1-bot-recipe"), recipe, world: content.world, mounts: content.mounts,
    skill: 1, mode: "deathmatch", seed: 1, maxClients: 16 });
  const save = resolve(temporary, "selected.qtsave");
  try { await writeSaveImage(save, simulation.checkpoint()); } finally { simulation.close(); await content.close(); }
  const messages: string[] = [], application = await Application.open(launch.options, { print: text => { messages.push(text); } });
  try {
    const originalCount = application.simulation.actors.observations().length;
    application.queueCommand("addbot", ["Ranger", "5"], null); await application.step(100);
    expect(application.botClients).toHaveLength(0); expect(application.simulation.players()).toHaveLength(0);
    expect(application.simulation.actors.observations()).toHaveLength(originalCount);
    expect(messages.some(message => message.includes("require an actual native or selected Q2 arsenal"))).toBe(true);
    await application.loadGame(save);
    const client = application.session.createClient(0), human = application.simulation.admitPlayer(client.id);
    application.queueCommand("addbot", ["Ranger", "5"], null); await application.step(100);
    const bot = application.botClients[0]; if (bot === undefined) throw new Error(`Q1 bot not admitted: ${messages.join("")}`);
    const actor = application.simulation.players().find(actor => application.simulation.movementPlayer(actor)?.client.equals(bot.client.id));
    if (actor === undefined) throw new Error("Bot has no actual shared player");
    const world = application.simulation, source = world.q1Source(), body = world.bodies.read(actor), player = world.movementPlayer(human.actor);
    if (source === null || body === null || player === null) throw new Error("Missing Q1 players");
    expect(world.q2Source()).toBeNull(); expect(world.q2WeaponSource()?.game.entity(actor)).toBeNull();
    expect(source.composition.clients.require(actor).name).toBe("Ranger");
    expect(world.botServices.isBot(actor)).toBe(true);
    const numeric = recipe.timing.find(entry => entry.provider === recipe.engineBehavior.provider)?.numeric;
    if (numeric === undefined) throw new Error("Missing source numeric profile");
    let positioned = false;
    for (let yaw = 0; yaw < 360; yaw += 30) {
      const radians = yaw * Math.PI / 180, origin = { x: body.origin.x + Math.cos(radians) * 160, y: body.origin.y + Math.sin(radians) * 160, z: body.origin.z };
      const trace = world.scene.traceExcluding({ start: body.origin, end: origin, shape: { kind: "box", bounds: player.bounds }, target: { kind: "world" },
        policy: { kind: "q3", contentsMask: 0x6000001, curves: true, playerCurveClip: true }, numeric, passActor: actor }, [actor, human.actor]);
      if (trace.fraction !== 1 || trace.startSolid || trace.allSolid) continue;
      source.composition.services.teleport(human.actor, origin, { x: 0, y: yaw + 180, z: 0 }, { x: 0, y: 0, z: 0 }, world.timeSeconds);
      positioned = true; break;
    }
    expect(positioned).toBe(true);
    let attacks = 0;
    for (let frame = 0; frame < 100; frame++) {
      await application.step(100);
      if (((world.movementPlayer(actor)?.buttons ?? 0) & 1) !== 0) attacks++;
    }
    const moved = world.bodies.read(actor); if (moved === null) throw new Error("Lost bot body");
    expect(Math.hypot(moved.origin.x - body.origin.x, moved.origin.y - body.origin.y)).toBeGreaterThan(32);
    expect(attacks).toBeGreaterThan(0); expect(world.combat.read(human.actor)?.health).toBeLessThan(100);
    world.disconnectPlayer(human.actor);
    await application.step(100);
    const resetOrigin = world.bodies.read(actor)?.origin;
    if (resetOrigin === undefined) throw new Error("Missing bot reset origin");
    source.composition.services.teleport(actor, resetOrigin, { x: 0, y: 90, z: 0 }, { x: 0, y: 0, z: 0 }, world.timeSeconds);
    await application.step(100); await application.step(100);
    expect(world.movementPlayer(actor)?.viewAngles.y).toBeCloseTo(90, 2);
    source.composition.requestRespawn(actor);
    const respawnView = world.movementPlayer(actor)?.viewAngles.y;
    expect(world.q2WeaponSource()?.weapons.states.get(actor)?.phase).toBe("activating");
    await application.step(100); await application.step(100);
    expect(world.movementPlayer(actor)?.viewAngles.y).toBeCloseTo(respawnView ?? -1, 2);
    const configuration = world.botServices.configuration; if (configuration === null) throw new Error("Missing bot configuration");
    expect(configuration).toBe(source.cvars); configuration.set("bot_thinktime", "150", true);
    await application.changeLevel("dm5");
    expect(application.simulation.recipe.map.geometry.requestedPath).toBe("maps/dm5.bsp");
    expect(application.simulation.recipe.weapons).toEqual(recipe.weapons);
    expect(application.simulation.recipe.equipment).toEqual(recipe.equipment);
    expect(application.simulation.recipe.enemies).toEqual(recipe.enemies);
    expect(application.simulation.recipe.execution).toEqual(recipe.execution);
    expect(application.simulation.recipe.mounts).toEqual(recipe.mounts);
    expect(application.simulation.recipe.id).toBe(recipe.id);
    expect(application.simulation.recipe.preset).toBe(recipe.preset);
    expect(application.botClients[0]?.client.id.equals(bot.client.id)).toBe(true);
    expect(application.simulation.botServices.configuration?.variableValue("bot_thinktime")).toBe(150);
    expect(application.simulation.actors.isLive(actor)).toBe(false);
    application.queueCommand("removebot", [String(bot.client.id.slot)], null); await application.step(100);
    expect(application.botClients).toHaveLength(0); expect(bot.client.isClosed).toBe(true);
  } finally { await application.close(); await rm(temporary, { recursive: true, force: true }); }
}, 120000);
