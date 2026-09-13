// SPDX-License-Identifier: GPL-2.0-or-later
// Live options retain Q1/Q2 named cvars and Q3 archived/latched cvar behavior.
import type { SeatId } from "../../contracts/identity.ts";
import type { Rect } from "../../contracts/render.ts";
import type { UiChoice, UiControl, UiControlId, UiMenuId } from "../../contracts/ui.ts";
import { CvarFlag, Q2CvarFlag } from "../../core/cvars/index.ts";
import type { CvarRegistry } from "../../core/cvars/index.ts";
import type { SeatInput } from "../../input/seat.ts";
import type { InputCommandBuilder } from "../../input/user-command.ts";
import type { RestartControls, RestartKind } from "../../settings/restart.ts";
import type { NativeUiController } from "../common/controller.ts";
import { menuRow } from "../common/layout.ts";
export * from "./bindings.ts";
export * from "./services.ts";

export type SettingCategory = "video" | "audio" | "input" | "network" | "accessibility" | "language";
interface SettingBase { readonly id: UiControlId; readonly label: string; readonly category: SettingCategory; readonly enabled: () => boolean; }
export type SettingBinding = SettingBase & (
  | { readonly kind: "toggle"; readonly read: () => boolean; readonly write: (value: boolean) => void }
  | { readonly kind: "slider"; readonly read: () => number; readonly write: (value: number) => void; readonly minimum: number; readonly maximum: number; readonly step: number }
  | { readonly kind: "choice"; readonly read: () => string; readonly write: (value: string) => void; readonly choices: () => readonly UiChoice[] }
  | { readonly kind: "text-entry"; readonly read: () => string; readonly write: (value: string) => void; readonly maximumLength: number;
      readonly commit?: { submit(value: string): void; cancel(): void } }
  | { readonly kind: "button"; readonly activate: () => void }
);
export function settingControl(binding: SettingBinding, rect: Rect, seat: SeatId): UiControl {
  const requireSeat = (actual: SeatId): void => { if (!actual.equals(seat)) throw new Error("Settings control belongs to another seat"); };
  const base = { id: binding.id, label: binding.label, rect, visible: true, enabled: binding.enabled() };
  switch (binding.kind) {
    case "toggle": return { ...base, kind: "toggle", checked: binding.read(), change: (actual, value) => { requireSeat(actual); binding.write(value); return undefined; } };
    case "slider": return { ...base, kind: "slider", value: binding.read(), minimum: binding.minimum, maximum: binding.maximum, step: binding.step,
      change: (actual, value) => { requireSeat(actual); binding.write(value); return undefined; } };
    case "choice": return { ...base, kind: "choice", selected: binding.read(), choices: binding.choices(),
      select: (actual, value) => { requireSeat(actual); binding.write(value); return undefined; } };
    case "text-entry": return { ...base, kind: "text-entry", text: binding.read(), maximumLength: binding.maximumLength,
      change: (actual, value) => { requireSeat(actual); binding.write(value); return undefined; },
      submit: (actual, value) => { requireSeat(actual); if (binding.commit === undefined) binding.write(value); else binding.commit.submit(value); return undefined; } };
    case "button": return { ...base, kind: "button", activate: actual => { requireSeat(actual); binding.activate(); return undefined; } };
  }
}

