import { sourceSoundChannel } from "./types.ts";
import type { SharedSoundChannel } from "./types.ts";
import type { ActorId, SeatId } from "../contracts/identity.ts";
import type { Vec3 } from "../contracts/math.ts";
import { SdlAudioDevice, SdlAudioUnavailableError } from "../platform/audio.ts";
import type { SdlAudioOptions } from "../platform/audio.ts";
import { AudioMixer } from "./mixer.ts";
import type { VoiceOrigin } from "./mixer.ts";
import { RawAudioStream } from "./streams.ts";
import { MusicPlayer } from "./music.ts";
import { EnvironmentReverb } from "./environments.ts";
import type { AudioTraceQuery, ReverbEnvironment } from "./environments.ts";
import { StereoReverb, UnderwaterFilter } from "./reverb.ts";
import type { AudioListener, PlaySound, LoopSound, AudioAudience, AudioStreamTarget, StreamPcm, SoundAsset } from "./types.ts";
interface SeatAudio {
    listener: AudioListener;
    readonly mixer: AudioMixer;
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
/** One output device; each listener owns a shared voice core and acoustic state. */
export class UnifiedAudio {
    readonly sampleRate: number;
    private readonly seats: SeatAudio[] = [];
    private readonly actors: ActorId[] = [];
    private dopplerEnabled = true;
    private readonly positions = new Map<number, Vec3>();
    private readonly streams = new Map<string, StreamBus>();
    private readonly music = new Map<string, MusicBus>();
    private device: SdlAudioDevice | null = null;
    private detachedOutput: { readonly playing: boolean; readonly bufferFrames: number; readonly deviceName: string | null } | null = null;
    private queuedPcm = new Int16Array(0);
    private closed = false;
    private paused = false;
    private effectsGain = 0.7;
    private frame = 0;
    private outputStarted = false;
    private previousPumpFrame: number | null = null;
    private readonly pumpIntervals: number[] = [];
    constructor(private readonly options: UnifiedAudioOptions) {
        this.sampleRate = options.sampleRate ?? 44100;
        if (!Number.isSafeInteger(this.sampleRate) || this.sampleRate < 8000 || this.sampleRate > 192000)
            throw new RangeError("Invalid audio output rate");
    }
    get sampleClock(): number { return this.frame; }
    get queuedFrames(): number { return this.device?.queuedFrames ?? 0; }
    get selectedOutput(): string | null { return this.device === null ? this.detachedOutput?.deviceName ?? null : this.device.deviceName; }
    get pendingOutput(): Int16Array<ArrayBuffer> {
        const samples = this.device === null ? this.queuedPcm.length : this.device.queuedFrames * 2;
        return this.queuedPcm.slice(this.queuedPcm.length - samples);
    }
    outputDeviceNames(): readonly string[] { this.check(); return SdlAudioDevice.outputDeviceNames(); }
    get outputState(): "detached" | "paused" | "playing" | "closed" { return this.closed ? "closed" : this.device?.state ?? "detached"; }
    get outputConfiguration(): { readonly sampleRate: number; readonly channels: 1 | 2; readonly sampleBits: 8 | 16;
        readonly deviceName: string | null; readonly bufferFrames: number; readonly maximumQueuedFrames: number } | null {
        const device = this.device;
        return device === null ? null : { sampleRate: device.sampleRate, channels: device.channels, sampleBits: device.sampleBits,
            deviceName: device.deviceName, bufferFrames: device.bufferFrames, maximumQueuedFrames: device.maxQueuedFrames };
    }
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
                state = { listener,
                    mixer: new AudioMixer(this.sampleRate, this.options.milliseconds, 96, 2, this.options.maxActors ?? 65536),
                    reverb: new StereoReverb(this.sampleRate), underwater: new UnderwaterFilter(this.sampleRate), environment: null, loops: new Map<string, LoopSound>() };
                state.mixer.setEffectsVolume(this.effectsGain);
                state.mixer.setDopplerEnabled(this.dopplerEnabled);
                // A new seat starts at the host paint epoch; it has no prior source channels.
                state.mixer.selectTime(this.frame, this.frame);
                for (const [entity, position] of this.positions) {
                    state.mixer.updateEntityPosition(entity, position);
                }
                this.seats.push(state);
            }
            state.listener = listener;
            const entity = listener.actor === null ? 0 : this.entity(listener.actor);
            state.mixer.setListener(entity, listener.origin, listener.axis);
            state.environment?.update(listener.origin, this.options.milliseconds());
        }
    }
    setEffectsVolume(gain: number): void {
        if (!Number.isFinite(gain) || gain < 0)
            throw new RangeError("Invalid effects gain");
        this.effectsGain = gain;
        for (const state of this.seats) {
            state.mixer.setEffectsVolume(gain);
        }
    }
    setDopplerEnabled(enabled: boolean): void {
        this.check();
        this.dopplerEnabled = enabled;
        for (const state of this.seats) state.mixer.setDopplerEnabled(enabled);
    }
    updateActor(actor: ActorId, origin: Vec3): void {
        this.check();
        const entity = this.entity(actor);
        this.positions.set(entity, { ...origin });
        for (const state of this.seats) {
            state.mixer.updateEntityPosition(entity, origin);
        }
    }
    updateQ3SeatActor(seat: SeatId, actor: ActorId, origin: Vec3): void {
        this.check();
        this.seat(seat).mixer.updateEntityPosition(this.entity(actor), origin);
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
        const channelCommand = sourceSoundChannel(request.family, request.channel);
        const origin = this.origin(request), entity = request.actor === null ? -1 : this.entity(request.actor);
        let playing = 0;
        for (const state of this.seats) {
            if (!selected(request.audience, state.listener.seat))
                continue;
            const local = state.listener.actor === null ? 0 : this.entity(state.listener.actor);
            const options = { entity: origin.kind === "local" ? local : entity, channel: request.channel, origin, volume: request.volume, attenuation: request.attenuation,
                ...(request.delaySeconds === undefined ? {} : { delaySeconds: request.delaySeconds }), ...(request.serverMilliseconds === undefined ? {} : { serverMilliseconds: request.serverMilliseconds }) };
            const accepted = request.family === "q3" ? state.mixer.startSharedSound(request.sound.pcm, { ...options, volume: Math.trunc(request.volume * 127) }, channelCommand, request.sound.name)
                : request.family === "q1" ? state.mixer.startQ1Sound(request.sound.pcm, options, channelCommand, this.options.random)
                : state.mixer.startQ2Sound(request.sound.pcm, options, channelCommand);
            if (accepted)
                playing++;
        }
        if (playing > 0)
            this.options.onSound?.(request);
        return playing;
    }
    stopSound(actor: ActorId, channel: SharedSoundChannel | null): void {
        const entity = this.entity(actor);
        for (const state of this.seats) {
            state.mixer.stopSharedChannel(entity, channel);
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
            if (request.family === "q3") this.q3Loop(state, request, origin);
        }
    }
    private q3Loop(state: SeatAudio, request: LoopSound, origin: Vec3): void {
        const options = { entity: this.entity(request.actor), origin, velocity: request.velocity, frameNumber: request.frameNumber,
            volume: Math.trunc(request.volume * (request.lifetime === "frame" ? 127 : 90)) };
        if (request.lifetime === "frame") state.mixer.updateLoopingSound(request.sound.pcm, options);
        else state.mixer.updateRealLoopingSound(request.sound.pcm, options);
    }
    beginLoopFrame(): void {
        for (const state of this.seats) {
            state.mixer.clearLoopingSounds(false);
            for (const [key, loop] of state.loops)
                if (loop.lifetime === "frame")
                    state.loops.delete(key);
        }
    }
    endLoopFrame(): void {
        for (const state of this.seats) {
            const loops = [...state.loops.values()].map(loop => ({ family: loop.family, entity: this.entity(loop.actor), sound: loop.sound.pcm,
                origin: this.loopPosition(loop, state.listener), volume: loop.volume, attenuation: loop.attenuation }));
            state.mixer.setSourceLoopSounds(loops.filter(loop => loop.family === "q1" || loop.family === "q2").map(loop => ({ ...loop, family: loop.family === "q1" ? "q1" : "q2" })));
            const entity = state.listener.actor === null ? 0 : this.entity(state.listener.actor);
            state.mixer.setListener(entity, state.listener.origin, state.listener.axis);
        }
    }
    stopLoop(actor: ActorId): void {
        const entity = this.entity(actor);
        for (const state of this.seats) {
            for (const family of ["q1", "q2", "q3"])
                state.loops.delete(`${family}:${entity}`);
            state.mixer.stopLoopingSound(entity);
        }
        this.endLoopFrame();
    }
    clearQ3SeatLoops(seat: SeatId, killAll: boolean): void {
        const state = this.seat(seat);
        state.mixer.clearLoopingSounds(killAll);
        for (const [key, loop] of state.loops)
            if (loop.family === "q3" && loop.audience.kind === "seat" && loop.audience.seat.equals(seat) && (killAll || loop.lifetime === "frame")) state.loops.delete(key);
        for (const loop of state.loops.values()) if (loop.family === "q3") this.q3Loop(state, loop, this.loopPosition(loop, state.listener));
    }
    stopQ3SeatLoop(seat: SeatId, actor: ActorId): void {
        const state = this.seat(seat), entity = this.entity(actor), key = `q3:${entity}`, loop = state.loops.get(key);
        if (loop?.audience.kind === "world") return;
        if (loop !== undefined && loop.audience.kind === "seat" && loop.audience.seat.equals(seat)) state.loops.delete(key);
        state.mixer.stopLoopingSound(entity);
    }
    addStaticSound(seat: SeatId, sound: SoundAsset, origin: Vec3, volume: number, attenuation: number): boolean { return this.seat(seat).mixer.addStaticSound(sound.pcm, origin, volume, attenuation); }
    updateAmbient(seat: SeatId, sounds: readonly SoundAsset[], levels: readonly number[], elapsedSeconds: number, level = 0.3, fade = 100): void {
        this.seat(seat).mixer.updateAmbient(sounds.map(sound => sound.pcm), levels, elapsedSeconds, level, fade);
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
            add(seat, state.mixer.mix(frames), 1);
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
        this.detachedOutput = null;
    }
    detachOutput(): void {
        this.check();
        const device = this.device;
        if (device === null) return;
        this.detachedOutput = { playing: device.state === "playing", bufferFrames: device.bufferFrames, deviceName: device.deviceName };
        device.pause(); this.queuedPcm = this.pendingOutput;
        device.close(); this.device = null;
        this.previousPumpFrame = null; this.pumpIntervals.length = 0;
    }
    selectOutput(deviceName: string | null): void {
        this.check();
        const previous = this.device;
        if (previous === null) {
            const detached = this.detachedOutput;
            const device = SdlAudioDevice.open({ deviceName, sampleRate: this.sampleRate, channels: 2, sampleBits: 16,
                ...(detached === null ? {} : { bufferFrames: detached.bufferFrames }) });
            try { device.queue(this.queuedPcm); }
            catch (error) { device.close(); throw error; }
            this.device = device;
            if (detached?.playing === true && !this.paused) device.resume();
            this.detachedOutput = null;
            this.previousPumpFrame = null; this.pumpIntervals.length = 0;
            return;
        }
        if (previous.deviceName === deviceName) return;
        const playing = previous.state === "playing";
        previous.pause();
        this.queuedPcm = this.pendingOutput;
        const open = (name: string | null): SdlAudioDevice => {
            const device = SdlAudioDevice.open({ deviceName: name, sampleRate: this.sampleRate, channels: 2, sampleBits: 16, bufferFrames: previous.bufferFrames });
            try { device.queue(this.queuedPcm); return device; }
            catch (error) { device.close(); throw error; }
        };
        let replacement: SdlAudioDevice;
        try { replacement = open(deviceName); }
        catch (error) {
            if (!(error instanceof SdlAudioUnavailableError)) { if (playing) previous.resume(); throw error; }
            // Single-output drivers require releasing the old device before retrying.
            previous.close(); this.device = null;
            try { replacement = open(deviceName); }
            catch (selectionError) {
                try {
                    const restored = open(previous.deviceName);
                    this.device = restored;
                    if (playing) restored.resume();
                } catch (restoreError) {
                    this.device?.close(); this.device = null;
                    this.detachedOutput = { playing, bufferFrames: previous.bufferFrames, deviceName: previous.deviceName };
                    throw new AggregateError([selectionError, restoreError], "Audio output selection and recovery failed");
                } finally { this.previousPumpFrame = null; this.pumpIntervals.length = 0; }
                throw selectionError;
            }
        }
        previous.close();
        this.device = replacement;
        this.previousPumpFrame = null; this.pumpIntervals.length = 0;
        if (playing) replacement.resume();
    }
    /** Cover recent frame times plus SDL's block consumption and scheduling jitter. */
    pump(aheadFrames?: number, measuredWorkMilliseconds = 0): number {
        this.check();
        const device = this.device;
        if (device === null)
            throw new Error("Audio output is not open");
        if (this.paused)
            return 0;
        if (!Number.isFinite(measuredWorkMilliseconds) || measuredWorkMilliseconds < 0) throw new RangeError("Invalid measured audio frame work");
        const workFrames = Math.ceil(measuredWorkMilliseconds * this.sampleRate / 1000);
        const initialFill = !this.outputStarted && device.state === "paused" && device.queuedFrames === 0;
        const playbackFrame = device.playbackFrames;
        const interval = this.previousPumpFrame === null ? 0 : playbackFrame - this.previousPumpFrame;
        if (!initialFill) {
            this.pumpIntervals.push(Math.max(interval, workFrames));
            if (this.pumpIntervals.length > 8)
                this.pumpIntervals.shift();
        }
        // Q3's s_mixahead default supplies the initial horizon; paused loading is not a refill interval.
        const target = aheadFrames ?? Math.min(device.maxQueuedFrames,
            initialFill ? Math.max(Math.ceil(this.sampleRate * 0.2), device.bufferFrames * 2)
                : Math.max(Math.ceil(this.sampleRate * 0.08), Math.max(...this.pumpIntervals) + device.bufferFrames * 2));
        if (!Number.isSafeInteger(target) || target < 0 || target > device.maxQueuedFrames)
            throw new RangeError("Invalid audio lookahead");
        this.previousPumpFrame = playbackFrame;
        this.queuedPcm = this.queuedPcm.subarray(this.queuedPcm.length - device.queuedFrames * 2);
        const frames = Math.max(0, target - device.queuedFrames);
        if (frames > 0) {
            const samples = this.mix(frames), queued = new Int16Array(this.queuedPcm.length + samples.length);
            queued.set(this.queuedPcm); queued.set(samples, this.queuedPcm.length);
            device.queue(samples);
            this.queuedPcm = queued.slice(queued.length - device.queuedFrames * 2);
        }
        device.resume();
        this.outputStarted = true;
        return frames;
    }
    pause(paused: boolean): void { this.check(); this.paused = paused; this.previousPumpFrame = null; this.pumpIntervals.length = 0; if (paused)
        this.device?.pause();
    else if (this.device !== null) {
        this.device.resume(); this.outputStarted = true;
    } }
    stopAll(): void {
        for (const state of this.seats) {
            state.mixer.stopAll();
            state.loops.clear();
            state.reverb.reset();
            state.underwater.reset();
        }
        this.streams.clear();
        for (const bus of this.music.values())
            bus.player.close();
        this.music.clear();
        this.device?.clear();
        this.queuedPcm = new Int16Array(0);
    }
    close(): void { if (this.closed)
        return; try {
        this.stopAll();
    }
    finally {
        this.closed = true;
        this.device?.close();
        this.device = null;
        this.detachedOutput = null;
    } }
    [Symbol.dispose](): void { this.close(); }
}
