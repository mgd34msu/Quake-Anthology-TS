import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FrontendPreferences, changedFrontendPreferences } from "../../src/app/bootstrap/frontend-preferences.ts";
import { StartupApplication } from "../../src/app/bootstrap/startup.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { NativeUiController } from "../../src/ui/common/controller.ts";
import { KeyCode } from "../../src/input/key-codes.ts";
import { encodePng } from "../../src/formats/images/png.ts";
import { bindMouseMotionSettings } from "../../src/ui/settings/index.ts";
import type { SettingBinding } from "../../src/ui/settings/index.ts";
import type { UiMenu, UiMenuId } from "../../src/contracts/ui.ts";
import { defaultMouseTuning } from "../../src/input/mouse.ts";

function control(bindings: readonly SettingBinding[], id: string): SettingBinding {
  const binding = bindings.find(binding => binding.id === `ui:input:${id}`);
  if (binding === undefined) throw new Error(`Missing mouse setting ${id}`);
  return binding;
}

test("frontend mouse extras reuse shared definitions and return only selected fields", () => {
  const preferences = new FrontendPreferences(() => "q1-netquake");
  const defaults = bindMouseMotionSettings({ read: () => defaultMouseTuning, write: () => undefined });
  for (const expected of defaults) {
    const actual = preferences.bindings().find(binding => binding.id === expected.id);
    expect(actual?.label).toBe(expected.label); expect(actual?.kind).toBe(expected.kind);
    if (actual?.kind === "slider" && expected.kind === "slider") {
      expect(actual.read()).toBe(expected.read()); expect(actual.minimum).toBe(expected.minimum);
      expect(actual.maximum).toBe(expected.maximum); expect(actual.step).toBe(expected.step);
    }
    if (actual?.kind === "toggle" && expected.kind === "toggle") expect(actual.read()).toBe(expected.read());
  }
  expect(preferences.values).toEqual({});
  const filter = control(preferences.bindings(), "filter"); if (filter.kind !== "toggle") throw new Error("Expected smoothing toggle");
  filter.write(true); expect(preferences.values).toEqual({ filter: true });
  const acceleration = control(preferences.bindings(), "acceleration"); if (acceleration.kind !== "slider") throw new Error("Expected acceleration slider");
  acceleration.write(0.5); expect(preferences.values).toEqual({ filter: true, acceleration: 0.5 });
  const before = { sensitivity: 7, pitch: 0.01, yaw: 0.03, invertMouse: true, alwaysRun: false, acceleration: 0.5, filter: true, freeLook: false,
    effectsVolume: 0.7, musicVolume: 0.25, controllerVibration: true, controllerVibrationStrength: 1 };
  expect(changedFrontendPreferences(before, { ...before, freeLook: true }, preferences.values)).toEqual({ filter: true, acceleration: 0.5, freeLook: true });
});

for (const width of [320, 640]) test(`startup Controls at ${width} reaches shared mouse settings and Gyro across pages`, async () => {
  const root = await mkdtemp(join(tmpdir(), "frontend-mouse-")), height = width * 3 / 4;
  const parsed = parseApplicationCommand(["--game", "q1-classic-id1", "--renderer", "cpu", "--hidden", "--width", String(width), "--height", String(height), "--user-content-root", root]);
  if (parsed.kind !== "run") throw new Error("Missing startup options");
  const menus = new Map<UiMenuId, () => UiMenu>(), observed: { controller: NativeUiController | null } = { controller: null };
  const register = NativeUiController.prototype.register;
  const registration = spyOn(NativeUiController.prototype, "register").mockImplementation(function(this: NativeUiController, id, factory) {
    observed.controller = this; menus.set(id, factory); return register.call(this, id, factory);
  });
  let app: StartupApplication | null = null;
  try {
    app = await StartupApplication.open(parsed.options, { print: () => undefined }, join(root, "saves"));
    const startup = app, seat = startup.inputSeat, controller = observed.controller;
    if (seat === null || controller === null) throw new Error("Missing startup input");
    const key = (code: number): void => { for (const down of [true, false]) startup.input({ seat, kind: "key", code, down, repeat: false, timeMilliseconds: performance.now() }); };
    for (let i = 0; i < 3; i++) key(KeyCode.Down); key(KeyCode.Enter);
    key(KeyCode.Down); key(KeyCode.Down); key(KeyCode.Enter);
    expect(controller.activeMenu).toBe("menu:settings:input:0");
    const focus = (id: string): void => {
      for (let i = 0; i < 14; i++) {
        const current = controller.state().focus; if (current.kind === "menu" && current.control === id) return;
        key(KeyCode.Tab);
      }
      throw new Error(`Unreachable startup control ${id}`);
    };
    const page = menus.get("menu:settings:input:0")?.(); if (page === undefined) throw new Error("Missing Controls page");
    for (const row of page.controls) {
      expect(row.rect.y).toBeGreaterThanOrEqual(0); expect(row.rect.y + row.rect.height).toBeLessThanOrEqual(480);
      if (row.enabled && row.visible) focus(row.id);
    }
    focus("ui:input:filter"); key(KeyCode.Enter); expect(startup.preferences.values).toEqual({ filter: true });
    focus("ui:input:acceleration"); key(KeyCode.Right); expect(startup.preferences.values.acceleration).toBe(0.05);
    focus("ui:input:freelook"); key(KeyCode.Enter); expect(startup.preferences.values.freeLook).toBe(false);
    const first = startup.captureNextFrame(); await startup.step();
    await Bun.write(`/tmp/frontend-mouse-${width}-page1.png`, encodePng(width, height, await first));
    focus("ui:settings:page:1"); key(KeyCode.Enter);
    expect(controller.activeMenu).toBe("menu:settings:input:1");
    focus("ui:startup:gyro");
    const second = startup.captureNextFrame(); await startup.step();
    await Bun.write(`/tmp/frontend-mouse-${width}-page2.png`, encodePng(width, height, await second));
    key(KeyCode.Enter); expect(controller.activeMenu).toBe("menu:settings:gyro");
    key(KeyCode.Escape); expect(controller.activeMenu).toBe("menu:settings:input:1");
    focus("ui:settings:page:-1"); key(KeyCode.Enter); expect(controller.activeMenu).toBe("menu:settings:input:0");
    focus("ui:settings:back"); key(KeyCode.Enter); expect(controller.activeMenu).toBe("menu:startup:options");
  } finally { await app?.close(); registration.mockRestore(); await rm(root, { recursive: true, force: true }); }
}, 60000);
