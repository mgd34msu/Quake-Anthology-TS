// Source PCM streams share one device. Chunk boundaries do not reset resampling phase.
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VorbisDecoder } from "../platform/vorbis.ts";
import type { PcmSound } from "./wav.ts";
import { decodeWav } from "./wav.ts";
import type { StreamPcm } from "./types.ts";
export interface PcmStream {
    readonly sampleRate: number;
    readonly channels: 1 | 2;
    readonly frameCount: number;
    readonly positionFrames: number;
    read(maxFrames: number): PcmSound | null;
    seek(frame: number): void;
    close(): void;
}
export class MemoryPcmStream implements PcmStream {
    private position = 0;
    private closed = false;
    constructor(private readonly pcm: PcmSound) { }
    get sampleRate(): number { return this.pcm.sampleRate; }
    get channels(): 1 | 2 { return this.pcm.channels; }
    get frameCount(): number { return this.pcm.frameCount; }
    get positionFrames(): number { return this.position; }
    private check(): void { if (this.closed)
        throw new Error("PCM stream closed"); }
    read(maxFrames: number): PcmSound | null {
        this.check();
        if (!Number.isSafeInteger(maxFrames) || maxFrames < 1)
            throw new RangeError("Invalid PCM frame request");
        const count = Math.min(maxFrames, this.frameCount - this.position);
        if (count === 0)
            return null;
        const samples = this.pcm.samples.subarray(this.position * this.channels, (this.position + count) * this.channels);
        this.position += count;
        return { samples, channels: this.channels, sampleRate: this.sampleRate, frameCount: count, loopStart: null };
    }
    seek(frame: number): void { this.check(); if (!Number.isSafeInteger(frame) || frame < 0 || frame > this.frameCount)
        throw new RangeError("PCM seek outside stream"); this.position = frame; }
    close(): void { this.closed = true; }
}
export class VorbisPcmStream implements PcmStream {
    private closed = false;
    private constructor(private readonly decoder: VorbisDecoder, private readonly temporaryDirectory: string | null) { }
    static open(path: string): VorbisPcmStream { return new VorbisPcmStream(VorbisDecoder.open(path), null); }
    /** The platform ABI owns file decoding. Archive bytes live in an owned, removed temporary file. */
    static fromBytes(bytes: Uint8Array): VorbisPcmStream {
        const directory = mkdtempSync(join(tmpdir(), "quake-audio-"));
        try {
            const path = join(directory, "source.ogg");
            writeFileSync(path, bytes);
            return new VorbisPcmStream(VorbisDecoder.open(path), directory);
        }
        catch (error) {
            rmSync(directory, { recursive: true, force: true });
            throw error;
        }
    }
    get sampleRate(): number { return this.decoder.metadata.sampleRate; }
    get channels(): 1 | 2 { return this.decoder.metadata.channels; }
    get frameCount(): number { return this.decoder.metadata.totalFrames; }
    get positionFrames(): number { return this.decoder.positionFrames; }
    read(maxFrames: number): PcmSound | null {
        const chunk = this.decoder.read(maxFrames);
        return chunk === null ? null : { ...chunk, frameCount: chunk.frames, loopStart: null };
    }
    seek(frame: number): void { this.decoder.seek(frame); }
    close(): void { if (this.closed)
        return; this.closed = true; try {
        this.decoder.close();
    }
    finally {
        if (this.temporaryDirectory !== null)
            rmSync(this.temporaryDirectory, { recursive: true, force: true });
    } }
}
export function openPcmBytes(bytes: Uint8Array, source = "<sound>"): PcmStream {
    if (bytes[0] === 79 && bytes[1] === 103 && bytes[2] === 103 && bytes[3] === 83)
        return VorbisPcmStream.fromBytes(bytes);
    return new MemoryPcmStream(decodeWav(bytes, source));
}
export function decodeSoundBytes(bytes: Uint8Array, source = "<sound>"): PcmSound {
    if (!(bytes[0] === 79 && bytes[1] === 103 && bytes[2] === 103 && bytes[3] === 83))
        return decodeWav(bytes, source);
    const stream = VorbisPcmStream.fromBytes(bytes);
    try {
        const samples = new Int16Array(stream.frameCount * stream.channels);
        let offset = 0;
        for (let chunk = stream.read(16384); chunk !== null; chunk = stream.read(16384)) {
            samples.set(chunk.samples, offset);
            offset += chunk.samples.length;
        }
        return { samples: samples.subarray(0, offset), channels: stream.channels, sampleRate: stream.sampleRate, frameCount: offset / stream.channels, loopStart: null };
    }
    finally {
        stream.close();
    }
}
interface Segment {
    readonly begin: number;
    readonly end: number;
    readonly samples: Int16Array;
}
export class RawAudioStream {
    private segments: Segment[] = [];
    private inputRate = 0;
    private channels: 1 | 2 = 2;
    private origin = 0;
    private outputFrames = 0;
    private end = 0;
    paused = false;
    constructor(readonly outputRate: number) { }
    get queuedSourceFrames(): number { return Math.max(0, this.end - this.sourcePosition); }
    private get sourcePosition(): number { return this.origin + Math.floor(this.outputFrames * this.inputRate / this.outputRate); }
    queue(chunk: StreamPcm): void {
        if (!Number.isSafeInteger(chunk.sampleRate) || chunk.sampleRate < 1 || !Number.isSafeInteger(chunk.sourceSample) || chunk.sourceSample < 0 || chunk.samples.length % chunk.channels !== 0)
            throw new RangeError("Invalid streamed PCM");
        if (chunk.resetStream || this.inputRate === 0) {
            this.segments = [];
            this.inputRate = chunk.sampleRate;
            this.channels = chunk.channels;
            this.origin = chunk.sourceSample;
            this.outputFrames = 0;
            this.end = chunk.sourceSample;
        }
        if (chunk.sampleRate !== this.inputRate || chunk.channels !== this.channels)
            throw new Error("PCM stream format changed without reset");
        if (chunk.sourceSample !== this.end)
            throw new Error(`PCM source discontinuity: expected ${this.end}, received ${chunk.sourceSample}`);
        const samples = chunk.samples instanceof Int16Array ? new Int16Array(chunk.samples) : Int16Array.from(chunk.samples, value => (value - 128) << 8);
        const end = chunk.sourceSample + samples.length / chunk.channels;
        if (end > chunk.sourceSample)
            this.segments.push({ begin: chunk.sourceSample, end, samples });
        this.end = end;
    }
    mix(frames: number, gain = 1): Float64Array {
        const output = new Float64Array(frames * 2);
        if (this.paused || this.inputRate === 0)
            return output;
        for (let frame = 0; frame < frames; frame++) {
            const position = this.sourcePosition;
            while (this.segments[0] !== undefined && position >= this.segments[0].end)
                this.segments.shift();
            const segment = this.segments[0];
            if (segment === undefined)
                break;
            const index = (position - segment.begin) * this.channels;
            const left = segment.samples[index], right = this.channels === 1 ? left : segment.samples[index + 1];
            if (left === undefined || right === undefined)
                throw new Error("PCM source position outside queued segment");
            output[frame * 2] = left * gain;
            output[frame * 2 + 1] = right * gain;
            this.outputFrames++;
        }
        return output;
    }
}
