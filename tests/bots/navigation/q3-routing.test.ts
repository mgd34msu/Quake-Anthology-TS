// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { testCorpusRoot } from "../../support/corpus.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { SharedSimulation } from "../../../src/app/bootstrap/simulation/runtime.ts";
import { ApplicationBots } from "../../../src/app/bootstrap/simulation/bots.ts";
import { createApplicationBotNavigation } from "../../../src/app/bootstrap/simulation/navigation.ts";
import { loadMountedBotAssetFiles } from "../../../src/bots/behavior/index.ts";
import { TravelFlags } from "../../../src/bots/behavior/q3/navigation-types.ts";
import { TravelGraph } from "../../../src/bots/behavior/q3/travel/routing.ts";
import { EngineSession } from "../../../src/world/session/session.ts";
import { parseEntities } from "../../../src/formats/q3-map/entities.ts";

const corpus = testCorpusRoot();
const retail = test.skipIf(!existsSync(resolve(corpus, "q3a/baseq3/pak0.pk3")));

async function openMap(map: string) {
  const launch = parseApplicationCommand([
    "--content-root",
    corpus,
    "--game",
    "q3-baseq3",
    "--map",
    map,
    "--movement",
    "q3",
    "--character",
    "q3",
    "--mode",
    "deathmatch",
    "--dedicated",
  ]);
  if (launch.kind !== "run") throw new Error("Expected a Q3 launch");
  const content = await loadApplicationContent(launch.options),
    identity = createIdentityOwner("q3-routing"),
    session = new EngineSession(identity, { kind: "headless" });
  const simulation = new SharedSimulation({
    recipe: content.recipe,
    world: content.world,
    mounts: content.mounts,
    mode: "deathmatch",
    skill: 3,
    seed: 7,
    maxClients: 4,
    dedicated: true,
    identity,
  });
  session.attachWorld(simulation);
  const navigation = await createApplicationBotNavigation({ content, simulation });
  return {
    content,
    session,
    simulation,
    navigation,
    close: async () => {
      session.close();
      await content.close();
    },
  };
}

retail(
  "q3dm17 bots may route through teleporters, jump pads and falls taller than 128 units",
  async () => {
    const world = await openMap("q3dm17");
    try {
      const runtime = world.navigation.runtime,
        edges = runtime.graph.edges;
      expect(runtime.graph.profile.capabilities.has("teleport")).toBe(true);
      expect(runtime.graph.profile.capabilities.has("jump-pad")).toBe(true);
      const teleports = edges.filter(edge => edge.mode === "teleport"),
        pads = edges.filter(edge => edge.mode === "jump-pad");
      expect(teleports.length).toBeGreaterThan(0);
      expect(pads.length).toBeGreaterThan(0);
      for (const edge of [...teleports, ...pads]) expect(runtime.edgeSelectable(edge, TravelFlags.DEFAULT)).toBe(true);
      const falls = edges.filter(edge => edge.mode === "drop" && edge.start.z - edge.end.z > 128);
      expect(falls.length).toBeGreaterThan(0);
      // Falls into lava or slime are still refused by the area travel flags; the height alone no longer is.
      expect(falls.some(edge => runtime.edgeSelectable(edge, TravelFlags.DEFAULT))).toBe(true);
      // A teleporter area reaches far goals through the teleporter itself, which only exists once the profile grants the mode.
      const teleporter = teleports[0];
      if (teleporter === undefined) throw new Error("q3dm17 has no teleporter reachability");
      const viaTeleporter = runtime.graph.nodes.filter(node => {
        const estimate = runtime.estimate({ startNode: teleporter.from, goalNode: node.id, origin: teleporter.start, travelFlags: TravelFlags.DEFAULT });
        return estimate.kind === "estimate" && estimate.firstEdge?.mode === "teleport";
      });
      expect(viaTeleporter.length).toBeGreaterThan(100);
    } finally {
      await world.close();
    }
  },
  120000,
);

