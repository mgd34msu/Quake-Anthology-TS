import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { createContentDigest } from "../../../src/contracts/content.ts";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { SharedSimulation } from "../../../src/app/bootstrap/simulation/runtime.ts";
import { ApplicationBots } from "../../../src/app/bootstrap/simulation/bots.ts";
import { loadMountedBotAssetFiles } from "../../../src/bots/behavior/index.ts";
import { NavigationRuntime, navigationFromAsset, parseAas } from "../../../src/bots/navigation/index.ts";
import { openArchive } from "../../../src/content/archive/index.ts";
import { ConnectionState } from "../../../src/content/q3/base/game/state.ts";
import { EngineSession } from "../../../src/world/session/session.ts";
import { tokenizeCommand } from "../../../src/core/commands/text.ts";
import { navigationWorld, profile } from "../navigation/prediction.ts";
import { BotCharacteristic } from "../../../src/bots/behavior/q3/ai-definitions.ts";
import { arenaPrediction } from "./arena-prediction.ts";

const corpus = resolve(import.meta.dir, "../../../../qfiles");

test.skipIf(!existsSync(resolve(corpus, "q3a/baseq3/pak0.pk3")))("retail arena roster and source bot brain produce shared player movement and combat", async () => {
  const launch = parseApplicationCommand(["--content-root", corpus, "--game", "q3-baseq3", "--map", "q3dm1",
    "--movement", "q3", "--character", "q3", "--mode", "singleplayer"]);
  if (launch.kind !== "run") throw new Error("Expected arena launch options");
  const content = await loadApplicationContent(launch.options), identity = createIdentityOwner("bot-arena");
  const simulation = new SharedSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
    mode: "singleplayer", skill: 3, seed: 7, maxClients: 4 });
  const session = new EngineSession(identity, { kind: "headless" });
  session.attachWorld(simulation);
  const humanClient = session.createClient(0), human = simulation.admitPlayer(humanClient.id);
  const game = simulation.q3Source();
  if (game === null) throw new Error("Real map did not create the Q3 source provider");
  const archive = await openArchive(resolve(corpus, "q3a/baseq3/pak0.pk3"));
  let bots: ApplicationBots | null = null;
  try {
    const files = await loadMountedBotAssetFiles(await content.forContent(content.recipe.map.entities.content), content.catalog);
    const navEntry = archive.findEntries("maps/q3dm1.aas")[0];
    if (navEntry === undefined) throw new Error("Retail arena navigation missing");
    const asset = parseAas(await archive.readEntry(navEntry)), world = navigationWorld(simulation.scene);
    const graph = navigationFromAsset({ name: "q3dm1", format: "q3-bsp", digest: createContentDigest("0".repeat(64)) }, asset, profile, world);
    const navigation = new NavigationRuntime(graph, world), consoleCommands: string[] = [], messages: string[] = [];
    const clientNavigation = new Map<number, NavigationRuntime>();
    const forClient = (client: number): NavigationRuntime => {
      let runtime = clientNavigation.get(client);
      if (runtime !== undefined) return runtime;
      const passActor = game.pool.at(client).actor.id, scene = simulation.scene;
      const queries = { trace: (query: Parameters<typeof scene.trace>[0]) => scene.trace({ ...query, passActor }),
        pointContents: (query: Parameters<typeof scene.pointContents>[0]) => scene.pointContents({ ...query, passActor }),
        boxLeaves: scene.boxLeaves.bind(scene), areasConnected: scene.areasConnected.bind(scene), clusterVisible: scene.clusterVisible.bind(scene) };
      runtime = new NavigationRuntime(graph, { ...navigationWorld(queries), passActor });
      clientNavigation.set(client, runtime);
      return runtime;
    };
    // Ranger must be skilled enough to aim while retreating with his starting machinegun.
    game.host.cvars.set("g_spSkill", "3", true);
    game.host.cvars.set("bot_nochat", "1", true);
    game.host.cvars.set("bot_challenge", "1", true);
    bots = new ApplicationBots({ session, simulation, files, leafCount: content.world.leaves.length,
      insertConsoleCommand: text => { consoleCommands.push(text); }, print: text => { messages.push(text); },
      openLog: () => ({ kind: "failed", error: new Error("Arena check did not enable source logging") }),
      navigation: { runtime: navigation, forClient,
        crouchedBounds: { min: { x: -15, y: -15, z: -24 }, max: { x: 15, y: 15, z: 16 } },
        predictClientMovement: query => arenaPrediction(simulation, query),
        travelWeapon: (_client, mode) => mode === "rocket-jump" ? 5 : mode === "bfg-jump" ? 9 : 10 } });
    const roster = bots.director.arenaRoster("q3dm1");
    expect(roster.map(bot => bot.name)).toEqual(["ranger"]);
    expect(consoleCommands.some(command => command.startsWith("addbot ranger 3.000000 free 2000"))).toBe(true);
    for (const command of consoleCommands.splice(0)) bots.consoleCommand(tokenizeCommand(command, "q3").argv);
    const botClient = bots.clients()[0];
    if (botClient === undefined) throw new Error("Authored arena bot did not allocate a real session client");
    const botActor = bots.actor(botClient.client.id);
    if (botActor === null) throw new Error("Authored bot has no canonical actor");
    const entity = game.pool.at(1), player = entity.client;
    if (player === null) throw new Error("Bot actor source player state missing");
    const brain = bots.director.roster()[0]?.state;
    if (brain === undefined) throw new Error("Authored bot has no source brain");
    expect(bots.director.library.characters.boundedFloat(brain.character, BotCharacteristic.ATTACK_SKILL, 0, 1)).toBeGreaterThan(0.3);
    expect(player.pers.connected).toBe(ConnectionState.CONNECTING);
    expect(game.world.linkState(1)).toBeUndefined();
    for (let frame = 1; frame <= 42; frame++) {
      session.step({ elapsedMilliseconds: 50, commands: bots.frame(frame * 50, 50) });
      bots.receive(simulation.drainPresentationEvents());
    }
    expect(player.pers.connected).toBe(ConnectionState.CONNECTED);
    const initial = { ...player.ps.origin };
    const selected = simulation.movementPlayer(entity.actor.id);
    if (selected === null || selected.state.kind !== "q3") throw new Error("Bot lost its selected movement state");
    expect(player.ps.origin).toEqual(selected.state.origin);
    expect(simulation.bodies.read(entity.actor.id)?.origin).toEqual(selected.state.origin);
    expect(simulation.bodies.linked(entity.actor.id)?.state.origin).toEqual(entity.s.pos.base);
    expect(game.world.trace({ start: initial, end: initial,
      shape: { kind: "box", mins: entity.r.mins, maxs: entity.r.maxs }, passEntityNum: 1, mask: 0x2010001 }).solidity).toBe("clear");
    const target = game.pool.at(0), targetPlayer = target.client;
    if (targetPlayer === null) throw new Error("Human source player state missing");
    let placed = false;
    for (const displacement of [{ x: 100, y: 0 }, { x: -100, y: 0 }, { x: 0, y: 100 }, { x: 0, y: -100 }]) {
      const end = { x: initial.x + displacement.x, y: initial.y + displacement.y, z: initial.z };
      const trace = game.world.trace({ start: initial, end, shape: { kind: "box", mins: entity.r.mins, maxs: entity.r.maxs }, passEntityNum: 1, mask: 0x2010001 });
      if (trace.fraction !== 1 || trace.solidity !== "clear") continue;
      targetPlayer.ps.origin = end; game.world.link(target); placed = true; break;
    }
    expect(placed).toBe(true);
    let frameTime = 42 * 50;
    target.health = 100;
    let moves = 0, shots = 0, ammoConsumed = 0;
    for (let frame = 1; frame <= 80; frame++) {
      frameTime += 50;
      const commands = bots.frame(frameTime, 50);
      for (const input of commands) { expect(input.actor).toBe(botActor); if (input.command.kind !== "q3") throw new Error("Native source bot command changed dialect");
        if (input.command.forwardMove !== 0 || input.command.rightMove !== 0) moves++;
        if ((input.command.buttons & 1) !== 0) shots++;
      }
      const previousAmmo = player.ps.ammo.get(2);
      session.step({ elapsedMilliseconds: 50, commands });
      ammoConsumed += Math.max(0, previousAmmo - player.ps.ammo.get(2));
      bots.receive(simulation.drainPresentationEvents());
    }
    expect(moves).toBeGreaterThan(0);
    expect(shots).toBeGreaterThan(0);
    expect(Math.hypot(player.ps.origin.x - initial.x, player.ps.origin.y - initial.y)).toBeGreaterThan(8);
    expect(ammoConsumed).toBeGreaterThan(0);
    expect(simulation.playerUi(human.actor).health).toBeLessThan(100);
    expect(bots.director.roster()).toHaveLength(1);
    const orderOrigin = { ...player.ps.origin };
    let orderPoint: typeof orderOrigin | null = null;
    for (const displacement of [{ x: 64, y: 0 }, { x: -64, y: 0 }, { x: 0, y: 64 }, { x: 0, y: -64 }]) {
      const end = { x: orderOrigin.x + displacement.x, y: orderOrigin.y + displacement.y, z: orderOrigin.z };
      const trace = game.world.trace({ start: orderOrigin, end, shape: { kind: "box", mins: entity.r.mins, maxs: entity.r.maxs }, passEntityNum: 1, mask: 0x2010001 });
      if (trace.fraction === 1 && trace.solidity === "clear" && forClient(1).route({ start: orderOrigin, goal: end }).kind === "route") { orderPoint = end; break; }
    }
    if (orderPoint === null) throw new Error("Retail arena has no clear local scripted goal");
    expect(bots.population.requestMoveToPoint(botActor, orderPoint)).toBe(2);
    let orderedMoves = 0;
    for (let frame = 0; frame < 24 && bots.population.goalStatus(botActor) === 2; frame++) {
      expect(bots.population.requestMoveToPoint(botActor, orderPoint)).toBe(2);
      frameTime += 50;
      const commands = bots.frame(frameTime, 50);
      orderedMoves += commands.filter(input => input.command.kind === "q3" && (input.command.forwardMove !== 0 || input.command.rightMove !== 0)).length;
      session.step({ elapsedMilliseconds: 50, commands });
      bots.receive(simulation.drainPresentationEvents());
    }
    expect(orderedMoves).toBeGreaterThan(0);
    expect(bots.population.goalStatus(botActor)).toBe(1);
    expect(Math.hypot(player.ps.origin.x - orderPoint.x, player.ps.origin.y - orderPoint.y)).toBeLessThanOrEqual(30);
    expect(bots.population.requestMoveToPoint(botActor, orderPoint)).toBe(1);
    bots.population.clearGoal(botActor);
    expect(bots.population.goalStatus(botActor)).toBe(0);
    expect(bots.population.requestFollowEntity(botActor, 0)).toBe(2);
    bots.population.clearGoal(botActor);
    expect(bots.population.goalStatus(botActor)).toBe(0);
    expect(bots.population.requestFollowEntity(botActor, 0)).toBe(2);
    let followMoves = 0;
    for (let frame = 0; frame < 4; frame++) {
      frameTime += 50;
      const commands = bots.frame(frameTime, 50);
      followMoves += commands.filter(input => input.command.kind === "q3" && (input.command.forwardMove !== 0 || input.command.rightMove !== 0)).length;
      session.step({ elapsedMilliseconds: 50, commands });
      bots.receive(simulation.drainPresentationEvents());
    }
    const followStatus = bots.population.goalStatus(botActor);
    expect(followStatus).not.toBe(0);
    expect(followStatus === 1 || followMoves > 0).toBe(true);
    const followedGeneration = bots.director.options.host.game.entity(0).generation;
    simulation.disconnectPlayer(human.actor);
    const replacement = simulation.admitPlayer(humanClient.id);
    expect(replacement.actor.equals(human.actor)).toBe(false);
    expect(bots.director.options.host.game.entity(0).generation).not.toBe(followedGeneration);
    expect(bots.population.goalStatus(botActor)).toBe(0);
  } finally { bots?.close(); session.close(); archive.close(); await content.close(); }
}, 30000);
