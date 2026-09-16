import type { SdlAudioOptions } from "../platform/audio.ts";
import { RawAudioStream } from "./streams.ts";

export type AudioOutputFormat = Pick<SdlAudioOptions, "sampleRate" | "channels"> & { readonly sampleBits: 8 | 16 };
export const defaultAudioOutputFormat: AudioOutputFormat = { sampleRate: 44100, channels: 2, sampleBits: 16 };
export const audioOutputRates = [11025, 22050, 44100, 48000] satisfies readonly number[];
export function audioOutputFormat(value: unknown): AudioOutputFormat {
    if (typeof value !== "object" || value === null || !("sampleRate" in value) || typeof value.sampleRate !== "number"
        || !Number.isSafeInteger(value.sampleRate) || value.sampleRate < 8000 || value.sampleRate > 192000
        || !("channels" in value) || value.channels !== 1 && value.channels !== 2
        || !("sampleBits" in value) || value.sampleBits !== 8 && value.sampleBits !== 16)
        throw new RangeError("Audio output requires 8000–192000 Hz, 1 or 2 channels, and 8 or 16 bits");
    return { sampleRate: value.sampleRate, channels: value.channels, sampleBits: value.sampleBits };
}
export function audioKhzRate(value: string): number | null {
    if (value.trim() === "") return null;
    switch (Number(value)) { case 11: return 11025; case 22: return 22050; case 44: return 44100; case 48: return 48000; default: return null; }
}
export function encodeOutputPcm(stereo: Int16Array, format: AudioOutputFormat): Int16Array | Uint8Array {
    if (stereo.length % 2 !== 0) throw new RangeError("Output PCM must contain stereo frames");
    if (format.channels === 2 && format.sampleBits === 16) return stereo;
    const samples = format.sampleBits === 16 ? new Int16Array(stereo.length / 2 * format.channels) : new Uint8Array(stereo.length / 2 * format.channels);
    for (let frame = 0; frame < stereo.length / 2; frame++) {
        const left = stereo[frame * 2], right = stereo[frame * 2 + 1];
        if (left === undefined || right === undefined) throw new Error("Missing PCM frame");
        for (let channel = 0; channel < format.channels; channel++) {
            const value = format.channels === 1 ? Math.trunc((left + right) / 2) : channel === 0 ? left : right;
            samples[frame * format.channels + channel] = format.sampleBits === 16 ? value : (value + 32768) >>> 8;
        }
    }
    return samples;
}
export function resampleQueuedPcm(samples: Int16Array, previousRate: number, nextRate: number): Int16Array<ArrayBuffer> {
    if (previousRate === nextRate || samples.length === 0) return samples.slice();
    const stream = new RawAudioStream(nextRate);
    stream.queue({ samples, sampleRate: previousRate, channels: 2, sourceSample: 0, resetStream: true });
    return Int16Array.from(stream.mix(Math.ceil(samples.length / 2 * nextRate / previousRate)));
}
