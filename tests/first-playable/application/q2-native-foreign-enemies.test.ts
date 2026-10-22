import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { WorldSeatPresentation } from "../../../src/app/bootstrap/presentation.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { applicationPreset } from "../../../src/app/bootstrap/content.ts";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import { q1MonsterSources } from "../../../src/content/monsters/q1.ts";
import { testCorpusRoot } from "../../support/corpus.ts";

// Selected foreign enemies must actually stand in a native Q2 DLL world:
// replaced guest monsters are stripped from the guest entity string and
// admitted as shared TS monsters, which engage and damage the player.
// Monsters only the guest can discharge (targets, event items, or a guest
// with no declared combat profile to project TS actors into) stay
// guest-native and are reported, never silently swapped.
interface Lane {
  readonly grunts: number;
  readonly attackFrames: boolean;
  readonly minHealth: number;
  readonly printed: readonly string[];
}

async function openLane(game: string, library: string, printed: string[]): Promise<{ app: Application; root: string }> {
  const corpus = testCorpusRoot();
  const root = await mkdtemp(join(tmpdir(), "quake-native-foreign-enemies-"));
  const parsed = parseApplicationCommand(["--content-root", corpus, "--game", game, "--map", "base2", "--q2-game", library,
    "--movement", "q2", "--character", "q2", "--renderer", "cpu", "--hidden",
    "--width", "320", "--height", "240", "--user-content-root", root]);
  if (parsed.kind !== "run") throw new Error("Missing launch options");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false });
  const preset = applicationPreset(catalog, parsed.options);
  const selectedSource = q1MonsterSources.find(source => source.edition === "classic");
  if (selectedSource === undefined) throw new Error("Missing classic Q1 creatures");
  const source = { provider: selectedSource.provider, content: catalog.require("q1-classic-id1").id };
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), enemies: { kind: "selected", value: {
    kind: "replace", default: { source, classname: "monster_army" }, byClassname: {} } } } });
  const app = await Application.open(parsed.options, { saveDirectory: join(root, "saves"), print: text => { printed.push(text); } }, recipe);
  return { app, root };
}

async function runLane(game: string, library: string): Promise<Lane> {
  const printed: string[] = [];
  const { app, root } = await openLane(game, library, printed);
  try {
    const local = app.localPlayers[0]; if (local === undefined) throw new Error("Missing local player");
    if (app.simulation.q2Native() === null) throw new Error("Native source was not admitted");
    for (let i = 0; i < 40; i++) await app.step(50);
    const grunts = app.simulation.presentations().filter(p => p.family === "q1").length;
    app.input({ seat: local.seat.id, kind: "key", code: 119, down: true, repeat: false, timeMilliseconds: performance.now() });
    let minHealth = 200;
    const frames = new Set<number>();
    for (let i = 0; i < 240; i++) {
      await app.step(50);
      minHealth = Math.min(minHealth, app.simulation.playerUi(local.actor).health);
      for (const p of app.simulation.presentations()) if (p.family === "q1") frames.add(p.frame);
    }
    app.input({ seat: local.seat.id, kind: "key", code: 119, down: false, repeat: false, timeMilliseconds: performance.now() });
    // Q1 army attack sequences live above the stand/walk frame ranges.
    return { grunts, attackFrames: [...frames].some(f => f >= 46), minHealth, printed };
  } finally { try { await app.close(); } finally { await rm(root, { recursive: true, force: true }); } }
}

test("rerelease native DLL world admits Quake 1 grunts that fight the player", async () => {
  const lane = await runLane("q2-rerelease-baseq2", "game_x64.dll");
  expect(lane.grunts).toBeGreaterThanOrEqual(5);
  expect(lane.attackFrames).toBe(true);
  expect(lane.minHealth).toBeLessThan(100);
}, 300_000);

test("classic native DLL world admits Quake 1 grunts through proxy edicts", async () => {
  const lane = await runLane("q2-classic-xatrix", "gamex86.dll");
  expect(lane.grunts).toBeGreaterThanOrEqual(5);
  expect(lane.attackFrames).toBe(true);
  expect(lane.minHealth).toBeLessThan(100);
}, 300_000);

test("unqualified classic guest keeps monsters guest-native and says so", async () => {
  // baseq2's classic DLL has no declared combat profile, so TS actors
  // cannot be projected into it; replacement stays guest-native, visibly.
  const printed: string[] = [];
  const { app, root } = await openLane("q2-classic-baseq2", "gamex86.dll", printed);
  try {
    const local = app.localPlayers[0]; if (local === undefined) throw new Error("Missing local player");
    for (let i = 0; i < 20; i++) await app.step(50);
    expect(app.simulation.presentations().filter(p => p.family === "q1")).toHaveLength(0);
    if (!(local.seat.presentation instanceof WorldSeatPresentation)) throw new Error("Missing local UI");
    const consoleText = local.seat.presentation.ui.local.console.buffer.dump();
    expect(consoleText.includes("Selected enemies") && consoleText.includes("guest-native")).toBe(true);
    expect(app.simulation.playerUi(local.actor).health).toBeGreaterThan(0);
  } finally { try { await app.close(); } finally { await rm(root, { recursive: true, force: true }); } }
}, 300_000);

test("foreign enemies survive a save and load on a native DLL world", async () => {
  const printed: string[] = [];
  const { app, root } = await openLane("q2-rerelease-baseq2", "game_x64.dll", printed);
  try {
    const local = app.localPlayers[0]; if (local === undefined) throw new Error("Missing local player");
    for (let i = 0; i < 40; i++) await app.step(50);
    const before = app.simulation.presentations().filter(p => p.family === "q1").length;
    expect(before).toBeGreaterThanOrEqual(5);
    const save = join(root, "saves", "slot.sav");
    await app.saveGame(save);
    await app.loadGame(save);
    for (let i = 0; i < 10; i++) await app.step(50);
    const after = app.simulation.presentations().filter(p => p.family === "q1").length;
    expect(after).toBeGreaterThanOrEqual(5);
    const restored = app.localPlayers[0] ?? local;
    expect(app.simulation.playerUi(restored.actor).health).toBeGreaterThan(0);
  } finally { try { await app.close(); } finally { await rm(root, { recursive: true, force: true }); } }
}, 300_000);
