import type { ConfigStore } from '../../settings/config.ts';

export interface AudioPreferences {
  readonly deviceName: string | null;
  readonly effectsVolume: number;
  readonly musicVolume: number;
}
function preferences(value: unknown): AudioPreferences {
  if (typeof value !== 'object' || value === null || !('version' in value) || value.version !== 1
    || !('deviceName' in value) || !(value.deviceName === null || typeof value.deviceName === 'string' && value.deviceName.length > 0 && !value.deviceName.includes(String.fromCharCode(0)))
    || !('effectsVolume' in value) || typeof value.effectsVolume !== 'number' || !Number.isFinite(value.effectsVolume) || value.effectsVolume < 0 || value.effectsVolume > 1
    || !('musicVolume' in value) || typeof value.musicVolume !== 'number' || !Number.isFinite(value.musicVolume) || value.musicVolume < 0 || value.musicVolume > 1)
    throw new Error('Invalid audio preferences');
  return { deviceName: value.deviceName, effectsVolume: value.effectsVolume, musicVolume: value.musicVolume };
}
export async function loadAudioSettings(store: ConfigStore): Promise<Partial<AudioPreferences>> {
  const text = await store.loadText('audio.json');
  if (text === null) return {};
  const value: unknown = JSON.parse(text);
  return preferences(value);
}
export async function saveAudioSettings(store: ConfigStore, audio: { readonly selectedOutput: string | null; readonly effectsVolume: number; readonly musicVolume: number }): Promise<void> {
  const value = preferences({ version: 1, deviceName: audio.selectedOutput, effectsVolume: audio.effectsVolume, musicVolume: audio.musicVolume });
  await store.dump('audio.json', `${JSON.stringify({ version: 1, ...value })}\n`);
}