interface CvarSettingBase { readonly name: string; readonly label: string; readonly category: SettingCategory; readonly restart: RestartKind | null; }
export type CvarSettingSpec = CvarSettingBase & (
  | { readonly kind: "toggle" }
  | { readonly kind: "slider"; readonly minimum: number; readonly maximum: number; readonly step: number }
  | { readonly kind: "choice"; readonly choices: readonly UiChoice[] }
  | { readonly kind: "text-entry"; readonly maximumLength: number; readonly submitOnly?: boolean }
);
/** The subsystem registers its cvar and supplies the spec; menus never create unused cvars. */
export function bindCvarSetting(registry: CvarRegistry, spec: CvarSettingSpec, restarts: RestartControls | null): SettingBinding {
  if (registry.find(spec.name) === undefined) throw new Error(`Settings cvar has no owner: ${spec.name}`);
  if (spec.restart !== null && restarts === null) throw new Error(`Settings cvar needs a ${spec.restart} restart owner: ${spec.name}`);
  const read = (): string => {
    const value = registry.find(spec.name);
    if (value === undefined) throw new Error(`Settings cvar was unregistered: ${spec.name}`);
    return value.latchedValue ?? value.value;
  };
  const write = (value: string): void => {
    registry.set(spec.name, value);
    if (spec.restart !== null) restarts?.request(spec.restart);
  };
  const id: UiControlId = `ui:settings:${spec.name}`;
  const base = { id, label: spec.label, category: spec.category, enabled: () => {
    const cvar = registry.find(spec.name);
    const readonlyFlags = registry.dialect === "q3" ? CvarFlag.ReadOnly | CvarFlag.Init : registry.dialect.startsWith("q2") ? Q2CvarFlag.NoSet : 0;
    return cvar !== undefined && (cvar.flags & readonlyFlags) === 0;
  } };
  switch (spec.kind) {
    case "toggle": return { ...base, kind: "toggle", read: () => Number(read()) !== 0, write: value => write(value ? "1" : "0") };
    case "slider": return { ...base, kind: "slider", minimum: spec.minimum, maximum: spec.maximum, step: spec.step,
      read: () => Number(read()), write: value => write(String(value)) };
    case "choice": return { ...base, kind: "choice", read, choices: () => spec.choices, write: value => {
      if (!spec.choices.some(choice => choice.id === value)) throw new RangeError("Unknown cvar setting choice"); write(value);
    } };
    case "text-entry": {
      if (spec.submitOnly !== true) return { ...base, kind: "text-entry", read, write, maximumLength: spec.maximumLength };
      let draft: string | null = null;
      return { ...base, kind: "text-entry", read: () => draft ?? read(), write: value => { draft = value; }, maximumLength: spec.maximumLength,
        commit: { submit: value => { write(value); draft = null; }, cancel: () => { draft = null; } } };
    }
  }
}

export interface SettingsMenus { readonly root: UiMenuId; dispose(): void; }
const categories: readonly { readonly id: SettingCategory; readonly label: string }[] = [
  { id: "video", label: "Video" }, { id: "audio", label: "Audio" }, { id: "input", label: "Controls" },
  { id: "network", label: "Network" }, { id: "accessibility", label: "Accessibility" }, { id: "language", label: "Language" },
];
/** Pagination keeps every bound option reachable at the smallest native menu size. */
export function registerSettingsMenus(controller: NativeUiController, bindings: readonly SettingBinding[]): SettingsMenus {
  const root: UiMenuId = "menu:settings:root", disposers: (() => void)[] = [];
  const back = (): UiControl => ({ id: "ui:settings:back", kind: "button", label: "Back", rect: menuRow(11), enabled: true, visible: true,
    activate: () => controller.closeMenu() });
  for (const category of categories) {
    const selected = bindings.filter(binding => binding.category === category.id);
    if (selected.length === 0) continue;
    const pages = Math.ceil(selected.length / 9);
    for (let page = 0; page < pages; page++) {
      const id: UiMenuId = `menu:settings:${category.id}:${page}`;
      disposers.push(controller.register(id, () => {
        const controls = selected.slice(page * 9, page * 9 + 9).map((binding, index) => settingControl(binding, menuRow(index), controller.seat));
        for (const direction of [-1, 1]) {
          const target = page + direction;
          if (target < 0 || target >= pages) continue;
          controls.push({ id: `ui:settings:page:${direction}`, kind: "button", label: direction < 0 ? "Previous page" : "Next page",
            rect: menuRow(10, { x: direction < 0 ? 64 : 336, width: 240 }), enabled: true, visible: true,
            activate: () => { controller.closeMenu(); return controller.openMenu(`menu:settings:${category.id}:${target}`); } });
        }
        controls.push(back());
        return { id, title: `${category.label}${pages > 1 ? ` ${page + 1}/${pages}` : ""}`, fullScreen: false,
          controls, open: () => undefined, close: () => {
            for (const binding of selected.slice(page * 9, page * 9 + 9)) if (binding.kind === "text-entry") binding.commit?.cancel();
            return undefined;
          } };
      }));
    }
  }
  disposers.push(controller.register(root, () => ({ id: root, title: "Options", fullScreen: false,
    controls: [...categories.filter(category => bindings.some(binding => binding.category === category.id)).map((category, index): UiControl => ({
      id: `ui:settings:category:${category.id}`, kind: "button", label: category.label, rect: menuRow(index), enabled: true, visible: true,
      activate: () => controller.openMenu(`menu:settings:${category.id}:0`),
    })), back()], open: () => undefined, close: () => undefined })));
  return { root, dispose() { for (const dispose of disposers.reverse()) dispose(); } };
}

