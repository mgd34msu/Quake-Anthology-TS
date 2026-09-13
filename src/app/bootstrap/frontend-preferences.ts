import type { CommandDialect } from "../../contracts/common.ts";
import { defaultMouseTuning } from "../../input/mouse.ts";
import { defaultViewInputTuning } from "../../input/user-command.ts";
import { bindAudioSettings, bindPrimaryInputSettings, bindMouseMotionSettings, bindControllerVibration } from "../../ui/settings/index.ts";
import type { AudioSettings, PrimaryInputSettings, MouseMotionSettings, ControllerVibrationSettings, SettingBinding } from "../../ui/settings/index.ts";
import type { ApplicationAudio } from "./audio.ts";
import type { ApplicationInput, LocalInput } from "./input.ts";

type FrontendInputValues = PrimaryInputSettings & MouseMotionSettings & ControllerVibrationSettings;
export type FrontendPreferenceValues = AudioSettings & FrontendInputValues;
export type FrontendPreferenceOverrides = Partial<FrontendPreferenceValues>;

export function applyFrontendPreferences(values: FrontendPreferenceOverrides, input: ApplicationInput, audio: ApplicationAudio): void {
  if (values.effectsVolume !== undefined) audio.effectsVolume = values.effectsVolume;
  if (values.musicVolume !== undefined) audio.musicVolume = values.musicVolume;
  for (const local of input.locals) applyFrontendInput(values, local);
}
export function readFrontendInput(local: LocalInput): FrontendInputValues {
  const mouse = local.builder.mouse.tuning;
  return { controllerVibration: local.haptics.enabled, controllerVibrationStrength: local.haptics.strength, sensitivity: mouse.sensitivity,
    pitch: mouse.pitch, yaw: mouse.yaw, invertMouse: mouse.invertPitch, acceleration: mouse.acceleration, filter: mouse.filter,
    freeLook: mouse.freeLook, alwaysRun: local.builder.tuning.alwaysRun };
}
export function applyFrontendInput(values: Partial<FrontendInputValues>, local: LocalInput): void {
  if (values.controllerVibrationStrength !== undefined) local.haptics.setStrength(values.controllerVibrationStrength);
  if (values.controllerVibration !== undefined) local.haptics.setEnabled(values.controllerVibration);
  local.builder.mouse.tuning = { ...local.builder.mouse.tuning,
    ...(values.sensitivity === undefined ? {} : { sensitivity: values.sensitivity }),
    ...(values.pitch === undefined ? {} : { pitch: values.pitch }),
    ...(values.yaw === undefined ? {} : { yaw: values.yaw }),
    ...(values.acceleration === undefined ? {} : { acceleration: values.acceleration }),
    ...(values.filter === undefined ? {} : { filter: values.filter }),
    ...(values.freeLook === undefined ? {} : { freeLook: values.freeLook }),
    ...(values.invertMouse === undefined ? {} : { invertPitch: values.invertMouse }) };
  if (values.alwaysRun !== undefined) local.builder.tuning = { ...local.builder.tuning, alwaysRun: values.alwaysRun };
}
export function readFrontendPreferences(input: ApplicationInput, audio: ApplicationAudio): FrontendPreferenceValues | null {
  const local = input.locals[0];
  return local === undefined ? null : { effectsVolume: audio.effectsVolume, musicVolume: audio.musicVolume,
    ...readFrontendInput(local) };
}
export function changedFrontendPreferences(before: FrontendPreferenceValues, after: FrontendPreferenceValues,
  selected: FrontendPreferenceOverrides): FrontendPreferenceOverrides {
  return { ...selected,
    ...(after.controllerVibrationStrength === before.controllerVibrationStrength ? {} : { controllerVibrationStrength: after.controllerVibrationStrength }),
    ...(after.controllerVibration === before.controllerVibration ? {} : { controllerVibration: after.controllerVibration }),
    ...(after.effectsVolume === before.effectsVolume ? {} : { effectsVolume: after.effectsVolume }),
    ...(after.musicVolume === before.musicVolume ? {} : { musicVolume: after.musicVolume }),
    ...(after.sensitivity === before.sensitivity ? {} : { sensitivity: after.sensitivity }),
    ...(Object.is(after.pitch, before.pitch) ? {} : { pitch: after.pitch }),
    ...(Object.is(after.yaw, before.yaw) ? {} : { yaw: after.yaw }),
    ...(after.acceleration === before.acceleration ? {} : { acceleration: after.acceleration }),
    ...(after.filter === before.filter ? {} : { filter: after.filter }),
    ...(after.freeLook === before.freeLook ? {} : { freeLook: after.freeLook }),
    ...(after.invertMouse === before.invertMouse ? {} : { invertMouse: after.invertMouse }),
    ...(after.alwaysRun === before.alwaysRun ? {} : { alwaysRun: after.alwaysRun }) };
}

/** Only user-selected overrides cross into a game; unselected values retain source defaults. */
export class FrontendPreferences {
  values: FrontendPreferenceOverrides = {};
  constructor(private readonly dialect: () => CommandDialect) {}
  bindings(): readonly SettingBinding[] {
    return [...bindControllerVibration({ read: () => ({ controllerVibration: this.values.controllerVibration ?? true, controllerVibrationStrength: this.values.controllerVibrationStrength ?? 1 }),
      write: values => { this.values = { ...this.values, ...values }; } }), ...bindAudioSettings({ read: () => ({ effectsVolume: this.values.effectsVolume ?? 0.7, musicVolume: this.values.musicVolume ?? 0.25 }),
      write: values => { this.values = { ...this.values, ...values }; } }),
    ...bindPrimaryInputSettings({ read: () => ({ sensitivity: this.values.sensitivity ?? defaultMouseTuning.sensitivity,
      pitch: this.values.pitch ?? defaultMouseTuning.pitch, yaw: this.values.yaw ?? defaultMouseTuning.yaw,
      invertMouse: this.values.invertMouse ?? defaultMouseTuning.invertPitch,
      alwaysRun: this.values.alwaysRun ?? defaultViewInputTuning(this.dialect()).alwaysRun }),
      write: values => { this.values = { ...this.values, ...values }; } }),
    ...bindMouseMotionSettings({ read: () => ({ acceleration: this.values.acceleration ?? defaultMouseTuning.acceleration,
      filter: this.values.filter ?? defaultMouseTuning.filter, freeLook: this.values.freeLook ?? defaultMouseTuning.freeLook }),
      write: values => { this.values = { ...this.values, ...values }; } })];
  }
}
