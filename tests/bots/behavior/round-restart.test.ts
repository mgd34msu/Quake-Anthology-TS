import { expect, spyOn, test } from "bun:test";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { ApplicationBots } from "../../../src/app/bootstrap/simulation/bots.ts";
import { createApplicationBotNavigation } from "../../../src/app/bootstrap/simulation/navigation.ts";
import { SharedSimulation } from "../../../src/app/bootstrap/simulation/runtime.ts";
import { loadMountedBotAssetFiles } from "../../../src/bots/behavior/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { ServerEntityFlags } from "../../../src/content/q3/base/shared/entity-shared.ts";
import { EngineSession } from "../../../src/world/session/session.ts";

test("six Team Arena slots retain bot resources and reconnect once after round settling", async () => {
  const launch = parseApplicationCommand(["--content-root", "/home/buzzkill/Projects/qfiles", "--game", "q3-missionpack", "--map", "mpteam1", "--movement", "q3", "--character", "q3", "--dedicated", "--mode", "deathmatch"]);
  if (launch.kind !== "run") throw new Error("Missing Team Arena fixture launch");
  const content = await loadApplicationContent(launch.options), identity = createIdentityOwner("bot-round-restart");
  const session = new EngineSession(identity, { kind: "headless" });
  const simulation = new SharedSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
    mode: "deathmatch", skill: 3, seed: 7, maxClients: 6, dedicated: true });
  session.attachWorld(simulation);
  const human = session.createClient(0); simulation.admitPlayer(human.id);
  const navigation = await createApplicationBotNavigation({ content, simulation });
  const files = await loadMountedBotAssetFiles(await content.forContent(content.recipe.map.entities.content), content.catalog);
  const bots = new ApplicationBots({ session, simulation, navigation, files, leafCount: content.world.leaves.length,
    print: () => {}, insertConsoleCommand: () => {}, openLog: () => ({ kind: "failed", error: new Error("No fixture log") }) });
  try {
    for (const name of ["sarge", "ranger", "visor", "grunt", "major"]) bots.consoleCommand(["addbot", name, "3"]);
    expect(simulation.clientIdentities()).toHaveLength(6); expect(bots.clients()).toHaveLength(5);
    const oldSource = bots.source, library = bots.director.library, bsp = bots.director.bspEntities;
    const oldAi = bots.director.ai, clients = bots.clients(), oldActors = simulation.players();
    const oldNavigation = clients.map(client => navigation.forClient?.(client.client.id.slot));
    for (const client of clients) {
      const state = oldAi.context.states.get(client.client.id.slot);
      if (state === undefined || state === null) throw new Error("Missing admitted bot state");
      state.lastGoalDecisionmaker = 23; state.lastGoalTeammate = 4;
      client.reliable.add("print retained-round-ring");
    }
    const rings = clients.map(client => client.reliable.pending());
    const setup = spyOn(library, "setup"), load = spyOn(library, "loadMap"), shutdown = spyOn(library, "shutdown"), dump = spyOn(bsp, "dump");
    try {
      bots.beginRoundRestart();
      expect(simulation.botServices.configuration).toBeNull();
      const preserved = simulation.restartSourceRound();
      bots.bindRestartedRound();
      expect(bots.source).not.toBe(oldSource); expect(bots.director.ai).not.toBe(oldAi);
      expect(bots.director.library).toBe(library); expect(bots.director.bspEntities).toBe(bsp);
      expect(simulation.players()).toHaveLength(0);
      for (const actor of oldActors) expect(simulation.actors.isLive(actor)).toBe(false);
      const connect = spyOn(bots.director.ai, "setupClient");
      try {
        for (let settle = 0; settle < 3; settle++) {
          expect(bots.frame(simulation.timeSeconds * 1000, 100)).toEqual([]);
          simulation.step({ elapsedMilliseconds: 100, commands: [] });
          expect(simulation.players()).toHaveLength(0);
        }
        expect(connect).not.toHaveBeenCalled();
        for (const client of preserved) if (!bots.reconnectRestartedClient(client)) simulation.admitPlayer(client);
        expect(connect).toHaveBeenCalledTimes(5);
        expect(simulation.clientIdentities()).toEqual(preserved);
        for (const [index, saved] of clients.entries()) {
          const active = bots.clients().find(client => client.client === saved.client);
          expect(active?.reliable).toBe(saved.reliable); expect(active?.reliable.pending()).toEqual(rings[index]);
          expect(saved.client.isClosed).toBe(false);
          const state = bots.director.ai.context.states.get(saved.client.id.slot);
          expect(state?.lastGoalDecisionmaker).toBe(23); expect(state?.lastGoalTeammate).toBe(4);
          expect(navigation.forClient?.(saved.client.id.slot)).not.toBe(oldNavigation[index]);
          expect((bots.source?.pool.at(saved.client.id.slot).r.svFlags ?? 0) & ServerEntityFlags.BOT).not.toBe(0);
          expect(() => bots.reconnectRestartedClient(saved.client.id)).toThrow("already reconnected");
        }
        expect((bots.source?.pool.at(human.id.slot).r.svFlags ?? 0) & ServerEntityFlags.BOT).toBe(0);
        expect(bots.frame(simulation.timeSeconds * 1000, 100)).toEqual([]);
        simulation.step({ elapsedMilliseconds: 100, commands: [] });
        expect(simulation.timeSeconds).toBe(0.4);
        bots.resumeRoundBots();
        expect(bots.director.checkpointOrchestration().sequences).toEqual([]);
        expect(connect).toHaveBeenCalledTimes(5);
        if (oldSource === null) throw new Error("Missing retired source round");
        const retiredTime = oldSource.level.time, retiredObservations = oldAi.context.observations.captureSaveState();
        const commandedSlots = new Set<number>();
        expect(bots.director.ai.context.game).toBe(bots.game);
        expect(bots.director.ai.context.game).not.toBe(oldAi.context.game);
        for (let tick = 0; tick < 6; tick++) {
          const commands = bots.frame(simulation.timeSeconds * 1000 + 100, 100);
          for (const command of commands) {
            expect(simulation.actors.isLive(command.actor)).toBe(true);
            expect(oldActors.some(actor => actor.equals(command.actor))).toBe(false);
            const player = simulation.movementPlayer(command.actor);
            if (player === null) throw new Error("Restarted bot command has no live movement player");
            commandedSlots.add(player.client.slot);
          }
          session.step({ elapsedMilliseconds: 100, commands });
          bots.receive(simulation.drainPresentationEvents());
        }
        expect(commandedSlots.size).toBe(5);
        for (const saved of clients) {
          const actor = simulation.players().find(actor => simulation.movementPlayer(actor)?.client.equals(saved.client.id));
          if (actor === undefined) throw new Error("Restarted bot lost its actor during source ticks");
          const observation = bots.director.ai.context.observations.info(saved.client.id.slot);
          expect(observation.valid).toBe(true);
          expect(observation.generation).toBe(actor.generation);
          expect(observation.lastUpdateTime).toBeGreaterThan(0.4);
          expect(bots.game.entity(saved.client.id.slot).generation).toBe(actor.generation);
        }
        expect(oldSource.level.time).toBe(retiredTime);
        expect(oldAi.context.observations.captureSaveState()).toEqual(retiredObservations);
        for (const actor of oldActors) expect(simulation.actors.isLive(actor)).toBe(false);
        expect(connect).toHaveBeenCalledTimes(5);
      } finally { connect.mockRestore(); }
      expect(setup).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled();
      expect(shutdown).not.toHaveBeenCalled(); expect(dump).not.toHaveBeenCalled();
    } finally { setup.mockRestore(); load.mockRestore(); shutdown.mockRestore(); dump.mockRestore(); }
  } finally { bots.close(); session.close(); await content.close(); }
}, 115000);
