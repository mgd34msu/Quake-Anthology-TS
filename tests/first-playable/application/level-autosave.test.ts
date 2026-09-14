import { SdlAudioDevice } from "../../../src/platform/audio.ts";
import { ApplicationInput } from "../../../src/app/bootstrap/input.ts";
import { ApplicationAudio } from "../../../src/app/bootstrap/audio.ts";
import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { readSaveImage } from "../../../src/persistence/save-image.ts";
import { ConfigStore } from "../../../src/settings/config.ts";

for (const [product, map, family, ammo] of [
  ["q1-classic-id1", "e1m1", "q1", "q1:ammo/nails"],
  ["q2-classic-baseq2", "base1", "q2", "q2:ammo_shells"],
] satisfies readonly (readonly [string, string, string, Parameters<Application["simulation"]["inventory"]["count"]>[1]])[]) {
  test(`initial decoded ${product} autosave restores progressed state without overwriting the selected file`, async () => {
    const root = await mkdtemp(join(tmpdir(), "quake-initial-autosave-"));
    const parsed = parseApplicationCommand(["--game", product, "--map", map, "--movement", family, "--character", family, "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240", "--user-content-root", root]);
    if (parsed.kind !== "run") throw new Error("Missing options");
    const host = { print: () => undefined, saveDirectory: join(root, "saves") };
    const path = join(host.saveDirectory, product, "autosave.sav");
    let app: Application | null = null;
    try {
      app = await Application.open(parsed.options, host);
      const local = app.localPlayers[0];
      if (local === undefined) throw new Error("Missing initial player");
      const initialOrigin = app.simulation.playerView(local.actor).origin;
      app.input({ kind: "key", seat: local.seat.id, timeMilliseconds: 0, code: 119, down: true, repeat: false });
      for (let frame = 0; frame < 10; frame++) await app.step(50);
      app.input({ kind: "key", seat: local.seat.id, timeMilliseconds: 500, code: 119, down: false, repeat: false });
      const owner = app.simulation.actors.resolveOwned(local.actor);
      if (owner === null) throw new Error("Missing owned player");
      app.simulation.combat.setHealth(owner, 73);
      app.simulation.inventory.give(owner, ammo, 17);
      await app.step(50);
      expect(app.simulation.playerUi(local.actor).health).toBe(73);
      expect(app.simulation.inventory.count(local.actor, ammo)).toBe(17);
      if (family === "q2") {
        const source = app.simulation.q2Source(), state = source?.players.states.get(local.actor);
        if (state === undefined) throw new Error("Missing Q2 camera state");
        state.fov = 55;
        await app.step(50);
        expect(app.simulation.playerView(local.actor).fieldOfView).toBe(55);
      }
      const view = app.simulation.playerView(local.actor), ui = app.simulation.playerUi(local.actor);
      expect(view.origin).not.toEqual(initialOrigin);
      await app.saveGame(path);
      const bytes = await Bun.file(path).bytes(), image = await readSaveImage(path);
      const savedSequence = app.simulation.movementPlayer(local.actor)?.lastSequence;
      const outputDirectory = Bun.env["QUAKE_INITIAL_SAVE_RECEIPTS"];
      if (outputDirectory !== undefined) {
        await Bun.write(join(outputDirectory, product, "autosave.sav"), bytes);
        await Bun.write(join(outputDirectory, product, "checkpoint.json"), JSON.stringify({ product, map, health: ui.health, ammo, ammoCount: 17, view, frame: image.frame,
          sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") }, null, 2));
      }
      const contentRoot = app.content.catalog.product(app.content.recipe.map.entities.content).userContent?.root;
      await app.close(); app = null;
      if (family === "q2") {
        if (contentRoot === undefined) throw new Error("Missing private content root");
        await new ConfigStore(contentRoot).dump("view.json", JSON.stringify({ version: 1, fieldOfView: 110 }));
      }
      app = await Application.open(parsed.options, host, image.recipe, undefined, image);
      const restored = app.localPlayers[0];
      if (restored === undefined) throw new Error("Missing restored player");
      expect(await Bun.file(path).bytes()).toEqual(bytes);
      expect(app.simulation.playerView(restored.actor)).toEqual(view);
      expect(app.simulation.playerUi(restored.actor)).toEqual(ui);
      if (family === "q2") expect(app.simulation.q2Source()?.players.states.get(restored.actor)?.fov).toBe(55);
      expect(app.simulation.checkpoint().frame).toEqual(image.frame);
      expect(app.simulation.movementPlayer(restored.actor)?.lastSequence).toBe(savedSequence);
      const restoredOrigin = app.simulation.playerView(restored.actor).origin;
      app.input({ kind: "key", seat: restored.seat.id, timeMilliseconds: 550, code: 115, down: true, repeat: false });
      for (let frame = 0; frame < 10; frame++) {
        await app.step(50);
        expect(await Bun.file(path).bytes()).toEqual(bytes);
      }
      app.input({ kind: "key", seat: restored.seat.id, timeMilliseconds: 1050, code: 115, down: false, repeat: false });
      expect(app.simulation.playerView(restored.actor).origin).not.toEqual(restoredOrigin);
      expect(app.simulation.playerUi(restored.actor).health).toBeGreaterThan(0);
      expect(app.simulation.inventory.count(restored.actor, ammo)).toBe(17);
      expect(app.simulation.checkpoint().frame).not.toEqual(image.frame);
    } finally { await app?.close(); await rm(root, { recursive: true, force: true }); }
  }, 60000);
}

test("level autosave captures initial and next playable worlds and preserves saves on failed travel and restore", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-level-autosave-"));
  const parsed = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240", "--user-content-root", root]);
  if (parsed.kind !== "run") throw new Error("Missing options");
  const app = await Application.open(parsed.options, { print: () => undefined, saveDirectory: join(root, "saves") });
  try {
    const path = join(root, "saves", "q2-classic-baseq2", "autosave.sav");
    const initial = await readSaveImage(path);
    expect(initial.recipe).toEqual(app.content.recipe);
    expect(initial.configurations).toHaveLength(1);
    const manual = join(root, "saves", "manual.sav"), quick = join(root, "saves", "quicksave.sav");
    await app.saveGame(manual); await app.saveGame(quick);
    const manualBytes = await Bun.file(manual).bytes(), quickBytes = await Bun.file(quick).bytes();
    await app.changeLevel("base2");
    const next = await readSaveImage(path);
    expect(next.recipe.map.geometry.requestedPath).toBe("maps/base2.bsp");
    expect(next.configurations).toHaveLength(1);
    const nextBytes = await Bun.file(path).bytes();
    await expect(app.changeLevel("nonexistent-autosave-test-map")).rejects.toThrow();
    expect(await Bun.file(path).bytes()).toEqual(nextBytes);
    await app.loadGame(manual);
    expect(app.content.recipe).toEqual(initial.recipe);
    expect(await Bun.file(path).bytes()).toEqual(nextBytes);
    expect(await Bun.file(manual).bytes()).toEqual(manualBytes);
    expect(await Bun.file(quick).bytes()).toEqual(quickBytes);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
}, 60000);

test("autosave write failure does not abort a playable level", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-autosave-failure-"));
  const saveDirectory = join(root, "not-a-directory"); await Bun.write(saveDirectory, "file");
  const parsed = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240", "--user-content-root", root]);
  if (parsed.kind !== "run") throw new Error("Missing options");
  const messages: string[] = [];
  const app = await Application.open(parsed.options, { print: message => { messages.push(message); }, saveDirectory });
  try {
    expect(app.localPlayers).toHaveLength(1);
    expect(messages.some(message => message.startsWith("Autosave failed:"))).toBe(true);
    await app.changeLevel("base2");
    expect(app.content.recipe.map.geometry.requestedPath).toBe("maps/base2.bsp");
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
}, 60000);


test("graphical saves retain key releases and failed preparation retains the live input owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-graphical-restore-"));
  const parsed = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240", "--user-content-root", root]);
  if (parsed.kind !== "run") throw new Error("Missing options");
  const app = await Application.open(parsed.options, { print: () => undefined, saveDirectory: join(root, "saves") });
  const openAudio = spyOn(SdlAudioDevice, "open"), closeAudio = spyOn(SdlAudioDevice.prototype, "close");
  const owners: ApplicationInput[] = [];
  const originalInput = ApplicationInput.prototype.input;
  const input = spyOn(ApplicationInput.prototype, "input").mockImplementation(function(this: ApplicationInput, event) {
    owners.push(this); return originalInput.call(this, event);
  });
  try {
    const local = app.localPlayers[0]; if (local === undefined) throw new Error("Missing local player");
    const client = local.seat.client, window = app.window;
    const key = (down: boolean): void => { app.input({ kind: "key", seat: local.seat.id, timeMilliseconds: performance.now(), code: 119, down, repeat: false }); };
    key(true);
    await app.step(50);
    const owner = owners[0]; if (owner === undefined) throw new Error("Missing input owner");
    expect(owner.locals[0]?.input.button("forward").active).toBe(true);
    const save = join(root, "held.sav");
    const pending = app.saveGame(save);
    key(false);
    await pending;
    await app.step(50);
    expect(owner.locals[0]?.input.button("forward").active).toBe(false);
    const old = app.simulation;
    const prepare = spyOn(ApplicationAudio.prototype, "prepareEnvironment").mockRejectedValueOnce(new Error("injected audio preparation failure"));
    try { await expect(app.loadGame(save)).rejects.toThrow("injected audio preparation failure"); }
    finally { prepare.mockRestore(); }
    expect(app.simulation).toBe(old);
    expect(app.window).toBe(window);
    key(true);
    expect(owners.at(-1)).toBe(owner);
    await app.step(50);
    expect(owner.locals[0]?.input.button("forward").active).toBe(true);
    key(false);
    await app.step(50);
    await app.loadGame(save);
    expect(app.localPlayers[0]?.seat.client).toBe(client);
    expect(app.window).toBe(window);
    key(false);
    expect(owners.at(-1)).not.toBe(owner);
    await app.step(50);
    expect(openAudio).not.toHaveBeenCalled();
    expect(closeAudio).not.toHaveBeenCalled();
  } finally { input.mockRestore(); openAudio.mockRestore(); closeAudio.mockRestore(); await app.close(); await rm(root, { recursive: true, force: true }); }
}, 60000);
