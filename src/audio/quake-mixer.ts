// Channel allocation, spatialization, ambient/static loops and delayed playsounds
// adapted from Quake snd_dma.c and Quake II snd_dma.c/snd_mix.c through their TS ports.
// SPDX-License-Identifier: GPL-2.0-or-later
import type { Axis, Vec3 } from "../contracts/math.ts";
import type { PcmSound } from "./wav.ts";
import type { VoiceOrigin } from "./mixer.ts";
interface Prepared {
    readonly width: 1 | 2;
    readonly sound: PcmSound;
    readonly samples: Int16Array;
    readonly loopStart: number | null;
    readonly length: number;
}
interface Voice {
    readonly prepared: Prepared;
    readonly entity: number;
    readonly channel: number;
    readonly origin: VoiceOrigin;
    readonly attenuation: number;
    readonly volume: number;
    readonly auto: boolean;
    left: number;
    right: number;
    position: number;
    end: number;
}
export interface QuakeStartSound {
    readonly entity: number;
    readonly channel: number;
    readonly origin: VoiceOrigin;
    readonly volume: number;
    readonly attenuation: number;
    readonly delaySeconds?: number;
    readonly serverMilliseconds?: number;
}
interface Pending {
    readonly begin: number;
    readonly order: number;
    readonly sound: PcmSound;
    readonly options: QuakeStartSound;
}
export interface QuakeLoopSound {
    readonly entity: number;
    readonly sound: PcmSound;
    readonly origin: Vec3;
    readonly volume?: number;
    readonly attenuation?: number;
}
function sample(data: Int16Array, index: number): number { const value = data[index]; if (value === undefined)
    throw new RangeError("Sound sample outside decoded allocation"); return value; }
