import { expect, spyOn, test } from "bun:test";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { ApplicationBots, type ApplicationBotClient } from "../../../src/app/bootstrap/simulation/bots.ts";
import { createApplicationBotNavigation } from "../../../src/app/bootstrap/simulation/navigation.ts";
import { SharedSimulation } from "../../../src/app/bootstrap/simulation/runtime.ts";
import { loadMountedBotAssetFiles } from "../../../src/bots/behavior/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { ServerEntityFlags } from "../../../src/content/q3/base/shared/entity-shared.ts";
import { EngineSession } from "../../../src/world/session/session.ts";
import { MAX_RELIABLE_COMMANDS } from "../../../src/network/q3/reliable.ts";

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
    const target = clients[0], recipient = target === undefined ? null : bots.actor(target.client.id);
    if (target === undefined || recipient === null) throw new Error("Missing actual bot recipient");
    bots.receive([{ kind: "q3-source", content: "q3:classic:component:test", sequence: 0, seconds: simulation.timeSeconds,
      recipient, event: { kind: "server-command", client: -1, text: "print private-component-message" } }]);
    expect(clients.map(client => client.reliable.pending().some(command => command.text === "print private-component-message"))).toEqual([true, false, false, false, false]);
    const rings = clients.map(client => client.reliable.pending());
    let eventSequence = 0;
    const receive = (client: number, text: string): void => bots.receive([{ kind: "q3-source",
      content: content.recipe.map.entities.content, sequence: ++eventSequence, seconds: simulation.timeSeconds,
      event: { kind: "server-command", client, text } }]);
    const setup = spyOn(library, "setup"), load = spyOn(library, "loadMap"), shutdown = spyOn(library, "shutdown"), dump = spyOn(bsp, "dump");
    try {
      bots.beginRoundRestart();
      receive(-1, "print detached-init");
      expect(simulation.botServices.configuration).toBeNull();
      const preserved = simulation.restartSourceRound();
      simulation.beginSourceRoundSettlement();
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
          receive(-1, `print settle-${settle}`);
          expect(simulation.players()).toHaveLength(0);
        }
        expect(connect).not.toHaveBeenCalled();
        const source = bots.source;
        if (source === null) throw new Error("Missing restarted source");
        const admission = source.admission.connect.bind(source.admission);
        const admissionSpy = spyOn(source.admission, "connect").mockImplementation((slot, firstTime, isBot) => {
          if (isBot) {
            const saved = clients.find(client => client.client.id.slot === slot);
            if (saved === undefined) throw new Error("Unexpected bot admission");
            expect(saved.reliable.pending().at(-1)?.text).toBe("map_restart\n");
          }
          return admission(slot, firstTime, isBot);
        });
        try {
          for (const client of preserved) {
            receive(client.slot, `print targeted-${client.slot}`);
            if (!bots.reconnectRestartedClient(client)) simulation.admitPlayer(client);
          }
        } finally { admissionSpy.mockRestore(); }
        expect(connect).toHaveBeenCalledTimes(5);
        expect(simulation.clientIdentities()).toEqual(preserved);
        for (const [index, saved] of clients.entries()) {
          const active = bots.clients().find(client => client.client === saved.client);
          expect(active?.reliable).toBe(saved.reliable);
          const retained = rings[index];
          if (retained === undefined) throw new Error("Missing retained ring");
          expect(active?.reliable.pending().map(command => command.text)).toEqual([
            ...retained.map(command => command.text), "print detached-init", "print settle-0", "print settle-1", "print settle-2",
            `print targeted-${saved.client.id.slot}`, "map_restart\n",
          ]);
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
        simulation.completeSourceRoundSettlement();
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
      const [detachedDrop, boundDrop, restartDrop, activeDrop, survivor] = bots.clients();
      if (detachedDrop === undefined || boundDrop === undefined || restartDrop === undefined || activeDrop === undefined || survivor === undefined) throw new Error("Expected five retained bots");
      const fill = (client: ApplicationBotClient): void => {
        client.reliable.assignAcknowledgement(client.reliable.sequence);
        for (let command = 0; command < MAX_RELIABLE_COMMANDS; command++) expect(client.reliable.add(`print fill-${command}`).kind).toBe("queued");
      };
      bots.beginRoundRestart();
      fill(detachedDrop); receive(detachedDrop.client.id.slot, "print overflow-detached");
      expect(detachedDrop.client.isClosed).toBe(true);
      simulation.restartSourceRound(); simulation.beginSourceRoundSettlement(); bots.bindRestartedRound();
      for (let settle = 0; settle < 3; settle++) simulation.step({ elapsedMilliseconds: 100, commands: [] });
      fill(boundDrop); receive(boundDrop.client.id.slot, "print overflow-bound");
      expect(boundDrop.client.isClosed).toBe(true);
      fill(restartDrop);
      const setupAfterDrop = spyOn(bots.director.ai, "setupClient");
      try {
        for (const dropped of [detachedDrop, boundDrop, restartDrop]) {
          expect(bots.reconnectRestartedClient(dropped.client.id)).toBe(true);
          expect(dropped.client.isClosed).toBe(true);
        }
        expect(setupAfterDrop).not.toHaveBeenCalled();
        expect(simulation.players()).toHaveLength(0);
        expect(bots.clients().map(client => client.client)).toEqual([activeDrop.client, survivor.client]);
        for (const kept of [activeDrop, survivor]) {
          kept.reliable.assignAcknowledgement(kept.reliable.sequence);
          expect(bots.reconnectRestartedClient(kept.client.id)).toBe(true);
        }
        expect(setupAfterDrop).toHaveBeenCalledTimes(2);
        simulation.step({ elapsedMilliseconds: 100, commands: [] });
        simulation.completeSourceRoundSettlement();
        bots.resumeRoundBots();
        fill(activeDrop); receive(activeDrop.client.id.slot, "print overflow-active");
        expect(activeDrop.client.isClosed).toBe(true);
        expect(bots.clients().map(client => client.client)).toEqual([survivor.client]);
        expect(simulation.players()).toHaveLength(1);
        const survivorSequence = survivor.reliable.sequence;
        receive(-1, "print survivor");
        expect(survivor.reliable.sequence).toBe(survivorSequence + 1);
        expect(survivor.reliable.pending().at(-1)?.text).toBe("print survivor");
      } finally { setupAfterDrop.mockRestore(); }
    } finally { setup.mockRestore(); load.mockRestore(); shutdown.mockRestore(); dump.mockRestore(); }
  } finally { bots.close(); session.close(); await content.close(); }
}, 115000);
