import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { fitClassicUserinfo } from "../../src/compat/q2/classic/records.ts";
import { fitRereleaseText } from "../../src/compat/q2/rerelease/module.ts";
import { sourceFrameMilliseconds } from "../../src/app/bootstrap/frame-time.ts";
import { scanGameFloat, scanGameVector } from "../../src/core/game-numeric.ts";
import { QuakeWorldChannel } from "../../src/network/q1/channels.ts";
import { BotAssetFiles } from "../../src/bots/behavior/assets.ts";
import { BotChatLibrary } from "../../src/bots/behavior/library/chat.ts";
import { BotMemory } from "../../src/bots/behavior/library/memory.ts";
import { BotScriptSources } from "../../src/bots/behavior/library/script-sources.ts";
import { ScriptGlobalDefines } from "../../src/content/legacy-script/preprocessor.ts";
import { corpusHasFile } from "../support/corpus.ts";

test("short and empty vectors read missing components as zero instead of throwing", () => {
  const vectors: readonly (readonly [string, readonly number[]])[] = [["1 2 3", [1, 2, 3]], ["1 2", [1, 2, 0]], ["5", [5, 0, 0]], ["", [0, 0, 0]]];
  for (const [text, expected] of vectors) {
    const value = scanGameVector(text);
    expect([value.x, value.y, value.z]).toEqual([...expected]);
  }
  const first = scanGameFloat("5");
  expect(scanGameFloat("5", first.nextOffset).value).toBe(0);
});

test("oversized guest strings are cut to their buffers", () => {
  const classic = fitClassicUserinfo(`\\name\\${"a".repeat(600)}`);
  expect(classic.length).toBe(511);
  expect(fitClassicUserinfo("\\name\\Ж")).toBe("\\name\\?");
  expect(fitClassicUserinfo("a\0b")).toBe("a");
  const rerelease = fitRereleaseText("Ж".repeat(2000), 2048);
  expect(new TextEncoder().encode(rerelease).length).toBeLessThan(2048);
  expect(rerelease.length).toBe(1023);
  expect(fitRereleaseText("short", 2048)).toBe("short");
});

test("a QW peer cannot jump the server channel to the end of the sequence space", () => {
  const server = new QuakeWorldChannel("server", 7);
  const packet = (sequence: number): Uint8Array => {
    const bytes = new Uint8Array(10), view = new DataView(bytes.buffer);
    view.setUint32(0, sequence, true); view.setUint16(8, 7, true);
    return bytes;
  };
  expect(server.receive(packet(0x7fffffff), 0)).toBeNull();
  expect(server.outgoingSequence).toBeLessThan(0x10000);
  expect(server.receive(packet(5), 1)).not.toBeNull();
  expect(server.transmit(new Uint8Array(0), 2, false).length).toBeGreaterThan(0);
});

function chatLibrary(match: string): BotChatLibrary {
  const files = new BotAssetFiles();
  for (const [name, text] of Object.entries({ "syn.c": "", "rnd.c": "", "match.c": match, "rchat.c": "" })) files.add(`botfiles/${name}`, new TextEncoder().encode(text));
  const memory = new BotMemory(), reader = new BotScriptSources(files, new ScriptGlobalDefines(), () => undefined, () => undefined, memory);
  const chats = new BotChatLibrary(reader, { random: { nextInt: () => 0 }, time: () => 0, *clientCommand() { return undefined; } }, {}, memory);
  chats.setup();
  return chats;
}

test("a long chat line that pushes a match variable past the signed-char offset reads as absent", () => {
  const chats = chatLibrary('1 { 0, ": ", 1, " help ", 2 = (7,9); }');
  expect(chats.findMatch(`bob: ${"a".repeat(130)} help z`, 1)?.type).toBe(7);
});

