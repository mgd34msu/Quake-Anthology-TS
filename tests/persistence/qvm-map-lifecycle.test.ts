import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../src/app/bootstrap/simulation/index.ts";
import type { Q3GuestMapTransition } from "../../src/app/bootstrap/simulation/q3/guest-runtime.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { UserFileStore } from "../../src/platform/files/writable.ts";
import { EngineSession } from "../../src/world/session/session.ts";

test("actual LRCTF full map lifecycle writes connected sessions before retirement and reconnects both teams without first-time admission", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qvm-map-lifecycle-"));
  const identity = createIdentityOwner("qvm-map-lifecycle"), session = new EngineSession(identity, { kind: "headless" });
  const clients = [session.createClient(0), session.createClient(1)];
  const writable = new UserFileStore(join(directory, "files"));
  async function open(map: string, transition?: Q3GuestMapTransition) {
    const launch = parseApplicationCommand(["--game", "q3-classic-lrctf", "--map", map, "--movement", "q3", "--character", "q3",
      "--mode", "deathmatch", "--dedicated", "--user-content-root", directory]);
    if (launch.kind !== "run") throw new Error("Expected LRCTF launch");
    const content = await loadApplicationContent(launch.options), prepared = content.preparedQ3Game;
    if (prepared === null) throw new Error("Missing LRCTF qagame");
    let buffer: CommandBuffer | null = null;
    const commands = () => { if (buffer === null) throw new Error("Guest console not bound"); return buffer; };
    const simulation = createSimulation({ dedicated: true, identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
      mode: "deathmatch", skill: 1, seed: 7, maxClients: 8,
      q3Guest: { prepared, gameDirectory: "lrctf", writable, print: () => undefined,
        common: { milliseconds: () => 1000, realTime: () => 1704067200,
          commands: { executeNow: text => { commands().executeNow(text); }, append: text => commands().append(text), insert: text => commands().insert(text) } } } });
    const guest = simulation.q3Guest();
    if (guest === null) throw new Error("Missing guest");
    if (transition !== undefined) {
      guest.state.cvars.restoreSaveState(transition.cvars);
      guest.state.cvars.set("mapname", map, true);
      guest.state.cvars.set("sv_mapname", map, true);
    }
    buffer = new CommandBuffer({ dialect: "q3", cvars: guest.state.cvars,
      context: { session: identity.session, origin: { kind: "server-console" } }, print: () => undefined });
    const output: string[] = [];
    const init = spyOn(guest.game, "initializeAsync"), connects = spyOn(guest.game, "clientConnectAsync"), disconnects = spyOn(guest.game, "clientDisconnectAsync"), shutdown = spyOn(guest.game, "shutdownAsync");
    await guest.initialize({ configstring: (slot, value) => { output.push(`cs:${slot}:${value}`); }, sendServerCommand: (slot, text) => { output.push(`cmd:${slot}:${text}`); }, dropClient: async slot => { throw new Error(`Unexpected drop ${slot}`); } },
      transition === undefined ? { kind: "new" } : { kind: "map-change", clients: transition.clients });
    expect(init).toHaveBeenCalledWith(0, 7, false);
    commands().execute();
    return { guest, simulation, connects, disconnects, shutdown, output, async close() {
      try { await guest.shutdown(); } finally {
        init.mockRestore(); connects.mockRestore(); disconnects.mockRestore(); shutdown.mockRestore(); simulation.close(); await content.close();
      }
    } };
  }
  let active: Awaited<ReturnType<typeof open>> | null = null;
  const command = { serverTime: 0, angles: [0, 0, 0] satisfies [number, number, number], buttons: 0, weapon: 2, forwardmove: 0, rightmove: 0, upmove: 0 };
  try {
    active = await open("q3ctf1");
    for (const client of clients) {
      const admission = await active.guest.connect(client.id, `\\name\\MapPlayer${client.id.slot}\\model\\sarge/default\\rate\\25000\\snaps\\20`);
      if (admission.kind !== "accepted") throw new Error(admission.reason);
      await active.guest.begin(admission.player, command);
      await active.guest.command(admission.player, ["team", client.id.slot === 0 ? "red" : "blue"]);
      expect(active.guest.game.data.copyPlayerState(client.id.slot).persistent[3]).toBe(client.id.slot + 1);
      expect(active.connects).toHaveBeenCalledWith(client.id.slot, true, false);
    }
    const previous = active;
    const userinfo = clients.map(client => previous.guest.state.getUserinfo(client.id.slot));
    const transition = await active.guest.shutdownForMapChange();
    expect(active.shutdown.mock.calls).toEqual([[false]]);
    expect(active.disconnects).not.toHaveBeenCalled();
    expect(active.guest.isRetired).toBe(true);
    expect(transition.clients.map(entry => entry.client)).toEqual(clients.map(client => client.id));
    expect<readonly (string | undefined)[]>(transition.clients.map(entry => entry.userinfo)).toEqual(userinfo);
    const savedSessions = clients.map(client => previous.guest.state.cvars.variableString(`session${client.id.slot}`));
    expect(savedSessions[0]?.split(" ")[0]).toBe("1");
    expect(savedSessions[1]?.split(" ")[0]).toBe("2");
    await active.close(); active = null;
    active = await open("q3ctf2", transition);
    expect(active.guest.state.cvars.variableString("mapname")).toBe("q3ctf2");
    const destination = active;
    expect(() => destination.guest.checkpoint()).toThrow("completed client operations");
    const foreign = createIdentityOwner("foreign-map-client").client(0, 1);
    await expect(active.guest.reconnect(foreign)).rejects.toThrow("not carried");
    for (const client of clients) {
      expect(active.guest.state.getUserinfo(client.id.slot)).toBe(userinfo[client.id.slot]);
      await expect(active.guest.connect(client.id, "\\name\\WrongFirstConnect")).rejects.toThrow("map reconnection");
      const admission = await active.guest.reconnect(client.id);
      if (admission.kind !== "accepted") throw new Error(admission.reason);
      expect(admission.player.client.equals(client.id)).toBe(true);
      expect(active.connects).toHaveBeenCalledWith(client.id.slot, false, false);
      await active.guest.begin(admission.player, command);
      expect(active.guest.game.data.copyPlayerState(client.id.slot).persistent[3]).toBe(client.id.slot + 1);
    }
    expect(active.guest.checkpoint().kind).toBe("qvm");
    await active.guest.shutdown();
    expect(active.shutdown.mock.calls).toEqual([[false]]);
    expect(active.disconnects).not.toHaveBeenCalled();
    expect(active.guest.isRetired).toBe(true);
    expect(clients.every(client => !client.isClosed)).toBe(true);
  } finally { await active?.close(); session.close(); await rm(directory, { recursive: true, force: true }); }
}, 120000);