function numeric(id: string, label: string, minimum: number, maximum: number, step: number, read: () => number, write: (value: number) => void): SettingBinding {
  return { id: `ui:input:${id}`, label, category: "input", kind: "slider", enabled: () => true, minimum, maximum, step, read, write };
}
function toggle(id: string, label: string, read: () => boolean, write: (value: boolean) => void): SettingBinding {
  return { id: `ui:input:${id}`, label, category: "input", kind: "toggle", enabled: () => true, read, write };
}
export interface PrimaryInputSettings { readonly sensitivity: number; readonly invertMouse: boolean; readonly alwaysRun: boolean; }
export interface ControllerVibrationSettings { readonly controllerVibration: boolean; readonly controllerVibrationStrength: number; }
export function bindControllerVibration(service: SettingsValueService<ControllerVibrationSettings>): readonly SettingBinding[] {
  return [toggle("controller-vibration", "Controller vibration", () => service.read().controllerVibration,
    value => service.write({ controllerVibration: value })),
    numeric("controller-vibration-strength", "Vibration strength", 0, 1, 0.05, () => service.read().controllerVibrationStrength,
      value => service.write({ controllerVibrationStrength: value }))];
}
export interface AudioSettings { readonly effectsVolume: number; readonly musicVolume: number; }
export interface SettingsValueService<T> { read(): T; write(values: Partial<T>): void; }
export function bindPrimaryInputSettings(service: SettingsValueService<PrimaryInputSettings>): readonly SettingBinding[] {
  return [numeric("sensitivity", "Mouse sensitivity", 0.1, 20, 0.1, () => service.read().sensitivity, value => service.write({ sensitivity: value })),
    toggle("invert-mouse", "Invert mouse", () => service.read().invertMouse, value => service.write({ invertMouse: value })),
    toggle("always-run", "Always run", () => service.read().alwaysRun, value => service.write({ alwaysRun: value }))];
}
export function bindAudioSettings(service: SettingsValueService<AudioSettings>): readonly SettingBinding[] {
  return [{ id: "ui:audio:effects", label: "Effects volume", category: "audio", kind: "slider", enabled: () => true,
    minimum: 0, maximum: 1, step: 0.05, read: () => service.read().effectsVolume, write: value => service.write({ effectsVolume: value }) },
  { id: "ui:audio:music", label: "Music volume", category: "audio", kind: "slider", enabled: () => true,
    minimum: 0, maximum: 1, step: 0.05, read: () => service.read().musicVolume, write: value => service.write({ musicVolume: value }) }];
}

