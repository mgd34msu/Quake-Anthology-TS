/* Quake II SCR_PlayCinematic/SCR_RunCinematic/SCR_ReadNextFrame.
 * Copyright (C) 1997-2001 Id Software, Inc. GPL-2.0-or-later. */
import { SaveReader } from "../persistence/value.ts";
import { CinDecoder, cinRgba, type CinFrame } from "./cin.ts";
import type { MediaInput } from "./source.ts";
import type { CinematicAudio, CinematicFrame, MediaClock } from "./types.ts";

export interface CinPlaybackOptions {
  readonly clock: MediaClock;
  readonly source?: string;
  readonly loop?: boolean;
  readonly hold?: boolean;
  readonly silent?: boolean;
  readonly onAudio: (audio: CinematicAudio) => void;
  readonly developerPrint?: (message: string) => void;
}
export interface CinPlaybackTick {
  readonly status: "playing" | "held" | "ended" | "looped";
  readonly update: { readonly kind: "unchanged" } | { readonly kind: "frame"; readonly frame: CinematicFrame | null };
}

function milliseconds(clock: MediaClock): number {
  const time = clock.sample();
  if (!Number.isFinite(time) || time < 0 || time > 0x7fffffff) throw new RangeError("CIN clock requires nonnegative signed milliseconds");
  return Math.trunc(time);
}

function saveFrame(frame: CinFrame | null) {
  return frame === null ? null : { ...frame, pixels: frame.pixels.slice(), palette: frame.palette.slice(),
    audio: frame.audio === null ? null : { ...frame.audio, signed: frame.audio.samples instanceof Int16Array, samples: Array.from(frame.audio.samples) } };
}
function readFrame(reader: SaveReader, pixels: number): CinFrame | null {
  return reader.nullable(r => {
    const image = r.field("pixels").bytes().slice(), palette = r.field("palette").bytes().slice();
    if (image.length !== pixels || palette.length !== 768) r.fail("CIN frame size differs");
    return { kind: "frame", pixels: image, palette, index: r.field("index").integer(0), time: r.field("time").finite(),
      audio: r.field("audio").nullable(a => {
        const signed = a.field("signed").boolean(), channels = a.field("channels").choice(1, 2);
        const samples = a.field("samples").list(s => { const sample = s.integer(signed ? -32768 : 0);
          if (sample > (signed ? 32767 : 255)) s.fail("PCM sample outside range"); return sample; });
        if (samples.length % channels !== 0) a.fail("partial PCM frame");
        return { samples: signed ? Int16Array.from(samples) : Uint8Array.from(samples), channels,
          sampleRate: a.field("sampleRate").integer(1), sourceSample: a.field("sourceSample").integer(0) };
      }) };
  });
}

export class CinPlayback {
  private readonly decoder: CinDecoder;
  private epoch: number;
  private picture: CinFrame | null = null;
  private pending: CinFrame | null = null;
  private state: CinPlaybackTick["status"] = "playing";
  private pass = 0;

  constructor(input: Uint8Array | MediaInput, private readonly options: CinPlaybackOptions, checkpoint?: unknown) {
    this.decoder = new CinDecoder(input, options.source);
    try {
      this.epoch = milliseconds(options.clock);
      if (checkpoint !== undefined) this.restoreCheckpoint(checkpoint);
      else { this.picture = this.read(); if (this.picture === null) this.state = "ended"; }
    } catch (error: unknown) { this.decoder.close(); throw error; }
  }

  captureCheckpoint() {
    return { decoder: this.decoder.captureCheckpoint(), epoch: this.epoch, picture: saveFrame(this.picture),
      pending: saveFrame(this.pending), state: this.state, pass: this.pass };
  }
  private restoreCheckpoint(value: unknown): void {
    const r = new SaveReader(value, "cin-playback");
    this.decoder.restoreCheckpoint(r.field("decoder").value);
    this.epoch = r.field("epoch").integer(0); this.pass = r.field("pass").integer(0);
    this.state = r.field("state").choice("playing", "held", "ended", "looped");
    this.picture = readFrame(r.field("picture"), this.decoder.width * this.decoder.height);
    this.pending = readFrame(r.field("pending"), this.decoder.width * this.decoder.height);
  }

  get dimensions(): { readonly width: number; readonly height: number } {
    return { width: this.decoder.width, height: this.decoder.height };
  }
  get currentFrame(): CinematicFrame | null { return this.presentation(); }

  private presentation(): CinematicFrame | null {
    const picture = this.picture;
    if (picture === null) return null;
    // Q2 updates its global palette while prefetching, before drawing the current indices.
    return { rgba: cinRgba(picture.pixels, this.decoder.palette), ...this.dimensions,
      index: picture.index, sourceTime: picture.time, time: this.epoch + picture.time, loop: this.pass };
  }

  private read(): CinFrame | null {
    const frame = this.decoder.next();
    if (frame.kind === "end") return null;
    if (frame.audio !== null && !this.options.silent) {
      const audio = frame.audio;
      const sourceTime = audio.sourceSample * 1000 / audio.sampleRate;
      this.options.onAudio({ ...audio, sourceTime, time: this.epoch + sourceTime, loop: this.pass, resetStream: audio.sourceSample === 0 });
    }
    return frame;
  }

  restart(clock: MediaClock): void {
    this.decoder.rewind();
    this.epoch = milliseconds(clock);
    this.pending = null;
    this.state = "playing";
    this.picture = this.read();
    if (this.picture === null) this.state = "ended";
  }

  run(clock: MediaClock, focus: "game" | "console" | "menu" = "game"): CinPlaybackTick {
    if (this.state === "ended" || this.state === "held") return { status: this.state, update: { kind: "unchanged" } };
    const time = milliseconds(clock);
    const decoded = this.decoder.nextFrameIndex;
    if (focus !== "game") {
      this.epoch = time - Math.trunc(decoded * 1000 / 14);
      return { status: this.state, update: { kind: "unchanged" } };
    }
    const frame = Math.trunc((time - this.epoch) * 14 / 1000);
    if (frame <= decoded) return { status: this.state, update: { kind: "unchanged" } };
    if (frame > decoded + 1) {
      this.options.developerPrint?.(`Dropped frame: ${frame} > ${decoded + 1}\n`);
      this.epoch = time - Math.trunc(decoded * 1000 / 14);
    }
    const previous = this.picture;
    this.picture = this.pending;
    this.pending = this.read();
    if (this.pending === null) {
      if (this.options.hold) { this.picture ??= previous; this.state = "held"; }
      else if (this.options.loop) { this.pass++; this.restart(clock); this.state = "looped"; }
      else { this.picture = null; this.state = "ended"; }
    } else this.state = "playing";
    return { status: this.state, update: { kind: "frame", frame: this.presentation() } };
  }

  close(): void { this.state = "ended"; this.decoder.close(); }
}
