import { expect, spyOn, test } from "bun:test";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { SharedSimulation } from "../../../src/app/bootstrap/simulation/runtime.ts";
import { createQ3ApplicationServerHost } from "../../../src/app/bootstrap/simulation/network-q3.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { FrameContext } from "../../../src/contracts/time.ts";
import type { GameFamily } from "../../../src/contracts/content.ts";
import { SaveReader, decodeCheckpointValue } from "../../../src/persistence/value.ts";
import { EngineSession } from "../../../src/world/session/session.ts";

function accounting(simulation: SharedSimulation) {
  simulation.drainPresentationEvents();
  const image = simulation.checkpoint(), provider = image.providers.find(entry => entry.schema === "world:simulation");
  if (provider === undefined) throw new Error("Missing simulation accounting");
  const state = new SaveReader(decodeCheckpointValue(provider.bytes), "settlement-accounting");
  return { host: state.field("hostMilliseconds").number(), scheduled: state.field("sourceSchedulingMilliseconds").number() };
}

for (const fixture of [{ movement: "q3", character: "q3", residual: 0 }, { movement: "q3", character: "q3", residual: 25 },
  { movement: "q1", character: "q1", residual: 25 }] satisfies readonly { movement: GameFamily; character: GameFamily; residual: number }[]) {
  test(`${fixture.movement} round settles four shared frames at current time and preserves ${fixture.residual}ms residual`, async () => {
    const launch = parseApplicationCommand(["--content-root", "/home/buzzkill/Projects/qfiles", "--game", "q3-baseq3", "--map", "q3dm1",
      "--movement", fixture.movement, "--character", fixture.character, "--mode", "deathmatch", "--dedicated"]);
    if (launch.kind !== "run") throw new Error("Missing source settlement launch");
    const content = await loadApplicationContent(launch.options), identity = createIdentityOwner(`settlement-${fixture.movement}-${fixture.residual}`);
    const session = new EngineSession(identity, { kind: "headless" });
    const simulation = new SharedSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
      skill: 1, mode: "deathmatch", seed: 7, maxClients: 1, dedicated: true });
    session.attachWorld(simulation);
    try {
      const client = session.createClient(0), originalActor = simulation.admitPlayer(client.id).actor;
      expect(() => simulation.beginSourceRoundSettlement()).toThrow("fresh matching");
      await session.stepAsync({ elapsedMilliseconds: 100 + fixture.residual, commands: [] });
      const initial = accounting(simulation), start = simulation.timeSeconds * 1000, initialFrame = simulation.clock.frame.frame;
      expect(start).toBe(100); expect(initial.scheduled - start).toBe(fixture.residual);
      expect(simulation.restartSourceRound()).toEqual([client.id]);
      simulation.beginSourceRoundSettlement();
      const source = simulation.q3Source();
      if (source === null) throw new Error("Missing restarted native source");
      const sourceFrames: FrameContext[] = [], begin = source.beginFrame.bind(source);
      const frame = spyOn(source, "beginFrame").mockImplementation(current => { sourceFrames.push(current); begin(current); });
      const end = spyOn(source, "endFrame"), actorTurn = spyOn(source, "runActor");
      const bots = spyOn(simulation.botServices, "frame").mockImplementation(() => { throw new Error("Settlement generated bot input"); });
      const wire = createQ3ApplicationServerHost({ session, simulation, content, print() {} });
      try {
        expect(() => simulation.beginSourceRoundSettlement()).toThrow("fresh matching");
        expect(() => simulation.restartSourceRound()).toThrow("Complete or retire");
        await expect(session.stepAsync({ elapsedMilliseconds: 50, commands: [] })).rejects.toThrow("empty 100ms");
        await expect(session.stepAsync({ elapsedMilliseconds: 100, commands: [{ actor: originalActor,
          source: { kind: "remote-client", client: client.id }, sequence: 0,
          command: { kind: "q3", serverTimeMilliseconds: 100, angleWords: [0, 0, 0], forwardMove: 0,
            rightMove: 0, upMove: 0, buttons: 0, weapon: 2 } }] })).rejects.toThrow("empty 100ms");
        expect(() => simulation.checkpoint()).toThrow("completed source round settlement");
        for (let index = 0; index < 3; index++) {
          const output = await session.stepAsync({ elapsedMilliseconds: 100, commands: [] });
          expect(session.snapshot).toBe(output.snapshot);
          expect(output.snapshot.frame).toMatchObject({ frame: initialFrame + index + 1, phase: "frame-exit",
            time: { kind: "milliseconds", value: start + (index + 1) * 100 } });
          expect(source.level.time).toBe(start + index * 100);
          expect(source.sourceState().time).toBe(start + (index + 1) * 100);
          expect(wire.time()).toBe(start + (index + 1) * 100);
        }
        expect(() => simulation.completeSourceRoundSettlement()).toThrow("four completed");
        const command = { serverTime: 73, angles: [1, 2, 3], buttons: 0, weapon: 2, forwardmove: 0, rightmove: 0, upmove: 0 } satisfies import("../../../src/network/q3/message.ts").WireUserCommand;
        source.host.serverState.setUserCommand(0, command);
        const actor = simulation.admitPlayer(client.id).actor;
        expect(simulation.actors.isLive(originalActor)).toBe(false); expect(simulation.actors.isLive(actor)).toBe(true);
        await session.stepAsync({ elapsedMilliseconds: 100, commands: [] });
        expect(sourceFrames.map(frame => frame.time.value)).toEqual([start, start + 100, start + 200, start + 300]);
        expect(sourceFrames.map(frame => frame.frame)).toEqual([initialFrame + 1, initialFrame + 2, initialFrame + 3, initialFrame + 4]);
        expect(end).toHaveBeenCalledTimes(4); expect(actorTurn.mock.calls.some(([turn]) => turn.id.equals(actor))).toBe(true);
        expect(bots).not.toHaveBeenCalled();
        expect(source.host.serverState.getUserCommand(0)).toEqual(command);
        expect(simulation.movementPlayer(actor)?.character).toBe(fixture.character);
        expect(simulation.timeSeconds * 1000).toBe(start + 400); expect(source.level.time).toBe(start + 300);
        await expect(session.stepAsync({ elapsedMilliseconds: 100, commands: [] })).rejects.toThrow("four frames");
        simulation.completeSourceRoundSettlement(); bots.mockRestore();
        const after = accounting(simulation);
        expect(after).toEqual({ host: initial.host + 400, scheduled: initial.scheduled + 400 });
        expect(after.scheduled - simulation.timeSeconds * 1000).toBe(fixture.residual);
        expect(() => simulation.beginSourceRoundSettlement()).toThrow("fresh matching");
        await session.stepAsync({ elapsedMilliseconds: 100, commands: [] });
        expect(sourceFrames.slice(4).map(frame => frame.time.value)).toEqual([start + 450, start + 500]);
        expect(end).toHaveBeenCalledTimes(6);
        const normal = accounting(simulation);
        expect(normal.scheduled - simulation.timeSeconds * 1000).toBe(fixture.residual);
        simulation.restartSourceRound();
        await session.stepAsync({ elapsedMilliseconds: 0, commands: [] });
        expect(() => simulation.beginSourceRoundSettlement()).toThrow("fresh matching");
        if (fixture.movement === "q3" && fixture.residual === 0) {
          simulation.restartSourceRound(); simulation.beginSourceRoundSettlement();
          const failingSource = simulation.q3Source(), failure = new Error("settlement frame failed");
          if (failingSource === null) throw new Error("Missing failure fixture source");
          const fault = spyOn(failingSource, "beginFrame").mockImplementation(() => { throw failure; });
          try {
            await expect(session.stepAsync({ elapsedMilliseconds: 100, commands: [] })).rejects.toBe(failure);
            await expect(session.stepAsync({ elapsedMilliseconds: 100, commands: [] })).rejects.toThrow("settlement failed");
            expect(() => simulation.checkpoint()).toThrow("completed source round settlement");
            expect(() => simulation.completeSourceRoundSettlement()).toThrow("four completed");
          } finally { fault.mockRestore(); }
        }
      } finally { frame.mockRestore(); end.mockRestore(); actorTurn.mockRestore(); bots.mockRestore(); }
    } finally { session.close(); await content.close(); }
  }, 115000);
}
