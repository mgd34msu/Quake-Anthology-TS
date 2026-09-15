import { expect, spyOn, test } from "bun:test";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { ActorCommand } from "../../../src/contracts/session.ts";

test("Q3 runs all due source frames, consumes one command, retains residual through save and freezes at zero", async () => {
  const launch = parseApplicationCommand(["--game", "q3-baseq3", "--map", "q3dm1", "--movement", "q3", "--character", "q3", "--dedicated", "--mode", "deathmatch"]);
  if (launch.kind !== "run") throw new Error("Missing launch");
  const content = await loadApplicationContent(launch.options), identity = createIdentityOwner("q3-catchup"), client = identity.client(0, 0);
  const options: Parameters<typeof createSimulation>[0] = { identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
    skill: 1, mode: "deathmatch", seed: 1, maxClients: 1 };
  const simulation = createSimulation(options);
  try {
    const actor = simulation.admitPlayer(client).actor, source = simulation.q3Source();
    if (source === null) throw new Error("Missing source");
    const begin = spyOn(source, "beginFrame"), think = spyOn(source, "playerThink"), end = spyOn(source, "endFrame");
    const actorTimes = new Set<number>(), runActor = source.runActor;
    const actors = spyOn(source, "runActor").mockImplementation(actor => { actorTimes.add(source.level.time); runActor.call(source, actor); });
    const command: ActorCommand = { actor, sequence: 0, source: { kind: "local-seat", seat: identity.seat(0), client },
      command: { kind: "q3", serverTimeMilliseconds: 200, angleWords: [0, 0, 0], forwardMove: 127, rightMove: 0, upMove: 0, buttons: 0, weapon: 2 } };
    simulation.step({ elapsedMilliseconds: 225, commands: [command] });
    expect(begin.mock.calls.map(call => call[0].time.value)).toEqual([50, 100, 150, 200]);
    expect(end).toHaveBeenCalledTimes(4); expect(think).toHaveBeenCalledTimes(1);
    expect([...actorTimes]).toEqual([50, 100, 150, 200]);
    expect(source.level.time).toBe(200); expect(source.level.frameNum).toBe(4);
    simulation.drainPresentationEvents(); const saved = simulation.checkpoint();
    const restored = createSimulation({ ...options, restore: saved, restoredClients: [client] });
    try {
      for (const current of [simulation, restored]) {
        current.step({ elapsedMilliseconds: 0, commands: [] }); expect(current.timeSeconds).toBe(0.2);
        current.step({ elapsedMilliseconds: 24, commands: [] }); expect(current.timeSeconds).toBe(0.2);
        current.step({ elapsedMilliseconds: 1, commands: [] }); expect(current.timeSeconds).toBe(0.25);
        expect(current.q3Source()?.level.time).toBe(250);
        current.step({ elapsedMilliseconds: 200, commands: [] }); expect(current.timeSeconds).toBe(0.45);
        expect(current.q3Source()?.level.frameNum).toBe(9);
      }
    } finally { restored.close(); begin.mockRestore(); think.mockRestore(); end.mockRestore(); actors.mockRestore(); }
  } finally { simulation.close(); await content.close(); }
});
