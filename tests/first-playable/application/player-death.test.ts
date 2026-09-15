import { expect, test } from "bun:test";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { SeatPlayerDeath, playerDeathMenu } from "../../../src/app/bootstrap/player-death.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { NativeUiController, defaultUiSkin } from "../../../src/ui/common/index.ts";
import { registerSavedGameMenus, type SavedGameMenuService } from "../../../src/ui/saves/menu.ts";
import { encodeSaveImage, decodeSaveImage } from "../../../src/persistence/index.ts";
import { KeyCode } from "../../../src/input/key-codes.ts";

for (const movement of ["q1", "q2", "q3"]) for (const character of ["q1", "q2", "q3"]) {
  test(`Q2 lethal damage opens common recovery and restores save: ${movement} movement, ${character} character`, async () => {
    const parsed = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--movement", movement, "--character", character, "--dedicated"]);
    if (parsed.kind !== "run") throw new Error("Missing launch");
    const content = await loadApplicationContent(parsed.options), identity = createIdentityOwner(`death-${movement}-${character}`);
    const options = { identity, recipe: content.recipe, world: content.world, mounts: content.mounts, mode: "singleplayer", skill: 0, seed: 17, maxClients: 1 } satisfies Parameters<typeof createSimulation>[0];
    let simulation = createSimulation(options);
    const client = identity.client(0, 0), seat = identity.seat(0);
    let actor = simulation.admitPlayer(client).actor;
    let gameFocus = true;
    const controller = new NativeUiController({ seat, skin: () => defaultUiSkin("resource:test:font"), now: () => 0, bindings: () => [],
      focus: focus => { gameFocus = focus.kind === "game"; }, sound: () => undefined, executeScript: () => undefined });
    for (let frame = 0; frame < 12; frame++) simulation.step({ elapsedMilliseconds: 100, commands: [] });
    const saved = encodeSaveImage(simulation.checkpoint());
    let loaded = false, restarted = false;
    const replace = (restore: boolean): void => {
      simulation.close(); simulation = createSimulation({ ...options, ...(restore ? { restore: decodeSaveImage(saved), restoredClients: [client] } : {}) });
      const restoredActor = restore ? simulation.players()[0] : simulation.admitPlayer(client).actor;
      if (restoredActor === undefined) throw new Error("Missing recovered player");
      actor = restoredActor;
    };
    const service: SavedGameMenuService = { recovery: { restart: async () => { replace(false); restarted = true; } },
      list: () => ({ rows: [{ id: "autosave.sav", label: "Autosave", map: "base1", game: "Quake II", savedAtMilliseconds: 1, unavailable: null }], error: null }),
      refresh: async () => undefined, unavailable: () => null, save: async () => undefined,
      load: async id => { expect(id).toBe("autosave.sav"); replace(true); loaded = true; } };
    const menus = registerSavedGameMenus(controller, service), death = new SeatPlayerDeath(controller, service, menus.load, () => undefined);
    const key = (code: number): void => { for (const down of [true, false]) {
      const event = { seat, kind: "key", code, down, repeat: false, timeMilliseconds: 0 } satisfies Parameters<typeof controller.input>[0];
      if (!death.input(event)) controller.input(event);
    } };
    const enter = (id: string): void => {
      for (let attempt = 0; attempt < 20; attempt++) {
        const focus = controller.state().focus;
        if (focus.kind === "menu" && focus.control === id) { key(KeyCode.Enter); return; }
        key(KeyCode.Tab);
      }
      throw new Error(`Missing control ${id}`);
    };
    const kill = (): void => {
      const source = simulation.q2Source(), body = simulation.bodies.read(actor);
      if (source === null || body === null) throw new Error("Missing player source");
      simulation.drainPresentationEvents();
      source.game.damage(actor, actor, actor, 500, 0, { x: 0, y: 0, z: 0 }, body.origin, { x: 0, y: 0, z: 0 }, 0);
      const events: ReturnType<typeof simulation.step>["events"][number][] = [];
      for (let frame = 0; frame < 15; frame++) events.push(...simulation.step({ elapsedMilliseconds: 100, commands: [] }).events);
      expect(events.some(event => event.payload.kind === "damage" && event.payload.outcome.kind === "committed" && event.payload.outcome.decision.reaction === "death")).toBe(true);
      expect(simulation.playerUi(actor).health).toBeLessThanOrEqual(0);
      death.observe(simulation.playerUi(actor).health);
      expect(controller.activeMenu).toBe(playerDeathMenu); expect(gameFocus).toBe(false);
    };
    try {
      death.observe(simulation.playerUi(actor).health); expect(controller.activeMenu).toBeNull();
      kill(); key(KeyCode.Escape); expect(controller.activeMenu).toBe(playerDeathMenu);
      enter("ui:death:load"); await Bun.sleep(0); expect(controller.activeMenu).toBe(menus.load);
      enter("ui:saves:slot:autosave.sav"); await Bun.sleep(0); expect(loaded).toBe(true);
      death.observe(simulation.playerUi(actor).health); expect(death.active).toBe(false); expect(gameFocus).toBe(true);
      expect(simulation.playerUi(actor).health).toBeGreaterThan(0);
      kill(); enter("ui:death:restart"); await Bun.sleep(0); expect(restarted).toBe(true);
      death.observe(simulation.playerUi(actor).health); expect(controller.activeMenu).toBeNull(); expect(gameFocus).toBe(true);
    } finally { death.close(); menus.dispose(); simulation.close(); await content.close(); }
  }, 30000);
}

