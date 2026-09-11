// SPDX-License-Identifier: GPL-2.0-or-later
// Q1/Q2 cd_ogg.ts libvorbisfile decoding, separated from track/game ownership.
import { dlopen, ptr, read } from "bun:ffi";
import { endianness } from "node:os";
import { openNativeLibrary } from "./native-libraries.ts";

function loadVorbis() {
  // W06 qualifies the LP64 ABI. Windows uses 32-bit C long and needs its own layout.
  if ((process.platform !== "linux" && process.platform !== "darwin")
    || (process.arch !== "x64" && process.arch !== "arm64"))
    throw new Error("Vorbis decoding requires the qualified 64-bit LP64 ABI");
  return openNativeLibrary("vorbisfile", path => dlopen(path, {
    ov_fopen: { args: ["buffer", "buffer"], returns: "i32" },
    ov_read: { args: ["buffer", "buffer", "i32", "i32", "i32", "i32", "buffer"], returns: "i64" },
    ov_info: { args: ["buffer", "i32"], returns: "ptr" },
    ov_streams: { args: ["buffer"], returns: "i64" },
    ov_pcm_total: { args: ["buffer", "i32"], returns: "i64" },
    ov_pcm_tell: { args: ["buffer"], returns: "i64" },
    ov_pcm_seek: { args: ["buffer", "i64"], returns: "i32" },
    ov_clear: { args: ["buffer"], returns: "i32" },
  }));
}

let library: ReturnType<typeof loadVorbis> | undefined;
function vorbis() { library ??= loadVorbis(); return library.symbols; }

export interface VorbisMetadata {
  readonly sampleRate: number;
  readonly channels: 1 | 2;
  readonly totalFrames: number;
  readonly durationSeconds: number;
  readonly logicalStreams: number;
}

/** The samples belong to the caller and survive decoder reads, seeks and close. */
export interface VorbisPcmChunk {
  readonly samples: Int16Array;
  readonly frames: number;
  readonly sampleRate: number;
  readonly channels: 1 | 2;
}

export class VorbisError extends Error {
  constructor(readonly operation: string, readonly code: number) {
    super(`${operation} failed with Vorbis error ${code}`);
    this.name = "VorbisError";
  }
}

function safeCount(value: bigint, name: string): number {
  if (value < 0n) throw new VorbisError(name, Number(value));
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`${name} exceeds safe integer precision`);
  return Number(value);
}

function streamFormat(storage: Uint8Array, stream: number): { sampleRate: number; channels: 1 | 2 } {
  const info = vorbis().ov_info(storage, stream);
  if (info === null) throw new Error("ov_info returned no stream metadata");
  const channels = read.i32(info, 4);
  const sampleRate = safeCount(read.i64(info, 8), "Vorbis sample rate");
  if (channels !== 1 && channels !== 2) throw new Error("Vorbis output must be mono or stereo");
  if (sampleRate < 8000 || sampleRate > 192000) throw new Error("Vorbis sample rate must be in 8000..192000 Hz");
  return { sampleRate, channels };
}

export class VorbisDecoder {
  private storage: Uint8Array | null;
  readonly metadata: VorbisMetadata;

  private constructor(storage: Uint8Array, metadata: VorbisMetadata) {
    this.storage = storage;
    this.metadata = Object.freeze(metadata);
  }

  static open(path: string): VorbisDecoder {
    if (path.length === 0 || path.includes("\0")) throw new Error("Vorbis path must be nonempty and contain no NUL");
    const api = vorbis();
    // LP64 OggVorbis_File is 944 bytes in the public libvorbisfile 1.x ABI.
    // Retain the source ports' 2048-byte reserve; only libvorbisfile accesses it.
    const storage = new Uint8Array(2048);
    if (ptr(storage) % 8 !== 0) throw new Error("Vorbis storage requires 8-byte alignment");
    const result = api.ov_fopen(Buffer.from(`${path}\0`, "utf8"), storage);
    // Failed ov_fopen cleans its partial state; ov_clear is valid only after success.
    if (result !== 0) throw new VorbisError("ov_fopen", result);
    try {
      const format = streamFormat(storage, 0);
      const logicalStreams = safeCount(api.ov_streams(storage), "ov_streams");
      if (logicalStreams === 0 || logicalStreams > 65536) throw new Error("Vorbis logical stream count is outside 1..65536");
      for (let index = 1; index < logicalStreams; index++) {
        const next = streamFormat(storage, index);
        if (next.sampleRate !== format.sampleRate || next.channels !== format.channels)
          throw new Error("Vorbis chained streams change the PCM format");
      }
      const totalFrames = safeCount(api.ov_pcm_total(storage, -1), "ov_pcm_total");
      return new VorbisDecoder(storage, { ...format, totalFrames, logicalStreams,
        durationSeconds: totalFrames / format.sampleRate });
    } catch (error) { api.ov_clear(storage); throw error; }
  }

  private opened(): Uint8Array {
    if (this.storage === null) throw new Error("Vorbis decoder is closed");
    return this.storage;
  }

  get closed(): boolean { return this.storage === null; }
  get positionFrames(): number { return safeCount(vorbis().ov_pcm_tell(this.opened()), "ov_pcm_tell"); }

  seek(frame: number): void {
    const storage = this.opened();
    if (!Number.isSafeInteger(frame) || frame < 0 || frame > this.metadata.totalFrames)
      throw new RangeError("Vorbis seek frame is outside the stream");
    const result = vorbis().ov_pcm_seek(storage, BigInt(frame));
    if (result !== 0) throw new VorbisError("ov_pcm_seek", result);
  }

  /** Reads up to maxFrames, returning null only at EOF. Corrupt packets fail explicitly. */
  read(maxFrames = 4096): VorbisPcmChunk | null {
    const storage = this.opened();
    if (!Number.isInteger(maxFrames) || maxFrames < 1 || maxFrames > 1048576)
      throw new RangeError("Vorbis read frame limit must be in 1..1048576");
    const { channels, sampleRate } = this.metadata;
    const samples = new Int16Array(maxFrames * channels);
    const bitstream = new Int32Array(1);
    let sampleCount = 0;
    while (sampleCount < samples.length) {
      const output = samples.subarray(sampleCount);
      const count = Number(vorbis().ov_read(storage, output, output.byteLength,
        endianness() === "BE" ? 1 : 0, 2, 1, bitstream));
      if (count < 0) throw new VorbisError("ov_read", count);
      if (count === 0) break;
      if (count > output.byteLength || count % (channels * 2) !== 0)
        throw new Error("Vorbis returned an invalid PCM byte count");
      const stream = bitstream[0];
      if (stream === undefined || stream < 0 || stream >= this.metadata.logicalStreams)
        throw new Error("Vorbis returned an invalid logical stream index");
      sampleCount += count / 2;
    }
    if (sampleCount === 0) return null;
    return { samples: samples.subarray(0, sampleCount), frames: sampleCount / channels, channels, sampleRate };
  }

  close(): void {
    const storage = this.storage;
    if (storage === null) return;
    this.storage = null;
    const result = vorbis().ov_clear(storage);
    if (result !== 0) throw new VorbisError("ov_clear", result);
  }

  [Symbol.dispose](): void { this.close(); }
}