const q3 = corpusHasFile("q3a/baseq3/pak0.pk3");
test.skipIf(!q3)("peer text cannot end a native Q3 server or inject console commands through a vote", async () => {
  const directory = await mkdtemp(join(tmpdir(), "q3-peer-commands-"));
  const parsed = parseApplicationCommand(["--game", "q3-baseq3", "--map", "q3dm1", "--movement", "q3", "--character", "q3", "--mode", "deathmatch", "--dedicated", "--user-content-root", directory, "+set", "g_gametype", "3"]);
  if (parsed.kind !== "run") throw new Error("Expected a server launch");
  const app = await Application.open(parsed.options, { print: () => undefined, saveDirectory: join(directory, "saves") });
  try {
    const client = app.session.createClient(0), actor = app.simulation.admitPlayer(client.id).actor;
    await app.step(100);
    const source = app.simulation.q3Source();
    if (source === null) throw new Error("Expected the native Q3 source");
    app.simulation.playerCommand(actor, "team", ["red"]);
    await app.step(100);
    for (const parameter of ["q3dm1\nquit", "q3dm1\rquit", "1\"\nquit\n//"]) {
      app.simulation.playerCommand(actor, "callvote", ["map", parameter]);
      expect(source.level.vote.time).toBe(0);
    }
    app.simulation.playerCommand(actor, "callvote", ["map_restart", ""]);
    expect(source.level.vote.time).not.toBe(0);
    app.simulation.playerCommand(actor, "vote", ["no"]);
    const commands: readonly (readonly [string, ...string[]])[] = [["gc", "0", "7"], ["gc", "60", "0"], ["follow", "a\x1b"]];
    for (const [name, ...args] of commands)
      expect(() => { app.simulation.playerCommand(actor, name, [...args]); }).not.toThrow();
    // Team changes are rate limited, so the automatic-follow sentinel gets a client that hasn't changed team yet.
    const spectator = app.session.createClient(1), watcher = app.simulation.admitPlayer(spectator.id).actor;
    await app.step(100);
    app.simulation.playerCommand(actor, "team", ["spectator"]);
    app.simulation.playerCommand(watcher, "team", ["follow1"]);
    for (const name of ["follownext", "followprev"]) expect(() => { app.simulation.playerCommand(watcher, name, []); }).not.toThrow();
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
}, 120000);

const q1 = corpusHasFile("q1/id1/pak0.pak");
test.skipIf(!q1)("a dedicated server restarts its map after a frame fault and exits when faults repeat", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dedicated-fault-"));
  const parsed = parseApplicationCommand(["--game", "q1-classic-id1", "--map", "start", "--dedicated", "--user-content-root", directory]);
  if (parsed.kind !== "run") throw new Error("Expected a server launch");
  const printed: string[] = [];
  const app = await Application.open(parsed.options, { print: text => { printed.push(text); return undefined; }, saveDirectory: join(directory, "saves") });
  try {
    await app.step(100);
    const before = app.simulation;
    const stepAsync = app.session.stepAsync.bind(app.session);
    let faults = 0;
    const fault = new Error("injected frame fault");
    const spy = spyOn(app.session, "stepAsync").mockImplementation((...args) => {
      if (faults === 0) { faults++; throw fault; }
      if (faults === 1) { faults++; app.requestQuit(); }
      return stepAsync(...args);
    });
    try { await app.run(); } finally { spy.mockRestore(); }
    expect(printed.some(text => text.startsWith("Server frame failed; restarting") && text.includes("injected frame fault"))).toBe(true);
    expect(app.simulation).not.toBe(before);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
}, 120000);

test.skipIf(!q1)("repeated dedicated frame faults still end the run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dedicated-fault-limit-"));
  const parsed = parseApplicationCommand(["--game", "q1-classic-id1", "--map", "start", "--dedicated", "--user-content-root", directory]);
  if (parsed.kind !== "run") throw new Error("Expected a server launch");
  const app = await Application.open(parsed.options, { print: () => undefined, saveDirectory: join(directory, "saves") });
  try {
    const fault = new Error("persistent frame fault");
    const spy = spyOn(app.session, "stepAsync").mockImplementation(() => { throw fault; });
    try { await expect(app.run()).rejects.toBe(fault); } finally { spy.mockRestore(); }
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
}, 120000);

test.skipIf(!q1)("map changes release the previous simulation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "travel-retention-"));
  const parsed = parseApplicationCommand(["--game", "q1-classic-id1", "--map", "e1m1", "--mode", "singleplayer", "--dedicated", "--user-content-root", directory]);
  if (parsed.kind !== "run") throw new Error("Expected a server launch");
  const app = await Application.open(parsed.options, { print: () => undefined, saveDirectory: join(directory, "saves") });
  try {
    const worlds: WeakRef<object>[] = [];
    for (let travel = 0; travel < 6; travel++) {
      worlds.push(new WeakRef(app.simulation));
      app.queueCommand("map", [travel % 2 === 0 ? "e1m2" : "e1m1"], null);
      for (let frame = 0; frame < 5; frame++) await app.step(50);
    }
    await Bun.sleep(0); Bun.gc(true); Bun.gc(true);
    // The collector is conservative about the stack, so one recent world may survive; the old chain must not.
    expect(worlds.filter(world => world.deref() !== undefined).length).toBe(0);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
}, 180000);

test.skipIf(!q3)("retail Q3 maps with entities that have no spawn function load", async () => {
  const directory = await mkdtemp(join(tmpdir(), "q3-unknown-spawn-"));
  const parsed = parseApplicationCommand(["--game", "q3-baseq3", "--map", "q3dm3", "--movement", "q3", "--character", "q3", "--mode", "deathmatch", "--dedicated", "--user-content-root", directory]);
  if (parsed.kind !== "run") throw new Error("Expected a server launch");
  const app = await Application.open(parsed.options, { print: () => undefined, saveDirectory: join(directory, "saves") });
  try {
    await app.step(100);
    expect(app.simulation.q3Source()).not.toBeNull();
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
}, 120000);

test("console time controls that overflow the source cast do not throw", () => {
  const controls = { timescale: 1e30, fixedtime: 0, hostFramerate: 0, cameraMode: 0 };
  expect(sourceFrameMilliseconds("q3", 16, controls, { dedicated: false, localServer: true })).toBe(1);
});
