import { expect, spyOn, test } from "bun:test";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { ActorCommand } from "../../../src/contracts/session.ts";
import { SaveReader, decodeCheckpointValue } from "../../../src/persistence/value.ts";

for (const edition of ["classic", "rerelease"]) test(`Q2 ${edition} catches up bounded fixed ticks without losing debt or replaying input`, async () => {
  const launch = parseApplicationCommand(["--game", `q2-${edition}-baseq2`, "--map", "base1", "--movement", "q2", "--dedicated"]);
  if (launch.kind !== "run") throw new Error("Missing launch");
  const content = await loadApplicationContent(launch.options), identity = createIdentityOwner(`q2-catchup-${edition}`), client = identity.client(0, 0);
  const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts, skill: 0, mode: "singleplayer", seed: 1, maxClients: 1,
    playerIdentity: player => ({ seat: player.slot, socialId: "" }) });
  try {
    const actor = simulation.admitPlayer(client).actor, source = simulation.q2Source();
    if (source === null) throw new Error("Missing Q2 source");
    const think = spyOn(source.players, "afterClientThink");
    const command: ActorCommand = { actor, sequence: 0, source: { kind: "local-seat", seat: identity.seat(0), client },
      command: { kind: "q2-classic", milliseconds: 100, buttons: 0, angleShorts: [0, 0, 0], forwardMove: 0, sideMove: 0, upMove: 0, impulse: 0, lightLevel: 0 } };
    simulation.step({ elapsedMilliseconds: 500, commands: [command] });
    expect(simulation.timeSeconds).toBeCloseTo(0.2);
    expect(think).toHaveBeenCalledTimes(1);
    simulation.drainPresentationEvents();
    const saved = simulation.checkpoint().providers.find(provider => provider.schema === "world:simulation");
    if (saved === undefined) throw new Error("Missing clock checkpoint");
    expect(new SaveReader(decodeCheckpointValue(saved.bytes), "clock").field("sourceSchedulingMilliseconds").number()).toBe(500);
    simulation.step({ elapsedMilliseconds: 0, commands: [] }); expect(simulation.timeSeconds).toBeCloseTo(0.2);
    simulation.step({ elapsedMilliseconds: 1, commands: [] }); expect(simulation.timeSeconds).toBeCloseTo(0.4);
    simulation.step({ elapsedMilliseconds: 1, commands: [] }); expect(simulation.timeSeconds).toBeCloseTo(edition === "rerelease" ? 0.525 : 0.6);
    simulation.step({ elapsedMilliseconds: 100, commands: [] }); expect(simulation.timeSeconds).toBeCloseTo(edition === "rerelease" ? 0.625 : 0.7);
    simulation.step({ elapsedMilliseconds: 250, commands: [] }); expect(simulation.timeSeconds).toBeCloseTo(edition === "rerelease" ? 0.825 : 0.9);
    simulation.step({ elapsedMilliseconds: 1, commands: [] }); expect(simulation.timeSeconds).toBeCloseTo(edition === "rerelease" ? 0.875 : 0.9);
    expect(think).toHaveBeenCalledTimes(1);
    const rerelease = source.product.rerelease;
    if (rerelease !== null) {
      const before = simulation.timeSeconds;
      rerelease.players.intermission = { kind: "intermission", map: "base2", started: before, exit: true, landmark: null };
      rerelease.players.intermissionFlags = 32;
      rerelease.players.intermissionFadeUntil = before + 1.3;
      const fade = spyOn(rerelease.players, "fadeFrame");
      for (let bundle = 0; bundle < 7; bundle++) simulation.step({ elapsedMilliseconds: 200, commands: [] });
      expect(simulation.timeSeconds - before).toBeCloseTo(1.3);
      expect(fade).toHaveBeenCalledTimes(52);
      expect(simulation.takeTransitions()).toHaveLength(1);
      expect(think).toHaveBeenCalledTimes(1);
      fade.mockRestore();
    }
    think.mockRestore();
  } finally { simulation.close(); await content.close(); }
}, 30000);

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
