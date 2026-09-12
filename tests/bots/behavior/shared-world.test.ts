import { statSchema, PersistentIndex } from "../../../src/content/q3/base/shared/definitions.ts";
import { teleportPlayer } from "../../../src/content/q3/base/game/misc.ts";
import { SimulationBotServices } from "../../../src/app/bootstrap/simulation/bots.ts";
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
import { BotInventory, BotModelIndex } from "../../../src/bots/behavior/q3/ai-definitions.ts";

const corpus = resolve(import.meta.dir, "../../../../qfiles");
const retail = test.skipIf(!existsSync(resolve(corpus, "q2/rerelease/baseq2/pak0.pak")) || !existsSync(resolve(corpus, "q3a/baseq3/pak0.pk3")));

retail("Q3 map bots pursue mapped Q2 supplies and fire the actual selected arsenal", async () => {
  const launch = parseApplicationCommand(["--content-root", corpus, "--game", "q3-baseq3", "--map", "q3dm1",
    "--movement", "q3", "--character", "q3", "--mode", "deathmatch", "--dedicated"]);
  if (launch.kind !== "run") throw new Error("Expected Q3 launch");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false }), preset = applicationPreset(catalog, launch.options);
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: "selected", value: [
    { provider: "q2:official", content: catalog.require("q2-classic-baseq2").id },
  ] } } });
  const captured: ApplicationBots[] = [], attach = SimulationBotServices.prototype.attach;
  SimulationBotServices.prototype.attach = function (director, transport) { captured.push(transport); attach.call(this, director, transport); };
  const application = await Application.open(launch.options, { print: () => undefined }, recipe).finally(() => { SimulationBotServices.prototype.attach = attach; });
  try {
    application.queueCommand("addbot", ["Sarge", "5"], null); await application.step(100);
    const transport = captured[0], bot = transport?.director.roster()[0];
    if (transport === undefined || bot === undefined) throw new Error("Missing selected Q2 bot on Q3");
    const world = application.simulation, source = world.q3Source(), arsenal = world.q2WeaponSource();
    if (source === null || arsenal === null) throw new Error("Missing actual Q3 map or Q2 arsenal");
    const native = source.records.nativeByActor(bot.actor.id), pickups = transport.game.pickups;
    if (native?.client == null || pickups === null) throw new Error("Missing actual source client or pickups");
    for (let frame = 0; frame < 50; frame++) await application.step(100);
    const supply = pickups.candidates(bot.sourceClient).find(item => item.name === "weapon_shotgun");
    if (supply === undefined) throw new Error("Missing authored shotgun");
    expect(pickups.ownsItemGoal?.(bot.sourceClient, supply.entity)).toBe(true);
    const center = { x: supply.origin.x, y: supply.origin.y, z: supply.origin.z + 24 };
    let start: typeof center | null = null;
    for (const offset of [{ x: 96, y: 0 }, { x: -96, y: 0 }, { x: 0, y: 96 }, { x: 0, y: -96 }]) {
      const candidate = { x: center.x + offset.x, y: center.y + offset.y, z: center.z };
      const shape = { kind: "box", mins: native.r.mins, maxs: native.r.maxs } satisfies Parameters<typeof source.world.trace>[0]["shape"];
      const lane = source.world.trace({ start: candidate, end: center, shape, passEntityNum: native.s.number, mask: 0x2010001 });
      const support = source.world.trace({ start: candidate, end: { ...candidate, z: candidate.z - 48 }, shape, passEntityNum: native.s.number, mask: 0x2010001 });
      if (lane.solidity === "clear" && lane.fraction === 1 && support.solidity === "clear" && support.fraction < 1) { start = candidate; break; }
    }
    if (start === null) throw new Error("Authored shotgun has no supported approach lane");
    teleportPlayer({ combat: source.combat, world: source.world }, native, start, { x: 0, y: Math.atan2(center.y - start.y, center.x - start.x) * 180 / Math.PI, z: 0 });
    native.client.ps.velocity = { x: 0, y: 0, z: 0 }; source.world.link(native);
    const nativeAmmo = native.client.ps.ammo.get(3);
    const frameCommands = transport.frame.bind(transport);
    let checkedCommands = 0, selectedShotgun = false;
    transport.frame = (time, elapsed) => {
      const commands = frameCommands(time, elapsed);
      for (const command of commands) if (command.command.kind === "q3") {
        if (command.arsenal?.weapon === "q2:weapon_shotgun" || command.arsenal?.weapon === "q2:weapon_supershotgun") selectedShotgun = true;
        const client = source.records.nativeByActor(command.actor)?.client;
        if (client == null) throw new Error("Command has no live native source player");
        if (command.command.weapon !== client.ps.weapon) throw new Error("Foreign decision weapon escaped into native transport");
        checkedCommands++;
      }
      return commands;
    };
    let chose = false;
    for (let frame = 0; frame < 60; frame++) {
      await application.step(100);
      const goal = transport.director.library.goals.getTopGoal(bot.state.gs);
      if (goal?.entity === supply.entity && goal.number >= 0x40000000) chose = true;
      if (pickups.inspect(bot.sourceClient, supply.observation.actor)?.observation.availability.kind === "respawning") break;
    }
    expect(chose).toBe(true);
    expect(pickups.inspect(bot.sourceClient, supply.observation.actor)?.observation.availability.kind).toBe("respawning");
    expect(world.inventory.count(bot.actor.id, "q2:weapon_shotgun")).toBe(1);
    expect(world.inventory.count(bot.actor.id, "q2:ammo_shells")).toBeGreaterThan(0);
    expect(native.client.ps.ammo.get(3)).toBe(nativeAmmo);
    const humanClient = application.session.createClient(1), human = world.admitPlayer(humanClient.id), target = source.records.nativeByActor(human.actor);
    if (target?.client == null) throw new Error("Missing real human target");
    teleportPlayer({ combat: source.combat, world: source.world }, native, start, { x: 0, y: Math.atan2(center.y - start.y, center.x - start.x) * 180 / Math.PI, z: 0 });
    native.client.ps.velocity = { x: 0, y: 0, z: 0 }; source.world.link(native);
    teleportPlayer({ combat: source.combat, world: source.world }, target, center, { x: 0, y: 0, z: 0 });
    target.client.ps.velocity = { x: 0, y: 0, z: 0 }; source.world.link(target);
    world.combat.setHealth(target.actor, 100);
    world.inventory.consume(bot.actor, "q2:ammo_bullets", world.inventory.count(bot.actor.id, "q2:ammo_bullets"));
    let shotgunHit = false;
    const hitsBefore = native.client.ps.persistant.get(PersistentIndex.PERS_HITS);
    expect(transport.game.entity(1).player?.state.weapon).toBeGreaterThan(0);
    expect(transport.game.entity(1).player?.state.weapon).not.toBe(target.client.ps.weapon);
    const shells = world.inventory.count(bot.actor.id, "q2:ammo_shells");
    for (let frame = 0; frame < 60; frame++) {
      const output = await application.step(100);
      for (const event of output.events) if (event.payload.kind === "damage" && event.payload.outcome.kind === "committed") {
        const decision = event.payload.outcome.decision, attack = decision.request.attack;
        if (decision.request.target.equals(human.actor) && attack.attacker?.equals(bot.actor.id) === true && decision.appliedDamage > 0
          && (attack.weapon === "q2:weapon_shotgun" || attack.weapon === "q2:weapon_supershotgun")) shotgunHit = true;
      }
      if (shotgunHit) break;
    }
    expect(world.combat.read(human.actor)?.health).toBeLessThan(100);
    expect(shotgunHit).toBe(true);
    expect(native.client.ps.persistant.get(PersistentIndex.PERS_HITS)).toBeGreaterThan(hitsBefore);
    expect(target.client.lastHurtClient).toBe(bot.sourceClient);
    expect(target.client.lastHurtMod).toBe(0);
    expect(world.inventory.count(bot.actor.id, "q2:ammo_shells")).toBeLessThan(shells);
    expect(selectedShotgun).toBe(true);
    const firedWeapon = arsenal.weapons.states.get(bot.actor.id)?.weapon;
    if (firedWeapon == null) throw new Error("Bot lost its actual firing weapon");
    expect(["shotgun", "supershotgun"]).toContain(firedWeapon);
    expect(native.client.ps.weapon).toBeLessThan(11);
    expect(checkedCommands).toBeGreaterThan(0);
    const schema = statSchema("baseq3");
    native.client.ps.stats.set(schema.holdableItem, BotModelIndex.MEDKIT);
    world.combat.setHealth(bot.actor, 30);
    for (let frame = 0; frame < 20 && native.client.ps.stats.get(schema.holdableItem) !== 0; frame++) await application.step(100);
    expect(native.client.ps.stats.get(schema.holdableItem)).toBe(0);
    expect(world.combat.read(bot.actor.id)?.health).toBe(native.client.ps.stats.get(schema.maxHealth) + 25);
  } finally { await application.close(); }
}, 120000);

