import { validateGamepadTuning } from "../../input/gamepad.ts";
import type { GamepadTuning, StickCurve } from "../../input/gamepad.ts";
import { defaultUiPreferences, readUiPreferences, writeUiPreferences } from "./accessibility.ts";
import { audioOutputFormat, audioOutputRates, type AudioOutputFormat } from "../../audio/output.ts";
import { registerLlmSettingsMenu, type LlmSettingsUi } from "./llm.ts";
// SPDX-License-Identifier: GPL-2.0-or-later
// Live options retain Q1/Q2 named cvars and Q3 archived/latched cvar behavior.
import type { SeatId } from "../../contracts/identity.ts";
import type { Rect } from "../../contracts/render.ts";
import type { UiChoice, UiControl, UiControlId, UiMenuId } from "../../contracts/ui.ts";
import { CvarFlag, Q2CvarFlag } from "../../core/cvars/index.ts";
import type { CvarRegistry } from "../../core/cvars/index.ts";
import { defaultMouseTuning } from "../../input/mouse.ts";
import type { MouseTuning } from "../../input/mouse.ts";
import type { SeatInput } from "../../input/seat.ts";
import type { InputCommandBuilder } from "../../input/user-command.ts";
import type { RestartControls, RestartKind } from "../../settings/restart.ts";
import type { NativeUiController } from "../common/controller.ts";
import { menuRow } from "../common/layout.ts";
export * from "./bindings.ts";
export * from "./services.ts";
export * from "./input-routing.ts";

