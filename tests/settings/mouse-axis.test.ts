import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { MouseInput } from "../../src/input/mouse.ts";
import { MouseSettings } from "../../src/input/mouse-settings.ts";
import { SeatInput } from "../../src/input/seat.ts";
import { InputCommandBuilder } from "../../src/input/user-command.ts";
import { bindInputSettings, settingControl } from "../../src/ui/settings/index.ts";
import type { SettingBinding } from "../../src/ui/settings/index.ts";
import { FrontendPreferences, changedFrontendPreferences } from "../../src/app/bootstrap/frontend-preferences.ts";

function slider(bindings: readonly SettingBinding[], id: string) {
  const binding = bindings.find(value => value.id === `ui:input:${id}`);
  if (binding === undefined || binding.kind !== "slider") throw new Error(`Missing slider ${id}`);
  return binding;
}

function controls() {
  const owner = createIdentityOwner("mouse-axis-settings"), seat = owner.seat(0);
  const context = { session: owner.session, origin: { kind: "local-seat", seat, client: owner.client(0, 0) } } satisfies import("../../src/contracts/common.ts").CommandContext;
  const commands = new CommandBuffer({ dialect: "q3", context });
  const input = new SeatInput({ seat, dialect: "q3", context, commands, uiEvent: () => false });
  const cvars = new CvarRegistry({ dialect: "q3", context });
  const builder = new InputCommandBuilder("q3", new MouseInput(new MouseSettings(cvars)));
  return { seat, builder, cvars, bindings: bindInputSettings(input, builder) };
}

test("shared axis controls scale actual mouse movement independently and retain inversion through zero", () => {
  const { seat, builder, bindings } = controls();
  const horizontal = slider(bindings, "mouse-yaw"), vertical = slider(bindings, "mouse-pitch");
  slider(bindings, "sensitivity").write(5);
  vertical.write(50);
  expect(builder.mouse.tuning.pitch).toBeCloseTo(0.011);
  expect(builder.mouse.tuning.yaw).toBeCloseTo(0.022);
  const motion = builder.mouse.sample({ x: 10, y: 10 }, 16, false, true);
  expect(motion.yaw).toBeCloseTo(-1.1); expect(motion.pitch).toBeCloseTo(0.55);
  expect(settingControl(vertical, { x: 0, y: 0, width: 100, height: 20 }, seat).label).toBe("Vertical sensitivity: 50%");
  builder.mouse.tuning = { ...builder.mouse.tuning, invertPitch: true, yaw: -0.022 };
  vertical.write(0); vertical.write(100);
  horizontal.write(0);
  expect(Object.is(builder.mouse.tuning.yaw, -0)).toBe(true);
  horizontal.write(50);
  expect(builder.mouse.tuning.yaw).toBeCloseTo(-0.011);
  expect(builder.mouse.tuning.invertPitch).toBe(true);
  expect(builder.mouse.sample({ x: 10, y: 10 }, 16, false, true).pitch).toBeLessThan(0);
  expect(vertical.minimum).toBe(0); expect(vertical.maximum).toBe(200); expect(vertical.step).toBe(1);
});

test("menu reads retain console coefficients beyond the slider range", () => {
  const { seat, builder, cvars, bindings } = controls();
  cvars.set("m_pitch", "0.11"); cvars.set("m_yaw", "-0.066");
  const vertical = slider(bindings, "mouse-pitch");
  expect(vertical.read()).toBeCloseTo(500);
  expect(settingControl(vertical, { x: 0, y: 0, width: 100, height: 20 }, seat).label).toBe("Vertical sensitivity: 500%");
  expect(builder.mouse.tuning.pitch).toBeCloseTo(0.11);
  expect(builder.mouse.tuning.yaw).toBeCloseTo(-0.066);
  vertical.write(201);
  expect(builder.mouse.tuning.pitch).toBeCloseTo(0.044);
});

test("frontend uses the same axis bindings and transfers only selected coefficient changes", () => {
  const preferences = new FrontendPreferences(() => "q1-netquake");
  const bindings = preferences.bindings();
  expect(preferences.values).toEqual({});
  slider(bindings, "mouse-pitch").write(50);
  expect(preferences.values).toEqual({ pitch: 0.011 });
  expect(slider(preferences.bindings(), "mouse-pitch").read()).toBe(50);
  const before = { sensitivity: 3, pitch: 0.022, yaw: 0.022, invertMouse: false, alwaysRun: false,
    effectsVolume: 0.7, musicVolume: 0.25, controllerVibration: true, controllerVibrationStrength: 1 };
  expect(changedFrontendPreferences(before, { ...before, yaw: -0 }, preferences.values)).toEqual({ pitch: 0.011, yaw: -0 });
});