retail("Q2 map bots select and fire actual Q1 weapons and collect mapped source supplies", async () => {
  const launch = parseApplicationCommand(["--content-root", corpus, "--game", "q2-rerelease-baseq2", "--map", "base1",
    "--movement", "q2", "--character", "q2", "--mode", "deathmatch", "--dedicated"]);
  if (launch.kind !== "run") throw new Error("Expected Q2 launch");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false }), preset = applicationPreset(catalog, launch.options);
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: "selected", value: [
    { provider: "q1:official", content: catalog.require("q1-classic-id1").id },
  ] } } });
  const application = await Application.open(launch.options, { print: () => undefined }, recipe);
  try {
    const captured: ApplicationBots[] = [], services = application.simulation.botServices, attach = services.attach.bind(services);
    services.attach = (director, transport) => { captured.push(transport); attach(director, transport); };
    application.queueCommand("addbot", ["Ranger", "5"], null); await application.step(100);
    const transport = captured[0], bot = transport?.director.roster()[0];
    if (transport === undefined || bot === undefined) throw new Error("Missing selected Q1 bot");
    const world = application.simulation, source = world.q2Source(), arsenal = world.q1WeaponSource();
    if (source === null || arsenal === null) throw new Error("Missing independent map and weapon sources");
    expect(world.q1Source()).toBeNull(); expect(world.q2WeaponSource()).toBeNull();
    expect(arsenal.game.entity(bot.actor.id)).toBeNull();
    expect(arsenal.game.player(bot.actor.id)?.actor.id.equals(bot.actor.id)).toBe(true);
    expect(world.botServices.isBot(bot.actor.id)).toBe(true);
    for (let frame = 0; frame < 50; frame++) await application.step(100);
    const pickups = transport.game.pickups, nativeBot = source.game.entity(bot.actor.id);
    if (pickups === null || nativeBot === null) throw new Error("Missing source-owned bot and pickups");
    const supply = pickups.candidates(bot.sourceClient).find(item => item.name === "weapon_shotgun");
    if (supply === undefined) throw new Error("Missing authored base1 shotgun supply");
    expect(supply.preview.ammo.some(receipt => receipt.item === "q1:ammo/shells" && receipt.given > 0)).toBe(true);
    const start = { x: 896, y: -96, z: -166.96875 };
    source.players.teleportPlayer(nativeBot, source.game, start, { x: 0, y: 180, z: 0 });
    let choseGoal = false;
    for (let frame = 0; frame < 60; frame++) {
      await application.step(100);
      if (transport.director.library.goals.getTopGoal(bot.state.gs)?.entity === supply.entity) choseGoal = true;
      if (pickups.inspect(bot.sourceClient, supply.observation.actor)?.observation.availability.kind === "respawning") break;
    }
    expect(choseGoal).toBe(true);
    expect(pickups.inspect(bot.sourceClient, supply.observation.actor)?.observation.availability.kind).toBe("respawning");
    for (const receipt of [...supply.preview.weapons, ...supply.preview.ammo]) expect(world.inventory.count(bot.actor.id, receipt.item)).toBe(receipt.before + receipt.given);
    expect(world.inventory.count(bot.actor.id, "q2:weapon_shotgun")).toBe(0);
    world.inventory.give(bot.actor, "q2:item_quad", 1);
    expect(source.items.use(bot.actor, "q2:item_quad", source.game)).toBe(true);
    transport.game.knowledge.updateInventory(bot.state);
    expect(bot.state.inventory[BotInventory.QUAD]).toBe(1);
    world.inventory.give(bot.actor, "q2:item_enviro", 1);
    expect(source.items.use(bot.actor, "q2:item_enviro", source.game)).toBe(true);
    transport.game.knowledge.updateInventory(bot.state);
    expect(bot.state.inventory[BotInventory.ENVIRONMENTSUIT]).toBe(1);
    const powerups = source.items.playerPowerups(bot.actor.id), readNow = source.game.host.now;
    try {
      source.game.host.now = () => Math.min(powerups.quadUntil, powerups.enviroUntil) - 0.001;
      transport.game.knowledge.updateInventory(bot.state);
      expect(bot.state.inventory[BotInventory.QUAD]).toBe(1);
      expect(bot.state.inventory[BotInventory.ENVIRONMENTSUIT]).toBe(1);
      source.game.host.now = () => Math.max(powerups.quadUntil, powerups.enviroUntil);
      transport.game.knowledge.updateInventory(bot.state);
      expect(bot.state.inventory[BotInventory.QUAD]).toBe(0);
      expect(bot.state.inventory[BotInventory.ENVIRONMENTSUIT]).toBe(0);
    } finally { source.game.host.now = readNow; }
    await application.step(100);
    world.inventory.give(bot.actor, "q2:item_breather", 1);
    expect(source.items.use(bot.actor, "q2:item_breather", source.game)).toBe(true);
    transport.game.knowledge.updateInventory(bot.state);
    expect(bot.state.inventory[BotInventory.ENVIRONMENTSUIT]).toBe(1);
    const breathing = source.items.playerPowerups(bot.actor.id);
    try {
      source.game.host.now = () => breathing.enviroUntil;
      transport.game.knowledge.updateInventory(bot.state);
      expect(bot.state.inventory[BotInventory.ENVIRONMENTSUIT]).toBe(1);
      source.game.host.now = () => breathing.breatherUntil;
      transport.game.knowledge.updateInventory(bot.state);
      expect(bot.state.inventory[BotInventory.ENVIRONMENTSUIT]).toBe(0);
    } finally { source.game.host.now = readNow; }
    const humanClient = application.session.createClient(1), human = world.admitPlayer(humanClient.id), nativeHuman = source.game.entity(human.actor);
    if (nativeHuman === null) throw new Error("Missing actual target");
    source.players.teleportPlayer(nativeBot, source.game, start, { x: 0, y: 180, z: 0 });
    source.players.teleportPlayer(nativeHuman, source.game, { x: 800, y: -96, z: start.z }, { x: 0, y: 0, z: 0 });
    world.combat.setHealth(nativeHuman.actor, 1000);
    expect(arsenal.game.selectWeapon(bot.actor, "axe")).toBe(true);
    const shells = world.inventory.count(bot.actor.id, "q1:ammo/shells");
    let attacked = false;
    for (let frame = 0; frame < 60; frame++) {
      await application.step(100);
      if (((world.movementPlayer(bot.actor.id)?.buttons ?? 0) & 1) !== 0) attacked = true;
      if ((world.combat.read(human.actor)?.health ?? 1000) < 1000) break;
    }
    expect(attacked).toBe(true);
    expect(arsenal.game.player(bot.actor.id)?.weapon).toBe("shotgun");
    expect(world.inventory.count(bot.actor.id, "q1:ammo/shells")).toBeLessThan(shells);
    expect(world.combat.read(human.actor)?.health).toBeLessThan(1000);
  } finally { await application.close(); }
}, 120000);

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
    const mapPlayer = source.game.player(actor), transport = transports[0];
    if (mapPlayer === null || transport === undefined) throw new Error("Missing map-owned Q1 powerup recipient");
    source.game.givePowerup(mapPlayer, "quad", 0.25); source.game.givePowerup(mapPlayer, "suit", 0.25);
    transport.game.knowledge.updateInventory(brain);
    expect(brain.inventory[BotInventory.QUAD]).toBe(1);
    expect(brain.inventory[BotInventory.ENVIRONMENTSUIT]).toBe(1);
    const sourceTime = source.game.time, expires = source.game.powerupExpires(actor, "quad");
    try {
      source.game.time = expires - 0.001;
      transport.game.knowledge.updateInventory(brain);
      expect(brain.inventory[BotInventory.QUAD]).toBe(1);
      expect(brain.inventory[BotInventory.ENVIRONMENTSUIT]).toBe(1);
      source.game.time = expires;
      transport.game.knowledge.updateInventory(brain);
      expect(brain.inventory[BotInventory.QUAD]).toBe(0);
      expect(brain.inventory[BotInventory.ENVIRONMENTSUIT]).toBe(0);
    } finally { source.game.time = sourceTime; }
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

