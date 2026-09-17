import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation, savedBotCheckpoint, savedSimulationSettings } from "../../../src/app/bootstrap/simulation/index.ts";
import { createApplicationBots } from "../../../src/app/bootstrap/simulation/bot-rerelease.ts";
import type { ApplicationBotService } from "../../../src/app/bootstrap/simulation/bots.ts";
import { loadApplicationBotAssets } from "../../../src/app/bootstrap/simulation/bot-assets.ts";
import { createApplicationBotNavigation } from "../../../src/app/bootstrap/simulation/navigation.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { SaveImage } from "../../../src/contracts/session.ts";
import { readSaveImage, writeSaveImage } from "../../../src/persistence/save-image.ts";
import { EngineSession } from "../../../src/world/session/session.ts";

for (const [game, map, movement, character] of [["q1-rerelease-id1", "dm4", "q1", "q1"],
  ["q2-rerelease-baseq2", "q2dm1", "q2", "q2"], ["q1-rerelease-id1", "dm4", "q2", "q3"]] satisfies readonly (readonly [string, string, string, string])[]) {
  test(`${game} native decisions with ${movement} movement/${character} character survive shared disk restoration`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "shared-bot-save-"));
    const launch = parseApplicationCommand(["--game", game, "--map", map, "--movement", movement, "--character", character,
      "--mode", "deathmatch", "--dedicated", "--user-content-root", directory]);
    if (launch.kind !== "run") throw new Error("Expected shared bot launch");
    const options = launch.options;
    async function open(image?: SaveImage) {
      const content = await loadApplicationContent(options), identity = createIdentityOwner(`saved-${game}-${movement}-${character}-bots`);
      const session = new EngineSession(identity, { kind: "headless" });
      const clients = image === undefined ? [] : savedSimulationSettings(image).clientSlots.map(slot => session.createClient(slot));
      const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
        mode: "deathmatch", skill: 3, seed: 7, maxClients: 4,
        playerIdentity: () => ({ seat: 0, socialId: "" }),
        ...(image === undefined ? {} : { restore: image, restoredClients: clients.map(client => client.id) }) });
      session.attachWorld(simulation);
      const cvars = simulation.q1Source()?.cvars ?? simulation.q2ServerCvars();
      if (cvars === null) throw new Error("Missing shared source cvars");
      const checkpoint = image === undefined ? null : savedBotCheckpoint(image);
      if (image !== undefined) expect(() => simulation.step({ elapsedMilliseconds: 0, commands: [] })).toThrow("Saved bot services");
      const assets = await loadApplicationBotAssets(content, simulation);
      if (assets.kind !== "rerelease") throw new Error("Actual native bot files were not selected");
      expect(assets.knowledge.characters.length).toBeGreaterThan(0);
      const name = assets.knowledge.characters[0]?.name;
      if (name === undefined) throw new Error("Missing native character");
      const navigation = await createApplicationBotNavigation({ content, simulation });
      const commands: string[] = [];
      const bots = createApplicationBots({ session, simulation, files: assets.files, navigation, configuration: cvars,
        leafCount: content.world.leaves.length, automaticFrame: true,
        insertConsoleCommand: text => { commands.push(text); }, print: () => undefined,
        openLog: () => ({ kind: "failed", error: new Error("Logging is disabled for this fixture") }),
        ...(checkpoint === null ? {} : { restore: { image: checkpoint, resolveClient: saved => clients.find(client => client.id.slot === saved.slot) ?? null } }) }, assets);
      let issued: ReturnType<ApplicationBotService["frame"]> = [];
      const issue = bots.frame.bind(bots);
      bots.frame = (time, elapsed) => { issued = issue(time, elapsed); return issued; };
      function drain() { bots.receive(simulation.drainPresentationEvents()); simulation.events.take(); }
      const sample = () => ({ commands: issued.map(({ actor, ...command }) => ({ ...command, actor: actor.slot })),
        players: simulation.players().map(actor => ({ slot: actor.slot, view: simulation.playerView(actor), ui: simulation.playerUi(actor),
          buttons: simulation.movementPlayer(actor)?.buttons })) });
      function frames(count: number) {
        const trace: ReturnType<typeof sample>[] = [];
        for (let frame = 0; frame < count; frame++) {
          session.step({ elapsedMilliseconds: 100, commands: [] }); drain();
          trace.push(sample());
        }
        expect(commands).toEqual([]);
        return trace;
      }
      return { simulation, bots, cvars, name, drain, frames, async close() { bots.close(); session.close(); await content.close(); } };
    }
    let active: Awaited<ReturnType<typeof open>> | null = null;
    try {
      active = await open();
      active.bots.consoleCommand(["addbot", active.name, "3"]);
      const initialSimulation = active.simulation;
      const before = initialSimulation.players().map(actor => initialSimulation.playerView(actor));
      const running = active.frames(24);
      expect(running.some(frame => frame.commands.some(entry => entry.command.forwardMove !== 0))).toBe(true);
      expect(initialSimulation.players().map(actor => initialSimulation.playerView(actor))).not.toEqual(before);
      expect(running.every(frame => frame.commands.every(entry => entry.source.kind === "bot"))).toBe(true);
      expect(running.some(frame => frame.players.some(player => player.ui.activeWeapon !== null))).toBe(true);
      expect(active.bots.clients()).toHaveLength(1);
      active.cvars.register("bot_saved_metadata", "11", 0);
      active.cvars.set("bot_saved_metadata", "19", true);
      active.cvars.stage("bot_saved_metadata", "23");
      const cvars = active.cvars.captureSaveState(), actors = active.simulation.actors.checkpoint();
      const cachedIndex = cvars.variables.findIndex(variable => variable?.name === "bot_saved_metadata");
      expect(cachedIndex).toBeGreaterThanOrEqual(0);
      const cached = active.cvars.readVm(cachedIndex);
      active.drain();
      const image = active.simulation.checkpoint();
      expect(active.simulation.actors.checkpoint()).toEqual(actors);
      const path = join(directory, "bots.sav");
      await writeSaveImage(path, image);
      const continuous = active.frames(12), random = active.simulation.random.checkpoint();
      await active.close(); active = null;
      active = await open(await readSaveImage(path));
      expect(active.cvars.captureSaveState()).toEqual(cvars);
      expect(active.cvars.readVm(cachedIndex)).toEqual(cached);
      expect(active.frames(12)).toEqual(continuous);
      expect(active.simulation.random.checkpoint()).toEqual(random);
      active.drain(); expect(savedBotCheckpoint(active.simulation.checkpoint())?.transport.connections).toHaveLength(1);
    } finally { await active?.close(); await rm(directory, { recursive: true, force: true }); }
  }, 120000);
}
