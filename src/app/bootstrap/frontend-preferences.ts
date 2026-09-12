import type { CommandDialect } from "../../contracts/common.ts";
import { defaultMouseTuning } from "../../input/mouse.ts";
import { defaultViewInputTuning } from "../../input/user-command.ts";
import { bindAudioSettings, bindPrimaryInputSettings } from "../../ui/settings/index.ts";
import type { AudioSettings, PrimaryInputSettings, SettingBinding } from "../../ui/settings/index.ts";
import type { ApplicationAudio } from "./audio.ts";
import type { ApplicationInput, LocalInput } from "./input.ts";

export type FrontendPreferenceValues = AudioSettings & PrimaryInputSettings;
export type FrontendPreferenceOverrides = Partial<FrontendPreferenceValues>;

export function applyFrontendPreferences(values: FrontendPreferenceOverrides, input: ApplicationInput, audio: ApplicationAudio): void {
  if (values.effectsVolume !== undefined) audio.effectsVolume = values.effectsVolume;
  if (values.musicVolume !== undefined) audio.musicVolume = values.musicVolume;
  for (const local of input.locals) applyFrontendInput(values, local);
}
export function readFrontendInput(local: LocalInput): PrimaryInputSettings {
  return { sensitivity: local.builder.mouse.tuning.sensitivity, invertMouse: local.builder.mouse.tuning.invertPitch, alwaysRun: local.builder.tuning.alwaysRun };
}
export function applyFrontendInput(values: Partial<PrimaryInputSettings>, local: LocalInput): void {
  local.builder.mouse.tuning = { ...local.builder.mouse.tuning,
    ...(values.sensitivity === undefined ? {} : { sensitivity: values.sensitivity }),
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
    ...(after.effectsVolume === before.effectsVolume ? {} : { effectsVolume: after.effectsVolume }),
    ...(after.musicVolume === before.musicVolume ? {} : { musicVolume: after.musicVolume }),
    ...(after.sensitivity === before.sensitivity ? {} : { sensitivity: after.sensitivity }),
    ...(after.invertMouse === before.invertMouse ? {} : { invertMouse: after.invertMouse }),
    ...(after.alwaysRun === before.alwaysRun ? {} : { alwaysRun: after.alwaysRun }) };
}

/** Only user-selected overrides cross into a game; unselected values retain source defaults. */
export class FrontendPreferences {
  values: FrontendPreferenceOverrides = {};
  constructor(private readonly dialect: () => CommandDialect) {}
  bindings(): readonly SettingBinding[] {
    return [...bindAudioSettings({ read: () => ({ effectsVolume: this.values.effectsVolume ?? 0.7, musicVolume: this.values.musicVolume ?? 0.25 }),
      write: values => { this.values = { ...this.values, ...values }; } }),
    ...bindPrimaryInputSettings({ read: () => ({ sensitivity: this.values.sensitivity ?? defaultMouseTuning.sensitivity,
      invertMouse: this.values.invertMouse ?? defaultMouseTuning.invertPitch,
      alwaysRun: this.values.alwaysRun ?? defaultViewInputTuning(this.dialect()).alwaysRun }),
      write: values => { this.values = { ...this.values, ...values }; } })];
  }
}
