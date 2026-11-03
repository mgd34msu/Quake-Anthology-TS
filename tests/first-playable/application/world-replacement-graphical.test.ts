import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { WorldSeatPresentation } from "../../../src/app/bootstrap/world-seat-presentation.ts";
import { corpusTest, testCorpusRoot } from "../../support/corpus.ts";
import { readObject } from "../../support/reflect.ts";

const test = corpusTest("q1/id1/pak0.pak");

test("map changes with a local seat on the hidden CPU renderer carry presentation, assets and input over and release the old world", async () => {
  const root = await mkdtemp(join(tmpdir(), "graphical-travel-"));
  const parsed = parseApplicationCommand(["--content-root", testCorpusRoot(), "--game", "q1-classic-id1", "--map", "e1m1", "--mode", "singleplayer",
    "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240", "--user-content-root", root]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const app = await Application.open(parsed.options, { print: () => undefined, saveDirectory: join(root, "saves") });
  try {
    const first = app.localPlayers[0]; if (first === undefined) throw new Error("Missing local player");
    const window = app.window, seat = first.seat.id;
    if (window === null) throw new Error("Missing hidden window");
    const before = readObject(app, "graphical"), renderer = readObject(before, "renderer");
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
    const generations = new Set<object>();
    for (const map of ["e1m2", "e1m1"]) {
      remember();
      const previous = readObject(app, "graphical");
      app.queueCommand("map", [map], null);
      for (let frame = 0; frame < 5; frame++) await app.step(50);
      const current = readObject(app, "graphical");
      expect(app.simulation.recipe.map.geometry.requestedPath).toContain(map);
      expect(current).not.toBe(previous);
      expect(readObject(current, "renderer")).toBe(renderer);
      expect(app.window).toBe(window);
      expect(readObject(current, "assets")).not.toBe(readObject(previous, "assets"));
      expect(readObject(current, "input")).not.toBe(readObject(previous, "input"));
      expect(app.localPlayers).toHaveLength(1);
      expect(app.localPlayers[0]?.seat.id.equals(seat)).toBe(true);
      expect(preferences()).toBe(preferencesBefore);
      generations.add(readObject(current, "assets"));
      const frame = app.captureNextFrame(); await app.step(1);
      expect((await frame).some(byte => byte !== 0)).toBe(true);
    }
    expect(generations.size).toBe(2);
    await Bun.sleep(0); Bun.gc(true); Bun.gc(true);
    // The collector is conservative about the stack, so one recent generation may survive; the older chain must not.
    for (const name of ["simulation", "assets", "input", "presentation"]) {
      const alive = released.filter(entry => entry.name === name && entry.ref.deref() !== undefined).length;
      expect(`${name}:${alive <= 1}`).toBe(`${name}:true`);
    }
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
}, 240000);
