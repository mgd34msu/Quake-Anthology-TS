import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { WorldSeatPresentation } from "../../../src/app/bootstrap/presentation.ts";
import { corpusTest, testCorpusRoot } from "../../support/corpus.ts";
import { readObject } from "../../support/reflect.ts";

const test = corpusTest("q1/id1/pak0.pak");

test("six map changes with a local seat on the hidden CPU renderer carry presentation, assets and input over and release the old world", async () => {
  const root = await mkdtemp(join(tmpdir(), "graphical-travel-"));
  const parsed = parseApplicationCommand(["--content-root", testCorpusRoot(), "--game", "q1-classic-id1", "--map", "e1m1", "--mode", "singleplayer",
    "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240", "--user-content-root", root]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const app = await Application.open(parsed.options, { print: () => undefined, saveDirectory: join(root, "saves") });
  try {
    const seat = app.localPlayers[0]?.seat.id, window = app.window;
    if (seat === undefined) throw new Error("Missing local player");
    if (window === null) throw new Error("Missing hidden window");
    const renderer = readObject(readObject(app, "graphical"), "renderer");
    const preferences = (): string => {
      const presentation = app.localPlayers[0]?.seat.presentation;
      if (!(presentation instanceof WorldSeatPresentation)) throw new Error("Missing seat presentation");
      return JSON.stringify(presentation.ui.preferences.values);
    };
    for (let frame = 0; frame < 5; frame++) await app.step(50);
    const preferencesBefore = preferences();
    const released: { readonly name: string; readonly ref: WeakRef<object> }[] = [];
    const remember = (): void => {
      const graphical = readObject(app, "graphical");
      released.push({ name: "simulation", ref: new WeakRef(app.simulation) }, { name: "assets", ref: new WeakRef(readObject(graphical, "assets")) },
        { name: "input", ref: new WeakRef(readObject(graphical, "input")) }, { name: "presentation", ref: new WeakRef(app.localPlayers[0]?.seat.presentation ?? graphical) });
    };
    // Only booleans leave this helper, so the test itself never keeps a previous world reachable.
    const travel = async (map: string): Promise<{ assets: boolean; input: boolean; renderer: boolean; window: boolean; seat: boolean; map: boolean; drawn: boolean }> => {
      remember();
      const previous = readObject(app, "graphical"), previousAssets = readObject(previous, "assets"), previousInput = readObject(previous, "input");
      app.queueCommand("map", [map], null);
      for (let frame = 0; frame < 5; frame++) await app.step(50);
      const current = readObject(app, "graphical");
      const captured = app.captureNextFrame(); await app.step(1);
      return { assets: readObject(current, "assets") !== previousAssets, input: readObject(current, "input") !== previousInput,
        renderer: readObject(current, "renderer") === renderer, window: app.window === window,
        seat: app.localPlayers.length === 1 && app.localPlayers[0]?.seat.id.equals(seat) === true,
        map: app.simulation.recipe.map.geometry.requestedPath.includes(map), drawn: (await captured).some(byte => byte !== 0) };
    };
    for (const map of ["e1m2", "e1m1", "e1m2", "e1m1", "e1m2", "e1m1"]) {
      expect(await travel(map)).toEqual({ assets: true, input: true, renderer: true, window: true, seat: true, map: true, drawn: true });
      expect(preferences()).toBe(preferencesBefore);
    }
    for (let round = 0; round < 8; round++) { await Bun.sleep(25); Bun.gc(true); }
    // The collector is conservative about the stack, so a couple of recent generations may survive; the older chain must not.
    console.log("DBG", JSON.stringify(released.map(entry => `${entry.name}:${entry.ref.deref() !== undefined}`)));
    await Bun.write("/tmp/claude-1000/-home-buzzkill-Projects-quake-anthology-ts/699b7558-0559-479c-bd99-8e1fdd26131f/scratchpad/heap.json", JSON.stringify((await import("bun:jsc")).generateHeapSnapshotForDebugging()));
    for (const name of ["simulation", "assets", "input", "presentation"]) {
      const alive = released.filter(entry => entry.name === name && entry.ref.deref() !== undefined).length;
      expect(`${name}:${alive <= 2}`).toBe(`${name}:true`);
    }
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
}, 240000);

test("TMPDEDICATED", async () => {
  const root = await mkdtemp(join(tmpdir(), "graphical-travel-"));
  const parsed = parseApplicationCommand(["--content-root", testCorpusRoot(), "--game", "q1-classic-id1", "--map", "e1m1", "--mode", "singleplayer", "--dedicated", "--user-content-root", root]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const app = await Application.open(parsed.options, { print: () => undefined, saveDirectory: join(root, "saves") });
  const worlds: WeakRef<object>[] = [];
  for (let travel = 0; travel < 6; travel++) {
    worlds.push(new WeakRef(app.simulation));
    app.queueCommand("map", [travel % 2 === 0 ? "e1m2" : "e1m1"], null);
    for (let frame = 0; frame < 5; frame++) await app.step(50);
  }
  for (let round = 0; round < 8; round++) { await Bun.sleep(25); Bun.gc(true); }
  console.log("DEDI", worlds.filter(world => world.deref() !== undefined).length);
  await app.close();
}, 240000);