retail("Q1 map bots collect mapped Q3 weapons and fire through the selected arsenal", async () => {
  const launch = parseApplicationCommand(["--content-root", corpus, "--game", "q1-rerelease-id1", "--map", "dm4",
    "--movement", "q1", "--character", "q2", "--mode", "deathmatch", "--dedicated"]);
  if (launch.kind !== "run") throw new Error("Expected Q1 launch");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false }), preset = applicationPreset(catalog, launch.options);
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: "selected", value: [
    { provider: "q3:official", content: catalog.require("q3-baseq3").id },
  ] } } });
  const application = await Application.open(launch.options, { print: () => undefined }, recipe);
  try {
    const captured: ApplicationBots[] = [], services = application.simulation.botServices, attach = services.attach.bind(services);
    services.attach = (director, transport) => { captured.push(transport); attach(director, transport); };
    application.queueCommand("addbot", ["Sarge", "5"], null); await application.step(100);
    const transport = captured[0], bot = transport?.director.roster()[0];
    if (transport === undefined || bot === undefined) throw new Error("Missing selected Q3 bot");
    const world = application.simulation, source = world.q1Source(), arsenal = world.selectedQ3WeaponSource();
    if (source === null || arsenal === null) throw new Error("Missing actual Q1 map or Q3 arsenal");
    expect(world.q3Source()).toBeNull(); expect(world.q1WeaponSource()).toBeNull();
    expect(arsenal.has(bot.actor.id)).toBe(true);
    for (let frame = 0; frame < 50; frame++) await application.step(100);
    const pickups = transport.game.pickups;
    if (pickups === null) throw new Error("Missing map-owned supply observations");
    const supply = pickups.candidates(bot.sourceClient).find(item => item.name === "weapon_rocketlauncher");
    if (supply === undefined) throw new Error("Missing authored dm4 rocket launcher");
    expect(supply.preview.weapons.some(receipt => receipt.item === "q3:weapon/rocketlauncher" && receipt.given > 0)).toBe(true);
    const start = { x: 12.117749006091444, y: 131.88225099390857, z: -294.96875 };
    source.composition.services.teleport(bot.actor.id, start, { x: 0, y: 315, z: 0 }, { x: 0, y: 0, z: 0 }, world.timeSeconds);
    let selectedGoal = false;
    for (let frame = 0; frame < 60; frame++) {
      await application.step(100);
      const goal = transport.director.library.goals.getTopGoal(bot.state.gs);
      if (goal?.entity === supply.entity && goal.number >= 0x40000000) selectedGoal = true;
      if (pickups.inspect(bot.sourceClient, supply.observation.actor)?.observation.availability.kind === "respawning") break;
    }
    expect(selectedGoal).toBe(true);
    expect(pickups.inspect(bot.sourceClient, supply.observation.actor)?.observation.availability.kind).toBe("respawning");
    for (const receipt of [...supply.preview.weapons, ...supply.preview.ammo]) expect(world.inventory.count(bot.actor.id, receipt.item)).toBe(receipt.before + receipt.given);
    expect(world.inventory.count(bot.actor.id, "q1:weapon/rocketlauncher")).toBe(0);
    const humanClient = application.session.createClient(1), human = world.admitPlayer(humanClient.id);
    source.composition.services.teleport(bot.actor.id, start, { x: 0, y: 315, z: 0 }, { x: 0, y: 0, z: 0 }, world.timeSeconds);
    source.composition.services.teleport(human.actor, { x: 80, y: 64, z: start.z }, { x: 0, y: 135, z: 0 }, { x: 0, y: 0, z: 0 }, world.timeSeconds);
    for (const ammo of ["q3:ammo/machinegun", "q3:ammo/shotgun"] satisfies readonly import("../../../src/contracts/gameplay.ts").ItemId[]) world.inventory.consume(bot.actor, ammo, world.inventory.count(bot.actor.id, ammo));
    const rockets = world.inventory.count(bot.actor.id, "q3:ammo/rocketlauncher");
    let rocketIntent = false, rocketHit = false;
    const frameCommands = transport.frame.bind(transport);
    transport.frame = (time, elapsed) => {
      const commands = frameCommands(time, elapsed);
      if (commands.some(command => command.arsenal?.weapon === "q3:weapon/rocketlauncher")) rocketIntent = true;
      return commands;
    };
    for (let frame = 0; frame < 60; frame++) {
      const output = await application.step(100);
      for (const event of output.events) if (event.payload.kind === "damage" && event.payload.outcome.kind === "committed") {
        const decision = event.payload.outcome.decision, attack = decision.request.attack;
        if (decision.request.target.equals(human.actor) && attack.attacker?.equals(bot.actor.id) === true && decision.appliedDamage > 0
          && attack.weapon === "q3:weapon/rocketlauncher" && attack.cause.kind === "q3") rocketHit = true;
      }
      if (rocketHit) break;
    }
    expect(rocketIntent).toBe(true); expect(rocketHit).toBe(true);
    expect(world.inventory.count(bot.actor.id, "q3:ammo/rocketlauncher")).toBeLessThan(rockets);
    expect(arsenal.read(bot.actor.id).activeWeapon).toBe("q3:weapon/rocketlauncher");
    expect(world.combat.read(human.actor)?.health).toBeLessThan(100);
  } finally { await application.close(); }
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