export type SettingCategory = "display" | "video" | "audio" | "input" | "network" | "accessibility" | "language";
interface SettingBase { readonly id: UiControlId; readonly label: string; readonly category: SettingCategory; readonly enabled: () => boolean; }
export type SettingBinding = SettingBase & (
  | { readonly kind: "toggle"; readonly read: () => boolean; readonly write: (value: boolean) => void }
  | { readonly kind: "slider"; readonly formatValue?: (value: number) => string; readonly read: () => number; readonly write: (value: number) => void; readonly minimum: number; readonly maximum: number; readonly step: number }
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
    case "slider": return { ...base, kind: "slider", value: binding.read(), ...(binding.formatValue === undefined ? {} : { valueLabel: binding.formatValue(binding.read()) }), minimum: binding.minimum, maximum: binding.maximum, step: binding.step,
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
export type SettingCvars = Pick<CvarRegistry, "dialect" | "find" | "set" | "variableValue">;
export function bindCvarSetting(registry: SettingCvars, spec: CvarSettingSpec, restarts: RestartControls | null): SettingBinding {
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
  { id: "display", label: "Display" }, { id: "video", label: "Graphics" }, { id: "audio", label: "Audio" }, { id: "input", label: "Controls" },
  { id: "network", label: "Network" }, { id: "accessibility", label: "Accessibility" }, { id: "language", label: "Language" },
];
/** Categories retain native controls in one scrollable view. */
export function registerSettingsMenus(controller: NativeUiController, bindings: readonly SettingBinding[], llm?: LlmSettingsUi, reset?: { readonly label: string; apply(): void }): SettingsMenus {
  const root: UiMenuId = "menu:settings:root", disposers: (() => void)[] = [];
  const llmMenu = llm === undefined ? null : registerLlmSettingsMenu(controller, llm);
  if (reset !== undefined) disposers.push(controller.register("menu:settings:reset-confirm", () => ({ id: "menu:settings:reset-confirm", title: reset.label, fullScreen: true,
    controls: [{ id: "ui:settings:keep", kind: "button", label: "Keep current settings", rect: menuRow(3), enabled: true, visible: true, activate: () => controller.closeMenu() },
      { id: "ui:settings:reset-apply", kind: "button", label: "Restore defaults", rect: menuRow(5), enabled: true, visible: true, activate: () => { reset.apply(); return controller.closeMenu(); } }],
    open: () => undefined, close: () => undefined })));

  if (llmMenu !== null) disposers.push(llmMenu.dispose);
  const back = (): UiControl => ({ id: "ui:settings:back", kind: "button", label: "Back", rect: menuRow(11), enabled: true, visible: true,
    activate: () => controller.closeMenu() });
  for (const category of categories) {
    const selected = bindings.filter(binding => binding.category === category.id);
    if (selected.length === 0) continue;
    const id: UiMenuId = `menu:settings:${category.id}:0`;
    disposers.push(controller.register(id, () => {
      const controls = selected.map((binding, index) => settingControl(binding, menuRow(index, { width: 496 }), controller.seat));
      return { id, title: category.label, fullScreen: false,
        scroll: { rect: { x: 64, y: 92, width: 512, height: 300 }, contentHeight: selected.length * 28, controls: controls.map(control => control.id) },
        controls: [...controls, back()], open: () => undefined, close: () => {
          for (const binding of selected) if (binding.kind === "text-entry") binding.commit?.cancel();
          return undefined;
        } };
    }));
  }
  disposers.push(controller.register(root, () => ({ id: root, title: "Options", fullScreen: false,
    controls: [...categories.filter(category => bindings.some(binding => binding.category === category.id)).map((category, index): UiControl => ({
      id: `ui:settings:category:${category.id}`, kind: "button", label: category.label, rect: menuRow(index), enabled: true, visible: true,
      activate: () => controller.openMenu(`menu:settings:${category.id}:0`),
    })), ...(llmMenu === null ? [] : [{ id: "ui:settings:llm", kind: "button", label: "LLM options", rect: menuRow(categories.filter(category => bindings.some(binding => binding.category === category.id)).length), enabled: true, visible: true, activate: () => controller.openMenu(llmMenu.root) } satisfies UiControl]), ...(reset === undefined ? [] : [{ id: "ui:settings:reset", kind: "button", label: reset.label,
    rect: menuRow(categories.filter(category => bindings.some(binding => binding.category === category.id)).length + (llmMenu === null ? 0 : 1)), enabled: true, visible: true,
    activate: () => controller.openMenu("menu:settings:reset-confirm") } satisfies UiControl]), back()], open: () => undefined, close: () => undefined })));
  return { root, dispose() { for (const dispose of disposers.reverse()) dispose(); } };
}

function numeric(id: string, label: string, minimum: number, maximum: number, step: number, read: () => number, write: (value: number) => void): Extract<SettingBinding, { readonly kind: "slider" }> {
  return { id: `ui:input:${id}`, label, category: "input", kind: "slider", enabled: () => true, minimum, maximum, step, read, write };
}
function toggle(id: string, label: string, read: () => boolean, write: (value: boolean) => void): SettingBinding {
  return { id: `ui:input:${id}`, label, category: "input", kind: "toggle", enabled: () => true, read, write };
}
export interface PrimaryInputSettings { readonly sensitivity: number; readonly pitch: number; readonly yaw: number; readonly invertMouse: boolean; readonly alwaysRun: boolean; }
export type MouseMotionSettings = Pick<MouseTuning, "acceleration" | "filter" | "freeLook" | "lookSpring" | "lookStrafe">;
export interface ControllerVibrationSettings { readonly controllerVibration: boolean; readonly controllerVibrationStrength: number; }
export function bindControllerVibration(service: SettingsValueService<ControllerVibrationSettings>): readonly SettingBinding[] {
  return [toggle("controller-vibration", "Controller vibration", () => service.read().controllerVibration,
    value => service.write({ controllerVibration: value })),
    numeric("controller-vibration-strength", "Vibration strength", 0, 1, 0.05, () => service.read().controllerVibrationStrength,
      value => service.write({ controllerVibrationStrength: value }))];
}
export interface AudioSettings { readonly effectsVolume: number; readonly musicVolume: number; }
export interface SettingsValueService<T> { read(): T; write(values: Partial<T>): void; }
function mouseAxis(service: SettingsValueService<PrimaryInputSettings>, axis: "pitch" | "yaw", name: string): SettingBinding {
  const read = (): number => Math.abs(service.read()[axis]) / defaultMouseTuning[axis] * 100;
  return { id: `ui:input:mouse-${axis}`, label: name, category: "input",
    kind: "slider", enabled: () => true, minimum: 0, maximum: 200, step: 1, read, formatValue: value => `${Number(value.toFixed(2))}%`,
    write: value => {
      const current = service.read()[axis];
      const direction = current < 0 || Object.is(current, -0) ? -1 : 1;
      service.write({ [axis]: direction * defaultMouseTuning[axis] * Math.min(200, Math.max(0, value)) / 100 });
    } };
}
export function bindPrimaryInputSettings(service: SettingsValueService<PrimaryInputSettings>): readonly SettingBinding[] {
  return [numeric("sensitivity", "Mouse sensitivity", 0.1, 20, 0.1, () => service.read().sensitivity, value => service.write({ sensitivity: value })),
    mouseAxis(service, "yaw", "Horizontal sensitivity"), mouseAxis(service, "pitch", "Vertical sensitivity"),
    toggle("invert-mouse", "Invert mouse", () => service.read().invertMouse, value => service.write({ invertMouse: value })),
    toggle("always-run", "Always run", () => service.read().alwaysRun, value => service.write({ alwaysRun: value }))];
}
export function bindMouseMotionSettings(service: SettingsValueService<MouseMotionSettings>, springAvailable: () => boolean = () => true): readonly SettingBinding[] {
  return [numeric("acceleration", "Mouse acceleration", 0, 2, 0.05, () => service.read().acceleration, value => service.write({ acceleration: value })),
    toggle("filter", "Mouse smoothing", () => service.read().filter, value => service.write({ filter: value })),
    { ...toggle("lookspring", "Look spring", () => service.read().lookSpring === true, value => service.write({ lookSpring: value })),
      enabled: () => springAvailable() && !service.read().freeLook },
    toggle("lookstrafe", "Look strafe", () => service.read().lookStrafe === true, value => service.write({ lookStrafe: value })),
    toggle("freelook", "Free look", () => service.read().freeLook, value => service.write({ freeLook: value }))];
}
export interface AudioOutputSettings {
  readonly format?: { read(): AudioOutputFormat; select(format: AudioOutputFormat): void };
  selected(): string | null;
  devices(): readonly string[];
  select(name: string | null): void;
  report(message: string): void;
}
export function bindMusicPlaylistSettings(registry: SettingCvars | null, tracks?: () => readonly string[]): readonly SettingBinding[] {
  if (registry === null) return [];
  const settings: SettingBinding[] = [{ id: "ui:audio:shuffle", label: "Shuffle Quake II gameplay music", category: "audio", kind: "toggle", enabled: () => true,
    read: () => registry.variableValue("music_shuffle") !== 0, write: value => { registry.set("music_shuffle", value ? "1" : "0"); } }];
  if (tracks !== undefined) settings.push({ id: "ui:audio:menu-track", label: "Menu music", category: "audio", kind: "choice", enabled: () => true,
    read: () => registry.find("music_menu_track")?.value ?? "auto", write: value => { registry.set("music_menu_track", value); },
    choices: () => { const current = registry.find("music_menu_track")?.value ?? "auto", names = new Set(tracks());
      if (current !== "auto" && current !== "0") names.add(current);
      return [{ id: "auto", label: "Automatic" }, { id: "0", label: "Off" }, ...[...names].map(name => ({ id: name, label: name }))]; } });
  return settings;
}
export function bindAudioGeometrySettings(registry: SettingCvars | null): readonly SettingBinding[] {
  return registry === null ? [] : [{ id: "ui:audio:geometry", label: "Geometry sound obstruction", category: "audio", kind: "toggle", enabled: () => true,
    read: () => registry.variableValue("s_geometryAcoustics") !== 0, write: value => { registry.set("s_geometryAcoustics", value ? "1" : "0"); } }];
}
export function bindAudioSettings(service: SettingsValueService<AudioSettings>, output?: AudioOutputSettings): readonly SettingBinding[] {
  const device: SettingBinding[] = output === undefined ? [] : [{ id: "ui:audio:device", label: "Output device", category: "audio", kind: "choice", enabled: () => true,
    read: () => output.selected() === null ? "default" : `device:${output.selected()}`,
    choices: () => { const names = new Set(output.devices()); const current = output.selected(); if (current !== null) names.add(current);
      return [{ id: "default", label: "System default" }, ...[...names].map(name => ({ id: `device:${name}`, label: name }))]; },
    write: value => { try {
      if (value !== "default" && !value.startsWith("device:")) throw new Error("Unknown audio output choice");
      output.select(value === "default" ? null : value.slice(7));
    } catch (error) { output.report(`Audio output selection failed: ${error instanceof Error ? error.message : String(error)}`); } } }];
  const format = output?.format;
  const formats: SettingBinding[] = format === undefined ? [] : ([
    { id: "ui:audio:rate", label: "Output sample rate", field: "sampleRate", values: audioOutputRates },
    { id: "ui:audio:bits", label: "Output sample bits", field: "sampleBits", values: [8, 16] },
    { id: "ui:audio:channels", label: "Output channels", field: "channels", values: [1, 2] },
  ] satisfies readonly { readonly id: UiControlId; readonly label: string; readonly field: keyof AudioOutputFormat; readonly values: readonly number[] }[]).map(spec => ({
    id: spec.id, label: spec.label, category: "audio", kind: "choice", enabled: () => true,
    read: () => String(format.read()[spec.field]),
    choices: () => [...new Set([...spec.values, format.read()[spec.field]])].map(value => ({ id: String(value),
      label: spec.field === "sampleRate" ? `${value} Hz` : spec.field === "sampleBits" ? `${value}-bit` : value === 1 ? "Mono" : "Stereo" })),
    write: value => { try { format.select(audioOutputFormat({ ...format.read(), [spec.field]: Number(value) })); }
      catch (error) { output?.report(`Audio format selection failed: ${error instanceof Error ? error.message : String(error)}`); } },
  }));
  return [...device, ...formats, { id: "ui:audio:effects", label: "Effects volume", category: "audio", kind: "slider", enabled: () => true,
    minimum: 0, maximum: 1, step: 0.05, read: () => service.read().effectsVolume, write: value => service.write({ effectsVolume: value }) },
  { id: "ui:audio:music", label: "Music volume", category: "audio", kind: "slider", enabled: () => true,
    minimum: 0, maximum: 1, step: 0.05, read: () => service.read().musicVolume, write: value => service.write({ musicVolume: value }) }];
}

/** These controls change the objects sampled by the next real user command. */
export function bindInputSettings(input: SeatInput, builder: InputCommandBuilder, vibration?: SettingsValueService<ControllerVibrationSettings>): readonly SettingBinding[] {
  const mouse = builder.mouse;
  return [
    ...(vibration === undefined ? [] : bindControllerVibration(vibration)),
    ...bindPrimaryInputSettings({ read: () => ({ sensitivity: mouse.tuning.sensitivity, pitch: mouse.tuning.pitch, yaw: mouse.tuning.yaw, invertMouse: mouse.tuning.invertPitch, alwaysRun: builder.tuning.alwaysRun }),
      write: values => {
        mouse.tuning = { ...mouse.tuning, ...(values.sensitivity === undefined ? {} : { sensitivity: values.sensitivity }),
          ...(values.pitch === undefined ? {} : { pitch: values.pitch }), ...(values.yaw === undefined ? {} : { yaw: values.yaw }),
          ...(values.invertMouse === undefined ? {} : { invertPitch: values.invertMouse }) };
        if (values.alwaysRun !== undefined) builder.tuning = { ...builder.tuning, alwaysRun: values.alwaysRun };
      } }),
    ...bindMouseMotionSettings({ read: () => mouse.tuning, write: values => { mouse.tuning = { ...mouse.tuning, ...values }; } }, () => builder.dialect === "q1-netquake" || builder.dialect === "q1-quakeworld"),
    ...bindGamepadSettings(input),
  ];
}

export interface UiPreferenceValues {
  readonly hudScale: number; readonly textScale: number; readonly menuScale: number;
  readonly highContrast: boolean; readonly reducedFlashes: boolean; readonly captions: boolean;
  readonly crosshair: boolean; readonly crosshairSize: number;
  readonly typeface: "standard" | "bold"; readonly colorMode: "standard" | "blue-yellow" | "monochrome";
}
/** Preferences are consumed directly by the common menu and HUD draw functions. */
export class SeatUiPreferences {
  private localValues: UiPreferenceValues = { ...defaultUiPreferences };
  constructor(readonly seat: SeatId, private readonly cvars: SettingCvars | null = null) {}
  get values(): UiPreferenceValues { return this.cvars === null ? this.localValues : readUiPreferences(this.cvars, this.seat.index); }
  set values(value: UiPreferenceValues) { if (this.cvars === null) this.localValues = value; else writeUiPreferences(this.cvars, this.seat.index, value); }
  bindings(): readonly SettingBinding[] {
    const number = (key: "hudScale" | "textScale" | "menuScale" | "crosshairSize", label: string, minimum: number, maximum: number, step: number): SettingBinding => ({
      id: `ui:accessibility:${key}`, label, category: "accessibility", kind: "slider", enabled: () => true, minimum, maximum, step,
      read: () => this.values[key], write: value => { this.values = { ...this.values, [key]: value }; },
    });
    const boolean = (key: "highContrast" | "reducedFlashes" | "captions" | "crosshair", label: string): SettingBinding => ({
      id: `ui:accessibility:${key}`, label, category: "accessibility", kind: "toggle", enabled: () => true,
      read: () => this.values[key], write: value => { this.values = { ...this.values, [key]: value }; },
    });
    const typeface: SettingBinding = { id: "ui:accessibility:typeface", label: "Typeface", category: "accessibility", kind: "choice", enabled: () => true,
      read: () => this.values.typeface, choices: () => [{ id: "standard", label: "Standard" }, { id: "bold", label: "Bold" }],
      write: value => { if (value !== "standard" && value !== "bold") throw new RangeError("Unknown typeface"); this.values = { ...this.values, typeface: value }; } };
    const colorMode: SettingBinding = { id: "ui:accessibility:colorMode", label: "Interface colors", category: "accessibility", kind: "choice", enabled: () => true,
      read: () => this.values.colorMode, choices: () => [{ id: "standard", label: "Standard" }, { id: "blue-yellow", label: "Blue and yellow" }, { id: "monochrome", label: "Monochrome" }],
      write: value => { if (value !== "standard" && value !== "blue-yellow" && value !== "monochrome") throw new RangeError("Unknown interface colors"); this.values = { ...this.values, colorMode: value }; } };
    return [typeface, colorMode, number("hudScale", "HUD size", 0.5, 1.5, 0.05), number("textScale", "Text size", 0.75, 2, 0.05),
      number("menuScale", "Menu size", 0.75, 1, 0.05), number("crosshairSize", "Crosshair size", 2, 32, 1),
      boolean("highContrast", "High contrast"), boolean("reducedFlashes", "Reduce HUD flashes"), boolean("captions", "Captions"), boolean("crosshair", "Crosshair"),
      { id: "ui:accessibility:reset", label: "Reset accessibility settings", category: "accessibility", kind: "button", enabled: () => true, activate: () => { this.values = { ...defaultUiPreferences }; } }];
  }
}
export * from "./gyro.ts";

export function bindGamepadSettings(input: SeatInput | (() => SeatInput)): readonly SettingBinding[] {
  const pad = () => (typeof input === "function" ? input() : input).gamepad;
  const update = (values: Partial<GamepadTuning>): void => { pad().tuning = validateGamepadTuning({ ...pad().tuning, ...values }); };
  const curve = (stick: "move" | "look", values: StickCurve): void => update({ [stick]: values });
  const tuning: SettingBinding[] = [];
  for (const stick of ["move", "look"] satisfies readonly ("move" | "look")[]) {
    const name = stick === "move" ? "Move" : "Look";
    tuning.push({ id: `ui:input:${stick}-curve-type`, label: `${name} deadzone shape`, category: "input", kind: "choice", enabled: () => true,
      read: () => pad().tuning[stick].kind, choices: () => [{ id: "radial", label: "Radial" }, { id: "axial", label: "Axial" }],
      write: value => { if (value !== "radial" && value !== "axial") throw new Error("Unknown controller curve");
        const previous = pad().tuning[stick]; curve(stick, value === "radial"
          ? { kind: value, deadzone: previous.deadzone, exponent: previous.exponent, outerThreshold: Math.min(0.02, (1 - previous.deadzone) / 2) }
          : { kind: value, deadzone: previous.deadzone, exponent: previous.exponent }); } });
    const outer = numeric(`${stick}-outer`, `${name} outer threshold`, 0, 0.49, 0.01,
      () => { const selected = pad().tuning[stick]; return selected.kind === "radial" ? selected.outerThreshold : 0; },
      value => { const selected = pad().tuning[stick]; if (selected.kind === "radial") curve(stick, { ...selected, outerThreshold: Math.min(value, 0.999 - selected.deadzone) }); });
    tuning.push({ ...outer, enabled: () => pad().tuning[stick].kind === "radial" });
    for (const component of ["x", "y"] satisfies readonly ("x" | "y")[]) {
      const preview = numeric(`${stick}-preview-${component}`, `${name} ${component.toUpperCase()} live`, -1, 1, 0.01,
        () => pad().preview()[stick].curved[component], () => {});
      tuning.push({ ...preview, enabled: () => false, formatValue: value => `Raw ${pad().preview()[stick].raw[component].toFixed(2)} / ${value.toFixed(2)}` });
    }
  }
  return [
    toggle("invert-controller", "Invert controller", () => pad().tuning.invertPitch, value => { update({ invertPitch: value }); }),
    toggle("swap-sticks", "Swap controller sticks", () => pad().tuning.swapSticks, value => { update({ swapSticks: value }); }),
    numeric("look-speed", "Controller turn speed", 30, 720, 10, () => pad().tuning.yawDegreesPerSecond, value => { update({ yawDegreesPerSecond: value }); }),
    numeric("pitch-speed", "Controller look speed", 30, 720, 10, () => pad().tuning.pitchDegreesPerSecond, value => { update({ pitchDegreesPerSecond: value }); }),
    numeric("move-deadzone", "Move stick deadzone", 0, 0.5, 0.01, () => pad().tuning.move.deadzone, value => { const selected = pad().tuning.move; curve("move", { ...selected, deadzone: selected.kind === "radial" ? Math.min(value, 0.999 - selected.outerThreshold) : value }); }),
    numeric("look-deadzone", "Look stick deadzone", 0, 0.5, 0.01, () => pad().tuning.look.deadzone, value => { const selected = pad().tuning.look; curve("look", { ...selected, deadzone: selected.kind === "radial" ? Math.min(value, 0.999 - selected.outerThreshold) : value }); }),
    numeric("look-curve", "Look response curve", 0.5, 4, 0.1, () => pad().tuning.look.exponent, value => { curve("look", { ...pad().tuning.look, exponent: value }); }),
    numeric("trigger", "Trigger threshold", 0.05, 0.95, 0.05, () => pad().tuning.triggerThreshold, value => { update({ triggerThreshold: value }); }),
    numeric("move-curve", "Move response curve", 0.5, 4, 0.1, () => pad().tuning.move.exponent, value => curve("move", { ...pad().tuning.move, exponent: value })),
    numeric("forward-sensitivity", "Forward controller sensitivity", 0, 3, 0.05, () => pad().tuning.forwardSensitivity, value => update({ forwardSensitivity: value })),
    numeric("side-sensitivity", "Side controller sensitivity", 0, 3, 0.05, () => pad().tuning.sideSensitivity, value => update({ sideSensitivity: value })),
    ...tuning,
  ];
}
