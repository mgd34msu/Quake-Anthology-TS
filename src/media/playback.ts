import { CinPlayback } from "./cin-playback.ts";
import { RoqPlayback } from "./roq-playback.ts";
import { RoqDecoderScratch } from "./roq.ts";
import { RoqStream } from "./roq-stream.ts";
import { mediaBytes, type MediaInput } from "./source.ts";
import { UnsupportedMediaError, type CinematicEndReason, type CinematicFrame, type CinematicOptions,
  type CinematicStatus, type CinematicTick, type MediaClock } from "./types.ts";

export type CinematicSource = { readonly format: "roq" | "cin"; readonly source: string; readonly open: () => MediaInput }
  | { readonly format: "image"; readonly source: string; readonly width: number; readonly height: number; readonly rgba: Uint8Array }
  | { readonly format: "ogv"; readonly source: string };

/** The clock is local to one movie, so pausing a seat cannot pause another movie. */
class PlaybackClock implements MediaClock {
  private readonly start: number;
  private pausedAt: number | null = null;
  private pausedDuration = 0;
  constructor(private readonly wall: MediaClock) { this.start = this.readWall(); }
  private readWall(): number {
    const time = this.wall.sample();
    if (!Number.isFinite(time) || time < 0) throw new RangeError("Media clock must be finite and nonnegative");
    return time;
  }
  sample(): number { return Math.max(0, (this.pausedAt ?? this.readWall()) - this.start - this.pausedDuration); }
  pause(paused: boolean): void {
    if (paused && this.pausedAt === null) this.pausedAt = this.readWall();
    else if (!paused && this.pausedAt !== null) {
      this.pausedDuration += this.readWall() - this.pausedAt;
      this.pausedAt = null;
    }
  }
}

type Movie = { readonly kind: "roq"; readonly playback: RoqPlayback; readonly stream: RoqStream }
  | { readonly kind: "cin"; readonly playback: CinPlayback }
  | { readonly kind: "image"; readonly frame: CinematicFrame };

export function cinematicBytes(format: "roq" | "cin", bytes: Uint8Array, source = "<cinematic>"): CinematicSource {
  return { format, source, open: () => mediaBytes(bytes, source) };
}

export class CinematicPlayback {
  readonly target: CinematicOptions["target"];
  private readonly clock: PlaybackClock;
  private readonly movie: Movie;
  private state: CinematicStatus = "playing";
  private decoderStatus: CinematicStatus | "looped" = "playing";
  private picture: CinematicFrame | null = null;
  private dirty = false;
  private frameRevision = 0;
  private completed = false;
  private closed = false;

  constructor(source: CinematicSource, private readonly options: CinematicOptions) {
    this.target = options.target;
    this.clock = new PlaybackClock(options.clock);
    const onAudio = (audio: Parameters<CinematicOptions["onAudio"]>[0]): undefined => {
      options.onAudio(audio, this.target);
      return undefined;
    };
    const common = { clock: this.clock, source: source.source, loop: options.loop ?? false,
      hold: options.hold ?? false, silent: options.silent ?? false, onAudio,
      developerPrint: (text: string): undefined => { options.developerPrint?.(text); return undefined; } };
    switch (source.format) {
      case "ogv": throw new UnsupportedMediaError("ogv");
      case "roq": {
        const scratch = new RoqDecoderScratch();
        const stream = RoqStream.open(source.open, source.source, scratch.file);
        if (stream === undefined) throw new Error(`Empty cinematic: ${source.source}`);
        try {
          this.movie = { kind: "roq", stream,
            playback: new RoqPlayback(stream, { ...common, scratch, shader: options.target.kind === "material",
              beforeRawStreamReset: () => { options.onAudioReset(this.target); return undefined; } }) };
        } catch (error: unknown) { stream.close(); throw error; }
        break;
      }
      case "cin": {
        const input = source.open();
        try { this.movie = { kind: "cin", playback: new CinPlayback(input, common) }; }
        catch (error: unknown) { input.close(); throw error; }
        this.picture = this.movie.playback.currentFrame;
        this.dirty = true;
        break;
      }
      case "image": {
        if (!Number.isSafeInteger(source.width) || !Number.isSafeInteger(source.height) || source.width <= 0
          || source.height <= 0 || source.rgba.length !== source.width * source.height * 4) throw new RangeError("Invalid cinematic still image");
        const frame: CinematicFrame = { rgba: source.rgba.slice(), width: source.width, height: source.height,
          index: 0, sourceTime: 0, time: 0, loop: 0 };
        this.movie = { kind: "image", frame };
        this.picture = frame; this.dirty = true; this.state = "held";
        break;
      }
    }
  }

  get status(): CinematicStatus { return this.state; }
  get sourceStatus(): CinematicStatus | "looped" { return this.state === "playing" ? this.decoderStatus : this.state; }
  get revision(): number { return this.frameRevision; }
  get playbackTimeMilliseconds(): number { return this.clock.sample(); }
  get currentFrame(): CinematicFrame | null { return this.picture === null ? null : { ...this.picture, rgba: this.picture.rgba.slice() }; }

  tick(): CinematicTick {
    let changed = this.dirty;
    this.dirty = false;
    if (this.state === "playing" && this.movie.kind !== "image") {
      const tick = this.movie.playback.run(this.clock);
      this.decoderStatus = tick.status;
      if (tick.update.kind === "frame") { this.picture = tick.update.frame; this.frameRevision++; changed = true; }
      if (tick.status === "held") this.state = "held";
      else if (tick.status === "ended") { this.state = "ended"; this.finish("finished"); }
    }
    return { status: this.state, frame: this.currentFrame, changed };
  }

  pause(paused: boolean): void {
    if ((paused && this.state !== "playing") || (!paused && this.state !== "paused")) return;
    this.clock.pause(paused);
    this.state = paused ? "paused" : "playing";
    this.options.onAudioPause(paused, this.target);
  }

  skip(): void {
    if (this.completed) return;
    this.state = "ended";
    this.finish("skipped");
  }

  stop(): void {
    if (this.completed) return;
    this.state = "stopped";
    this.finish("stopped");
  }

  private finish(reason: CinematicEndReason): void {
    if (this.completed) return;
    this.completed = true;
    this.releaseInput();
    this.options.onAudioReset(this.target);
    this.options.onComplete(reason, this.target);
  }

  private releaseInput(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.movie.kind === "roq") this.movie.stream.close();
    else if (this.movie.kind === "cin") this.movie.playback.close();
  }

  close(): void { this.stop(); this.releaseInput(); }
}
