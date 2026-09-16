// Intro/loop and CD track selection adapted from Q3 snd_dma.c and Q1/Q2 cd_ogg.ts.
// SPDX-License-Identifier: GPL-2.0-or-later
import { RawAudioStream } from "./streams.ts";
import type { PcmStream } from "./streams.ts";
import type { SoundFamily, StreamPcm } from "./types.ts";
export type MusicVolumeMode = "source" | "immediate";
export class MusicControls {
    enabled = true;
    private readonly remap: number[] = Array.from({ length: 100 }, (_, index) => index);
    get remappedTracks(): readonly number[] { return this.remap.slice(1); }
    mappedTrack(track: number): number { return this.remap[track] ?? track; }
    setRemap(tracks: readonly number[]): void {
        if (tracks.length >= this.remap.length) throw new RangeError("CD remap exceeds 99 tracks");
        for (const track of tracks) if (!Number.isInteger(track) || track < 0 || track > 255) throw new RangeError("Invalid CD track");
        tracks.forEach((track, index) => { this.remap[index + 1] = track; });
    }
    reset(): void { this.enabled = true; for (let index = 0; index < this.remap.length; index++) this.remap[index] = index; }
}
export class MusicPlayer {
    private stream: PcmStream | null = null;
    private loop: PcmStream | null = null;
    private pcm: RawAudioStream;
    private targetVolume = 0.25;
    private smoothedVolume = Math.fround(0.5);
    paused = false;
    constructor(readonly outputRate: number, readonly family: SoundFamily = "q3", private readonly volumeMode: MusicVolumeMode = "source", readonly controls: MusicControls = new MusicControls()) {
        this.pcm = new RawAudioStream(outputRate);
    }
    get playing(): boolean { return this.stream !== null; }
    get sourcePosition(): number { return this.pcm.sourcePosition; }
    get volume(): number { return this.family === "q3" && this.volumeMode === "source" ? this.smoothedVolume : this.targetVolume; }
    setVolume(value: number): void { if (!Number.isFinite(value) || value < 0)
        throw new RangeError("Invalid music volume"); this.targetVolume = value; }
    /** Called once by the presentation frame, matching Q3's source smoothing clock. */
    update(): void {
        if (this.family === "q3" && this.volumeMode === "source" && this.stream !== null && !this.paused && this.controls.enabled)
            this.smoothedVolume = Math.fround(Math.fround(this.smoothedVolume + Math.fround(Math.fround(this.targetVolume) * 2)) / 4);
    }
    start(intro: PcmStream, loop: PcmStream | null = null): void {
        this.stop();
        this.stream = intro;
        this.loop = loop;
        this.pcm = new RawAudioStream(this.outputRate);
        this.paused = false;
    }
    stop(): void {
        const stream = this.stream, loop = this.loop;
        this.stream = null;
        this.loop = null;
        try {
            stream?.close();
        }
        finally {
            if (loop !== stream)
                loop?.close();
        }
    }
    private nextChunk(): StreamPcm | null {
        const stream = this.stream;
        if (stream === null)
            return null;
        const sourceSample = stream.positionFrames;
        const chunk = stream.read(16384);
        if (chunk !== null)
            return { ...chunk, sourceSample, resetStream: false };
        if (this.loop === null) {
            this.stream = null;
            stream.close();
            return null;
        }
        if (this.loop !== stream)
            stream.close();
        this.stream = this.loop;
        this.stream.seek(0);
        const loopChunk = this.stream.read(16384);
        if (loopChunk === null) {
            this.stop();
            return null;
        }
        return { ...loopChunk, sourceSample: 0, resetStream: true };
    }
    mix(frames: number): Float64Array {
        if (!this.controls.enabled || this.paused || this.volume <= 0 || this.stream === null)
            return new Float64Array(frames * 2);
        return this.pcm.mix(frames, this.volume, () => this.nextChunk());
    }
    close(): void { this.stop(); }
}
export type OpenMusicTrack = (path: string) => Promise<PcmStream | null>;
/** Track remapping precedes the ordered loose/archive search through the caller's mount plan. */
export class CdMusic {
    private track: number | null = null;
    private request = 0;
    get enabled(): boolean { return this.player.controls.enabled; }
    set enabled(value: boolean) { this.player.controls.enabled = value; }
    constructor(readonly player: MusicPlayer, private readonly open: OpenMusicTrack) { }
    get playingTrack(): number | null { return this.track; }
    get remappedTracks(): readonly number[] { return this.player.controls.remappedTracks; }
    setRemap(tracks: readonly number[]): void { this.player.controls.setRemap(tracks); }
    reset(): void { this.stop(); this.player.controls.reset(); }
    async play(track: number, looping: boolean): Promise<boolean> {
        if (!this.enabled)
            return false;
        if (!Number.isInteger(track) || track < 0 || track > 255)
            throw new RangeError("Invalid CD track");
        const mapped = this.player.controls.mappedTrack(track);
        if (mapped < 1)
            return false;
        if (this.track === mapped && this.player.playing)
            return true;
        const request = ++this.request;
        this.player.stop();
        this.track = null;
        const number = String(mapped).padStart(2, "0");
        const candidates = [`music/${number}.ogg`, `music/track${number}.ogg`, `music/${number}.wav`, `music/track${number}.wav`];
        for (const path of candidates) {
            const stream = await this.open(path);
            if (request !== this.request || !this.enabled) {
                stream?.close();
                return false;
            }
            if (stream === null) continue;
            this.player.start(stream, looping ? stream : null);
            this.track = mapped;
            return true;
        }
        return false;
    }
    pause(): void { this.player.paused = true; }
    resume(): void { if (this.enabled)
        this.player.paused = false; }
    stop(): void { this.request++; this.player.stop(); this.track = null; }
    close(): void { this.stop(); }
}
const xatrixTracks: readonly number[] = [9, 13, 14, 7, 16, 2, 15, 3, 4, 18];
export type Q2SoundtrackProfile = { readonly kind: "disc" } | { readonly kind: "remastered"; readonly campaign: string };
export function remapQ2MusicTrack(track: number, profile: Q2SoundtrackProfile): number {
    if (profile.kind === "disc" || track < 2 || track > 11)
        return track;
    const game = profile.campaign.toLowerCase();
    if (game === "rogue")
        return track + 10;
    if (game === "xatrix") {
        const remapped = xatrixTracks[track - 2];
        if (remapped === undefined)
            throw new RangeError("Expansion soundtrack index outside CD range");
        return remapped;
    }
    return track;
}
export interface MusicTrack {
    readonly name: string;
    readonly path: string;
}
/** Q2's named/numbered playlist, menu track and shuffle selection over mounted tracks. */
export class Q2Jukebox {
    private readonly tracks: MusicTrack[];
    private readonly names = new Map<string, MusicTrack>();
    private index = 0;
    private autoTrack = "";
    private request = 0;
    private manual = false;
    enabled = true;
    shuffle = false;
    menuTrack = "77";
    soundtrack: Q2SoundtrackProfile = { kind: "remastered", campaign: "baseq2" };
    constructor(readonly player: MusicPlayer, tracks: readonly MusicTrack[], private readonly open: OpenMusicTrack, private readonly random: () => number) {
        for (const track of tracks)
            if (!this.names.has(track.name.toLowerCase()))
                this.names.set(track.name.toLowerCase(), track);
        this.tracks = [...this.names.values()];
    }
    private lookup(name: string): MusicTrack | undefined {
        if (/^\d+$/.test(name)) {
            const track = remapQ2MusicTrack(Number(name), this.soundtrack);
            if (track <= 0)
                return undefined;
            const number = String(track).padStart(2, "0");
            return this.names.get(`track${number}`) ?? this.names.get(number);
        }
        return this.names.get(name.replaceAll("\\", "/").replace(/\.(ogg|wav)$/i, "").toLowerCase());
    }
    private shuffleTracks(): void {
        for (let i = this.tracks.length - 1; i > 0; i--) {
            const random = this.random();
            if (!Number.isSafeInteger(random) || random < 0)
                throw new RangeError("Jukebox random source must return a nonnegative integer");
            const j = random % (i + 1), a = this.tracks[i], b = this.tracks[j];
            if (a === undefined || b === undefined)
                throw new Error("Jukebox shuffle index outside playlist");
            this.tracks[i] = b;
            this.tracks[j] = a;
        }
    }
    private async start(track: MusicTrack, request: number): Promise<boolean> {
        const stream = await this.open(track.path);
        if (stream === null)
            return false;
        if (request !== this.request) {
            stream.close();
            return false;
        }
        this.player.start(stream, stream);
        return true;
    }
    async update(serverTrack: string | null, cinematic = false): Promise<boolean> {
        if (cinematic || this.manual)
            return false;
        const name = serverTrack ?? this.menuTrack;
        if (name.length === 0 || name === "0") {
            this.stop();
            return false;
        }
        if (name.toLowerCase() === this.autoTrack.toLowerCase())
            return this.player.playing;
        this.player.stop();
        if (!this.enabled)
            return false;
        this.autoTrack = name;
        const request = ++this.request;
        if (serverTrack !== null && this.shuffle && this.tracks.length > 0) {
            for (let attempted = 0; attempted < this.tracks.length; attempted++) {
                if (this.index === 0)
                    this.shuffleTracks();
                const track = this.tracks[this.index];
                this.index = (this.index + 1) % this.tracks.length;
                if (track !== undefined && await this.start(track, request))
                    return true;
                if (request !== this.request)
                    return false;
            }
            return false;
        }
        const track = this.lookup(name);
        return track === undefined ? false : this.start(track, request);
    }
    async play(name: string): Promise<boolean> {
        const track = this.lookup(name);
        if (track === undefined)
            return false;
        this.player.stop();
        const request = ++this.request;
        const success = await this.start(track, request);
        if (success)
            this.manual = true;
        return success;
    }
    async next(serverTrack: string | null): Promise<boolean> { this.stop(); return this.update(serverTrack); }
    pause(paused: boolean): void { this.player.paused = paused; }
    stop(): void { this.request++; this.manual = false; this.autoTrack = ""; this.player.stop(); }
    close(): void { this.stop(); }
}
