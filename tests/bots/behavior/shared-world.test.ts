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
import type { ApplicationBots } from "../../../src/app/bootstrap/simulation/bots.ts";
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
    application.queueCommand("addbot", ["Ranger", "5"], null); await application.step(100);
    const nativeBot = application.botClients[0]; if (nativeBot === undefined) throw new Error("Native Q1 bot was not admitted");
    expect(application.simulation.players()).toHaveLength(1);
    application.queueCommand("removebot", [String(nativeBot.client.id.slot)], null); await application.step(100);
    expect(application.botClients).toHaveLength(0); expect(nativeBot.client.isClosed).toBe(true);
    await application.loadGame(save);
    const transports: ApplicationBots[] = [], services = application.simulation.botServices, attach = services.attach.bind(services);
    services.attach = (director, transport) => { transports.push(transport); attach(director, transport); };
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
    await application.step(100);
    const brain = transports[0]?.director.roster().find(entry => entry.actor.id.equals(actor))?.state;
    if (brain === undefined) throw new Error("Missing actual bot brain");
    expect(brain.viewangles.y).toBe(90); expect(brain.idealViewangles.y).toBe(90);
    await application.step(100);
    source.composition.requestRespawn(actor);
    const respawnView = world.movementPlayer(actor)?.viewAngles.y;
    if (respawnView === undefined) throw new Error("Missing source respawn view");
    expect(world.q2WeaponSource()?.weapons.states.get(actor)?.phase).toBe("activating");
    await application.step(100);
    expect(brain.viewangles.y).toBe(respawnView); expect(brain.idealViewangles.y).toBe(respawnView);
    await application.step(100);
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

retail("native Q1 bots pursue an authored supply and fight through the same director", async () => {
  const launch = parseApplicationCommand(["--content-root", corpus, "--game", "q1-rerelease-id1", "--map", "dm4",
    "--movement", "q1", "--character", "q2", "--mode", "deathmatch", "--dedicated"]);
  if (launch.kind !== "run") throw new Error("Expected native Q1 launch");
  const application = await Application.open(launch.options, { print: () => undefined });
  try {
    const captured: ApplicationBots[] = [], services = application.simulation.botServices, attach = services.attach.bind(services);
    services.attach = (director, transport) => { captured.push(transport); attach(director, transport); };
    application.queueCommand("addbot", ["Ranger", "5"], null); await application.step(100);
    const transport = captured[0], bot = transport?.director.roster()[0];
    if (transport === undefined || bot === undefined) throw new Error("Missing native Q1 director/player");
    const world = application.simulation, source = world.q1Source();
    if (source === null) throw new Error("Missing native Q1 source");
    expect(world.q2WeaponSource()).toBeNull();
    expect(world.weaponProvider).toEqual(world.recipe.map.entities);
    for (let frame = 0; frame < 50; frame++) await application.step(100);
    const pickups = transport.game.pickups;
    if (pickups === null) throw new Error("Missing source supplies");
    const target = pickups.candidates(bot.sourceClient).find(item => item.name === "weapon_rocketlauncher");
    if (target === undefined) throw new Error("Missing authored dm4 rocket launcher");
    expect(target.observation.availability).toEqual({ kind: "ready", eligible: true });
    expect(target.preview.weapons).toEqual([{ item: "q1:weapon/rocketlauncher", before: 0, given: 1 }]);
    const start = { x: 12.117749006091444, y: 131.88225099390857, z: -294.96875 };
    // Place the actual source player in the previously checked supported 96-unit lane; all subsequent movement is bot commands.
    source.composition.services.teleport(bot.actor.id, start, { x: 0, y: 315, z: 0 }, { x: 0, y: 0, z: 0 }, world.timeSeconds);
    let choseGoal = false, collected = false;
    for (let frame = 0; frame < 60; frame++) {
      await application.step(100);
      if (transport.director.library.goals.getTopGoal(bot.state.gs)?.entity === target.entity) choseGoal = true;
      if (world.inventory.count(bot.actor.id, "q1:weapon/rocketlauncher") === 1) { collected = true; break; }
    }
    expect(choseGoal).toBe(true); expect(collected).toBe(true);
    for (const receipt of [...target.preview.weapons, ...target.preview.ammo]) expect(world.inventory.count(bot.actor.id, receipt.item)).toBe(receipt.before + receipt.given);
    expect(pickups.inspect(bot.sourceClient, target.observation.actor)?.observation.availability.kind).toBe("respawning");
    const humanClient = application.session.createClient(1), human = world.admitPlayer(humanClient.id);
    source.composition.services.teleport(bot.actor.id, start, { x: 0, y: 315, z: 0 }, { x: 0, y: 0, z: 0 }, world.timeSeconds);
    source.composition.services.teleport(human.actor, { x: 80, y: 64, z: start.z }, { x: 0, y: 135, z: 0 }, { x: 0, y: 0, z: 0 }, world.timeSeconds);
    const targetPlayer = source.game.player(human.actor);
    if (targetPlayer === null) throw new Error("Missing native target player");
    world.combat.setHealth(targetPlayer.actor, 1000);
    expect(source.game.selectWeapon(bot.actor, "axe")).toBe(true);
    let attacked = false;
    for (let frame = 0; frame < 60; frame++) {
      await application.step(100);
      if (((world.movementPlayer(bot.actor.id)?.buttons ?? 0) & 1) !== 0) attacked = true;
      if ((world.combat.read(human.actor)?.health ?? 1000) < 1000) break;
    }
    expect(attacked).toBe(true); expect(world.combat.read(human.actor)?.health).toBeLessThan(1000);
    expect(source.game.player(bot.actor.id)?.weapon).not.toBe("axe");
    const clientId = application.botClients[0]?.client.id;
    if (clientId === undefined) throw new Error("Lost native bot client");
    await application.changeLevel("dm5");
    expect(application.botClients[0]?.client.id.equals(clientId)).toBe(true);
    expect(application.simulation.actors.isLive(bot.actor.id)).toBe(false);
    application.queueCommand("removebot", [String(clientId.slot)], null); await application.step(100);
    expect(application.botClients).toHaveLength(0);
  } finally { await application.close(); }
}, 120000);