retail(
  "q3dm19 selection takes lifts and jump pads from the stored reachability without a movement simulation",
  async () => {
    const world = await openMap("q3dm19");
    const files = await loadMountedBotAssetFiles(await world.content.forContent(world.content.recipe.map.entities.content), world.content.catalog);
    const bots = new ApplicationBots({
      session: world.session,
      simulation: world.simulation,
      files,
      navigation: world.navigation,
      leafCount: world.content.world.leaves.length,
      print: () => undefined,
      insertConsoleCommand: () => undefined,
      openLog: () => ({ kind: "failed", error: new Error("No log") }),
    });
    try {
      bots.consoleCommand(["addbot", "sarge", "3"]);
      for (let frame = 0; frame < 5; frame++) {
        const commands = bots.frame(Math.round(world.simulation.timeSeconds * 1000) + 50, 50);
        world.session.step({ elapsedMilliseconds: 50, commands });
        bots.receive(world.simulation.drainPresentationEvents());
      }
      const bot = bots.director.roster()[0];
      if (bot === undefined) throw new Error("Missing bot");
      const state = bots.director.library.moveStates.fromHandle(bot.state.ms);
      if (state === null) throw new Error("Missing movement state");
      const runtime = world.navigation.forClient(bot.sourceClient),
        graph = new TravelGraph(runtime);
      const goalFor = (area: number) => ({
        origin: { x: 0, y: 0, z: 0 },
        area,
        mins: { x: -8, y: -8, z: -8 },
        maxs: { x: 8, y: 8, z: 8 },
        entity: 0,
        number: 0,
        flags: 0,
        itemInfo: 0,
      });
      const taken = new Set<string>();
      for (const edge of runtime.graph.edges) {
        if (edge.mode !== "mover" && edge.mode !== "jump-pad") continue;
        state.area = edge.from;
        state.lastGoalArea = 0;
        state.lastArea = 0;
        const selected = graph.select(state, goalFor(edge.to), TravelFlags.DEFAULT).reachability;
        if (selected === graph.handle(edge)) taken.add(edge.mode);
      }
      expect([...taken].sort()).toEqual(["jump-pad", "mover"]);
    } finally {
      bots.close();
      await world.close();
    }
  },
  180000,
);

retail(
  "q3dm17 items floating above jump pads are reachable from the pad area",
  async () => {
    const world = await openMap("q3dm17");
    const files = await loadMountedBotAssetFiles(await world.content.forContent(world.content.recipe.map.entities.content), world.content.catalog);
    const bots = new ApplicationBots({
      session: world.session,
      simulation: world.simulation,
      files,
      navigation: world.navigation,
      leafCount: world.content.world.leaves.length,
      print: () => undefined,
      insertConsoleCommand: () => undefined,
      openLog: () => ({ kind: "failed", error: new Error("No log") }),
    });
    try {
      bots.consoleCommand(["addbot", "sarge", "3"]);
      for (let frame = 0; frame < 5; frame++) {
        const commands = bots.frame(Math.round(world.simulation.timeSeconds * 1000) + 50, 50);
        world.session.step({ elapsedMilliseconds: 50, commands });
        bots.receive(world.simulation.drainPresentationEvents());
      }
      const navigation = bots.director.navigation,
        bounds = { min: { x: -15, y: -15, z: -15 }, max: { x: 15, y: 15, z: 15 } };
      const mega = parseEntities(world.simulation.sourceEntityText).filter(entity => entity.get("classname") === "item_health_mega");
      expect(mega.length).toBeGreaterThan(0);
      for (const entity of mega) {
        const [x, y, z] = (entity.get("origin") ?? "").split(" ").map(Number);
        if (x === undefined || y === undefined || z === undefined) throw new Error("Mega health has no origin");
        expect(navigation.bestReachableFromJumpPadArea({ x, y, z }, bounds)).toBeGreaterThan(0);
      }
      // Nothing is launched into a box far outside the map.
      expect(navigation.bestReachableFromJumpPadArea({ x: 0, y: 0, z: 90000 }, bounds)).toBe(0);
    } finally {
      bots.close();
      await world.close();
    }
  },
  180000,
);
