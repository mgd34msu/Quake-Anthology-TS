import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { WorldSeatPresentation } from "../../../src/app/bootstrap/presentation.ts";
import { KeyCode } from "../../../src/input/key-codes.ts";
import { readSaveImage } from "../../../src/persistence/save-image.ts";
import { encodePng } from "../../../src/formats/images/png.ts";

test("actual pause menu saves, confirms overwrite and restores a mixed-source local world", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-save-menu-"));
  const parsed = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--movement", "q1", "--character", "q2", "--renderer", "cpu", "--hidden", "--width", "640", "--height", "480", "--user-content-root", root]);
  if (parsed.kind !== "run") throw new Error("Missing options");
  const app = await Application.open(parsed.options, { print: () => undefined, saveDirectory: join(root, "saves") });
  try {
    const local = app.localPlayers[0]; if (local === undefined) throw new Error("Missing player");
    const ui = () => { if (!(local.seat.presentation instanceof WorldSeatPresentation)) throw new Error("Missing presentation"); return local.seat.presentation.ui; };
    const key = (code: number): void => { for (const down of [true, false]) app.input({ seat: local.seat.id, kind: "key", code, down, repeat: false, timeMilliseconds: performance.now() }); };
    const enter = async (id: string): Promise<void> => {
      for (let attempt = 0; attempt < 30; attempt++) { const focus = ui().controller.state().focus; if (focus.kind === "menu" && focus.control === id) { key(KeyCode.Enter); await app.step(1); return; } key(KeyCode.Tab); }
      throw new Error(`Missing control ${id}`);
    };
    const settle = async (): Promise<void> => { for (let index = 0; index < 4; index++) { await Bun.sleep(5); await app.step(1); } };
    app.input({ seat: local.seat.id, kind: "key", code: 119, down: true, repeat: false, timeMilliseconds: performance.now() });
    expect(ui().local.input.isDown({ kind: "key", code: 119 })).toBe(true);
    await app.step(100); key(KeyCode.Escape); await app.step(1);
    app.input({ seat: local.seat.id, kind: "key", code: 119, down: false, repeat: false, timeMilliseconds: performance.now() });
    const paused = app.simulation.checkpoint();
    await app.step(1000); await app.step(1000);
    expect(app.simulation.checkpoint()).toEqual(paused);
    expect(ui().local.input.sample(performance.now(), 16).buttons.find(button => button.action === "forward")?.fraction ?? 0).toBe(0);
    app.input({ seat: local.seat.id, kind: "mouse-motion", position: { x: 100, y: 160 }, delta: { x: 0, y: 0 }, timeMilliseconds: performance.now() });
    for (const down of [true, false]) app.input({ seat: local.seat.id, kind: "mouse-button", button: 1, down, timeMilliseconds: performance.now() });
    await app.step(1); await settle(); expect(ui().controller.activeMenu).toBe("menu:saves:save"); await enter("ui:saves:new");
    await enter("ui:saves:write"); await settle();
    const path = join(root, "saves", "Save 001.sav"), saved = await readSaveImage(path);
    expect(saved.recipe).toEqual(app.content.recipe); expect(saved.bodies).toEqual(paused.bodies);
    expect(ui().controller.activeMenu).toBe("menu:saves:save");
    await enter("ui:saves:slot:Save 001.sav"); expect(ui().controller.activeMenu).toBe("menu:saves:overwrite");
    for (const down of [true, false]) app.input({ seat: local.seat.id, kind: "controller-button", device: 0, button: 1, down, timeMilliseconds: performance.now() });
    await app.step(1); expect(ui().controller.activeMenu).toBe("menu:saves:save"); expect(await readSaveImage(path)).toEqual(saved);
    await enter("ui:saves:slot:Save 001.sav"); await enter("ui:saves:overwrite"); await settle();
    await enter("ui:saves:back"); expect(ui().controller.activeMenu).toBe("menu:application:game");
    const view = app.simulation.playerView(local.actor);
    app.simulation.controlPlayer(local.actor, { kind: "cutscene", origin: { x: 1000, y: 1000, z: 1000 }, angles: { x: 0, y: 0, z: 0 }, viewOffset: { x: 0, y: 0, z: 0 } });
    expect(app.simulation.playerView(local.actor)).not.toEqual(view);
    await Bun.write(join(root, "saves", "Broken.sav"), "broken");
    await enter("ui:application:load"); await settle();
    await enter("ui:saves:slot:Broken.sav"); expect(ui().controller.activeMenu).toBe("menu:saves:load");
    const capture = app.captureNextFrame(); await app.step(1); await Bun.write("/tmp/quake-save-menu-load.png", encodePng(640, 480, await capture));
    const previous = app.simulation;
    await enter("ui:saves:slot:Save 001.sav"); await settle();
    expect(app.simulation).not.toBe(previous); expect(app.content.recipe).toEqual(saved.recipe);
    const restored = app.localPlayers[0]; if (restored === undefined) throw new Error("Missing restored player");
    expect(Math.abs(app.simulation.playerView(restored.actor).origin.x - view.origin.x)).toBeLessThan(2);
    expect(ui().controller.activeMenu).toBeNull();
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
}, 60000);

