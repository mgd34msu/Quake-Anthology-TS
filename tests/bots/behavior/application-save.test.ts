import { ApplicationQ3Client } from "../../../src/app/bootstrap/q3-client.ts";
import { GameCommandRuntime } from "../../../src/content/q3/team-arena/commands.ts";
import { BaseScoreboard } from "../../../src/content/q3/presentation/scoreboard.ts";
import { MoveType } from "../../../src/content/q3/base/shared/definitions.ts";
import { ApplicationAudio } from "../../../src/app/bootstrap/audio.ts";
import { readSaveImage } from "../../../src/persistence/save-image.ts";
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


test("restored native dead scoreboard requests saved player rows after initial open and committed load", async () => {
  const directory = await mkdtemp(join(tmpdir(), "application-restored-scoreboard-"));
  const parsed = parseApplicationCommand(["--game", "q3-baseq3", "--map", "q3dm1", "--movement", "q3", "--character", "q3", "--mode", "deathmatch",
    "--dedicated", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240", "--user-content-root", directory]);
  if (parsed.kind !== "run") throw new Error("Expected native scoreboard launch");
  let app: Application | null = null;
  const draws: { scores: number; clients: number[]; dead: boolean; requested: boolean }[] = [];
  const scoreboardRequests = spyOn(GameCommandRuntime.prototype, "scoreboard");
  const received: { client: number; text: string; seat: number }[] = [];
  const originalReceive = ApplicationQ3Client.prototype.receive;
  const receive = spyOn(ApplicationQ3Client.prototype, "receive").mockImplementation(function(this: ApplicationQ3Client, state, events, commands) {
    for (const event of events) if (event.kind === "q3-source" && event.event.kind === "server-command")
      received.push({ client: event.event.client, text: event.event.text, seat: this.options.local.player.seat.client.id.slot });
    return originalReceive.call(this, state, events, commands);
  });
  const originalDraw = BaseScoreboard.prototype.draw;
  const draw = spyOn(BaseScoreboard.prototype, "draw").mockImplementation(async function(this: BaseScoreboard) {
    draws.push({ scores: this.state.numScores, clients: this.state.scores.slice(0, this.state.numScores).map(score => score.client),
      dead: this.state.predictedPlayerState.pmType === MoveType.PM_DEAD, requested: this.state.showScores });
    return originalDraw.call(this);
  });
  try {
    app = await Application.open(parsed.options, { print: () => undefined, saveDirectory: join(directory, "saves") });
    const human = app.session.createClient(0), player = app.simulation.admitPlayer(human.id);
    app.queueCommand("addbot", ["sarge", "3"], null);
    for (let frame = 0; frame < 60; frame++) await app.step(100);
    expect(app.botClients).toHaveLength(1);
    app.simulation.playerCommand(player.actor, "kill", []);
    await app.step(100);
    expect(app.simulation.playerUi(player.actor).health).toBeLessThanOrEqual(0);
    const path = join(directory, "dead.sav"); await app.saveGame(path);
    const image = await readSaveImage(path);
    await app.close(); app = null;
    scoreboardRequests.mockClear();
    app = await Application.open({ ...parsed.options, dedicated: false }, { print: () => undefined }, image.recipe, undefined, image);
    await app.step(100); await app.step(100);
    expect(scoreboardRequests).toHaveBeenCalledTimes(1);
    expect(received.some(event => event.client === 0 && event.seat === 0 && event.text.startsWith("scores 2 "))).toBe(true);
    expect(received.some(event => event.text.includes("server: score"))).toBe(false);
    expect(draws.filter(value => value.dead && !value.requested).map(value => ({ scores: value.scores, clients: [...value.clients].sort() })))
      .toContainEqual({ scores: 2, clients: [0, 1] });
    draws.length = 0;
    scoreboardRequests.mockClear();
    const original = app.simulation;
    const failure = spyOn(ApplicationAudio.prototype, "prepareEnvironment").mockRejectedValueOnce(new Error("injected scoreboard candidate failure"));
    try { await expect(app.loadGame(path)).rejects.toThrow("injected scoreboard candidate failure"); }
    finally { failure.mockRestore(); }
    expect(app.simulation).toBe(original);
    await app.step(100);
    expect(scoreboardRequests).not.toHaveBeenCalled();
    draws.length = 0; received.length = 0;
    await app.loadGame(path);
    await app.step(100); await app.step(100);
    expect(scoreboardRequests).toHaveBeenCalledTimes(1);
    expect(draws.filter(value => value.dead && !value.requested).map(value => ({ scores: value.scores, clients: [...value.clients].sort() })))
      .toContainEqual({ scores: 2, clients: [0, 1] });
  } finally { draw.mockRestore(); receive.mockRestore(); scoreboardRequests.mockRestore(); await app?.close(); await rm(directory, { recursive: true, force: true }); }
}, 120000);