retail("Q3 map bots pursue mapped Q1 supplies and fire the actual selected arsenal", async () => {
  const launch = parseApplicationCommand(["--content-root", corpus, "--game", "q3-baseq3", "--map", "q3dm1",
    "--movement", "q3", "--character", "q3", "--mode", "deathmatch", "--dedicated"]);
  if (launch.kind !== "run") throw new Error("Expected Q3 launch");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false }), preset = applicationPreset(catalog, launch.options);
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: "selected", value: [
    { provider: "q1:official", content: catalog.require("q1-classic-id1").id },
  ] } } });
  const captured: ApplicationBots[] = [], attach = SimulationBotServices.prototype.attach;
  SimulationBotServices.prototype.attach = function (director, transport) { captured.push(transport); attach.call(this, director, transport); };
  const application = await Application.open(launch.options, { print: () => undefined }, recipe).finally(() => { SimulationBotServices.prototype.attach = attach; });
  try {
    application.queueCommand("addbot", ["Sarge", "5"], null); await application.step(100);
    const transport = captured[0], bot = transport?.director.roster()[0];
    if (transport === undefined || bot === undefined) throw new Error("Missing selected Q1 bot on Q3");
    const world = application.simulation, source = world.q3Source(), arsenal = world.q1WeaponSource();
    if (source === null || arsenal === null) throw new Error("Missing actual Q3 map or Q1 arsenal");
    const native = source.records.nativeByActor(bot.actor.id), pickups = transport.game.pickups;
    if (native?.client == null || pickups === null) throw new Error("Missing actual source client or pickups");
    for (let frame = 0; frame < 50; frame++) await application.step(100);
    const supply = pickups.candidates(bot.sourceClient).find(item => item.name === "weapon_shotgun");
    if (supply === undefined) throw new Error("Missing authored shotgun");
    expect(pickups.ownsItemGoal?.(bot.sourceClient, supply.entity)).toBe(true);
    const center = { x: supply.origin.x, y: supply.origin.y, z: supply.origin.z + 24 };
    let start: typeof center | null = null;
    for (const offset of [{ x: 96, y: 0 }, { x: -96, y: 0 }, { x: 0, y: 96 }, { x: 0, y: -96 }]) {
      const candidate = { x: center.x + offset.x, y: center.y + offset.y, z: center.z };
      const shape = { kind: "box", mins: native.r.mins, maxs: native.r.maxs } satisfies Parameters<typeof source.world.trace>[0]["shape"];
      const lane = source.world.trace({ start: candidate, end: center, shape, passEntityNum: native.s.number, mask: 0x2010001 });
      const support = source.world.trace({ start: candidate, end: { ...candidate, z: candidate.z - 48 }, shape, passEntityNum: native.s.number, mask: 0x2010001 });
      if (lane.solidity === "clear" && lane.fraction === 1 && support.solidity === "clear" && support.fraction < 1) { start = candidate; break; }
    }
    if (start === null) throw new Error("Authored shotgun has no supported approach lane");
    teleportPlayer({ combat: source.combat, world: source.world }, native, start, { x: 0, y: Math.atan2(center.y - start.y, center.x - start.x) * 180 / Math.PI, z: 0 });
    native.client.ps.velocity = { x: 0, y: 0, z: 0 }; source.world.link(native);
    const nativeAmmo = native.client.ps.ammo.get(3);
    expect(transport.game.entity(bot.sourceClient).player?.state).not.toBe(native.client.ps);
    const frameCommands = transport.frame.bind(transport);
    let checkedCommands = 0, selectedShotgun = false;
    transport.frame = (time, elapsed) => {
      const commands = frameCommands(time, elapsed);
      for (const command of commands) if (command.command.kind === "q3") {
        if (command.arsenal?.weapon === "q1:weapon/supershotgun") selectedShotgun = true;
        const client = source.records.nativeByActor(command.actor)?.client;
        if (client == null) throw new Error("Command has no live native source player");
        if (command.command.weapon !== client.ps.weapon) throw new Error("Foreign decision weapon escaped into native transport");
        checkedCommands++;
      }
      return commands;
    };
    let chose = false;
    for (let frame = 0; frame < 60; frame++) {
      await application.step(100);
      const goal = transport.director.library.goals.getTopGoal(bot.state.gs);
      if (goal?.entity === supply.entity && goal.number >= 0x40000000) chose = true;
      if (pickups.inspect(bot.sourceClient, supply.observation.actor)?.observation.availability.kind === "respawning") break;
    }
    expect(chose).toBe(true);
    expect(pickups.inspect(bot.sourceClient, supply.observation.actor)?.observation.availability.kind).toBe("respawning");
    for (const receipt of [...supply.preview.weapons, ...supply.preview.ammo]) expect(world.inventory.count(bot.actor.id, receipt.item)).toBe(receipt.before + receipt.given);
    expect(world.inventory.count(bot.actor.id, "q1:weapon/supershotgun")).toBe(1);
    expect(world.inventory.count(bot.actor.id, "q1:ammo/shells")).toBeGreaterThan(0);
    expect(native.client.ps.ammo.get(3)).toBe(nativeAmmo);
    const humanClient = application.session.createClient(1), human = world.admitPlayer(humanClient.id), target = source.records.nativeByActor(human.actor);
    if (target?.client == null) throw new Error("Missing real human target");
    teleportPlayer({ combat: source.combat, world: source.world }, native, start, { x: 0, y: Math.atan2(center.y - start.y, center.x - start.x) * 180 / Math.PI, z: 0 });
    native.client.ps.velocity = { x: 0, y: 0, z: 0 }; source.world.link(native);
    teleportPlayer({ combat: source.combat, world: source.world }, target, center, { x: 0, y: 0, z: 0 });
    target.client.ps.velocity = { x: 0, y: 0, z: 0 }; source.world.link(target);
    world.combat.setHealth(target.actor, 100);
    // Empty competing ammunition so this encounter tests the acquired shotgun.
    for (const ammo of ["q1:ammo/nails", "q1:ammo/rockets", "q1:ammo/cells"] satisfies readonly import("../../../src/contracts/gameplay.ts").ItemId[]) world.inventory.consume(bot.actor, ammo, world.inventory.count(bot.actor.id, ammo));
    let shotgunHit = false;
    const hitsBefore = native.client.ps.persistant.get(PersistentIndex.PERS_HITS);
    expect(transport.game.entity(1).player?.state.weapon).toBeGreaterThan(0);
    expect(transport.game.entity(1).player?.state.weapon).not.toBe(target.client.ps.weapon);
    const shells = world.inventory.count(bot.actor.id, "q1:ammo/shells");
    for (let frame = 0; frame < 60; frame++) {
      const output = await application.step(100);
      for (const event of output.events) if (event.payload.kind === "damage" && event.payload.outcome.kind === "committed") {
        const decision = event.payload.outcome.decision, attack = decision.request.attack;
        if (decision.request.target.equals(human.actor) && attack.attacker?.equals(bot.actor.id) === true && decision.appliedDamage > 0
          && attack.weapon === "q1:weapon/supershotgun" && attack.cause.kind === "q1") shotgunHit = true;
      }
      if (shotgunHit) break;
    }
    expect(world.combat.read(human.actor)?.health).toBeLessThan(100);
    expect(shotgunHit).toBe(true);
    expect(native.client.ps.persistant.get(PersistentIndex.PERS_HITS)).toBeGreaterThan(hitsBefore);
    expect(target.client.lastHurtClient).toBe(bot.sourceClient);
    expect(target.client.lastHurtMod).toBe(0);
    expect(world.inventory.count(bot.actor.id, "q1:ammo/shells")).toBeLessThan(shells);
    expect(selectedShotgun).toBe(true);
    const firedWeapon = arsenal.game.player(bot.actor.id)?.weapon;
    if (firedWeapon == null) throw new Error("Bot lost its actual firing weapon");
    expect(firedWeapon).toBe("supershotgun");
    expect(native.client.ps.weapon).toBeLessThan(11);
    expect(checkedCommands).toBeGreaterThan(0);
    const schema = statSchema("baseq3");
    native.client.ps.stats.set(schema.holdableItem, BotModelIndex.MEDKIT);
    world.combat.setHealth(bot.actor, 30);
    for (let frame = 0; frame < 20 && native.client.ps.stats.get(schema.holdableItem) !== 0; frame++) await application.step(100);
    expect(native.client.ps.stats.get(schema.holdableItem)).toBe(0);
    expect(world.combat.read(bot.actor.id)?.health).toBe(native.client.ps.stats.get(schema.maxHealth) + 25);
  } finally { await application.close(); }
}, 120000);