for (const mode of ["singleplayer", "deathmatch"]) test(`actual Q3 ${mode} pause keeps local bot policy and clock correct`, async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-pause-bots-"));
  const parsed = parseApplicationCommand(["--game", "q3-baseq3", "--map", "q3dm1", "--mode", mode, "--renderer", "cpu", "--hidden", "--width", "640", "--height", "480", "--user-content-root", root]);
  if (parsed.kind !== "run") throw new Error("Missing options");
  const app = await Application.open(parsed.options, { print: () => undefined, saveDirectory: join(root, "saves") });
  try {
    await app.step(100); app.queueCommand("addbot", ["sarge"], null); await app.step(100); await app.step(100);
    expect(app.simulation.players().length).toBeGreaterThan(1);
    const local = app.localPlayers[0]; if (local === undefined || !(local.seat.presentation instanceof WorldSeatPresentation)) throw new Error("Missing local player");
    for (const down of [true, false]) app.input({ seat: local.seat.id, kind: "key", code: KeyCode.Escape, down, repeat: false, timeMilliseconds: performance.now() });
    const first = await app.step(1), time = app.timeMilliseconds;
    const paused = await app.step(1000);
    if (mode === "singleplayer") { expect(paused.snapshot).toEqual(first.snapshot); expect(paused.events).toEqual([]); expect(app.timeMilliseconds).toBe(time); }
    else expect(app.timeMilliseconds).toBe(time + 1000);
    for (const down of [true, false]) app.input({ seat: local.seat.id, kind: "key", code: KeyCode.Escape, down, repeat: false, timeMilliseconds: performance.now() });
    await app.step(10); expect(app.timeMilliseconds).toBe(time + (mode === "singleplayer" ? 10 : 1010));
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
}, 60000);

test("split-screen save menu restores both connected seats through the common save contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-save-seats-"));
  const parsed = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--seats", "2", "--renderer", "cpu", "--hidden", "--width", "640", "--height", "480", "--user-content-root", root]);
  if (parsed.kind !== "run") throw new Error("Missing options");
  const app = await Application.open(parsed.options, { print: () => undefined, saveDirectory: join(root, "saves") });
  try {
    await app.step(100); const seat = app.localPlayers[0]?.seat; if (seat === undefined) throw new Error("Missing seat");
    const key = (code: number): void => { for (const down of [true, false]) app.input({ seat: seat.id, kind: "key", code, down, repeat: false, timeMilliseconds: performance.now() }); };
    const enter = async (id: string): Promise<void> => {
      if (!(seat.presentation instanceof WorldSeatPresentation)) throw new Error("Missing presentation");
      const controller = seat.presentation.ui.controller;
      for (let attempt = 0; attempt < 30; attempt++) { const focus = controller.state().focus; if (focus.kind === "menu" && focus.control === id) { key(KeyCode.Enter); await app.step(1); return; } key(KeyCode.Tab); }
      throw new Error(`Missing control ${id}`);
    };
    const settle = async (): Promise<void> => { for (let index = 0; index < 4; index++) { await Bun.sleep(5); await app.step(1); } };
    key(KeyCode.Escape); await enter("ui:application:save"); await settle(); await enter("ui:saves:new"); await enter("ui:saves:write"); await settle();
    const saved = await readSaveImage(join(root, "saves", "Save 001.sav")); expect(saved.configurations.length).toBe(2);
    await enter("ui:saves:back"); await enter("ui:application:load"); await settle();
    const previous = app.simulation; await enter("ui:saves:slot:Save 001.sav"); await settle();
    expect(app.simulation).not.toBe(previous); expect(app.localPlayers.length).toBe(2); expect(app.simulation.players().length).toBe(2);
    expect(app.content.recipe).toEqual(saved.recipe);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
}, 60000);
