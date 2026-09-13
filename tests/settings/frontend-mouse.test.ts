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
import { defaultGamepadTuning } from "../../src/input/gamepad.ts";
import { ConfigStore } from "../../src/settings/config.ts";
import { ApplicationInput } from "../../src/app/bootstrap/input.ts";

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

test("saved mouse baseline reloads read-only beneath selected overrides", async () => {
  const root = await mkdtemp(join(tmpdir(), "frontend-mouse-baseline-"));
  try {
    const one = new ConfigStore(join(root, "q1/id1")), two = new ConfigStore(join(root, "q2/baseq2"));
    const profile = { version: 1, bindings: [], gamepad: defaultGamepadTuning, mouse: { ...defaultMouseTuning,
      sensitivity: 7.5, yaw: -0.011, pitch: 0, invertPitch: true, acceleration: 0.75, filter: true, freeLook: false },
      history: [], rumble: true, controller: { kind: "automatic" } } satisfies import("../../src/settings/config.ts").SeatSettings;
    await one.saveSeat("input/seat-1.json", profile);
    await one.saveSeat("input/seat-2.json", { ...profile, mouse: { ...profile.mouse, sensitivity: 14 } });
    await two.saveSeat("input/seat-1.json", { ...profile, mouse: { ...defaultMouseTuning, sensitivity: 9, acceleration: 1 } });
    const before = await one.loadText("input/seat-1.json"), beforeOther = await one.loadText("input/seat-2.json");
    const preferences = new FrontendPreferences(() => "q1-netquake"), bindings = preferences.bindings();
    const read = (id: string): number | boolean => { const binding = control(bindings, id); if (binding.kind !== "slider" && binding.kind !== "toggle") throw new Error("Expected mouse value"); return binding.read(); };
    await preferences.loadBaseline(one);
    expect(preferences.values).toEqual({}); expect(read("sensitivity")).toBe(7.5);
    expect(read("mouse-yaw")).toBeCloseTo(50); expect(read("mouse-pitch")).toBe(0); expect(read("invert-mouse")).toBe(true);
    expect(read("acceleration")).toBe(0.75); expect(read("filter")).toBe(true); expect(read("freelook")).toBe(false);
    const acceleration = control(bindings, "acceleration"); if (acceleration.kind !== "slider") throw new Error("Expected acceleration");
    acceleration.write(0.5); expect(preferences.values).toEqual({ acceleration: 0.5 });
    await preferences.loadBaseline(two);
    expect(read("sensitivity")).toBe(9); expect(read("mouse-pitch")).toBeCloseTo(100); expect(read("invert-mouse")).toBe(false);
    expect(read("filter")).toBe(false); expect(read("freelook")).toBe(true); expect(read("acceleration")).toBe(0.5);
    await preferences.loadBaseline(new ConfigStore(join(root, "missing")));
    expect(read("sensitivity")).toBe(3); expect(preferences.values).toEqual({ acceleration: 0.5 });
    expect(await one.loadText("input/seat-1.json")).toBe(before); expect(await one.loadText("input/seat-2.json")).toBe(beforeOther);
    expect(await Bun.file(join(root, "missing/input/seat-1.json")).exists()).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("startup reads selected product profiles, preserves other seats through play, and reloads on return", async () => {
  const root = await mkdtemp(join(tmpdir(), "frontend-baseline-handoff-"));
  const q1 = new ConfigStore(join(root, "q1/id1")), q2 = new ConfigStore(join(root, "q2/baseq2"));
  const profile = { version: 1, bindings: [], gamepad: defaultGamepadTuning, mouse: { ...defaultMouseTuning,
    sensitivity: 7.5, pitch: 0.011, yaw: 0.033, invertPitch: true, acceleration: 0.75, filter: true, freeLook: false },
    history: [], rumble: true, controller: { kind: "automatic" } } satisfies import("../../src/settings/config.ts").SeatSettings;
  await q1.saveSeat("input/seat-1.json", profile);
  await q1.saveSeat("input/seat-2.json", { ...profile, mouse: { ...profile.mouse, sensitivity: 12, yaw: 0.044, filter: false } });
  await q2.saveSeat("input/seat-1.json", { ...profile, mouse: { ...defaultMouseTuning, sensitivity: 9, acceleration: 1 } });
  const parsed = parseApplicationCommand(["--game", "q1-classic-id1", "--movement", "q1", "--character", "q1", "--mode", "coop", "--seats", "2", "--frames", "1",
    "--renderer", "cpu", "--hidden", "--width", "640", "--height", "480", "--user-content-root", root]);
  if (parsed.kind !== "run") throw new Error("Missing startup options");
  const observed: { controller: NativeUiController | null } = { controller: null }, register = NativeUiController.prototype.register;
  const registration = spyOn(NativeUiController.prototype, "register").mockImplementation(function(this: NativeUiController, id, factory) {
    observed.controller = this; return register.call(this, id, factory);
  });
  const opened = spyOn(ApplicationInput, "open"), prints: string[] = []; let app: StartupApplication | null = null;
  try {
    app = await StartupApplication.open(parsed.options, { print: text => { prints.push(text); return undefined; } }, join(root, "saves"));
    const startup = app;
    const key = (code: number): void => { const seat = startup.inputSeat; if (seat === null) throw new Error("Missing startup seat");
      for (const down of [true, false]) startup.input({ seat, kind: "key", code, down, repeat: false, timeMilliseconds: performance.now() }); };
    const focus = (id: string): void => { for (let i = 0; i < 14; i++) {
      const current = observed.controller?.state().focus; if (current?.kind === "menu" && current.control === id) return; key(KeyCode.Tab);
    } throw new Error(`Unreachable ${id}`); };
    const read = (id: string): number | boolean => { const binding = control(startup.preferences.bindings(), id);
      if (binding.kind !== "slider" && binding.kind !== "toggle") throw new Error("Missing mouse value"); return binding.read(); };
    expect(startup.preferences.values).toEqual({}); expect(read("sensitivity")).toBe(7.5); expect(read("acceleration")).toBe(0.75);
    focus("ui:startup:options"); key(KeyCode.Enter); focus("ui:startup:controls"); key(KeyCode.Enter);
    expect(read("mouse-pitch")).toBeCloseTo(50); expect(read("mouse-yaw")).toBeCloseTo(150);
    expect(read("invert-mouse")).toBe(true); expect(read("filter")).toBe(true); expect(read("freelook")).toBe(false);
    focus("ui:input:acceleration"); key(KeyCode.Right); expect(startup.preferences.values).toEqual({ acceleration: 0.8 });
    startup.model.select("product", "q2-classic-baseq2"); await startup.step();
    expect(read("sensitivity")).toBe(9); expect(read("filter")).toBe(false); expect(read("acceleration")).toBe(0.8);
    startup.model.select("product", "q1-classic-id1"); await startup.step();
    expect(read("sensitivity")).toBe(7.5); expect(read("filter")).toBe(true);
    const capture = startup.captureNextFrame(); await startup.step();
    await Bun.write("/tmp/frontend-mouse-baseline.png", encodePng(640, 480, await capture));
    key(KeyCode.Escape); key(KeyCode.Escape); focus("ui:startup:multi"); key(KeyCode.Enter); focus("ui:startup:play"); key(KeyCode.Enter);
    await startup.step();
    const result = opened.mock.results.at(-1); if (result?.type !== "return") throw new Error(`Game did not open: ${prints.join("")}`);
    const input = await result.value;
    expect(input.locals.length).toBe(2); expect(input.locals[0]?.builder.mouse.tuning.sensitivity).toBe(7.5);
    expect(input.locals[1]?.builder.mouse.tuning.sensitivity).toBe(12); expect(input.locals[1]?.builder.mouse.tuning.filter).toBe(false);
    expect(input.locals[1]?.builder.mouse.tuning.yaw).toBe(Math.fround(0.044));
    expect((await q1.loadSeat("input/seat-1.json"))?.mouse.acceleration).toBe(Math.fround(0.8));
    expect((await q1.loadSeat("input/seat-2.json"))?.mouse.sensitivity).toBe(12);
    expect(startup.inputSeat).not.toBeNull(); expect(read("sensitivity")).toBe(7.5);
    expect(startup.preferences.values.sensitivity).toBeUndefined(); expect(startup.preferences.values.yaw).toBeUndefined();
    await startup.close(); app = null;
    app = await StartupApplication.open(parsed.options, { print: () => undefined }, join(root, "saves"));
    const restored = control(app.preferences.bindings(), "acceleration"); if (restored.kind !== "slider") throw new Error("Missing restored acceleration");
    expect(restored.read()).toBe(Math.fround(0.8)); expect(app.preferences.values).toEqual({});
  } finally { await app?.close(); opened.mockRestore(); registration.mockRestore(); await rm(root, { recursive: true, force: true }); }
}, 60000);

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
