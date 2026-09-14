import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../src/app/bootstrap/simulation/index.ts";
import { createQ3ApplicationServerHost } from "../../src/app/bootstrap/simulation/network-q3.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { ActorCommand } from "../../src/contracts/session.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { fromQ3PlayerState, toQ3UserCommand } from "../../src/network/q3/adapters.ts";
import type { WireUserCommand } from "../../src/network/q3/message.ts";
import { UserFileStore } from "../../src/platform/files/writable.ts";
import { EngineSession } from "../../src/world/session/session.ts";

test("actual local LRCTF uses shared admission and delivers each local command before its authoritative frame", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qvm-local-world-"));
  const launch = parseApplicationCommand(["--game", "q3-classic-lrctf", "--map", "q3ctf1", "--movement", "q3", "--character", "q3",
    "--mode", "deathmatch", "--user-content-root", directory]);
  if (launch.kind !== "run") throw new Error("Expected local LRCTF launch");
  const content = await loadApplicationContent(launch.options);
  const identity = createIdentityOwner("local-qvm-authority"), session = new EngineSession(identity, { kind: "local" });
  let closeGuest: (() => Promise<void>) | undefined;
  try {
    const prepared = content.preparedQ3Game;
    if (prepared === null) throw new Error("Missing LRCTF qagame");
    let milliseconds = 0, buffer: CommandBuffer | null = null;
    const commands = () => { if (buffer === null) throw new Error("Guest console not bound"); return buffer; };
    const simulation = createSimulation({ dedicated: false, identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
      mode: "deathmatch", skill: 1, seed: 7, maxClients: 8,
      q3Guest: { prepared, gameDirectory: "lrctf", writable: new UserFileStore(join(directory, "files")), print: () => undefined,
        common: { milliseconds: () => milliseconds, realTime: () => 1704067200,
          commands: { executeNow: text => { commands().executeNow(text); }, append: text => commands().append(text), insert: text => commands().insert(text) } } } });
    session.attachWorld(simulation);
    const guest = simulation.q3Guest();
    if (guest === null) throw new Error("Missing local guest");
    closeGuest = () => guest.shutdown();
    buffer = new CommandBuffer({ dialect: "q3", cvars: guest.state.cvars,
      context: { session: identity.session, origin: { kind: "server-console" } }, print: () => undefined });
    await guest.initialize({ configstring: () => undefined, sendServerCommand: () => undefined, dropClient: async () => undefined });
    commands().execute();
    expect(guest.state.cvars.variableString("dedicated")).toBe("0");
    const authority = createQ3ApplicationServerHost({ session, simulation, content, print: () => undefined });
    await authority.prepare(7, 1);
    const client = session.createClient(0), seat = session.createSeat(0, client);
    const info = "\\name\\LocalGuest\\model\\sarge/default\\rate\\25000\\snaps\\20\\ip\\localhost";
    const admission = await authority.connect(client.id, info);
    if (admission.kind !== "accepted") throw new Error(admission.reason);
    const player = admission.player;
    const wire = (): WireUserCommand => ({ serverTime: milliseconds, angles: [0, 0, 0], buttons: 0, weapon: 2, forwardmove: 100, rightmove: 0, upmove: 0 });
    await authority.begin?.(player, wire());
    await authority.command(player, "team", ["red"]);
    await authority.userinfo(player, info.replace("LocalGuest", "RenamedGuest"));
    expect(authority.gameState(player, 1).clientNumber).toBe(0);
    const calls: string[] = [], originalThink = guest.think.bind(guest), originalFrame = guest.runFrame.bind(guest);
    const think = spyOn(guest, "think").mockImplementation(async (target, command) => { calls.push("think"); await originalThink(target, command); });
    const frame = spyOn(guest, "runFrame").mockImplementation(async time => { calls.push("frame"); await originalFrame(time); });
    try {
      const input = (): ActorCommand => ({ actor: player.actor, source: { kind: "local-seat", seat: seat.id, client: client.id }, sequence: milliseconds, command: toQ3UserCommand(wire()) });
      const start = guest.game.data.copyPlayerState(0).origin;
      for (let index = 0; index < 12; index++) {
        milliseconds += 50;
        await session.stepAsync({ elapsedMilliseconds: 50, commands: [input()] });
        commands().execute();
      }
      expect(calls).toEqual(Array.from({ length: 12 }, () => ["think", "frame"]).flat());
      const state = guest.game.data.copyPlayerState(0);
      expect(Math.hypot(state.origin.x - start.x, state.origin.y - start.y, state.origin.z - start.z)).toBeGreaterThan(1);
      expect(simulation.playerView(player.actor)).toEqual({ origin: state.origin, angles: state.viewAngles, viewHeight: state.viewHeight });
      expect(simulation.movementPlayer(player.actor)).toBeNull();
      const actors = simulation.actors.checkpoint();
      expect(authority.snapshot(player).player).toEqual(fromQ3PlayerState(state, "baseq3"));
      expect(simulation.actors.checkpoint()).toEqual(actors);
      const time = simulation.timeSeconds;
      await expect(session.stepAsync({ elapsedMilliseconds: 50, commands: [input(), input()] })).rejects.toThrow("once per frame");
      const foreign = createIdentityOwner("foreign-local-seat");
      await expect(session.stepAsync({ elapsedMilliseconds: 50, commands: [{ ...input(), source: { kind: "local-seat", seat: foreign.seat(0), client: client.id } }] })).rejects.toThrow("owned seat");
      expect(simulation.timeSeconds).toBe(time);
      expect(think).toHaveBeenCalledTimes(12);
      await authority.disconnect(player, "Local fixture complete");
      expect(guest.players()).toEqual([]);
      expect(client.isClosed).toBe(true);
    } finally { think.mockRestore(); frame.mockRestore(); }
  } finally { await closeGuest?.(); session.close(); await content.close(); await rm(directory, { recursive: true, force: true }); }
}, 120000);