/** These controls change the objects sampled by the next real user command. */
export function bindInputSettings(input: SeatInput, builder: InputCommandBuilder, vibration?: SettingsValueService<ControllerVibrationSettings>): readonly SettingBinding[] {
  const mouse = builder.mouse, pad = input.gamepad;
  return [
    ...(vibration === undefined ? [] : bindControllerVibration(vibration)),
    ...bindPrimaryInputSettings({ read: () => ({ sensitivity: mouse.tuning.sensitivity, invertMouse: mouse.tuning.invertPitch, alwaysRun: builder.tuning.alwaysRun }),
      write: values => {
        mouse.tuning = { ...mouse.tuning, ...(values.sensitivity === undefined ? {} : { sensitivity: values.sensitivity }),
          ...(values.invertMouse === undefined ? {} : { invertPitch: values.invertMouse }) };
        if (values.alwaysRun !== undefined) builder.tuning = { ...builder.tuning, alwaysRun: values.alwaysRun };
      } }),
    numeric("acceleration", "Mouse acceleration", 0, 2, 0.05, () => mouse.tuning.acceleration, value => { mouse.tuning = { ...mouse.tuning, acceleration: value }; }),
    toggle("filter", "Mouse smoothing", () => mouse.tuning.filter, value => { mouse.tuning = { ...mouse.tuning, filter: value }; }),
    toggle("freelook", "Free look", () => mouse.tuning.freeLook, value => { mouse.tuning = { ...mouse.tuning, freeLook: value }; }),
    toggle("invert-controller", "Invert controller", () => pad.tuning.invertPitch, value => { pad.tuning = { ...pad.tuning, invertPitch: value }; }),
    toggle("swap-sticks", "Swap controller sticks", () => pad.tuning.swapSticks, value => { pad.tuning = { ...pad.tuning, swapSticks: value }; }),
    numeric("look-speed", "Controller turn speed", 30, 720, 10, () => pad.tuning.yawDegreesPerSecond, value => { pad.tuning = { ...pad.tuning, yawDegreesPerSecond: value }; }),
    numeric("pitch-speed", "Controller look speed", 30, 720, 10, () => pad.tuning.pitchDegreesPerSecond, value => { pad.tuning = { ...pad.tuning, pitchDegreesPerSecond: value }; }),
    numeric("move-deadzone", "Move stick deadzone", 0, 0.5, 0.01, () => pad.tuning.move.deadzone, value => { pad.tuning = { ...pad.tuning, move: { ...pad.tuning.move, deadzone: value } }; }),
    numeric("look-deadzone", "Look stick deadzone", 0, 0.5, 0.01, () => pad.tuning.look.deadzone, value => { pad.tuning = { ...pad.tuning, look: { ...pad.tuning.look, deadzone: value } }; }),
    numeric("look-curve", "Look response curve", 0.5, 4, 0.1, () => pad.tuning.look.exponent, value => { pad.tuning = { ...pad.tuning, look: { ...pad.tuning.look, exponent: value } }; }),
    numeric("trigger", "Trigger threshold", 0.05, 0.95, 0.05, () => pad.tuning.triggerThreshold, value => { pad.tuning = { ...pad.tuning, triggerThreshold: value }; }),
  ];
}

export interface UiPreferenceValues {
  readonly hudScale: number; readonly textScale: number; readonly menuScale: number;
  readonly highContrast: boolean; readonly reducedFlashes: boolean; readonly captions: boolean;
  readonly crosshair: boolean; readonly crosshairSize: number;
}
/** Preferences are consumed directly by the common menu and HUD draw functions. */
export class SeatUiPreferences {
  values: UiPreferenceValues = { hudScale: 1, textScale: 1, menuScale: 1, highContrast: false, reducedFlashes: false, captions: true, crosshair: true, crosshairSize: 8 };
  constructor(readonly seat: SeatId) {}
  bindings(): readonly SettingBinding[] {
    const number = (key: "hudScale" | "textScale" | "menuScale" | "crosshairSize", label: string, minimum: number, maximum: number, step: number): SettingBinding => ({
      id: `ui:accessibility:${key}`, label, category: "accessibility", kind: "slider", enabled: () => true, minimum, maximum, step,
      read: () => this.values[key], write: value => { this.values = { ...this.values, [key]: value }; },
    });
    const boolean = (key: "highContrast" | "reducedFlashes" | "captions" | "crosshair", label: string): SettingBinding => ({
      id: `ui:accessibility:${key}`, label, category: "accessibility", kind: "toggle", enabled: () => true,
      read: () => this.values[key], write: value => { this.values = { ...this.values, [key]: value }; },
    });
    return [number("hudScale", "HUD size", 0.5, 1.5, 0.05), number("textScale", "Text size", 0.75, 2, 0.05),
      number("menuScale", "Menu size", 0.75, 1, 0.05), number("crosshairSize", "Crosshair size", 2, 32, 1),
      boolean("highContrast", "High contrast"), boolean("reducedFlashes", "Reduce HUD flashes"), boolean("captions", "Captions"), boolean("crosshair", "Crosshair")];
  }
}
export * from "./gyro.ts";
