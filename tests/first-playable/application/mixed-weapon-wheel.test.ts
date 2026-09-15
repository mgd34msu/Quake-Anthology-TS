import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { createStartupSelection } from "../../../src/app/bootstrap/startup-selection.ts";
import { encodePng } from "../../../src/formats/images/png-encoder.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { WorldSeatPresentation } from "../../../src/app/bootstrap/presentation.ts";
import { InputRouter } from "../../../src/input/router.ts";

test.skipIf(process.env["QUAKE_PRIVATE_NATIVE"] !== "1")("Q1 world with Q3 arsenal and Q2 rerelease monsters renders the weapon wheel", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-mixed-wheel-"));
  let app: Application | null = null, router: InputRouter | null = null;
  try {
    const parsed = parseApplicationCommand(["--game", "q1-classic-id1", "--map", "start", "--movement", "q1", "--character", "q3",
      "--model", "ranger", "--mode", "singleplayer", "--renderer", "gl", "--hidden", "--width", "1280", "--height", "720", "--user-content-root", root]);
    if (parsed.kind !== "run") throw new Error("Missing launch options");
    const selection = await createStartupSelection(parsed.options);
    selection.select("weapons", "q3-baseq3"); selection.select("enemies", "q2:monsters/rerelease/baseq2");
    selection.select("grapple", "disabled"); selection.select("grenades", "disabled");
    const launch = await selection.resolve();
    const application = app = await Application.open(launch.options, { saveDirectory: join(root, "saves"), print: text => { process.stdout.write(text); } }, launch.recipe);
    application.queueCommand("map", ["e1m1"], null); await application.step(16); await application.step(16);
    await application.step(100);
    const local = application.localPlayers[0];
    if (local === undefined || !(local.seat.presentation instanceof WorldSeatPresentation)) throw new Error("Missing local presentation");
    const ui = local.seat.presentation.ui;
    const route = router = new InputRouter({ seats: [{ input: ui.local.input, controller: { kind: "none" } }], keyboardSeat: local.seat.id,
      controllers: null, now: () => performance.now(), ticks: () => 0, subframe: false, unhandled: () => undefined });
    const tap = (code: number): void => { for (const down of [true, false]) route.handlePlatform({ kind: "key", timestamp: 0, scancode: code, keycode: code, modifiers: 0, down, repeat: false }); };
    tap(96); route.handlePlatform({ kind: "text", timestamp: 0, text: "give all" }); tap(13);
    await application.step(1); await application.step(1); tap(96);
    expect(application.simulation.playerUi(local.actor).items.some(item => item.id === "q3:weapon/rocketlauncher" && item.owned)).toBe(true);
    expect(application.simulation.playerUi(local.actor).items.filter(item => item.kind === "weapon" && item.owned).length).toBeGreaterThan(2);
    process.stdout.write(JSON.stringify({ phase: "granted", weapons: application.simulation.playerUi(local.actor).items.filter(item => item.kind === "weapon" && item.owned), health: application.simulation.playerUi(local.actor).health }) + "\n");
    const key = (down: boolean): void => route.handlePlatform({ kind: "key", timestamp: 0, scancode: 20, keycode: 113, modifiers: 0, down, repeat: false });
    key(true); await application.step(100); expect(ui.weaponWheel.isOpen).toBe(true);
    route.handlePlatform({ kind: "mouse-motion", timestamp: 0, x: 0, y: 0, dx: 0, dy: -170, buttons: 0 });
    const until = performance.now() + 10000;
    while (performance.now() < until) await application.step(16);
    const pixels = application.captureNextFrame(); await application.step(16);
    await Bun.write(process.env["QUAKE_WHEEL_CAPTURE"] ?? join(root, "wheel-open.png"), encodePng(1280, 720, await pixels));
    key(false); await application.step(100);
    expect(ui.weaponWheel.isOpen).toBe(false);
    for (let frame = 0; frame < 100 && application.simulation.playerUi(local.actor).activeWeapon !== "q3:weapon/gauntlet"; frame++) await application.step(16);
    expect(application.simulation.playerUi(local.actor).activeWeapon).toBe("q3:weapon/gauntlet");
    key(true); await application.step(16); expect(ui.weaponWheel.isOpen).toBe(true); key(false); await application.step(16);
    tap(96); route.handlePlatform({ kind: "text", timestamp: 0, text: "unbind q" }); tap(13);
    await application.step(16); await application.step(16); tap(96);
    expect(ui.local.input.binding({ kind: "key", code: 113 })).toBeNull();
    key(true); await application.step(16); expect(ui.weaponWheel.isOpen).toBe(false); key(false); await application.step(16);
  } finally { router?.close(); try { await app?.close(); } finally { await rm(root, { recursive: true, force: true }); } }
}, 120000);
