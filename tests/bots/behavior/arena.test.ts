import { createQ1BotKnowledge } from "../../../src/app/bootstrap/simulation/bot-q1-knowledge.ts";
import { SharedPickupAdmission } from "../../../src/world/gameplay/pickups.ts";
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
import { BotCharacteristic, BotInventory, BotModelIndex } from "../../../src/bots/behavior/q3/ai-definitions.ts";
import { arenaPrediction } from "./arena-prediction.ts";
import { GameAiContext } from "../../../src/bots/behavior/q3/ai-context.ts";
import { BotState } from "../../../src/bots/behavior/q3/ai-state.ts";
import { botAttackMove } from "../../../src/bots/behavior/q3/ai-navigation.ts";
import { botChooseWeapon, botBattleUseItems, updateQ3BotItemInventory } from "../../../src/bots/behavior/q3/ai-combat.ts";
import { createBotArsenalKnowledge } from "../../../src/bots/behavior/q3/arsenal-knowledge.ts";
import { q3BotGame } from "../../../src/bots/behavior/q3/source-game.ts";
import { createQ2BotKnowledge } from "../../../src/app/bootstrap/simulation/bot-q2-knowledge.ts";
import { WeaponState, Powerup, statSchema } from "../../../src/content/q3/base/shared/definitions.ts";
import { BotActionFlag } from "../../../src/bots/behavior/library/actions.ts";
import { BotMoveFlag } from "../../../src/bots/behavior/q3/movement-state.ts";

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
    const q2Launch = parseApplicationCommand(["--content-root", corpus, "--game", "q2-classic-baseq2", "--map", "base1", "--dedicated"]);
    if (q2Launch.kind !== "run") throw new Error("Expected Q2 arsenal fixture");
    const q2Content = existsSync(resolve(corpus, "q2/baseq2/pak0.pak")) ? await loadApplicationContent(q2Launch.options) : null;
    let q2Simulation: SharedSimulation | null = null;
    try {
      if (q2Content !== null) q2Simulation = new SharedSimulation({ identity: createIdentityOwner("bot-attack-distance"), recipe: q2Content.recipe,
        world: q2Content.world, mounts: q2Content.mounts, mode: "deathmatch", skill: 3, seed: 7, maxClients: 4 });
      const library = bots.director.library, original = bots.director.ai.context;
      const items = new BotState("baseq3"); items.client = brain.client; items.curPs.copyFrom(player.ps);
      items.inventory[65] = 1; items.inventory[97] = 13;
      const schema = statSchema("baseq3");
      items.curPs.stats.set(schema.health, 35);
      items.curPs.powerups.set(Powerup.PW_QUAD, 1);
      for (const model of [BotModelIndex.MEDKIT, BotModelIndex.TELEPORTER, 0]) {
        items.curPs.stats.set(schema.holdableItem, model);
        updateQ3BotItemInventory(items);
        expect(items.inventory[BotInventory.HEALTH]).toBe(35);
        expect(items.inventory[BotInventory.MEDKIT]).toBe(Number(model === BotModelIndex.MEDKIT));
        expect(items.inventory[BotInventory.TELEPORTER]).toBe(Number(model === BotModelIndex.TELEPORTER));
        expect(items.inventory[BotInventory.QUAD]).toBe(1);
        expect(items.inventory[65]).toBe(1); expect(items.inventory[97]).toBe(13);
        library.actions.resetInput(items.client);
        botBattleUseItems(original, items);
        expect(library.actions.getInput(items.client, 0).actionFlags & BotActionFlag.USE).toBe(model === 0 ? 0 : BotActionFlag.USE);
      }
      items.curPs.powerups.set(Powerup.PW_QUAD, 0); updateQ3BotItemInventory(items);
      expect(items.inventory[BotInventory.QUAD]).toBe(0);
      library.actions.resetInput(items.client);
      const walkEdge = graph.edges.find(edge => edge.mode === "walk");
      if (walkEdge === undefined) throw new Error("Retail arena has no walking reachability");
      const moveHandle = library.moveStates.allocate(), moveState = library.moveStates.fromHandle(moveHandle);
      if (moveState === null) throw new Error("Retail movement state allocation failed");
      try {
        moveState.lastReachability = walkEdge.id;
        moveState.walkProgress = { edge: walkEdge, phase: "traverse" };
        moveState.lastReachability = walkEdge.id;
        expect(moveState.walkProgress?.edge).toBe(walkEdge);
        moveState.lastReachability = walkEdge.id + 1;
        expect(moveState.walkProgress).toBeNull();
        moveState.walkProgress = { edge: walkEdge, phase: "traverse" };
        const moveInput = { origin: brain.origin, velocity: brain.velocity, viewOffset: { x: 0, y: 0, z: brain.curPs.viewheight },
          entityNum: brain.entityNum, client: brain.client, thinkTime: 0.1, presenceType: 2, viewAngles: brain.viewangles };
        library.moveStates.initialize(moveHandle, { ...moveInput, orMoveFlags: BotMoveFlag.ONGROUND });
        expect(moveState.walkProgress?.edge).toBe(walkEdge);
        library.moveStates.initialize(moveHandle, { ...moveInput, orMoveFlags: BotMoveFlag.TELEPORTED });
        expect(moveState.walkProgress).toBeNull();
        moveState.walkProgress = { edge: walkEdge, phase: "traverse" };
        library.moveStates.reset(moveHandle);
        expect(moveState.walkProgress).toBeNull();
        expect(moveState.lastReachability).toBe(0);
      } finally { library.moveStates.free(moveHandle); }
      const gauntlet = library.weapons.getWeaponInfo(brain.ws, 1);
      if (gauntlet === undefined || !gauntlet.valid) throw new Error("Native gauntlet knowledge missing");
      const activation = new BotState("baseq3"); activation.ws = brain.ws;
      activation.curPs.weaponState = WeaponState.WEAPON_RAISING;
      const nativeKnowledge = q3BotGame(game, () => undefined).knowledge;
      expect(nativeKnowledge.activationWeapon(library, activation)).toBe(-1);
      const priority: readonly (readonly [number, BotInventory, BotInventory])[] = [
        [2, BotInventory.MACHINEGUN, BotInventory.BULLETS], [3, BotInventory.SHOTGUN, BotInventory.SHELLS],
        [8, BotInventory.PLASMAGUN, BotInventory.CELLS], [6, BotInventory.LIGHTNING, BotInventory.LIGHTNINGAMMO],
        [7, BotInventory.RAILGUN, BotInventory.SLUGS], [5, BotInventory.ROCKETLAUNCHER, BotInventory.ROCKETS],
        [9, BotInventory.BFG10K, BotInventory.BFGAMMO],
      ];
      for (const [, weapon, ammo] of priority) {
        activation.inventory[weapon] = 1; activation.inventory[ammo] = 1;
      }
      for (const [selected, weapon] of priority) {
        expect(nativeKnowledge.activationWeapon(library, activation)).toBe(selected);
        activation.inventory[weapon] = 0;
      }
      activation.inventory[BotInventory.GAUNTLET] = 1;
      activation.inventory[BotInventory.GRENADELAUNCHER] = 1; activation.inventory[BotInventory.GRENADES] = 20;
      expect(nativeKnowledge.activationWeapon(library, activation)).toBe(-1);
      for (const candidate of [
        { info: { ...gauntlet, number: 7, weaponInventoryIndex: 64 }, melee: true, maximumRange: 60, personalityRole: null, supply: null },
        { info: { ...gauntlet, number: 8, weaponInventoryIndex: 64, projectileInfo: { ...gauntlet.projectileInfo, gravity: 1 } }, melee: false, maximumRange: null, personalityRole: null, supply: null },
      ]) {
        activation.inventory[64] = 1;
        expect(createBotArsenalKnowledge({ updateInventory: () => undefined, candidates: () => [candidate] }).activationWeapon(library, activation)).toBe(-1);
      }
      expect(createBotArsenalKnowledge({ updateInventory: () => undefined, candidates: () => [] }).activationWeapon(library, activation)).toBe(-1);
      if (q2Simulation !== null) {
        const actor = q2Simulation.admitPlayer(q2Simulation.options.identity.client(0, 1)).actor;
        const owner = q2Simulation.actors.resolveOwned(actor);
        if (owner === null) throw new Error("Q2 activation owner missing");
        const knowledge = createQ2BotKnowledge({ simulation: q2Simulation, actorForClient: () => actor });
        const state = new BotState("baseq3"); state.ws = brain.ws; state.curPs.weaponState = WeaponState.WEAPON_RAISING;
        const select = () => { knowledge.knowledge.updateInventory(state); return knowledge.resolveWeapon(0, knowledge.knowledge.activationWeapon(library, state)); };
        expect(select()).toBe("q2:weapon_blaster");
        q2Simulation.inventory.consume(owner, "q2:weapon_blaster", 1);
        q2Simulation.inventory.give(owner, "q2:weapon_supershotgun", 1); q2Simulation.inventory.give(owner, "q2:ammo_shells", 1);
        expect(select()).toBeNull();
        q2Simulation.inventory.give(owner, "q2:ammo_shells", 1);
        expect(select()).toBe("q2:weapon_supershotgun");
        q2Simulation.inventory.give(owner, "q2:weapon_machinegun", 1); q2Simulation.inventory.give(owner, "q2:ammo_bullets", 1);
        expect(select()).toBe("q2:weapon_machinegun");
        expect(state.curPs.weaponState).toBe(WeaponState.WEAPON_RAISING);
        q2Simulation.inventory.give(owner, "q2:weapon_shotgun", 1);
        knowledge.knowledge.updateInventory(state);
        const utility = (preview: import("../../../src/contracts/pickups.ts").PickupSupplyPreview) => knowledge.knowledge.pickupUtility(library, state, preview);
        expect(utility({ accepted: true, weapons: [], ammo: [] })).toBe(0);
        expect(utility({ accepted: true, weapons: [{ item: "q2:weapon_shotgun", before: 1, given: 1 }], ammo: [] })).toBe(0);
        const admission = new SharedPickupAdmission({ inventory: q2Simulation.inventory,
          profile: { id: "test:sequential-supply", weaponOwnership: "all-destinations",
            ammo: [{ source: "q1:ammo/shells", destinations: ["q2:ammo_shells"] }, { source: "q1:ammo/nails", destinations: ["q2:ammo_shells"] }],
            weapons: [{ source: "q1:weapon/shotgun", destinations: ["q2:weapon_shotgun"] }] },
          ammoGranted: () => { throw new Error("Preview mutated ammo"); }, weaponGranted: () => { throw new Error("Preview selected weapon"); } });
        const beforePreview = q2Simulation.inventory.entries(actor);
        const sequential = admission.preview(actor, { kind: "weapon", offer: { item: "q1:weapon/shotgun",
          ammo: [{ item: "q1:ammo/shells", amount: 10 }, { item: "q1:ammo/nails", amount: 10 }] } });
        expect(sequential.ammo.map(receipt => receipt.before)).toEqual([2, 12]);
        expect(utility(sequential)).toBe(20);
        expect(q2Simulation.inventory.entries(actor)).toEqual([...beforePreview]);
        expect(utility({ accepted: true, weapons: [], ammo: [{ item: "q2:ammo_cells", before: 0, given: 10 }] })).toBe(0);
        expect(utility({ accepted: true, weapons: [{ item: "q2:weapon_rocketlauncher", before: 0, given: 1 }], ammo: [{ item: "q2:ammo_rockets", before: 0, given: 5 }] })).toBe(105);
        expect(utility({ accepted: false, weapons: [{ item: "q2:weapon_rocketlauncher", before: 0, given: 1 }], ammo: [] })).toBe(0);
        expect(utility({ accepted: true, weapons: [{ item: "q2:ammo_grenades", before: 0, given: 5 }], ammo: [{ item: "q2:ammo_grenades", before: 0, given: 5 }] })).toBe(0);

      }
      if (existsSync(resolve(corpus, "q1/rerelease/id1/pak0.pak"))) {
        const q1Launch = parseApplicationCommand(["--content-root", corpus, "--game", "q1-rerelease-id1", "--map", "dm4", "--dedicated"]);
        if (q1Launch.kind !== "run") throw new Error("Expected Q1 source ownership fixture");
        const q1Content = await loadApplicationContent(q1Launch.options);
        const q1Simulation = new SharedSimulation({ identity: createIdentityOwner("bot-q1-supply"), recipe: q1Content.recipe,
          world: q1Content.world, mounts: q1Content.mounts, mode: "deathmatch", skill: 3, seed: 7, maxClients: 4 });
        try {
          const actor = q1Simulation.admitPlayer(q1Simulation.options.identity.client(0, 1)).actor;
          const owner = q1Simulation.actors.resolveOwned(actor);
          if (owner === null) throw new Error("Q1 source ownership fixture lost actor");
          q1Simulation.inventory.consume(owner, "q1:ammo/shells", q1Simulation.inventory.count(actor, "q1:ammo/shells"));
          const knowledge = createQ1BotKnowledge({ simulation: q1Simulation, actorForClient: () => actor });
          const state = new BotState("baseq3"); state.ws = brain.ws;
          knowledge.knowledge.updateInventory(state);
          const selectedBefore = knowledge.knowledge.chooseWeapon(library, state);
          expect(knowledge.resolveWeapon(0, selectedBefore)).toBe("q1:weapon/axe");
          expect(knowledge.knowledge.pickupUtility(library, state, { accepted: true, weapons: [],
            ammo: [{ item: "q1:ammo/shells", before: 0, given: 10 }] })).toBe(10);
          expect(knowledge.knowledge.chooseWeapon(library, state)).toBe(selectedBefore);
          expect(q1Simulation.inventory.count(actor, "q1:ammo/shells")).toBe(0);
        } finally { q1Simulation.close(); await q1Content.close(); }
      }
      const cases = [
        ...(q2Simulation === null ? [] : [{ name: "Q2 blaster", active: 1, melee: false, knowledge: createQ2BotKnowledge({ simulation: q2Simulation, actorForClient: () => null }).knowledge }]),
        { name: "Q3 gauntlet", active: 1, melee: true, knowledge: q3BotGame(game, () => undefined).knowledge },
        { name: "Q3 machinegun", active: 2, melee: false, knowledge: q3BotGame(game, () => undefined).knowledge },
        { name: "remapped melee", active: 7, melee: true, knowledge: createBotArsenalKnowledge({ updateInventory: () => undefined,
          candidates: () => [{ info: { ...gauntlet, number: 7 }, melee: true, maximumRange: 60, personalityRole: null, supply: null }] }) },
      ];
      for (const entry of cases) {
        const directions: number[] = [];
        const context = new GameAiContext({ ...original.game, knowledge: entry.knowledge, random: { random: () => 0.5, crandom: () => 0 } }, library,
          { ...original.host, navigation: { ...original.navigation, moveInDirection: (_handle, direction) => { directions.push(direction.x); return true; } } });
        const state = new BotState("baseq3");
        state.character = brain.character; state.ws = brain.ws; state.ms = brain.ms; state.enemy = 0;
        state.curPs.weapon = entry.active; state.curPs.weaponState = WeaponState.WEAPON_RAISING; state.weaponNum = 9;
        context.time = 10;
        botChooseWeapon(context, state);
        expect(state.weaponNum).toBe(9);
        for (const distance of [80, 100, 200]) {
          context.observations.update(0, { ...original.observations.info(0), origin: { x: distance, y: 0, z: 0 } }, 10);
          directions.length = 0;
          botAttackMove(context, state, 0);
          const expected = entry.melee || distance > 180 ? 1 : distance < 100 ? -1 : 0;
          expect(Math.sign(directions[0] ?? 0), `${entry.name} at ${distance}`).toBe(expected);
          expect(state.curPs.weapon).toBe(entry.active);
        }
      }
    } finally { q2Simulation?.close(); await q2Content?.close(); }
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
    const sourceClient = brain.client, settings = { ...brain.settings };
    for (const number of [0x40000000, 37]) {
      const current = bots.director.ai.context.states.get(sourceClient);
      if (current === null || current === undefined) throw new Error("Session test lost real bot state");
      current.lastGoalTeamGoal.number = number; current.lastGoalTeamGoal.area = 12;
      current.lastGoalLtgType = 5; current.lastGoalDecisionmaker = 2; current.lastGoalTeammate = 3;
      expect(bots.director.ai.shutdownClient(sourceClient, true)).toBe(true);
      expect(bots.director.ai.setupClient(sourceClient, settings, true)).toBe(true);
      const restored = bots.director.ai.context.states.get(sourceClient);
      if (restored === null || restored === undefined) throw new Error("Session test failed to restore real bot");
      expect(restored.lastGoalTeamGoal.number).toBe(number === 37 ? 37 : 0);
      expect(restored.lastGoalTeamGoal.area).toBe(number === 37 ? 12 : 0);
      expect(restored.lastGoalLtgType).toBe(number === 37 ? 5 : 0);
      expect(restored.lastGoalDecisionmaker).toBe(number === 37 ? 2 : 0);
      expect(restored.lastGoalTeammate).toBe(number === 37 ? 3 : 0);
    }
  } finally { bots?.close(); session.close(); archive.close(); await content.close(); }
}, 30000);