test("multiplayer death leaves gameplay focus and native respawn input available", () => {
  const identity = createIdentityOwner("death-multiplayer"), seat = identity.seat(0);
  const controller = new NativeUiController({ seat, skin: () => defaultUiSkin("resource:test:font"), now: () => 0, bindings: () => [],
    focus: () => { throw new Error("Multiplayer death must not capture input"); }, sound: () => undefined, executeScript: () => undefined });
  const death = new SeatPlayerDeath(controller, undefined, "menu:saves:load", () => undefined);
  death.observe(-17); expect(death.active).toBe(false); expect(controller.activeMenu).toBeNull();
  expect(death.input({ seat, kind: "key", code: KeyCode.Enter, down: true, repeat: false, timeMilliseconds: 0 })).toBe(false);
  death.close();
});

test.skipIf(process.env["QUAKE_DEATH_APPLICATION_TEST"] !== "1")("actual application death stays animated, pauses load browser and recovers through queued world replacement", async () => {
  const { Application } = await import("../../../src/app/bootstrap/application.ts");
  const { WorldSeatPresentation } = await import("../../../src/app/bootstrap/presentation.ts");
  const { mkdtemp, mkdir, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { encodePng } = await import("../../../src/formats/images/png.ts");
  const renderer = process.env["QUAKE_DEATH_RENDERER"] === "gl" ? "gl" : "cpu";
  const captures = join(".artifacts", "resume-20260913", "player-death-flow", `application-${renderer}`);
  await mkdir(captures, { recursive: true });
  const root = await mkdtemp(join(tmpdir(), "quake-death-application-"));
  const parsed = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--movement", "q1", "--character", "q2", "--renderer", renderer, "--hidden", "--width", "640", "--height", "480", "--user-content-root", root]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const app = await Application.open(parsed.options, { print: () => undefined, saveDirectory: join(root, "saves") });
  const ui = () => {
    const local = app.localPlayers[0];
    if (local === undefined || !(local.seat.presentation instanceof WorldSeatPresentation)) throw new Error("Missing local presentation");
    return local.seat.presentation.ui;
  };
  const capture = async (name: string): Promise<void> => {
    const pending = app.captureNextFrame(); await app.step(1);
    const pixels = await pending;
    await Bun.write(join(captures, `${name}.png`), encodePng(640, 480, pixels));
    const local = app.localPlayers[0];
    if (local === undefined || !(local.seat.presentation instanceof WorldSeatPresentation)) throw new Error("Missing capture presentation");
    await Bun.write(join(captures, `${name}.json`), JSON.stringify({ renderer, width: 640, height: 480, timeMilliseconds: app.timeMilliseconds,
      menu: ui().controller.activeMenu, focus: ui().local.input.focus.kind, health: app.simulation.playerUi(local.actor).health,
      view: app.simulation.playerView(local.actor), camera: local.seat.presentation.camera(), recipe: app.content.recipe }, null, 2));
  };
  const key = (code: number): void => { for (const down of [true, false]) app.input({ seat: ui().local.player.seat.id, kind: "key", code, down, repeat: false, timeMilliseconds: performance.now() }); };
  const enter = async (id: string): Promise<void> => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const focus = ui().controller.state().focus;
      if (focus.kind === "menu" && focus.control === id) { key(KeyCode.Enter); await app.step(1); return; }
      key(KeyCode.Tab);
    }
    throw new Error(`Missing control ${id}`);
  };
  const settle = async (): Promise<void> => { for (let i = 0; i < 5; i++) { await Bun.sleep(10); await app.step(1); } };
  const kill = async (): Promise<void> => {
    for (let frame = 0; frame < 12; frame++) await app.step(100);
    const actor = ui().local.player.actor, source = app.simulation.q2Source(), body = app.simulation.bodies.read(actor);
    if (source === null || body === null) throw new Error("Missing source player");
    source.game.damage(actor, actor, actor, 117, 0, { x: 0, y: 0, z: 0 }, body.origin, { x: 0, y: 0, z: 0 }, 0);
    const output = await app.step(100);
    expect(output.events.some(event => event.payload.kind === "damage" && event.payload.outcome.kind === "committed" && event.payload.outcome.decision.reaction === "death")).toBe(true);
    expect(ui().controller.activeMenu).toBe(playerDeathMenu);
    const time = app.timeMilliseconds;
    key(KeyCode.Escape); for (let frame = 0; frame < 15; frame++) await app.step(100); expect(app.timeMilliseconds).toBe(time + 1500); expect(ui().controller.activeMenu).toBe(playerDeathMenu);
    expect(ui().local.input.focus.kind).toBe("menu");
  };
  try {
    await capture("alive");
    await kill(); await capture("death"); const original = app.simulation;
    await enter("ui:death:load"); await settle();
    await capture("load-browser");
    const pausedTime = app.timeMilliseconds; await app.step(1000); expect(app.timeMilliseconds).toBe(pausedTime);
    await enter("ui:saves:slot:q2-classic-baseq2/autosave.sav"); await settle();
    expect(app.simulation).not.toBe(original); expect(ui().controller.activeMenu).toBeNull(); expect(app.simulation.playerUi(ui().local.player.actor).health).toBeGreaterThan(0);
    await capture("restored");
    await kill(); const restored = app.simulation;
    await enter("ui:death:restart"); await settle();
    expect(app.simulation).not.toBe(restored); expect(ui().controller.activeMenu).toBeNull(); expect(app.simulation.playerUi(ui().local.player.actor).health).toBeGreaterThan(0);
    await capture("restarted");
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
}, 60000);