function clamp(value: number): number { return Math.max(-32768, Math.min(32767, Math.trunc(value))); }
export class QuakeMixer {
    private readonly cache = new WeakMap<PcmSound, Prepared>();
    private readonly voices: (Voice | null)[];
    private readonly statics: Voice[] = [];
    private readonly ambient: (Voice | null)[] = [null, null];
    private loops: Voice[] = [];
    private readonly entities = new Map<number, Vec3>();
    private pending: Pending[] = [];
    private order = 0;
    private time = 0;
    private beginOffset = 0;
    private listenerEntity = 0;
    private listenerOrigin: Vec3 = { x: 0, y: 0, z: 0 };
    private listenerRight: Vec3 = { x: 0, y: -1, z: 0 };
    effectsVolume = 0.7;
    paused = false;
    active = true;
    constructor(readonly family: "q1" | "q2", readonly outputRate: number, private readonly random: () => number, capacity = family === "q1" ? 8 : 32, readonly outputChannels: 1 | 2 = 2) {
        if (!Number.isInteger(outputRate) || outputRate < 8000 || outputRate > 192000)
            throw new RangeError("Invalid mixer rate");
        if (!Number.isInteger(capacity) || capacity < 1)
            throw new RangeError("Invalid channel capacity");
        this.voices = Array.from({ length: capacity }, () => null);
    }
    get sampleClock(): number { return this.time; }
    setTime(frame: number): void { if (!Number.isSafeInteger(frame) || frame < this.time)
        throw new RangeError("Audio clock must advance"); this.time = frame; }
    get activeChannels(): number { return this.voices.filter(v => v !== null).length; }
    setListener(entity: number, origin: Vec3, axis: Axis): void {
        this.listenerEntity = entity;
        this.listenerOrigin = { ...origin };
        this.listenerRight = { x: -axis[1].x, y: -axis[1].y, z: -axis[1].z };
        for (const voice of this.voices)
            if (voice !== null)
                this.spatialize(voice);
        const merged = new Map<PcmSound, Voice>();
        for (const voice of this.statics) {
            this.spatialize(voice);
            const prior = merged.get(voice.prepared.sound);
            if (prior === undefined)
                merged.set(voice.prepared.sound, voice);
            else {
                prior.left += voice.left;
                prior.right += voice.right;
                voice.left = 0;
                voice.right = 0;
            }
        }
    }
    updateEntityPosition(entity: number, origin: Vec3): void { this.entities.set(entity, { ...origin }); }
    private prepare(sound: PcmSound): Prepared {
        const prior = this.cache.get(sound);
        if (prior !== undefined)
            return prior;
        if (sound.channels !== 1 || sound.samples.length !== sound.frameCount || sound.frameCount < 1 || sound.sampleRate < 1)
            throw new Error("Quake effects require nonempty mono PCM");
        const scale = sound.sampleRate / this.outputRate, length = Math.trunc(sound.frameCount / scale), step = Math.trunc(scale * 256);
        if (length < 1)
            throw new Error("Sound resamples to zero frames");
        const samples = new Int16Array(length);
        for (let i = 0; i < length; i++)
            samples[i] = sample(sound.samples, Math.trunc(i * step / 256));
        const loopStart = sound.loopStart === null ? null : Math.trunc(sound.loopStart / scale);
        if (loopStart !== null && (loopStart < 0 || loopStart >= length))
            throw new RangeError("Sound loop outside PCM");
        const width: 1 | 2 = "sourceBytesPerSample" in sound && sound.sourceBytesPerSample === 1 ? 1 : 2;
        const prepared = { sound, samples, length, loopStart, width };
        this.cache.set(sound, prepared);
        return prepared;
    }
    private spatialize(voice: Voice): void {
        if (voice.origin.kind === "local" || voice.entity === this.listenerEntity) {
            voice.left = voice.volume;
            voice.right = voice.volume;
            return;
        }
        if (this.family === "q2" && !this.active) {
            voice.left = 255;
            voice.right = 255;
            return;
        }
        const position = voice.origin.kind === "fixed" ? voice.origin.position : this.entities.get(voice.origin.entity);
        if (position === undefined)
            throw new Error(`No sound position for entity ${voice.entity}`);
        const x = position.x - this.listenerOrigin.x, y = position.y - this.listenerOrigin.y, z = position.z - this.listenerOrigin.z;
        const length = Math.sqrt(x * x + y * y + z * z);
        const pan = length === 0 ? 0 : (x * this.listenerRight.x + y * this.listenerRight.y + z * this.listenerRight.z) / length;
        const distance = (this.family === "q1" ? length : Math.max(0, length - 80)) * voice.attenuation;
        const mono = this.outputChannels === 1 || (this.family === "q2" && voice.attenuation === 0);
        const scale = this.family === "q1" ? 1 : 0.5;
        voice.left = Math.max(0, Math.trunc(voice.volume * (1 - distance) * (mono ? 1 : scale * (1 - pan))));
        voice.right = Math.max(0, Math.trunc(voice.volume * (1 - distance) * (mono ? 1 : scale * (1 + pan))));
    }
    private allocate(entity: number, channel: number): number | null {
        let index: number | null = null, remaining = 0x7fffffff;
        for (let i = 0; i < this.voices.length; i++) {
            const voice = this.voices[i];
            if (voice === undefined)
                throw new Error("Missing channel slot");
            if (voice !== null && channel !== 0 && voice.entity === entity && (voice.channel === channel || (this.family === "q1" && channel === -1)))
                return i;
            if (voice !== null && voice.entity === this.listenerEntity && entity !== this.listenerEntity)
                continue;
            const life = voice === null ? -this.time : voice.end - this.time;
            if (life < remaining) {
                index = i;
                remaining = life;
            }
        }
        return index;
    }
    startSound(sound: PcmSound, options: QuakeStartSound): boolean {
        if (!Number.isInteger(options.channel) || (this.family === "q2" && options.channel < 0))
            throw new RangeError("Invalid source sound channel");
        if (!Number.isFinite(options.volume) || options.volume < 0 || !Number.isFinite(options.attenuation) || options.attenuation < 0)
            throw new RangeError("Invalid sound gain or attenuation");
        this.prepare(sound);
        if (this.family === "q1")
            return this.issue(sound, options);
        const server = (options.serverMilliseconds ?? this.time * 1000 / this.outputRate) * 0.001 * this.outputRate;
        let begin = Math.trunc(server + this.beginOffset);
        if (begin < this.time) {
            begin = this.time;
            this.beginOffset = Math.trunc(begin - server);
        }
        else if (begin > this.time + 0.3 * this.outputRate) {
            begin = Math.trunc(this.time + 0.1 * this.outputRate);
            this.beginOffset = Math.trunc(begin - server);
        }
        else
            this.beginOffset -= 10;
        begin = (options.delaySeconds ?? 0) === 0 ? this.time : Math.trunc(begin + (options.delaySeconds ?? 0) * this.outputRate);
        if (this.pending.length >= 128)
            return false;
        this.pending.push({ begin, order: this.order++, sound, options });
        // C inserts before an existing equal begin time.
        this.pending.sort((a, b) => a.begin - b.begin || b.order - a.order);
        return true;
    }
    private issue(sound: PcmSound, options: QuakeStartSound): boolean {
        const index = this.allocate(options.entity, options.channel);
        if (index === null)
            return false;
        this.voices[index] = null;
        const prepared = this.prepare(sound);
        const attenuation = this.family === "q1" ? options.attenuation / 1000 : options.attenuation * (options.attenuation === 3 ? 0.001 : 0.0005);
        const voice: Voice = { prepared, entity: options.entity, channel: options.channel, origin: options.origin, attenuation, volume: Math.trunc(options.volume * 255), auto: false,
            left: 0, right: 0, position: 0, end: this.time + prepared.length };
        this.spatialize(voice);
        if (this.family === "q1" && voice.left === 0 && voice.right === 0)
            return false;
        if (this.family === "q1" && this.voices.some(other => other !== null && other.prepared.sound === sound && other.position === 0)) {
            const random = this.random();
            if (!Number.isInteger(random) || random < 0)
                throw new RangeError("Sound random source must return a nonnegative integer");
            const skip = Math.min(prepared.length - 1, random % Math.trunc(0.1 * this.outputRate));
            voice.position = skip;
            voice.end -= skip;
        }
        this.voices[index] = voice;
        return true;
    }
    stopSound(entity: number, channel: number): void {
        const index = this.voices.findIndex(v => v !== null && v.entity === entity && v.channel === channel);
        if (index >= 0)
            this.voices[index] = null;
        this.pending = this.pending.filter(p => p.options.entity !== entity || p.options.channel !== channel);
    }
    stopAll(): void { this.voices.fill(null); this.statics.length = 0; this.ambient.fill(null); this.loops = []; this.pending = []; this.beginOffset = 0; }
    addStaticSound(sound: PcmSound, origin: Vec3, volume: number, attenuation: number): boolean {
        if (this.statics.length + this.voices.length + 2 >= 128)
            return false;
        const prepared = this.prepare(sound);
        if (prepared.loopStart === null)
            throw new Error("Static sound requires a WAV loop marker");
        const voice: Voice = { prepared, entity: -1, channel: 0, origin: { kind: "fixed", position: { ...origin } }, volume, attenuation: attenuation / 64 / 1000,
            left: 0, right: 0, position: 0, end: this.time + prepared.length, auto: false };
        this.spatialize(voice);
        this.statics.push(voice);
        return true;
    }
    updateAmbient(sounds: readonly PcmSound[], levels: readonly number[], elapsedSeconds: number, ambientLevel = 0.3, fade = 100): void {
        for (let index = 0; index < 2; index++) {
            const sound = sounds[index], level = levels[index];
            if (sound === undefined || level === undefined || ambientLevel === 0) {
                this.ambient[index] = null;
                continue;
            }
            const prepared = this.prepare(sound);
            let voice = this.ambient[index];
            if (voice === undefined || voice === null || voice.prepared.sound !== sound)
                voice = { prepared, entity: -1, channel: 0, origin: { kind: "local" }, volume: 0, attenuation: 0,
                    left: 0, right: 0, position: 0, end: this.time + prepared.length, auto: true };
            const target = ambientLevel * level < 8 ? 0 : ambientLevel * level;
            const current = voice.left, step = Math.max(0, elapsedSeconds * fade);
            voice.left = current < target ? Math.min(target, current + step) : Math.max(target, current - step);
            voice.right = voice.left;
            this.ambient[index] = voice;
        }
    }
    /** Q2 entity loops merge by the retained sound allocation and use global paint phase. */
    setLoopSounds(sounds: readonly QuakeLoopSound[]): void {
        const merged = new Map<PcmSound, Voice>();
        for (const entry of sounds) {
            const prepared = this.prepare(entry.sound);
            const voice: Voice = { prepared, entity: entry.entity, channel: 0, origin: { kind: "fixed", position: entry.origin }, volume: Math.trunc((entry.volume ?? 1) * 255),
                attenuation: (entry.attenuation ?? 1) * (this.family === "q1" ? 0.001 : 0.003), left: 0, right: 0, position: this.time % prepared.length, end: this.time + prepared.length - (this.time % prepared.length), auto: true };
            this.spatialize(voice);
            const prior = merged.get(entry.sound);
            if (prior === undefined)
                merged.set(entry.sound, voice);
            else {
                prior.left += voice.left;
                prior.right += voice.right;
            }
        }
        this.loops = [...merged.values()].map(voice => { voice.left = Math.min(255, voice.left); voice.right = Math.min(255, voice.right); return voice; });
    }
    mix(frames: number): Int16Array {
        if (!Number.isSafeInteger(frames) || frames < 0)
            throw new RangeError("Invalid audio frame count");
        const result = new Int16Array(frames * 2);
        if (this.paused)
            return result;
        for (let frame = 0; frame < frames; frame++) {
            while (this.pending[0] !== undefined && this.pending[0].begin <= this.time) {
                const pending = this.pending.shift();
                if (pending !== undefined)
                    this.issue(pending.sound, pending.options);
            }
            let left = 0, right = 0;
            const paint = (voice: Voice): boolean => {
                if (voice.left === 0 && voice.right === 0)
                    return true;
                if (voice.position >= voice.prepared.length) {
                    const loop = voice.auto ? 0 : voice.prepared.loopStart;
                    if (loop === null)
                        return false;
                    voice.position = loop;
                    voice.end = this.time + voice.prepared.length - loop;
                }
                const value = sample(voice.prepared.samples, voice.position++);
                if (voice.prepared.width === 1) {
                    const l = Math.min(255, voice.left) >> 3, r = Math.min(255, voice.right) >> 3;
                    if (this.family === "q1") {
                        left += (value >> 8) * l * 8;
                        right += (value >> 8) * r * 8;
                    }
                    else {
                        left += (value >> 8) * Math.trunc(l * 8 * 256 * this.effectsVolume);
                        right += (value >> 8) * Math.trunc(r * 8 * 256 * this.effectsVolume);
                    }
                }
                else if (this.family === "q1") {
                    left += (value * voice.left) >> 8;
                    right += (value * voice.right) >> 8;
                }
                else {
                    const volume = Math.trunc(this.effectsVolume * 256);
                    left += (value * voice.left * volume) >> 8;
                    right += (value * voice.right * volume) >> 8;
                }
                return true;
            };
            for (let i = 0; i < this.voices.length; i++) {
                const voice = this.voices[i];
                if (voice !== undefined && voice !== null && !paint(voice))
                    this.voices[i] = null;
            }
            for (const voice of this.statics)
                paint(voice);
            for (const voice of this.ambient)
                if (voice !== null)
                    paint(voice);
            for (const voice of this.loops)
                paint(voice);
            const volume = Math.trunc(this.effectsVolume * 256);
            result[frame * 2] = clamp(this.family === "q1" ? (left * volume) >> 8 : left >> 8);
            result[frame * 2 + 1] = clamp(this.family === "q1" ? (right * volume) >> 8 : right >> 8);
            this.time++;
        }
        return result;
    }
}
