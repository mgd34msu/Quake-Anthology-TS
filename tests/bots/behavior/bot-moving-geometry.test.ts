import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import type { ApplicationBots } from "../../../src/app/bootstrap/simulation/bots.ts";
import { createApplicationBotNavigation } from "../../../src/app/bootstrap/simulation/navigation.ts";
import { BotMoveFlag, BotMoveResult, BotMoveResultFlag } from "../../../src/bots/behavior/q3/movement-state.ts";
import { botInputToUserCommand } from "../../../src/bots/behavior/q3/ai-input.ts";
import { selectedQ3Command } from "../../../src/app/bootstrap/simulation/q3-commands.ts";
import type { UserCommand } from "../../../src/content/q3/base/shared/player-state.ts";
import { navigationFromAsset } from "../../../src/bots/navigation/graph.ts";
import { TravelFlags } from "../../../src/bots/behavior/q3/navigation-types.ts";

const corpus = resolve(import.meta.dir, "../../../../qfiles");
const retail = test.skipIf(!existsSync(resolve(corpus, "q2/rerelease/baseq2/pak0.pak")));
for (const initiallyRaised of [false, true]) retail(`authored Q2 lift ${initiallyRaised ? "waits for a raised platform" : "keeps BSP identity"} through shared Q3 route execution`, async () => {
  const userRoot = await mkdtemp(resolve(tmpdir(), "bot-moving-geometry-"));
  const launch = parseApplicationCommand(["--content-root", corpus, "--user-content-root", userRoot,
    "--game", "q2-rerelease-baseq2", "--map", "q2dm1", "--movement", "q2", "--character", "q2", "--mode", "deathmatch", "--dedicated"]);
  if (launch.kind !== "run") throw new Error("Expected mover launch");
  const application = await Application.open(launch.options, { print: () => undefined });
  try {
    const captured: ApplicationBots[] = [], services = application.simulation.botServices, attach = services.attach.bind(services);
    services.attach = (director, transport) => { captured.push(transport); attach(director, transport); };
    application.queueCommand("addbot", ["Ranger", "5"], null); await application.step(100);
    const transport = captured[0], bot = transport?.director.roster()[0];
    if (transport === undefined || bot === undefined) throw new Error("Missing bot");
    const world = application.simulation, source = world.q2Source();
    if (source === null) throw new Error("Missing Q2 world");
    const navigation = await createApplicationBotNavigation({ content: application.content, simulation: world });
    const runtime = navigation.forClient(bot.sourceClient), edge = runtime.graph.edges.find(edge => edge.mode === "mover" && edge.id === 1020);
    if (edge === undefined || edge.entity === null || edge.entity.model === null) throw new Error("Missing authored lift edge");
    const asset = runtime.graph.asset;
    if (asset?.kind !== "nav3") throw new Error("Expected authored NAV3");
    for (const [stored, expected] of [[0, null], [1, null], [2, 1], [254, 253], [255, null], [256, 254], [257, 255], [null, null]] satisfies readonly (readonly [number | null, number | null])[]) {
      const graph = navigationFromAsset(runtime.graph.map, { ...asset, entities: asset.entities.map(entity => entity.link === edge.id ? { ...entity, model: stored } : entity) }, runtime.graph.profile, runtime.world);
      expect(graph.edges.find(candidate => candidate.id === edge.id)?.entity?.model).toBe(expected);
      expect(graph.edges.find(candidate => candidate.id === 1023)?.entity).toBeNull();
    }
    const mover = runtime.world.entity(edge.entity);
    if (mover === null) throw new Error("Authored lift model has no live binding");
    const observed = Array.from({ length: transport.game.entityCount }, (_, number) => transport.game.entity(number))
      .find(entity => entity.present && entity.inlineModel === edge.entity?.model);
    expect(observed?.classname).toBe("func_plat");
    expect(observed?.state.modelindex).toBe(edge.entity.model);
    expect(transport.game.modelIndex(`*${edge.entity.model}`)).toBe(edge.entity.model);
    expect(transport.game.modelIndex("models/test-registration.md2")).toBeGreaterThanOrEqual(world.options.world.models.length);
    const native = source.game.entity(bot.actor.id);
    if (native === null) throw new Error("Missing bot player");
    const incoming = runtime.graph.edges.find(candidate => candidate.to === edge.from);
    const start = incoming === undefined ? edge.start : runtime.node(incoming.from)?.origin ?? edge.start;
    const player = world.movementPlayer(bot.actor.id);
    if (player === null) throw new Error("Missing player bounds");
    expect(transport.game.world.trace({ start, end: start, passEntityNum: bot.sourceClient, mask: 1 | 0x10000,
      shape: { kind: "box", mins: player.standingBounds.min, maxs: player.standingBounds.max } }).solidity).toBe("clear");
    if (initiallyRaised) {
      transport.frame = () => [];
      const activatorClient = application.session.createClient(1), activator = world.admitPlayer(activatorClient.id);
      const activatorEntity = source.game.entity(activator.actor), platformEntity = source.game.entity(mover.actor);
      if (activatorEntity === null || platformEntity === null) throw new Error("Missing source lift activator");
      const activatorPlayer = world.movementPlayer(activator.actor);
      if (activatorPlayer === null) throw new Error("Missing activator movement");
      source.players.teleportPlayer(activatorEntity, source.game, edge.start, { x: 0, y: 0, z: 0 });
      transport.frame = (time, elapsed) => [{ actor: activator.actor, source: { kind: "remote-client", client: activatorClient.id }, sequence: time,
        command: selectedQ3Command({ serverTime: time, angles: { x: 0, y: 0, z: 0 }, buttons: 0, weapon: 0, forwardmove: 0, rightmove: 0, upmove: 0 }, activatorPlayer, elapsed) }];
      for (let frame = 0; frame < 40 && source.baseEntities.platformState(platformEntity)?.phase === "bottom"; frame++) await application.step(100);
      expect(source.baseEntities.platformState(platformEntity)?.phase).toBe("up");
      world.disconnectPlayer(activator.actor); application.session.closeClient(activatorClient.id); transport.frame = () => [];
      for (let frame = 0; frame < 250 && source.baseEntities.platformState(platformEntity)?.phase !== "top"; frame++) await application.step(100);
      expect(source.baseEntities.platformState(platformEntity)?.phase).toBe("top");
      expect(runtime.nearest(edge.start, 16)).toBeNull();
      expect(runtime.world.admit({ from: start, to: edge.start, mode: "walk", hint: null, entity: null }, runtime.graph.profile).admitted).toBe(false);
    }
    const moverBefore = world.bodies.read(mover.actor), playerBefore = world.bodies.read(bot.actor.id);
    const route = runtime.route({ start, goal: edge.end });
    expect(world.bodies.read(mover.actor)).toEqual(moverBefore);
    expect(world.bodies.read(bot.actor.id)).toEqual(playerBefore);
    expect(route.kind).toBe("route");
    if (route.kind !== "route") throw new Error(route.reason);
    expect(route.route.edges.map(value => value.id)).toEqual([1023, 1020]);
    source.players.teleportPlayer(native, source.game, start, { x: 0, y: 0, z: 0 });
    const goal = { origin: edge.end, area: edge.to + 1, mins: { x: -8, y: -8, z: -8 }, maxs: { x: 8, y: 8, z: 8 }, entity: 0, number: 0, flags: 0, itemInfo: 0 };
    const library = transport.director.library, state = library.moveStates.fromHandle(bot.state.ms);
    if (state === null) throw new Error("Missing movement state");
    let aboard = false, sequence = 0, reached = false, elevatorActions = 0, centeredRideFrames = 0, waitingFrames = 0, waitedAtTop = false, waitedWhileDescending = false;
    transport.frame = (time, elapsed) => {
      const body = world.bodies.read(bot.actor.id), player = world.movementPlayer(bot.actor.id);
      if (body === null || player === null) throw new Error("Missing real bot movement");
      library.actions.resetInput(bot.sourceClient);
      library.moveStates.initialize(bot.state.ms, { origin: body.origin, velocity: body.velocity, viewOffset: { x: 0, y: 0, z: player.viewHeight },
        entityNum: bot.sourceClient, client: bot.sourceClient, thinkTime: elapsed / 1000, presenceType: 2, viewAngles: player.viewAngles,
        orMoveFlags: body.ground === null ? 0 : BotMoveFlag.ONGROUND });
      const result = new BotMoveResult();
      transport.director.navigation.moveToGoal(result, bot.state.ms, goal, TravelFlags.DEFAULT);
      const elevator = edge.entity === null ? undefined : runtime.world.entity(edge.entity)?.elevator;
      const phase = elevator?.phase;
      if ((result.flags & BotMoveResultFlag.WAITING) !== 0) {
        waitingFrames++;
        waitedAtTop ||= phase === "top"; waitedWhileDescending ||= phase === "down";
        expect(result.failure).toBe(false);
        const support = transport.game.world.trace({ start: body.origin, end: { ...body.origin, z: body.origin.z - 3 },
          passEntityNum: bot.sourceClient, mask: 1 | 0x10000, shape: { kind: "box", mins: player.standingBounds.min, maxs: player.standingBounds.max } });
        expect(support.fraction).toBeLessThan(1); expect(support.solidity).toBe("clear");
        expect(support.entityNum).not.toBe(observed?.state.number);
        expect(Math.hypot(body.origin.x - start.x, body.origin.y - start.y)).toBeLessThan(8);
        expect(library.actions.getInput(bot.sourceClient, elapsed / 1000).speed).toBeLessThan(5);
      }
      if (body.ground?.equals(mover.actor) === true) {
        if (initiallyRaised && !aboard) {
          if (elevator === undefined) throw new Error("Boarded lift observation disappeared");
          expect(Math.abs(elevator.origin.z - elevator.bottom.z)).toBeLessThan(64);
        }
        aboard = true; expect(result.failure).toBe(false);
        if (result.travelType === 11) elevatorActions++;
        if (library.actions.getInput(bot.sourceClient, elapsed / 1000).speed < 50) centeredRideFrames++;
      }
      const command: UserCommand = { serverTime: time, angles: { x: 0, y: 0, z: 0 }, buttons: 0, weapon: 0, forwardmove: 0, rightmove: 0, upmove: 0 };
      botInputToUserCommand(library.actions.getInput(bot.sourceClient, elapsed / 1000), command, { x: 0, y: 0, z: 0 }, time);
      return [{ actor: bot.actor.id, source: { kind: "bot", provider: "q3:bot" }, sequence: sequence++, command: selectedQ3Command(command, player, elapsed) }];
    };
    for (let frame = 0; frame < (initiallyRaised ? 450 : 220); frame++) {
      await application.step(100);
      const body = world.bodies.read(bot.actor.id);
      if (body !== null && Math.hypot(body.origin.x - edge.end.x, body.origin.y - edge.end.y, body.origin.z - edge.end.z) < 24) { reached = true; break; }
    }
    if (initiallyRaised) {
      expect(waitingFrames).toBeGreaterThan(20); expect(waitedAtTop).toBe(true); expect(waitedWhileDescending).toBe(true);
    }
    expect(aboard).toBe(true); expect(reached).toBe(true);
    expect(elevatorActions).toBeGreaterThan(20); expect(centeredRideFrames).toBeGreaterThan(10);
    expect(world.bodies.read(bot.actor.id)?.ground?.equals(mover.actor)).toBe(false);
  } finally { await application.close(); await rm(userRoot, { recursive: true, force: true }); }
}, 60000);
