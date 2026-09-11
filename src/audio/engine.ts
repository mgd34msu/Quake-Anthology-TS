import type { ActorId, SeatId } from "../contracts/identity.ts";
import type { Vec3 } from "../contracts/math.ts";
import { SdlAudioDevice } from "../platform/audio.ts";
import type { SdlAudioOptions } from "../platform/audio.ts";
import { AudioMixer } from "./mixer.ts";
import type { VoiceOrigin } from "./mixer.ts";
import { QuakeMixer } from "./quake-mixer.ts";
import { RawAudioStream } from "./streams.ts";
import { MusicPlayer } from "./music.ts";
import { EnvironmentReverb } from "./environments.ts";
import type { AudioTraceQuery, ReverbEnvironment } from "./environments.ts";
import { StereoReverb, UnderwaterFilter } from "./reverb.ts";
import type { AudioListener, PlaySound, LoopSound, AudioAudience, AudioStreamTarget, StreamPcm, SoundAsset } from "./types.ts";
interface SeatAudio {
    listener: AudioListener;
    readonly q1: QuakeMixer;
    readonly q2: QuakeMixer;
    readonly q3: AudioMixer;
    readonly reverb: StereoReverb;
    readonly underwater: UnderwaterFilter;
    environment: EnvironmentReverb | null;
    readonly loops: Map<string, LoopSound>;
}
interface StreamBus {
    target: AudioStreamTarget;
    readonly stream: RawAudioStream;
}
interface MusicBus {
    readonly target: AudioStreamTarget;
    readonly player: MusicPlayer;
}
export interface UnifiedAudioOptions {
    readonly sampleRate?: number;
    /** Source allocation clock in signed 32-bit whole milliseconds. */
    readonly milliseconds: () => number;
    /** Session-owned integer random source for Q1 same-frame phase offsets. */
    readonly random: () => number;
    readonly maxActors?: number;
    readonly onSound?: (sound: PlaySound) => void;
}
function selected(audience: AudioAudience, seat: SeatId): boolean { return audience.kind === "world" || audience.seat.equals(seat); }
function add(output: Float64Array, input: Float64Array | Int16Array, gain: number): void {
    for (let i = 0; i < input.length; i++) {
        const a = output[i], b = input[i];
        if (a === undefined || b === undefined)
            throw new Error("Audio bus length mismatch");
        output[i] = a + b * gain;
    }
}
/** One output device, independent source mixers and acoustic state for each listener. */
export class UnifiedAudio {
    readonly sampleRate: number;
    private readonly seats: SeatAudio[] = [];
    private readonly actors: ActorId[] = [];
    private readonly positions = new Map<number, Vec3>();
    private readonly streams = new Map<string, StreamBus>();
    private readonly music = new Map<string, MusicBus>();
    private device: SdlAudioDevice | null = null;
    private closed = false;
    private paused = false;
    private effectsGain = 0.7;
    private frame = 0;
    constructor(private readonly options: UnifiedAudioOptions) {
        this.sampleRate = options.sampleRate ?? 44100;
        if (!Number.isSafeInteger(this.sampleRate) || this.sampleRate < 8000 || this.sampleRate > 192000)
            throw new RangeError("Invalid audio output rate");
    }
    get sampleClock(): number { return this.frame; }
    get queuedFrames(): number { return this.device?.queuedFrames ?? 0; }
    get outputState(): "detached" | "paused" | "playing" | "closed" { return this.closed ? "closed" : this.device?.state ?? "detached"; }
    private check(): void { if (this.closed)
        throw new Error("Audio engine closed"); }
    private entity(actor: ActorId): number {
        const index = this.actors.findIndex(candidate => candidate.equals(actor));
        if (index >= 0)
            return index + 1;
        const maximum = this.options.maxActors ?? 65536;
        if (this.actors.length + 1 >= maximum)
            throw new RangeError("Audio actor capacity exhausted");
        this.actors.push(actor);
        return this.actors.length;
    }
    private seat(id: SeatId): SeatAudio {
        const seat = this.seats.find(value => value.listener.seat.equals(id));
        if (seat === undefined)
            throw new Error("Unknown audio seat");
        return seat;
    }
    setListeners(listeners: readonly AudioListener[]): void {
        this.check();
        for (let index = 0; index < listeners.length; index++) {
            const listener = listeners[index];
            if (listener === undefined)
                throw new Error("Missing listener");
            if (listeners.slice(0, index).some(prior => prior.seat.equals(listener.seat)))
                throw new Error("Duplicate audio seat");
            if (!Number.isFinite(listener.gain) || listener.gain < 0)
                throw new RangeError("Invalid listener gain");
        }
        for (let index = this.seats.length - 1; index >= 0; index--) {
            const state = this.seats[index];
            if (state !== undefined && !listeners.some(listener => listener.seat.equals(state.listener.seat)))
                this.seats.splice(index, 1);
        }
        for (const listener of listeners) {
            let state = this.seats.find(value => value.listener.seat.equals(listener.seat));
            if (state === undefined) {
                state = { listener, q1: new QuakeMixer("q1", this.sampleRate, this.options.random), q2: new QuakeMixer("q2", this.sampleRate, this.options.random),
                    q3: new AudioMixer(this.sampleRate, this.options.milliseconds, 96, 2, this.options.maxActors ?? 65536),
                    reverb: new StereoReverb(this.sampleRate), underwater: new UnderwaterFilter(this.sampleRate), environment: null, loops: new Map<string, LoopSound>() };
                state.q1.effectsVolume = this.effectsGain;
                state.q2.effectsVolume = this.effectsGain;
                state.q3.setEffectsVolume(this.effectsGain);
                // A new seat starts at the host paint epoch; it has no prior source channels.
                state.q1.setTime(this.frame);
                state.q2.setTime(this.frame);
                state.q3.selectTime(this.frame, this.frame);
                for (const [entity, position] of this.positions) {
                    state.q1.updateEntityPosition(entity, position);
                    state.q2.updateEntityPosition(entity, position);
                    state.q3.updateEntityPosition(entity, position);
                }
                this.seats.push(state);
            }
            state.listener = listener;
            const entity = listener.actor === null ? 0 : this.entity(listener.actor);
            state.q1.setListener(entity, listener.origin, listener.axis);
            state.q2.setListener(entity, listener.origin, listener.axis);
            state.q3.setListener(entity, listener.origin, listener.axis);
            state.environment?.update(listener.origin, this.options.milliseconds());
        }
    }
    setEffectsVolume(gain: number): void {
        if (!Number.isFinite(gain) || gain < 0)
            throw new RangeError("Invalid effects gain");
        this.effectsGain = gain;
        for (const state of this.seats) {
            state.q1.effectsVolume = gain;
            state.q2.effectsVolume = gain;
            state.q3.setEffectsVolume(gain);
        }
    }
    updateActor(actor: ActorId, origin: Vec3): void {
        this.check();
        const entity = this.entity(actor);
        this.positions.set(entity, { ...origin });
        for (const state of this.seats) {
            state.q1.updateEntityPosition(entity, origin);
            state.q2.updateEntityPosition(entity, origin);
            state.q3.updateEntityPosition(entity, origin);
        }
    }
    private origin(request: PlaySound | LoopSound): VoiceOrigin {
        switch (request.origin.kind) {
            case "local": return { kind: "local" };
            case "fixed": return { kind: "fixed", position: request.origin.position };
            case "actor": return { kind: "entity", entity: this.entity(request.origin.actor) };
        }
    }
    play(request: PlaySound): number {
        this.check();
        if (!Number.isFinite(request.volume) || request.volume < 0 || request.volume > 1)
            throw new RangeError("Sound volume must be 0..1");
        const origin = this.origin(request), entity = request.actor === null ? -1 : this.entity(request.actor);
        let playing = 0;
        for (const state of this.seats) {
            if (!selected(request.audience, state.listener.seat))
                continue;
            const local = state.listener.actor === null ? 0 : this.entity(state.listener.actor);
            const options = { entity: origin.kind === "local" ? local : entity, channel: request.channel, origin, volume: request.volume, attenuation: request.attenuation,
                ...(request.delaySeconds === undefined ? {} : { delaySeconds: request.delaySeconds }), ...(request.serverMilliseconds === undefined ? {} : { serverMilliseconds: request.serverMilliseconds }) };
            const accepted = request.family === "q3" ? state.q3.startSound(request.sound.pcm, { ...options, volume: Math.trunc(request.volume * 127) }, request.sound.name)
                : (request.family === "q1" ? state.q1 : state.q2).startSound(request.sound.pcm, options);
            if (accepted)
                playing++;
        }
        if (playing > 0)
            this.options.onSound?.(request);
        return playing;
    }
    stopSound(actor: ActorId, channel: number): void {
        const entity = this.entity(actor);
        for (const state of this.seats) {
            state.q1.stopSound(entity, channel);
            state.q2.stopSound(entity, channel);
            state.q3.stopChannel(entity, channel);
        }
    }
    private loopPosition(request: LoopSound, listener: AudioListener): Vec3 {
        if (request.origin.kind === "local") return listener.origin;
        if (request.origin.kind === "fixed") return request.origin.position;
        const position = this.positions.get(this.entity(request.origin.actor));
        if (position === undefined) throw new Error("Loop requires an actor position");
        return position;
    }
    loop(request: LoopSound): void {
        this.check();
        const entity = this.entity(request.actor);
        for (const state of this.seats) {
            if (!selected(request.audience, state.listener.seat))
                continue;
            const origin = this.loopPosition(request, state.listener);
            state.loops.set(`${request.family}:${entity}`, request);
            if (request.family === "q3") {
                const options = { entity, origin, velocity: request.velocity, frameNumber: request.frameNumber,
                    volume: Math.trunc(request.volume * (request.lifetime === "frame" ? 127 : 90)) };
                if (request.lifetime === "frame")
                    state.q3.updateLoopingSound(request.sound.pcm, options);
                else
                    state.q3.updateRealLoopingSound(request.sound.pcm, options);
            }
        }
    }
    beginLoopFrame(): void {
        for (const state of this.seats) {
            state.q3.clearLoopingSounds(false);
            for (const [key, loop] of state.loops)
                if (loop.lifetime === "frame")
                    state.loops.delete(key);
        }
    }
    endLoopFrame(): void {
        for (const state of this.seats) {
            const loops = [...state.loops.values()].map(loop => ({ family: loop.family, entity: this.entity(loop.actor), sound: loop.sound.pcm,
                origin: this.loopPosition(loop, state.listener), volume: loop.volume, attenuation: loop.attenuation }));
            state.q1.setLoopSounds(loops.filter(loop => loop.family === "q1"));
            state.q2.setLoopSounds(loops.filter(loop => loop.family === "q2"));
            const entity = state.listener.actor === null ? 0 : this.entity(state.listener.actor);
            state.q3.setListener(entity, state.listener.origin, state.listener.axis);
        }
    }
    stopLoop(actor: ActorId): void {
        const entity = this.entity(actor);
        for (const state of this.seats) {
            for (const family of ["q1", "q2", "q3"])
                state.loops.delete(`${family}:${entity}`);
            state.q3.stopLoopingSound(entity);
        }
        this.endLoopFrame();
    }
    addStaticSound(seat: SeatId, sound: SoundAsset, origin: Vec3, volume: number, attenuation: number): boolean { return this.seat(seat).q1.addStaticSound(sound.pcm, origin, volume, attenuation); }
    updateAmbient(seat: SeatId, sounds: readonly SoundAsset[], levels: readonly number[], elapsedSeconds: number, level = 0.3, fade = 100): void {
        this.seat(seat).q1.updateAmbient(sounds.map(sound => sound.pcm), levels, elapsedSeconds, level, fade);
    }
    setEnvironment(seat: SeatId, environments: readonly ReverbEnvironment[], trace: AudioTraceQuery): void {
        const state = this.seat(seat);
        state.environment = new EnvironmentReverb(environments, trace);
        state.reverb.reset();
        state.environment.update(state.listener.origin, this.options.milliseconds());
    }
    queueStream(target: AudioStreamTarget, chunk: StreamPcm): void {
        this.check();
        let bus = this.streams.get(target.id);
        if (bus === undefined) {
            bus = { target, stream: new RawAudioStream(this.sampleRate) };
            this.streams.set(target.id, bus);
        }
        else
            bus.target = target;
        bus.stream.queue(chunk);
    }
    pauseStream(id: string, paused: boolean): void { const bus = this.streams.get(id); if (bus !== undefined)
        bus.stream.paused = paused; }
    stopStream(id: string): void { this.streams.delete(id); }
    attachMusic(target: AudioStreamTarget, player: MusicPlayer): void {
        if (player.outputRate !== this.sampleRate)
            throw new Error("Music output rate differs from device mix");
        const prior = this.music.get(target.id);
        if (prior !== undefined && prior.player !== player)
            prior.player.close();
        this.music.set(target.id, { target, player });
    }
    stopMusic(id: string): void { this.music.get(id)?.player.close(); this.music.delete(id); }
    updateMusic(): void { for (const bus of this.music.values())
        bus.player.update(); }
    private audienceGain(audience: AudioAudience): number {
        if (audience.kind === "world")
            return 1;
        return this.seats.find(state => state.listener.seat.equals(audience.seat))?.listener.gain ?? 0;
    }
    mix(frames: number): Int16Array {
        this.check();
        if (!Number.isSafeInteger(frames) || frames < 0 || frames > this.sampleRate * 2)
            throw new RangeError("Mix request exceeds two seconds");
        const output = new Float64Array(frames * 2);
        if (this.paused)
            return new Int16Array(frames * 2);
        for (const state of this.seats) {
            const seat = new Float64Array(frames * 2);
            add(seat, state.q1.mix(frames), 1);
            add(seat, state.q2.mix(frames), 1);
            add(seat, state.q3.mix(frames), 1);
            const params = state.environment?.params;
            if (params !== undefined && params !== null)
                state.reverb.process(seat, params);
            if (state.listener.underwater)
                state.underwater.process(seat);
            else
                state.underwater.reset();
            add(output, seat, state.listener.gain);
        }
        for (const bus of this.streams.values())
            add(output, bus.stream.mix(frames, bus.target.gain), this.audienceGain(bus.target.audience));
        for (const bus of this.music.values())
            add(output, bus.player.mix(frames), bus.target.gain * this.audienceGain(bus.target.audience));
        this.frame += frames;
        return Int16Array.from(output, value => Math.max(-32768, Math.min(32767, Math.trunc(value))));
    }
    openDevice(options: Omit<SdlAudioOptions, "sampleRate" | "channels" | "sampleBits"> = {}): void {
        this.check();
        if (this.device !== null)
            throw new Error("Audio output already open");
        this.device = SdlAudioDevice.open({ ...options, sampleRate: this.sampleRate, channels: 2, sampleBits: 16 });
    }
    /** Fill a short queue. No wall-clock advancement occurs when the device is paused. */
    pump(aheadFrames = Math.ceil(this.sampleRate * 0.08)): number {
        this.check();
        const device = this.device;
        if (device === null)
            throw new Error("Audio output is not open");
        if (this.paused)
            return 0;
        if (!Number.isSafeInteger(aheadFrames) || aheadFrames < 0 || aheadFrames > device.maxQueuedFrames)
            throw new RangeError("Invalid audio lookahead");
        const frames = Math.max(0, aheadFrames - device.queuedFrames);
        if (frames > 0)
            device.queue(this.mix(frames));
        device.resume();
        return frames;
    }
    pause(paused: boolean): void { this.check(); this.paused = paused; if (paused)
        this.device?.pause();
    else
        this.device?.resume(); }
    stopAll(): void {
        for (const state of this.seats) {
            state.q1.stopAll();
            state.q2.stopAll();
            state.q3.stopAll();
            state.loops.clear();
            state.reverb.reset();
            state.underwater.reset();
        }
        this.streams.clear();
        for (const bus of this.music.values())
            bus.player.close();
        this.music.clear();
        this.device?.clear();
    }
    close(): void { if (this.closed)
        return; try {
        this.stopAll();
    }
    finally {
        this.closed = true;
        this.device?.close();
        this.device = null;
    } }
    [Symbol.dispose](): void { this.close(); }
}