test("native Q3 singleplayer death retains match input and attack respawns without a recovery menu", async () => {
  const { Application } = await import("../../../src/app/bootstrap/application.ts");
  const { WorldSeatPresentation } = await import("../../../src/app/bootstrap/presentation.ts");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const root = await mkdtemp(join(tmpdir(), "quake-q3-match-death-")), saves = join(root, "saves");
  const parsed = parseApplicationCommand(["--game", "q3-baseq3", "--map", "q3dm1", "--movement", "q3", "--character", "q3",
    "--mode", "singleplayer", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240", "--user-content-root", root]);
  if (parsed.kind !== "run") throw new Error("Missing native Q3 match launch");
  const prints: string[] = [];
  const app = await Application.open(parsed.options, { print: text => { prints.push(text); }, saveDirectory: saves });
  try {
    const local = app.localPlayers[0], simulation = app.simulation;
    if (local === undefined || !(local.seat.presentation instanceof WorldSeatPresentation)) throw new Error("Missing match seat");
    const presentation = local.seat.presentation, client = presentation.q3Client;
    await app.step(50);
    presentation.local.console.field.setText("/kill"); presentation.local.console.submit(); await app.step(50);
    expect(simulation.playerUi(local.actor).health).toBeLessThanOrEqual(0);
    const time = app.timeMilliseconds;
    for (let frame = 0; frame < 25; frame++) {
      await app.step(100);
      expect(presentation.ui.controller.activeMenu).toBeNull();
      expect(presentation.local.input.focus.kind).toBe("game");
    }
    expect(app.timeMilliseconds).toBe(time + 2500);
    app.input({ kind: "mouse-button", seat: local.seat.id, button: 1, down: true, timeMilliseconds: performance.now() });
    try {
      for (let frame = 0; frame < 10 && simulation.playerUi(local.actor).health <= 0; frame++) await app.step(100);
      expect(simulation.playerUi(local.actor).health).toBeGreaterThan(0);
      expect(app.simulation).toBe(simulation); expect(local.seat.presentation).toBe(presentation); expect(presentation.q3Client).toBe(client);
      expect(presentation.ui.controller.activeMenu).toBeNull(); expect(presentation.local.input.focus.kind).toBe("game");
    } finally { app.input({ kind: "mouse-button", seat: local.seat.id, button: 1, down: false, timeMilliseconds: performance.now() }); }
    expect(prints.some(text => text.includes("Autosaved ") || text.includes("Autosave failed:"))).toBe(false);
    expect(await Bun.file(join(saves, "q3-baseq3", "autosave.sav")).exists()).toBe(false);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
}, 60000);
