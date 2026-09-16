import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { ApplicationImageSettings } from "../../../src/app/bootstrap/image-settings.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { WorldSeatPresentation } from "../../../src/app/bootstrap/presentation.ts";
import { encodePng } from "../../../src/formats/images/png.ts";
import { KeyCode } from "../../../src/input/key-codes.ts";
import { bindNativeVideoSettings } from "../../../src/ui/settings/services.ts";
import { StartupApplication } from "../../../src/app/bootstrap/startup.ts";

function luminance(pixels: Uint8Array): number {
  let sum = 0;
  for (let index = 0; index < pixels.length; index++) if (index % 4 !== 3) sum += pixels[index] ?? 0;
  return sum;
}

for (const backend of ["cpu", "gl"]) test(`actual ${backend} Display menu previews brightness, saves it, and resizes without replacing the simulation`, async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-video-settings-"));
  const parsed = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--movement", "q2", "--character", "q2",
    "--renderer", backend, "--hidden", "--width", "640", "--height", "480", "--user-content-root", root]);
  if (parsed.kind !== "run") throw new Error("Missing video options");
  let app: Application | null = null;
  try {
    app = await Application.open(parsed.options, { print: () => undefined });
    const application = app, local = app.localPlayers[0], window = app.window;
    if (local === undefined || !(local.seat.presentation instanceof WorldSeatPresentation) || window === null) throw new Error("Missing graphical application");
    const controller = local.seat.presentation.ui.controller, simulation = application.simulation;
    const key = (code: number): void => { for (const down of [true, false]) application.input({ seat: local.seat.id, kind: "key", code, down, repeat: false, timeMilliseconds: performance.now() }); };
    const focus = (id: string): void => {
      for (let attempts = 0; attempts < 30; attempts++) {
        const state = controller.state().focus;
        if (state.kind === "menu" && state.control === id) return;
        key(KeyCode.Tab);
      }
      throw new Error(`Could not focus ${id}`);
    };
    const enter = async (id: string): Promise<void> => { focus(id); key(KeyCode.Enter); await application.step(1); };
    const capture = async (): Promise<Uint8Array> => { const next = application.captureNextFrame(); await application.step(1); return next; };
    await application.step(1); key(KeyCode.Escape); await application.step(1);
    await enter("ui:application:settings"); await enter("ui:settings:category:display");
    expect(controller.activeMenu).toBe("menu:settings:display:0");
    const dark = await capture();
    await Bun.write(`/tmp/video-settings-${backend}-default.png`, encodePng(640, 480, dark));
    focus("ui:video:brightness"); for (let count = 0; count < 20; count++) key(KeyCode.Right);
    await application.step(1);
    const bright = await capture();
    await Bun.write(`/tmp/video-settings-${backend}-bright.png`, encodePng(640, 480, bright));
    expect(luminance(bright)).toBeGreaterThan(luminance(dark) * 1.15);
    expect(await Bun.file(join(root, "settings/images.cfg")).text()).toContain('r_gamma "2"');
    const saved = await ApplicationImageSettings.open({ context: { session: application.session.session, origin: { kind: "local-console" } }, dialect: "q2-classic", userContentRoot: root, print: () => undefined });
    expect(saved.gamma).toBe(2); await saved.close();
    await enter("ui:video:brightness-reset");
    const restored = await capture(); expect(luminance(restored)).toBeLessThan(luminance(bright) / 1.15);
    const setText = (id: string, value: string): void => { focus(id); key(KeyCode.End); for (let count = 0; count < 4; count++) key(KeyCode.Backspace);
      application.input({ seat: local.seat.id, kind: "text", text: value, timeMilliseconds: performance.now() }); };
    setText("ui:video:custom-width", "800"); setText("ui:video:custom-height", "600"); await enter("ui:video:custom-apply");
    expect(window.logicalSize).toEqual({ width: 800, height: 600 });
    const resized = await capture(); expect(resized.length).toBe(800 * 600 * 4);
    await Bun.write(`/tmp/video-settings-${backend}-custom.png`, encodePng(800, 600, resized));
    setText("ui:video:custom-width", "bad"); key(KeyCode.Enter); await application.step(1);
    expect(window.logicalSize).toEqual({ width: 800, height: 600 });
    const bindings = bindNativeVideoSettings(() => window, null, () => undefined), resolution = bindings.find(binding => binding.id === "ui:video:resolution");
    if (resolution?.kind !== "choice") throw new Error("Missing resolution binding");
    for (const mode of window.displayModes) expect(resolution.choices().some(choice => choice.id === `${mode.width}x${mode.height}`)).toBe(true);
    expect(resolution.read()).toBe("800x600"); expect(application.simulation).toBe(simulation); expect(application.window).toBe(window);
    if (backend === "gl") { await enter("ui:video:vsync"); expect(window.swapInterval).toBe(0); }
    focus("ui:video:brightness"); for (let count = 0; count < 20; count++) key(KeyCode.Right);
    await application.step(1);
    await application.close(); app = null;
    const startup = await StartupApplication.open({ ...parsed.options, displayOverrides: {} }, { print: () => undefined }, join(root, "saves"));
    try {
      await startup.step(); expect(startup.model.options).toMatchObject({ width: 800, height: 600, gamma: 2 });
      expect(startup.model.options.displayOverrides).toEqual({});
      const seat = startup.inputSeat; if (seat === null) throw new Error("Missing startup seat");
      const startupKey = (code: number): void => { for (const down of [true, false]) startup.input({ seat, kind: "key", code, down, repeat: false, timeMilliseconds: performance.now() }); };
      for (let index = 0; index < 3; index++) startupKey(KeyCode.Down);
      startupKey(KeyCode.Enter); startupKey(KeyCode.Enter);
      const pixels = startup.captureNextFrame(); await startup.step();
      await Bun.write(`/tmp/video-settings-${backend}-startup.png`, encodePng(800, 600, await pixels));
    } finally { await startup.close(); }
    const explicit = await StartupApplication.open({ ...parsed.options, displayOverrides: { gamma: 1 } }, { print: () => undefined }, join(root, "saves"));
    try { await explicit.step(); expect(explicit.model.options.gamma).toBe(1); expect(explicit.model.options.width).toBe(800); }
    finally { await explicit.close(); }
  } finally { await app?.close(); await rm(root, { recursive: true, force: true }); }
}, 60000);