retail("Q2 map bots collect mapped Q3 weapons and fire through the selected arsenal", async () => {
  const launch = parseApplicationCommand(["--content-root", corpus, "--game", "q2-rerelease-baseq2", "--map", "base1",
    "--movement", "q2", "--character", "q2", "--mode", "deathmatch", "--dedicated"]);
  if (launch.kind !== "run") throw new Error("Expected Q2 launch");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false }), preset = applicationPreset(catalog, launch.options);
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: "selected", value: [
    { provider: "q3:official", content: catalog.require("q3-baseq3").id },
  ] } } });
  const application = await Application.open(launch.options, { print: () => undefined }, recipe);
  try {
    const captured: ApplicationBots[] = [], services = application.simulation.botServices, attach = services.attach.bind(services);
    services.attach = (director, transport) => { captured.push(transport); attach(director, transport); };
    application.queueCommand("addbot", ["Sarge", "5"], null); await application.step(100);
    const transport = captured[0], bot = transport?.director.roster()[0];
    if (transport === undefined || bot === undefined) throw new Error("Missing selected Q3 bot");
    const world = application.simulation, source = world.q2Source(), arsenal = world.selectedQ3WeaponSource();
    if (source === null || arsenal === null) throw new Error("Missing actual Q2 map or Q3 arsenal");
    expect(world.q3Source()).toBeNull(); expect(world.q2WeaponSource()).toBeNull();
    expect(arsenal.has(bot.actor.id)).toBe(true);
    for (let frame = 0; frame < 50; frame++) await application.step(100);
    const pickups = transport.game.pickups;
    if (pickups === null) throw new Error("Missing map-owned supply observations");
    const supply = pickups.candidates(bot.sourceClient).find(item => item.name === "weapon_shotgun");
    if (supply === undefined) throw new Error("Missing authored base1 shotgun");
    expect(supply.preview.weapons.some(receipt => receipt.item === "q3:weapon/shotgun" && receipt.given > 0)).toBe(true);
    const start = { x: 896, y: -96, z: -166.96875 };
    const nativeBot = source.game.entity(bot.actor.id);
    if (nativeBot === null) throw new Error("Missing map-owned bot");
    source.players.teleportPlayer(nativeBot, source.game, start, { x: 0, y: 180, z: 0 });
    let selectedGoal = false;
    for (let frame = 0; frame < 60; frame++) {
      await application.step(100);
      const goal = transport.director.library.goals.getTopGoal(bot.state.gs);
      if (goal?.entity === supply.entity && goal.number >= 0x40000000) selectedGoal = true;
      if (pickups.inspect(bot.sourceClient, supply.observation.actor)?.observation.availability.kind === "respawning") break;
    }
    expect(selectedGoal).toBe(true);
    expect(pickups.inspect(bot.sourceClient, supply.observation.actor)?.observation.availability.kind).toBe("respawning");
    for (const receipt of [...supply.preview.weapons, ...supply.preview.ammo]) expect(world.inventory.count(bot.actor.id, receipt.item)).toBe(receipt.before + receipt.given);
    expect(world.inventory.count(bot.actor.id, "q2:weapon_shotgun")).toBe(0);
    const humanClient = application.session.createClient(1), human = world.admitPlayer(humanClient.id);
    source.players.teleportPlayer(nativeBot, source.game, start, { x: 0, y: 180, z: 0 });
    const nativeHuman = source.game.entity(human.actor);
    if (nativeHuman === null) throw new Error("Missing map-owned target");
    source.players.teleportPlayer(nativeHuman, source.game, { x: 800, y: -96, z: start.z }, { x: 0, y: 0, z: 0 });
    world.combat.setHealth(nativeHuman.actor, 100);
    // Empty starter ammunition so this encounter tests the acquired shotgun.
    world.inventory.consume(bot.actor, "q3:ammo/machinegun", world.inventory.count(bot.actor.id, "q3:ammo/machinegun"));
    const shells = world.inventory.count(bot.actor.id, "q3:ammo/shotgun");
    let shotgunIntent = false, shotgunHit = false;
    const frameCommands = transport.frame.bind(transport);
    transport.frame = (time, elapsed) => {
      const commands = frameCommands(time, elapsed);
      if (commands.some(command => command.arsenal?.weapon === "q3:weapon/shotgun")) shotgunIntent = true;
      return commands;
    };
    for (let frame = 0; frame < 60; frame++) {
      const output = await application.step(100);
      for (const event of output.events) if (event.payload.kind === "damage" && event.payload.outcome.kind === "committed") {
        const decision = event.payload.outcome.decision, attack = decision.request.attack;
        if (decision.request.target.equals(human.actor) && attack.attacker?.equals(bot.actor.id) === true && decision.appliedDamage > 0
          && attack.weapon === "q3:weapon/shotgun" && attack.cause.kind === "q3") shotgunHit = true;
      }
      if (shotgunHit) break;
    }
    expect(shotgunIntent).toBe(true); expect(shotgunHit).toBe(true);
    expect(world.inventory.count(bot.actor.id, "q3:ammo/shotgun")).toBeLessThan(shells);
    expect(arsenal.read(bot.actor.id).activeWeapon).toBe("q3:weapon/shotgun");
    expect(world.combat.read(human.actor)?.health).toBeLessThan(100);
  } finally { await application.close(); }
}, 120000);
