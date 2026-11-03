// SPDX-License-Identifier: GPL-2.0-or-later
import { expect } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { readSaveImage } from "../../../src/persistence/save-image.ts";
import { WorldSeatPresentation } from "../../../src/app/bootstrap/presentation.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { applicationPreset } from "../../../src/app/bootstrap/content.ts";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import { q1MonsterSources } from "../../../src/content/monsters/q1.ts";
import { testCorpusRoot, corpusTest } from "../../support/corpus.ts";
import { trackedTempDirectories } from "../../support/temp-directories.ts";
const test = corpusTest("q1/id1/pak0.pak", "q2/baseq2/pak0.pak", "q2/rerelease/baseq2/pak0.pak");
const tempDirectory = trackedTempDirectories();

// Selected foreign enemies must actually stand in a native Q2 DLL world:
// replaced guest monsters are stripped from the guest entity string and
// admitted as shared TS monsters, which engage and damage the player.
// Monsters only the guest can discharge (targets, event items, or a guest
// with no declared combat profile to project TS actors into) stay
// guest-native and are reported, never silently swapped.
interface Lane {
  readonly grunts: number;
  readonly chasing: boolean;
  readonly attacking: boolean;
  readonly minHealth: number;
  readonly printed: readonly string[];
}

async function openLane(game: string, library: string, printed: string[]): Promise<{ app: Application; root: string }> {
  const corpus = testCorpusRoot();
  const root = await tempDirectory("quake-native-foreign-enemies-");
  const parsed = parseApplicationCommand([
    "--content-root",
    corpus,
    "--game",
    game,
    "--map",
    "base2",
    "--q2-game",
    library,
    "--movement",
    "q2",
    "--character",
    "q2",
    "--renderer",
    "cpu",
    "--hidden",
    "--width",
    "320",
    "--height",
    "240",
    "--user-content-root",
    root,
  ]);
  if (parsed.kind !== "run") throw new Error("Missing launch options");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false });
  const preset = applicationPreset(catalog, parsed.options);
  const selectedSource = q1MonsterSources.find(source => source.edition === "classic");
  if (selectedSource === undefined) throw new Error("Missing classic Q1 creatures");
  const source = { provider: selectedSource.provider, content: catalog.require("q1-classic-id1").id };
  const recipe = await resolveLaunch({
    catalog,
    preset,
    choice: {
      ...presetChoice(preset.id),
      enemies: {
        kind: "selected",
        value: {
          kind: "replace",
          default: { source, classname: "monster_army" },
          byClassname: {},
        },
      },
    },
  });
  const app = await Application.open(
    parsed.options,
    {
      saveDirectory: join(root, "saves"),
      print: text => {
        printed.push(text);
      },
    },
    recipe,
  );
  return { app, root };
}

