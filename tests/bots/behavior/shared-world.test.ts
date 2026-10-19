import { statSchema, PersistentIndex } from "../../../src/content/q3/base/shared/definitions.ts";
import { testCorpusRoot } from "../../support/corpus.ts";

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
import { BotModelIndex } from "../../../src/bots/behavior/q3/ai-definitions.ts";

const corpus = testCorpusRoot();
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
    // The roam may have looted stronger Q2 weapons; drain every other ammo
    // type so the authored shotgun is the arsenal's only stocked choice.
    for (const ammo of ["q2:ammo_bullets", "q2:ammo_rockets", "q2:ammo_cells", "q2:ammo_grenades", "q2:ammo_slugs", "q2:ammo_flechettes", "q2:ammo_disruptor"] as const)
      world.inventory.consume(bot.actor, ammo, world.inventory.count(bot.actor.id, ammo));
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
    // Overheal decays back toward max health; the exact value depends on
    // which frame phase consumed the medkit.
    const overhealed = world.combat.read(bot.actor.id)?.health ?? 0, maxHealth = native.client.ps.stats.get(schema.maxHealth);
    expect(overhealed).toBeGreaterThan(maxHealth);
    expect(overhealed).toBeLessThanOrEqual(maxHealth + 25);
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
    application.queueCommand("addbot", ["Ranger", "5"], null); await application.step(100);
    const botClient = application.botClients[0];
    const botActor = botClient === undefined ? null : application.simulation.players().find(actor => application.simulation.movementPlayer(actor)?.client.equals(botClient.client.id)) ?? null;
    if (botClient === undefined || botActor === null) throw new Error("Missing selected Q1 bot");
    const world = application.simulation, source = world.q2Source(), arsenal = world.q1WeaponSource();
    if (source === null || arsenal === null) throw new Error("Missing independent map and weapon sources");
    const ownedBot = source.game.entity(botActor); if (ownedBot === null) throw new Error("Missing owned bot actor");
    const bot = { actor: ownedBot.actor };
    expect(world.q1Source()).toBeNull(); expect(world.q2WeaponSource()).toBeNull();
    expect(arsenal.game.entity(bot.actor.id)).toBeNull();
    expect(arsenal.game.player(bot.actor.id)?.actor.id.equals(bot.actor.id)).toBe(true);
    expect(world.botServices.isBot(bot.actor.id)).toBe(true);
    for (let frame = 0; frame < 50; frame++) await application.step(100);
    const nativeBot = source.game.entity(bot.actor.id);
    if (nativeBot === null) throw new Error("Missing source-owned bot");
    const supply = [...source.game.entities.values()].find(entity => entity.classname === "weapon_shotgun");
    if (supply === undefined) throw new Error("Missing authored base1 shotgun supply");
    const start = { x: 896, y: -96, z: -166.96875 };
    const supplyOrigin = world.bodies.read(supply.actor.id)?.origin;
    if (supplyOrigin === undefined) throw new Error("Missing supply origin");
    source.players.teleportPlayer(nativeBot, source.game, { x: supplyOrigin.x, y: supplyOrigin.y, z: supplyOrigin.z + 24 }, { x: 0, y: 180, z: 0 });
    const shellsBefore = world.inventory.count(bot.actor.id, "q1:ammo/shells");
    for (let frame = 0; frame < 60 && world.inventory.count(bot.actor.id, "q1:ammo/shells") <= shellsBefore; frame++) await application.step(100);
    expect(world.inventory.count(bot.actor.id, "q1:weapon/shotgun")).toBe(1);
    expect(world.inventory.count(bot.actor.id, "q1:ammo/shells")).toBeGreaterThan(shellsBefore);
    expect(world.inventory.count(bot.actor.id, "q2:weapon_shotgun")).toBe(0);
    world.inventory.give(bot.actor, "q2:item_quad", 1);
    expect(source.items.use(bot.actor, "q2:item_quad", source.game)).toBe(true);
    world.inventory.give(bot.actor, "q2:item_enviro", 1);
    expect(source.items.use(bot.actor, "q2:item_enviro", source.game)).toBe(true);
    const powerups = source.items.playerPowerups(bot.actor.id), readNow = source.game.host.now;
    expect(powerups.quadUntil).toBeGreaterThan(readNow());
    expect(powerups.enviroUntil).toBeGreaterThan(readNow());
    await application.step(100);
    world.inventory.give(bot.actor, "q2:item_breather", 1);
    expect(source.items.use(bot.actor, "q2:item_breather", source.game)).toBe(true);
    const breathing = source.items.playerPowerups(bot.actor.id);
    expect(breathing.breatherUntil).toBeGreaterThan(breathing.enviroUntil);
    const humanClient = application.session.createClient(1), human = world.admitPlayer(humanClient.id), nativeHuman = source.game.entity(human.actor);
    if (nativeHuman === null) throw new Error("Missing actual target");
    source.players.teleportPlayer(nativeBot, source.game, start, { x: 0, y: 180, z: 0 });
    source.players.teleportPlayer(nativeHuman, source.game, { x: 800, y: -96, z: start.z }, { x: 0, y: 0, z: 0 });
    world.combat.setHealth(nativeHuman.actor, 1000);
    expect(arsenal.game.selectWeapon(bot.actor, "axe")).toBe(true);
    const shells = world.inventory.count(bot.actor.id, "q1:ammo/shells");
    let attacked = false;
    for (let frame = 0; frame < 120; frame++) {
      if (frame % 10 === 0) {
        // Keep the silent target in the bot's current view until it acquires.
        const body = world.bodies.read(bot.actor.id), view = world.movementPlayer(bot.actor.id)?.viewAngles;
        if (body !== null && view !== undefined) {
          const radians = view.y * Math.PI / 180;
          source.players.teleportPlayer(nativeHuman, source.game,
            { x: body.origin.x + Math.cos(radians) * 128, y: body.origin.y + Math.sin(radians) * 128, z: body.origin.z }, { x: 0, y: view.y + 180, z: 0 });
        }
      }
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
    // The new world owns a fresh registry, but shared bot settings carry over.
    expect(application.simulation.botServices.configuration?.variableValue("bot_thinktime")).toBe(150);
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
    // The brain resyncs its aim from the actual player view after an external
    // teleport instead of snapping back to its stale heading.
    const brainAimYaw = (): number => {
      const checkpoint = world.botServices.checkpoint();
      if (checkpoint === null || !("kind" in checkpoint.director) || checkpoint.director.kind !== "rerelease") throw new Error("Missing rerelease bot checkpoint");
      const yaw = checkpoint.director.clients[0]?.behavior.brain.memory.aim.yaw;
      if (yaw === undefined) throw new Error("Missing bot aim state");
      return yaw;
    };
    const angularDistance = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);
    expect(angularDistance(brainAimYaw(), world.movementPlayer(actor)?.viewAngles.y ?? 999)).toBeLessThan(1);
    await application.step(100);
    source.composition.requestRespawn(actor);
    const respawnView = world.movementPlayer(actor)?.viewAngles.y;
    if (respawnView === undefined) throw new Error("Missing source respawn view");
    expect(world.q2WeaponSource()?.weapons.states.get(actor)?.phase).toBe("activating");
    await application.step(100);
    expect(angularDistance(brainAimYaw(), world.movementPlayer(actor)?.viewAngles.y ?? 999)).toBeLessThan(1);
    await application.step(100);
    const mapPlayer = source.game.player(actor);
    if (mapPlayer === null) throw new Error("Missing map-owned Q1 powerup recipient");
    source.game.givePowerup(mapPlayer, "quad", 0.25); source.game.givePowerup(mapPlayer, "suit", 0.25);
    const quadExpires = source.game.powerupExpires(actor, "quad"), suitExpires = source.game.powerupExpires(actor, "suit");
    expect(quadExpires).toBeGreaterThan(source.game.time);
    expect(suitExpires).toBeGreaterThan(source.game.time);
    expect(quadExpires - source.game.time).toBeCloseTo(0.25, 2);
    const configuration = world.botServices.configuration; if (configuration === null) throw new Error("Missing bot configuration");
    expect(configuration).toBe(source.cvars); configuration.set("bot_enable", "0", true);
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
    expect(application.simulation.botServices.configuration?.variableValue("bot_enable")).toBe(0);
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
    application.queueCommand("addbot", ["Sarge", "5"], null); await application.step(100);
    const botClient = application.botClients[0];
    const botActor = botClient === undefined ? undefined : application.simulation.players().find(actor => application.simulation.movementPlayer(actor)?.client.equals(botClient.client.id));
    if (botActor === undefined) throw new Error("Missing selected Q3 bot");
    const world = application.simulation, source = world.q1Source(), arsenal = world.selectedQ3WeaponSource();
    if (source === null || arsenal === null) throw new Error("Missing actual Q1 map or Q3 arsenal");
    const ownedBot = source.game.player(botActor);
    if (ownedBot === null) throw new Error("Missing owned selected Q3 bot");
    const bot = { actor: ownedBot.actor };
    expect(world.q3Source()).toBeNull(); expect(world.q1WeaponSource()).toBeNull();
    expect(arsenal.has(bot.actor.id)).toBe(true);
    for (let frame = 0; frame < 50; frame++) await application.step(100);
    const start = { x: 12.117749006091444, y: 131.88225099390857, z: -294.96875 };
    // Touch pickup at the authored dm4 rocket launcher origin: long-range
    // generated-nav item fetches are covered by the navigation suites; this
    // test's contract is the mapped grant into the selected arsenal.
    source.composition.services.teleport(bot.actor.id, { x: 80, y: 64, z: start.z }, { x: 0, y: 315, z: 0 }, { x: 0, y: 0, z: 0 }, world.timeSeconds);
    let collected = false;
    for (let frame = 0; frame < 60; frame++) {
      await application.step(100);
      if (world.inventory.count(bot.actor.id, "q3:weapon/rocketlauncher") === 1) { collected = true; break; }
    }
    expect(collected).toBe(true);
    expect(world.inventory.count(bot.actor.id, "q3:ammo/rocketlauncher")).toBeGreaterThan(0);
    expect(world.inventory.count(bot.actor.id, "q1:weapon/rocketlauncher")).toBe(0);
    const humanClient = application.session.createClient(1), human = world.admitPlayer(humanClient.id);
    // Retail weapons.txt keeps the rocket launcher out of fights under 128
    // units, so the engagement starts one lane-length farther back.
    source.composition.services.teleport(bot.actor.id, { x: -56, y: 200, z: start.z }, { x: 0, y: 315, z: 0 }, { x: 0, y: 0, z: 0 }, world.timeSeconds);
    source.composition.services.teleport(human.actor, { x: 80, y: 64, z: start.z }, { x: 0, y: 135, z: 0 }, { x: 0, y: 0, z: 0 }, world.timeSeconds);
    for (const ammo of ["q3:ammo/machinegun", "q3:ammo/shotgun"] satisfies readonly import("../../../src/contracts/gameplay.ts").ItemId[]) world.inventory.consume(bot.actor, ammo, world.inventory.count(bot.actor.id, ammo));
    const rockets = world.inventory.count(bot.actor.id, "q3:ammo/rocketlauncher");
    let rocketHit = false;
    for (let frame = 0; frame < 60; frame++) {
      const output = await application.step(100);
      for (const event of output.events) if (event.payload.kind === "damage" && event.payload.outcome.kind === "committed") {
        const decision = event.payload.outcome.decision, attack = decision.request.attack;
        if (decision.request.target.equals(human.actor) && attack.attacker?.equals(bot.actor.id) === true && decision.appliedDamage > 0
          && attack.weapon === "q3:weapon/rocketlauncher" && attack.cause.kind === "q3") rocketHit = true;
      }
      if (rocketHit) break;
    }
    expect(rocketHit).toBe(true);
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
    application.queueCommand("addbot", ["Ranger", "5"], null); await application.step(100);
    const botClient = application.botClients[0];
    const botActor = botClient === undefined ? undefined : application.simulation.players().find(actor => application.simulation.movementPlayer(actor)?.client.equals(botClient.client.id));
    if (botClient === undefined || botActor === undefined) throw new Error("Missing native Q1 bot player");
    const world = application.simulation, source = world.q1Source();
    if (source === null) throw new Error("Missing native Q1 source");
    const ownedBot = source.game.player(botActor);
    if (ownedBot === null) throw new Error("Missing owned native Q1 bot");
    const bot = { actor: ownedBot.actor };
    expect(world.q2WeaponSource()).toBeNull();
    expect(world.weaponProvider).toEqual(world.recipe.map.entities);
    expect(world.botServices.isBot(bot.actor.id)).toBe(true);
    for (let frame = 0; frame < 50; frame++) await application.step(100);
    const start = { x: 12.117749006091444, y: 131.88225099390857, z: -294.96875 };
    // Place the actual source player in the previously checked supported 96-unit lane; all subsequent movement is bot commands.
    source.composition.services.teleport(bot.actor.id, start, { x: 0, y: 315, z: 0 }, { x: 0, y: 0, z: 0 }, world.timeSeconds);
    const rocketsBefore = world.inventory.count(bot.actor.id, "q1:ammo/rockets");
    let collected = false, pursued = false;
    for (let frame = 0; frame < 60; frame++) {
      await application.step(100);
      const body = world.bodies.read(bot.actor.id);
      if (body !== null && Math.hypot(body.origin.x - start.x, body.origin.y - start.y) > 32) pursued = true;
      if (world.inventory.count(bot.actor.id, "q1:weapon/rocketlauncher") === 1) { collected = true; break; }
    }
    expect(pursued).toBe(true); expect(collected).toBe(true);
    expect(world.inventory.count(bot.actor.id, "q1:ammo/rockets")).toBeGreaterThan(rocketsBefore);
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
    // Overheal decays back toward max health; the exact value depends on
    // which frame phase consumed the medkit.
    const overhealed = world.combat.read(bot.actor.id)?.health ?? 0, maxHealth = native.client.ps.stats.get(schema.maxHealth);
    expect(overhealed).toBeGreaterThan(maxHealth);
    expect(overhealed).toBeLessThanOrEqual(maxHealth + 25);
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
    application.queueCommand("addbot", ["Sarge", "5"], null); await application.step(100);
    const botClient = application.botClients[0];
    const botActor = botClient === undefined ? undefined : application.simulation.players().find(actor => application.simulation.movementPlayer(actor)?.client.equals(botClient.client.id));
    if (botActor === undefined) throw new Error("Missing selected Q3 bot");
    const world = application.simulation, source = world.q2Source(), arsenal = world.selectedQ3WeaponSource();
    if (source === null || arsenal === null) throw new Error("Missing actual Q2 map or Q3 arsenal");
    const nativeBot = source.game.entity(botActor);
    if (nativeBot === null) throw new Error("Missing map-owned bot");
    const bot = { actor: nativeBot.actor };
    expect(world.q3Source()).toBeNull(); expect(world.q2WeaponSource()).toBeNull();
    expect(arsenal.has(bot.actor.id)).toBe(true);
    for (let frame = 0; frame < 50; frame++) await application.step(100);
    const supply = [...source.game.entities.values()].find(entity => entity.classname === "weapon_shotgun");
    if (supply === undefined) throw new Error("Missing authored base1 shotgun");
    const start = { x: 896, y: -96, z: -166.96875 };
    // Touch pickup at the authored supply, as in the Q1-arsenal sibling test.
    const supplyOrigin = world.bodies.read(supply.actor.id)?.origin;
    if (supplyOrigin === undefined) throw new Error("Missing supply origin");
    source.players.teleportPlayer(nativeBot, source.game, { x: supplyOrigin.x, y: supplyOrigin.y, z: supplyOrigin.z + 24 }, { x: 0, y: 180, z: 0 });
    let collected = false;
    for (let frame = 0; frame < 60; frame++) {
      await application.step(100);
      if (world.inventory.count(bot.actor.id, "q3:weapon/shotgun") === 1) { collected = true; break; }
    }
    expect(collected).toBe(true);
    expect(world.inventory.count(bot.actor.id, "q3:ammo/shotgun")).toBeGreaterThan(0);
    expect(world.inventory.count(bot.actor.id, "q2:weapon_shotgun")).toBe(0);
    const humanClient = application.session.createClient(1), human = world.admitPlayer(humanClient.id);
    source.players.teleportPlayer(nativeBot, source.game, start, { x: 0, y: 180, z: 0 });
    const nativeHuman = source.game.entity(human.actor);
    if (nativeHuman === null) throw new Error("Missing map-owned target");
    source.players.teleportPlayer(nativeHuman, source.game, { x: 800, y: -96, z: start.z }, { x: 0, y: 0, z: 0 });
    world.combat.setHealth(nativeHuman.actor, 100);
    // Empty every other ammunition type so this encounter tests the shotgun.
    for (const ammo of ["q3:ammo/machinegun", "q3:ammo/rocketlauncher", "q3:ammo/lightning", "q3:ammo/railgun", "q3:ammo/plasmagun", "q3:ammo/grenadelauncher", "q3:ammo/bfg"] as const)
      world.inventory.consume(bot.actor, ammo, world.inventory.count(bot.actor.id, ammo));
    const shells = world.inventory.count(bot.actor.id, "q3:ammo/shotgun");
    let shotgunHit = false;
    for (let frame = 0; frame < 60; frame++) {
      const output = await application.step(100);
      for (const event of output.events) if (event.payload.kind === "damage" && event.payload.outcome.kind === "committed") {
        const decision = event.payload.outcome.decision, attack = decision.request.attack;
        if (decision.request.target.equals(human.actor) && attack.attacker?.equals(bot.actor.id) === true && decision.appliedDamage > 0
          && attack.weapon === "q3:weapon/shotgun" && attack.cause.kind === "q3") shotgunHit = true;
      }
      if (shotgunHit) break;
    }
    expect(shotgunHit).toBe(true);
    expect(world.inventory.count(bot.actor.id, "q3:ammo/shotgun")).toBeLessThan(shells);
    expect(arsenal.read(bot.actor.id).activeWeapon).toBe("q3:weapon/shotgun");
    expect(world.combat.read(human.actor)?.health).toBeLessThan(100);
  } finally { await application.close(); }
}, 120000);
