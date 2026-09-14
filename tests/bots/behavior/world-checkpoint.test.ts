import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createSharedBotWorld } from "../../../src/app/bootstrap/simulation/bot-world.ts";
import { SharedSimulation } from "../../../src/app/bootstrap/simulation/runtime.ts";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { CvarRegistry } from "../../../src/core/cvars/index.ts";
import { decodeCheckpointValue, encodeCheckpointValue } from "../../../src/persistence/value.ts";

const corpus = resolve(import.meta.dir, "../../../../qfiles");
test.skipIf(!existsSync(resolve(corpus, "q1/rerelease/id1/pak0.pak")))("shared bot observation restore preserves IDs, pool and strings without startup side effects", async () => {
  const launch = parseApplicationCommand(["--content-root", corpus, "--game", "q1-rerelease-id1", "--map", "dm4", "--mode", "deathmatch", "--dedicated"]);
  if (launch.kind !== "run") throw new Error("Missing launch recipe");
  const content = await loadApplicationContent(launch.options);
  try {
    const identity = createIdentityOwner("world-checkpoint");
    const simulation = new SharedSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
      mode: "deathmatch", skill: 3, seed: 7, maxClients: 4 });
    const cvars = new CvarRegistry({ dialect: "q3", context: { session: identity.session,
      origin: { kind: "local-seat", seat: identity.seat(0), client: identity.client(0, 0) } } });
    const options = { simulation, cvars, actor: () => null, connect: () => { throw new Error("unexpected connect"); },
      drop: () => { throw new Error("unexpected drop"); }, begin: () => {}, print: () => {}, console: () => {}, message: () => {} };
    const before = createSharedBotWorld(options);
    before.game.options.engine.setUserinfo(2, "saved-info");
    before.game.options.configstrings.set(9, "saved-config");
    before.game.clientBegin(2);
    before.game.modelIndex("checkpoint-model");
    const allocation = before.game.memory.allocate(12); allocation.writeString("retained");
    const saved = before.checkpoint();
    expect(saved.actors.length).toBeGreaterThan(0);
    cvars.set("mapname", "must-remain", true);
    const after = createSharedBotWorld({ ...options, restoring: true });
    expect(after.checkpoint().actors).toEqual([]);
    expect(cvars.get("mapname")?.value).toBe("must-remain");
    after.restoreCheckpoint(decodeCheckpointValue(encodeCheckpointValue(saved)), actor => simulation.actors.referenceSaved(actor, "current"));
    expect(after.checkpoint()).toEqual(saved);
    expect(after.game.memory.restoreAllocation(before.game.memory.captureAllocation(allocation)).readString()).toBe("retained");
    expect(after.game.options.engine.getUserinfo(2)).toBe("saved-info");
    expect(after.game.options.configstrings.get(9)).toBe("saved-config");
    const first = saved.actors[0];
    if (first === undefined) throw new Error("Missing observation fixture");
    expect(after.entityId(simulation.actors.referenceSaved(first.actor, "current"))).toBe(first.id);
    expect(() => after.restoreCheckpoint({ ...saved, freeIds: [first.id] }, actor => simulation.actors.referenceSaved(actor, "current"))).toThrow();
    expect(after.checkpoint()).toEqual(saved);
    const second = saved.actors[1];
    if (second === undefined) throw new Error("Missing second observation fixture");
    const withFreeIds = { ...saved, actors: saved.actors.slice(2), freeIds: [first.id, second.id] };
    after.restoreCheckpoint(withFreeIds, actor => simulation.actors.referenceSaved(actor, "current"));
    expect(after.entityId(simulation.actors.referenceSaved(first.actor, "current"))).toBe(second.id);
    expect(after.entityId(simulation.actors.referenceSaved(second.actor, "current"))).toBe(first.id);
    expect(after.checkpoint().nextEntity).toBe(saved.nextEntity);
    expect(after.checkpoint().nextGeneration).toBe(saved.nextGeneration + 2);
  } finally { await content.close(); }
});
