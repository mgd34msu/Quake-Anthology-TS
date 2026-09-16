import type { MusicPreferences } from "./audio/playlist-settings.ts";
import { defaultAudioOutputFormat } from "../../audio/output.ts";
import type { AudioOutputSettings } from "../../ui/settings/index.ts";
import { loadAudioSettings, saveAudioSettings } from "./audio-settings.ts";
import type { AudioPreferences } from "./audio-settings.ts";
import type { CommandDialect } from "../../contracts/common.ts";
import { defaultMouseTuning } from "../../input/mouse.ts";
import type { MouseTuning } from "../../input/mouse.ts";
import { MouseSettings } from "../../input/mouse-settings.ts";
import { CvarRegistry } from "../../core/cvars/index.ts";
import { createIdentityOwner } from "../../contracts/identity.ts";
import type { ConfigStore, SeatSettings } from "../../settings/config.ts";
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
  local.builder.mouse.tuning = frontendMouseTuning(values, local.builder.mouse.tuning);
  if (values.alwaysRun !== undefined) local.builder.tuning = { ...local.builder.tuning, alwaysRun: values.alwaysRun };
}
function frontendMouseTuning(values: Partial<FrontendInputValues>, mouse: MouseTuning): MouseTuning {
  return { ...mouse,
    ...(values.sensitivity === undefined ? {} : { sensitivity: values.sensitivity }),
    ...(values.pitch === undefined ? {} : { pitch: values.pitch }),
    ...(values.yaw === undefined ? {} : { yaw: values.yaw }),
    ...(values.acceleration === undefined ? {} : { acceleration: values.acceleration }),
    ...(values.filter === undefined ? {} : { filter: values.filter }),
    ...(values.freeLook === undefined ? {} : { freeLook: values.freeLook }),
    ...(values.invertMouse === undefined ? {} : { invertPitch: values.invertMouse }) };
}
export function frontendSeatSettings(values: FrontendPreferenceOverrides, saved: SeatSettings): SeatSettings {
  return { ...saved, mouse: frontendMouseTuning(values, saved.mouse),
    ...(values.alwaysRun === undefined ? {} : { alwaysRun: values.alwaysRun }),
    ...(values.controllerVibration === undefined ? {} : { rumble: values.controllerVibration }),
    ...(values.controllerVibrationStrength === undefined ? {} : { rumbleStrength: values.controllerVibrationStrength }) };
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

/** Only user-selected overrides cross into a game; saved values stay with their seat. */
export class FrontendPreferences {
  values: FrontendPreferenceOverrides = {};
  audioBaseline: Partial<AudioPreferences> = {};
  private audioOutput: AudioOutputSettings | undefined;
  private musicSettings: (() => MusicPreferences) | undefined;
  get audioValues(): AudioSettings { return { effectsVolume: this.values.effectsVolume ?? this.audioBaseline.effectsVolume ?? 0.7, musicVolume: this.values.musicVolume ?? this.audioBaseline.musicVolume ?? 0.25 }; }
  private alwaysRunBaseline: boolean | undefined;
  private vibrationBaseline = { controllerVibration: true, controllerVibrationStrength: 1 };
  private mouseBaseline: MouseTuning = defaultMouseTuning;
  constructor(private readonly dialect: () => CommandDialect) {}
  async loadBaseline(settings: ConfigStore): Promise<void> {
    this.audioBaseline = await loadAudioSettings(settings);
    const saved = await settings.loadSeat("input/seat-1.json"), identity = createIdentityOwner("frontend-mouse-baseline");
    const mouse = new MouseSettings(new CvarRegistry({ dialect: this.dialect(), context: { session: identity.session,
      origin: { kind: "local-seat", seat: identity.seat(0), client: identity.client(0, 0) } } }));
    if (saved !== null) mouse.write(saved.mouse);
    this.mouseBaseline = mouse.read();
    this.alwaysRunBaseline = saved?.alwaysRun;
    this.vibrationBaseline = { controllerVibration: saved?.rumble ?? true, controllerVibrationStrength: saved?.rumbleStrength ?? 1 };
  }
  async saveAudioBaseline(settings: ConfigStore): Promise<void> {
    if (this.audioOutput === undefined && this.musicSettings === undefined && this.values.effectsVolume === undefined && this.values.musicVolume === undefined) return;
    const saved = await loadAudioSettings(settings);
    const volume = { effectsVolume: this.values.effectsVolume ?? saved.effectsVolume ?? this.audioValues.effectsVolume,
      musicVolume: this.values.musicVolume ?? saved.musicVolume ?? this.audioValues.musicVolume };
    const deviceName = this.audioOutput === undefined ? saved.deviceName ?? null : this.audioOutput.selected();
    const outputFormat = this.audioOutput?.format?.read() ?? saved.outputFormat ?? defaultAudioOutputFormat;
    const musicPreferences = this.musicSettings?.() ?? { musicShuffle: saved.musicShuffle ?? false, menuTrack: saved.menuTrack ?? "auto" };
    const values = { deviceName, outputFormat, ...volume, ...musicPreferences };
    if (saved.musicShuffle !== musicPreferences.musicShuffle || saved.menuTrack !== musicPreferences.menuTrack || saved.deviceName !== deviceName || saved.effectsVolume !== volume.effectsVolume || saved.musicVolume !== volume.musicVolume
      || saved.outputFormat?.sampleRate !== outputFormat.sampleRate || saved.outputFormat?.sampleBits !== outputFormat.sampleBits || saved.outputFormat?.channels !== outputFormat.channels) await saveAudioSettings(settings, { selectedOutput: deviceName, outputFormat, ...volume, musicPreferences });
    this.audioBaseline = values;
  }
  bindings(output?: AudioOutputSettings, musicSettings?: () => MusicPreferences): readonly SettingBinding[] {
    this.audioOutput = output; this.musicSettings = musicSettings;
    return [...bindControllerVibration({ read: () => ({ controllerVibration: this.values.controllerVibration ?? this.vibrationBaseline.controllerVibration, controllerVibrationStrength: this.values.controllerVibrationStrength ?? this.vibrationBaseline.controllerVibrationStrength }),
      write: values => { this.values = { ...this.values, ...values }; } }), ...bindAudioSettings({ read: () => this.audioValues,
      write: values => { this.values = { ...this.values, ...values }; } }, output),
    ...bindPrimaryInputSettings({ read: () => ({ sensitivity: this.values.sensitivity ?? this.mouseBaseline.sensitivity,
      pitch: this.values.pitch ?? this.mouseBaseline.pitch, yaw: this.values.yaw ?? this.mouseBaseline.yaw,
      invertMouse: this.values.invertMouse ?? this.mouseBaseline.invertPitch,
      alwaysRun: this.values.alwaysRun ?? this.alwaysRunBaseline ?? defaultViewInputTuning(this.dialect()).alwaysRun }),
      write: values => { this.values = { ...this.values, ...values }; } }),
    ...bindMouseMotionSettings({ read: () => ({ acceleration: this.values.acceleration ?? this.mouseBaseline.acceleration,
      filter: this.values.filter ?? this.mouseBaseline.filter, freeLook: this.values.freeLook ?? this.mouseBaseline.freeLook }),
      write: values => { this.values = { ...this.values, ...values }; } })];
  }
}
