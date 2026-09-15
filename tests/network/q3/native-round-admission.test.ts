import { expect, spyOn, test } from "bun:test";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createQ3ApplicationServerHost } from "../../../src/app/bootstrap/simulation/network-q3.ts";
import { SharedSimulation } from "../../../src/app/bootstrap/simulation/runtime.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { EngineSession } from "../../../src/world/session/session.ts";

test("native round admission returns source denial but preserves connect, begin and cleanup failures", async () => {
  const launch = parseApplicationCommand(["--content-root", "/home/buzzkill/Projects/qfiles", "--game", "q3-baseq3", "--map", "q3dm1", "--movement", "q3", "--character", "q3", "--dedicated", "--mode", "deathmatch"]);
  if (launch.kind !== "run") throw new Error("Missing native admission fixture");
  const content = await loadApplicationContent(launch.options);
  try {
    for (const failureAt of ["denial", "connect", "begin", "cleanup"]) {
      const identity = createIdentityOwner(`native-round-${failureAt}`), session = new EngineSession(identity, { kind: "headless" });
      const simulation = new SharedSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
        mode: "deathmatch", skill: 1, seed: 7, maxClients: 1, dedicated: true });
      session.attachWorld(simulation);
      const client = session.createClient(0), oldActor = simulation.admitPlayer(client.id).actor;
      const host = createQ3ApplicationServerHost({ session, simulation, content, print() {} });
      const round = host.sourceRound;
      if (round === undefined) throw new Error("Native authority omitted round binding");
      try {
        round.preflight(); expect(simulation.restartSourceRound()).toEqual([client.id]); round.rebind();
        const source = simulation.q3Source();
        if (source === null) throw new Error("Missing restarted source");
        const failure = new Error(`unexpected ${failureAt}`), cleanupFailure = new Error("cleanup failed");
        const connect = spyOn(source.admission, "connect"), begin = spyOn(source.admission, "begin");
        const cleanup = spyOn(simulation, "disconnectPlayer");
        if (failureAt === "denial") {
          source.host.cvars.set("g_password", "required-secret", true); source.settings.update();
        } else if (failureAt === "connect") connect.mockImplementation(() => { throw failure; });
        else begin.mockImplementation(() => { throw failure; });
        if (failureAt === "cleanup") cleanup.mockImplementation(() => { throw cleanupFailure; });
        const command = { serverTime: 123, angles: [1, 2, 3], buttons: 0, weapon: 2, forwardmove: 0, rightmove: 0, upmove: 0 } satisfies import("../../../src/network/q3/message.ts").WireUserCommand;
        try {
          const reconnect = Promise.resolve(round.reconnect(client.id, "\\name\\Retained\\ip\\10.0.0.5", command));
          if (failureAt === "denial") {
            expect(await reconnect).toEqual({ kind: "rejected", reason: "Invalid password" }); expect(begin).not.toHaveBeenCalled();
          } else if (failureAt !== "cleanup") await expect(reconnect).rejects.toBe(failure);
          else {
            try { await reconnect; throw new Error("Expected combined failure"); }
            catch (error) {
              if (!(error instanceof AggregateError)) throw error;
              const failures: unknown = error.errors;
              expect(failures).toEqual([failure, cleanupFailure]);
            }
          }
          expect(connect).toHaveBeenCalledTimes(1); expect(connect.mock.calls[0]?.slice(1)).toEqual([false, false]);
          expect(cleanup).toHaveBeenCalledTimes(1);
          expect(simulation.actors.isLive(oldActor)).toBe(false); expect(client.isClosed).toBe(false);
          if (failureAt !== "cleanup") expect(simulation.players()).toEqual([]);
          expect(source.host.serverState.getUserCommand(0)).toEqual(command);
        } finally { connect.mockRestore(); begin.mockRestore(); cleanup.mockRestore(); }
      } finally { session.close(); }
    }
  } finally { await content.close(); }
}, 115000);