async function runLane(game: string, library: string): Promise<Lane> {
  const printed: string[] = [];
  const { app, root } = await openLane(game, library, printed);
  try {
    const local = app.localPlayers[0];
    if (local === undefined) throw new Error("Missing local player");
    if (app.simulation.q2Native() === null) throw new Error("Native source was not admitted");
    for (let i = 0; i < 40; i++) await app.step(50);
    const grunts = app.simulation.presentations().filter(p => p.family === "q1").length;
    // Grunts wake only on a clear line of sight, so walking blindly forward is not a stable scenario (the grunt that
    // wakes can be behind glass or a grating). Put the player 80 units in front of each grunt in turn until one fights.
    // The classic proxy-edict player is not a movement player and cannot be teleported, so that lane moves the grunt
    // next to the player instead (it reaches attack frames; its damage is not asserted).
    let minHealth = 200;
    const frames = new Set<number>();
    const attacked = (): boolean => [...frames].some(f => f >= 81 && f <= 89);
    const sample = async (): Promise<void> => {
      await app.step(50);
      minHealth = Math.min(minHealth, app.simulation.playerUi(local.actor).health);
      for (const p of app.simulation.presentations()) if (p.family === "q1") frames.add(p.frame);
    };
    const player = app.simulation.playerView(local.actor).origin;
    for (const grunt of app.simulation
      .presentations()
      .filter(p => p.family === "q1")
      .slice(0, 6)) {
      if (library === "game_x64.dll") {
        const radians = (grunt.angles.y * Math.PI) / 180;
        app.simulation.diagnostics().movePlayer(local.actor, {
          kind: "teleport",
          angles: { x: 0, y: (grunt.angles.y + 180) % 360, z: 0 },
          origin: { x: grunt.origin.x + 80 * Math.cos(radians), y: grunt.origin.y + 80 * Math.sin(radians), z: grunt.origin.z + 10 },
          velocity: { x: 0, y: 0, z: 0 },
          commandAngles: { x: 0, y: 0, z: 0 },
          holdMilliseconds: 0,
          spectator: false,
        });
        for (let i = 0; i < 60 && !attacked(); i++) await sample();
      } else {
        const owned = app.simulation.actors.resolveOwned(grunt.actor),
          body = owned === null ? null : app.simulation.bodies.read(owned.id);
        if (owned === null || body === null) continue;
        for (const degrees of [0, 90, 180, 270]) {
          const radians = (degrees * Math.PI) / 180;
          app.simulation.bodies.write(owned, {
            ...body,
            origin: { x: player.x + 80 * Math.cos(radians), y: player.y + 80 * Math.sin(radians), z: player.z },
            velocity: { x: 0, y: 0, z: 0 },
          });
          app.simulation.bodies.link(owned);
          for (let i = 0; i < 30 && !attacked(); i++) await sample();
          if (attacked()) break;
        }
      }
      if (attacked()) {
        for (let i = 0; i < 40 && minHealth >= 100; i++) await sample();
        break;
      }
    }
    // Q1 army frames: stand 0-7, pain 40-45, run 73-80, attack 81-89, walk 90-.
    return { grunts, chasing: [...frames].some(f => f >= 73 && f <= 80), attacking: attacked(), minHealth, printed };
  } finally {
    try {
      await app.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}

test("rerelease native DLL world admits Quake 1 grunts that chase and attack the player", async () => {
  const lane = await runLane("q2-rerelease-baseq2", "game_x64.dll");
  expect(lane.grunts).toBeGreaterThanOrEqual(5);
  expect(lane.chasing).toBe(true);
  expect(lane.attacking).toBe(true);
  expect(lane.minHealth).toBeLessThan(100);
}, 600_000);

test("classic native DLL world admits Quake 1 grunts through proxy edicts", async () => {
  const lane = await runLane("q2-classic-xatrix", "gamex86.dll");
  expect(lane.grunts).toBeGreaterThanOrEqual(5);
  expect(lane.chasing).toBe(true);
  expect(lane.attacking).toBe(true);
}, 600_000);

test("unqualified classic guest keeps monsters guest-native and says so", async () => {
  // baseq2's classic DLL has no declared combat profile, so TS actors
  // cannot be projected into it; replacement stays guest-native, visibly.
  const printed: string[] = [];
  const { app, root } = await openLane("q2-classic-baseq2", "gamex86.dll", printed);
  try {
    const local = app.localPlayers[0];
    if (local === undefined) throw new Error("Missing local player");
    for (let i = 0; i < 20; i++) await app.step(50);
    expect(app.simulation.presentations().filter(p => p.family === "q1")).toHaveLength(0);
    if (!(local.seat.presentation instanceof WorldSeatPresentation)) throw new Error("Missing local UI");
    const consoleText = local.seat.presentation.ui.local.console.buffer.dump();
    expect(consoleText.includes("Selected enemies") && consoleText.includes("guest-native")).toBe(true);
    expect(app.simulation.playerUi(local.actor).health).toBeGreaterThan(0);
    // The narrowing is also recorded per axis, in status and in the save.
    const consumption = app.simulation.selectionConsumption();
    expect(consumption.find(entry => entry.axis === "enemies")?.outcome).toBe("guest-native");
    const save = join(root, "saves", "consumption.sav");
    await app.saveGame(save);
    expect((await readSaveImage(save)).consumption).toEqual(consumption);
  } finally {
    try {
      await app.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}, 600_000);

test("foreign enemies survive a save and load on a native DLL world", async () => {
  const printed: string[] = [];
  const { app, root } = await openLane("q2-rerelease-baseq2", "game_x64.dll", printed);
  try {
    const local = app.localPlayers[0];
    if (local === undefined) throw new Error("Missing local player");
    for (let i = 0; i < 40; i++) await app.step(50);
    const q1Paths = (): string[] =>
      app.simulation
        .presentations()
        .filter(p => p.family === "q1")
        .map(p => p.path)
        .sort();
    const before = q1Paths();
    expect(before.length).toBeGreaterThanOrEqual(5);
    const save = join(root, "saves", "slot.sav");
    await app.saveGame(save);
    await app.loadGame(save);
    for (let i = 0; i < 10; i++) await app.step(50);
    expect(q1Paths()).toEqual(before);
    const restored = app.localPlayers[0] ?? local;
    expect(app.simulation.playerUi(restored.actor).health).toBeGreaterThan(0);
  } finally {
    try {
      await app.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}, 600_000);
