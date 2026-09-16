import { validMenuTrack, type MusicPreferences } from "./audio/playlist-settings.ts";
import { audioOutputFormat, defaultAudioOutputFormat, type AudioOutputFormat } from "../../audio/output.ts";
import type { ConfigStore } from '../../settings/config.ts';

export interface AudioPreferences extends Partial<MusicPreferences> {
  readonly deviceName: string | null;
  readonly outputFormat: AudioOutputFormat;
  readonly effectsVolume: number;
  readonly musicVolume: number;
}
function preferences(value: unknown): AudioPreferences {
  if (typeof value !== 'object' || value === null || !('version' in value) || value.version !== 1
    || !('deviceName' in value) || !(value.deviceName === null || typeof value.deviceName === 'string' && value.deviceName.length > 0 && !value.deviceName.includes(String.fromCharCode(0)))
    || !('effectsVolume' in value) || typeof value.effectsVolume !== 'number' || !Number.isFinite(value.effectsVolume) || value.effectsVolume < 0 || value.effectsVolume > 1
    || !('musicVolume' in value) || typeof value.musicVolume !== 'number' || !Number.isFinite(value.musicVolume) || value.musicVolume < 0 || value.musicVolume > 1)
    throw new Error('Invalid audio preferences');
  const musicShuffle = "musicShuffle" in value ? value.musicShuffle : false;
  const menuTrack = "menuTrack" in value ? value.menuTrack : "auto";
  if (typeof musicShuffle !== "boolean" || typeof menuTrack !== "string" || !validMenuTrack(menuTrack)) throw new Error("Invalid music preferences");
  return { ...("musicShuffle" in value ? { musicShuffle } : {}), ...("menuTrack" in value ? { menuTrack } : {}), outputFormat: "outputFormat" in value ? audioOutputFormat(value.outputFormat) : defaultAudioOutputFormat, deviceName: value.deviceName, effectsVolume: value.effectsVolume, musicVolume: value.musicVolume };
}
export async function loadAudioSettings(store: ConfigStore): Promise<Partial<AudioPreferences>> {
  const text = await store.loadText('audio.json');
  if (text === null) return {};
  const value: unknown = JSON.parse(text);
  return preferences(value);
}
export async function saveAudioSettings(store: ConfigStore, audio: { readonly musicPreferences?: MusicPreferences; readonly outputFormat?: AudioOutputFormat; readonly selectedOutput: string | null; readonly effectsVolume: number; readonly musicVolume: number }): Promise<void> {
  const saved = audio.musicPreferences ?? await loadAudioSettings(store);
  const value = preferences({ musicShuffle: saved.musicShuffle ?? false, menuTrack: saved.menuTrack ?? "auto", version: 1, outputFormat: audio.outputFormat ?? defaultAudioOutputFormat, deviceName: audio.selectedOutput, effectsVolume: audio.effectsVolume, musicVolume: audio.musicVolume });
  await store.dump('audio.json', `${JSON.stringify({ version: 1, ...value })}\n`);
}
