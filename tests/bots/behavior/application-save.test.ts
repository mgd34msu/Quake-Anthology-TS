import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { SourceBotDirector } from "../../../src/bots/behavior/index.ts";
import type { SessionClient } from "../../../src/world/session/session.ts";

test("Application restores native bot disk state with unpublished clients and exact continuation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "application-bot-save-"));
  const parsed = parseApplicationCommand(["--game", "q3-baseq3", "--map", "q3dm1", "--movement", "q3", "--character", "q3", "--mode", "deathmatch", "--dedicated", "--user-content-root", directory]);
  if (parsed.kind !== "run") throw new Error("Expected native bot launch");
  const options = parsed.options;
  async function open() {
    const app = await Application.open(options, { print: () => undefined, saveDirectory: join(directory, "saves") });
    const human = app.session.createClient(0);
    app.simulation.admitPlayer(human.id);
    return { app, human };
  }
  function sample(app: Application) {
    const source = app.simulation.q3Source();
    if (source === null) throw new Error("Expected native source");
    const state = source.sourceState();
    return structuredClone({ time: state.time, entities: state.entities.map(({ actor, ...entity }) => entity),
      clients: state.clients.map(({ actor, ...client }) => client), configstrings: state.configstrings });
  }
  async function frames(app: Application, count: number) {
    const trace: ReturnType<typeof sample>[] = [];
    for (let frame = 0; frame < count; frame++) { await app.step(100); trace.push(sample(app)); }
    return trace;
  }
  let active: Awaited<ReturnType<typeof open>> | null = null;
  try {
    active = await open();
    active.app.queueCommand("addbot", ["ranger", "3"], null);
    active.app.queueCommand("addbot", ["sarge", "3"], null);
    await frames(active.app, 80);
    expect(active.app.simulation.players()).toHaveLength(3);
    const path = join(directory, "native.sav");
    await active.app.saveGame(path);
    const continuous = await frames(active.app, 20), random = active.app.simulation.random.checkpoint();
    await active.app.close(); active = null;
    active = await open();
    const { app, human } = active, original = app.simulation;
    const drafts: SessionClient[] = [], prepareClient = app.session.prepareClient.bind(app.session);
    const prepare = spyOn(app.session, "prepareClient").mockImplementation(slot => { const draft = prepareClient(slot); drafts.push(draft); return draft; });
    const publish = spyOn(app.session, "replaceWorld").mockImplementationOnce(() => { throw new Error("injected candidate publication failure"); });
    try { await expect(app.loadGame(path)).rejects.toThrow("injected candidate publication failure"); }
    finally { prepare.mockRestore(); publish.mockRestore(); }
    expect(app.simulation).toBe(original);
    expect(human.isClosed).toBe(false);
    expect(drafts).toHaveLength(2);
    expect(drafts.every(draft => draft.isClosed)).toBe(true);
    const load = spyOn(SourceBotDirector.prototype, "load");
    try { await app.loadGame(path); expect(load).not.toHaveBeenCalled(); }
    finally { load.mockRestore(); }
    expect(app.simulation.players()).toHaveLength(3);
    expect(app.simulation.players().some(actor => app.simulation.movementPlayer(actor)?.client === human.id)).toBe(true);
    expect(await frames(app, 20)).toEqual(continuous);
    expect(app.simulation.random.checkpoint()).toEqual(random);
    const reused = app.simulation.players().map(actor => app.simulation.movementPlayer(actor)?.client);
    app.queueCommand("addbot", ["visor", "3"], null);
    await frames(app, 5);
    expect(app.simulation.players()).toHaveLength(4);
    const removed = app.simulation.players().map(actor => app.simulation.movementPlayer(actor)?.client).find(client => client !== undefined && !reused.includes(client));
    if (removed === undefined) throw new Error("Expected additional bot client");
    await app.loadGame(path);
    expect(app.simulation.players().map(actor => app.simulation.movementPlayer(actor)?.client)).toEqual(reused);
    const replacement = app.session.createClient(removed.slot);
    expect(replacement.id.equals(removed)).toBe(false);
    app.session.closeClient(replacement.id);
  } finally { await active?.app.close(); await rm(directory, { recursive: true, force: true }); }
}, 120000);

test("native local autosave waits for a completed frame and restore preserves its seat", async () => {
  const directory = await mkdtemp(join(tmpdir(), "application-native-autosave-"));
  const parsed = parseApplicationCommand(["--game", "q3-baseq3", "--map", "q3dm1", "--movement", "q3", "--character", "q3", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240", "--user-content-root", directory]);
  if (parsed.kind !== "run") throw new Error("Expected local native launch");
  const app = await Application.open(parsed.options, { print: () => undefined, saveDirectory: join(directory, "saves") });
  try {
    const path = join(directory, "saves", "q3-baseq3", "autosave.sav");
    expect(await Bun.file(path).exists()).toBe(false);
    await app.step(50);
    expect(await Bun.file(path).exists()).toBe(true);
    const bytes = await Bun.file(path).bytes();
    const local = app.localPlayers[0];
    if (local === undefined) throw new Error("Expected local seat");
    await app.loadGame(path);
    expect(app.localPlayers[0]?.seat.client).toBe(local.seat.client);
    await app.step(50);
    expect(await Bun.file(path).bytes()).toEqual(bytes);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
}, 120000);
