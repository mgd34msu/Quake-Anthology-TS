import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { createSimulation, savedSimulationSettings } from "../../src/app/bootstrap/simulation/index.ts";
import { simulationQvmCheckpoint, validateSimulationSave } from "../../src/app/bootstrap/simulation/save.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { Q3PlayerState } from "../../src/contracts/protocol.ts";
import type { SaveImage } from "../../src/contracts/session.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import type { WireUserCommand } from "../../src/network/q3/message.ts";
import { UserFileStore } from "../../src/platform/files/writable.ts";
import { readSaveImage, writeSaveImage } from "../../src/persistence/save-image.ts";
import { EngineSession } from "../../src/world/session/session.ts";

test("actual LRCTF shared guest restores disk state into fresh clients without guest lifecycle replay", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qvm-world-save-"));
  const launch = parseApplicationCommand(["--game", "q3-classic-lrctf", "--map", "q3ctf1", "--movement", "q3", "--character", "q3",
    "--mode", "deathmatch", "--dedicated", "--user-content-root", directory]);
  if (launch.kind !== "run") throw new Error("Expected LRCTF launch");
  const options = launch.options;
  async function open(image?: SaveImage) {
    const content = await loadApplicationContent(options), prepared = content.preparedQ3Game;
    if (prepared === null) throw new Error("LRCTF has no prepared qagame");
    const identity = createIdentityOwner("qvm-disk-world"), session = new EngineSession(identity, { kind: "headless" });
    const clients = (image === undefined ? [0] : savedSimulationSettings(image).clientSlots).map(slot => {
      if (image !== undefined) session.closeClient(session.createClient(slot).id);
      return session.createClient(slot);
    });
    let buffer: CommandBuffer | null = null;
    const commands = () => { if (buffer === null) throw new Error("Guest console not bound"); return buffer; };
    let milliseconds = image === undefined ? 0 : savedSimulationSettings(image).hostMilliseconds;
    const simulation = createSimulation({ dedicated: true, identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
      mode: "deathmatch", skill: 1, seed: 7, maxClients: 8,
      q3Guest: { prepared, gameDirectory: "lrctf", writable: new UserFileStore(join(directory, "guest-files")), print: () => undefined,
        common: { milliseconds: () => milliseconds, realTime: output => {
          output?.({ second: 0, minute: 0, hour: 0, day: 1, month: 0, year: 124, weekday: 1, yearDay: 0, isDst: 0 }); return 1704067200;
        }, commands: { executeNow: text => { commands().executeNow(text); }, append: text => commands().append(text), insert: text => commands().insert(text) } } },
      ...(image === undefined ? {} : { restore: image, restoredClients: clients.map(client => client.id) }) });
    session.attachWorld(simulation);
    const guest = simulation.q3Guest();
    if (guest === null) throw new Error("Missing shared QVM source");
    const activeGuest = guest;
    buffer = new CommandBuffer({ dialect: "q3", cvars: guest.state.cvars,
      context: { session: identity.session, origin: { kind: "server-console" } }, print: () => undefined });
    const output: string[] = [];
    const sink = { configstring: (index: number, value: string) => { output.push(`config:${index}:${value}`); },
      sendServerCommand: (slot: number, text: string) => { output.push(`command:${slot}:${text}`); },
      dropClient: async (slot: number, reason: string) => { output.push(`drop:${slot}:${reason}`); } };
    if (image === undefined) await guest.initialize(sink); else guest.completeRestore(sink);
    commands().execute();
    const userCommand = (): WireUserCommand => ({ serverTime: milliseconds, angles: [0, 0, 0], buttons: 1, weapon: 2,
      forwardmove: 100, rightmove: 0, upmove: 0 });
    if (image === undefined) {
      const client = clients[0]; if (client === undefined) throw new Error("Missing test client");
      const admission = await guest.connect(client.id, "\\name\\SavePlayer\\model\\sarge/default\\rate\\25000\\snaps\\20");
      if (admission.kind !== "accepted") throw new Error(admission.reason);
      await guest.begin(admission.player, userCommand());
      await guest.command(admission.player, ["team", "red"]);
    } else expect(output).toEqual([]);
    simulation.drainPresentationEvents(); simulation.events.take(); output.length = 0;
    async function frames(count: number) {
      const trace: { readonly frame: SaveImage["frame"]; readonly player: Q3PlayerState; readonly output: readonly string[] }[] = [];
      for (let frame = 0; frame < count; frame++) {
        milliseconds += 50;
        const player = activeGuest.players()[0]; if (player === undefined) throw new Error("Saved guest client vanished");
        await activeGuest.think(player, userCommand());
        const completed = await session.stepAsync({ elapsedMilliseconds: 50, commands: [] });
        commands().execute(); simulation.drainPresentationEvents(); simulation.events.take();
        trace.push({ frame: completed.snapshot.frame, player: activeGuest.game.data.copyPlayerState(player.sourceEntity), output: output.splice(0) });
      }
      expect(commands().pendingText).toBe("");
      return trace;
    }
    return { simulation, guest, clients, frames, async close() { await guest.shutdown(); session.close(); await content.close(); } };
  }
  let active: Awaited<ReturnType<typeof open>> | null = null;
  try {
    active = await open();
    const start = active.guest.game.data.copyPlayerState(0).origin;
    await active.frames(12);
    const moved = active.guest.game.data.copyPlayerState(0).origin;
    expect(Math.hypot(moved.x - start.x, moved.y - start.y, moved.z - start.z)).toBeGreaterThan(1);
    const actors = active.simulation.actors.checkpoint(), image = active.simulation.checkpoint();
    expect(active.simulation.actors.checkpoint()).toEqual(actors);
    expect(savedSimulationSettings(image).clientSlots).toEqual([0]);
    const guest = simulationQvmCheckpoint(image); if (guest === null) throw new Error("Missing saved qagame bytes");
    expect(() => validateSimulationSave({ ...image, guests: [] })).toThrow("exactly one");
    expect(() => validateSimulationSave({ ...image, guests: [guest, guest] })).toThrow("exactly one");
    expect(() => validateSimulationSave({ ...image, guests: [{ ...guest, module: { ...guest.module, revision: "other-revision" } }] })).toThrow("artifact and API");
    const path = join(directory, "world.sav"); await writeSaveImage(path, image);
    const continuous = await active.frames(12), data = active.guest.checkpoint().data, random = active.simulation.random.checkpoint();
    const oldClient = active.clients[0]?.id;
    if (oldClient === undefined) throw new Error("Missing original client");
    await active.close(); active = null;
    active = await open(await readSaveImage(path));
    expect(active.simulation.clientIdentities()).toEqual(active.clients.map(client => client.id));
    expect(active.clients[0]?.id.equals(oldClient)).toBe(false);
    expect(active.clients[0]?.id.generation).not.toBe(oldClient.generation);
    const restoredGuest = active.guest.checkpoint();
    expect(restoredGuest.data).toEqual(guest.data);
    expect(restoredGuest.instructionIndex).toBe(guest.instructionIndex);
    expect(restoredGuest.programStack).toBe(guest.programStack);
    expect(restoredGuest.operandStack).toEqual(guest.operandStack);
    const links = (saved: SaveImage) => saved.bodies.map(body => ({ slot: body.actor.slot, count: body.linkCount,
      linked: body.linked === null ? null : { bounds: body.linked.absoluteBounds, origin: body.linked.state.origin, angles: body.linked.state.angles } }));
    expect(links(active.simulation.checkpoint())).toEqual(links(image));
    expect(await active.frames(12)).toEqual(continuous);
    expect(active.guest.checkpoint().data).toEqual(data);
    expect(active.simulation.random.checkpoint()).toEqual(random);
  } finally { await active?.close(); await rm(directory, { recursive: true, force: true }); }
}, 120000);
