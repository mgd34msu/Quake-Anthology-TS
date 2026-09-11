import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { SharedSimulation } from "../../../src/app/bootstrap/simulation/runtime.ts";
import { createApplicationBotNavigation } from "../../../src/app/bootstrap/simulation/navigation.ts";

const corpus = resolve(import.meta.dir, "../../../../qfiles");
for (const movement of ["q3", "q1", "q2"]) test.skipIf(!existsSync(resolve(corpus, "q3a/baseq3/pak4.pk3")))(
  `mounted retail navigation predicts selected ${movement} movement without actor writes`, async () => {
    const launch = parseApplicationCommand(["--content-root", corpus, "--game", "q3-baseq3", "--map", "q3dm1",
      "--movement", movement, "--character", "q3", "--mode", "deathmatch"]);
    if (launch.kind !== "run") throw new Error("Expected retail launch options");
    const content = await loadApplicationContent(launch.options), identity = createIdentityOwner(`navigation-check-${movement}`);
    try {
      const simulation = new SharedSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
        mode: "deathmatch", skill: 3, seed: 7, maxClients: 4 });
      const navigation = await createApplicationBotNavigation({ content, simulation });
      const { actor } = simulation.admitPlayer(identity.client(0, 1));
      const player = simulation.movementPlayer(actor);
      if (player === null) throw new Error("Admitted player missing");
      const before = JSON.stringify(player.state), body = simulation.bodies.read(actor), origin = player.view().origin;
      const result = navigation.predictClientMovement({ entityNum: 0, origin, presence: 2, onGround: true,
        velocity: { x: 0, y: 0, z: 0 }, commandMove: { x: 400, y: 0, z: 0 }, commandFrames: 8, maxFrames: 8,
        frameTime: 0.016, stopEvents: 0, stopArea: 0, visualize: false });
      expect(JSON.stringify(player.state)).toBe(before);
      expect(simulation.bodies.read(actor)).toEqual(body);
      expect(navigation.runtime.graph.asset?.kind).toBe("aas");
      expect(navigation.runtime.graph.asset?.kind === "aas" && navigation.runtime.graph.asset.vertices.length).toBe(0);
      expect(navigation.runtime.graph.nodes.length).toBeGreaterThan(100);
      expect(result.frames).toBe(8);
      expect(result.end).not.toEqual(origin);
      expect(navigation.forClient(0).world.passActor?.equals(actor)).toBe(true);
      expect(navigation.forClient(0).route({ start: origin, goal: result.end }).kind).toBe("route");
      if (movement === "q3") {
        const source = simulation.q3Source();
        if (source === null) throw new Error("Retail Q3 source missing");
        const entity = source.pool.at(0), client = entity.client;
        if (client === null) throw new Error("Retail Q3 player missing");
        const snapped = { x: Math.trunc(result.end.x), y: Math.trunc(result.end.y), z: Math.trunc(result.end.z) };
        client.ps.origin = result.end;
        entity.r.withCurrentOrigin(snapped, () => {
          expect(entity.r.currentOrigin).toEqual(snapped);
          expect(client.ps.origin).toEqual(result.end);
          source.world.link(entity);
          expect(simulation.bodies.linked(actor)?.state.origin).toEqual(snapped);
          expect(simulation.bodies.read(actor)?.origin).toEqual(result.end);
          expect(() => entity.r.withCurrentOrigin(origin, () => {
            entity.r.currentOrigin = origin;
            expect(client.ps.origin).toEqual(origin);
            throw new Error("source callback interruption");
          })).toThrow("source callback interruption");
          expect(entity.r.currentOrigin).toEqual(snapped);
          expect(client.ps.origin).toEqual(origin);
        });
        expect(entity.r.currentOrigin).toEqual(origin);
      }
    } finally { await content.close(); }
  }, 30000);
