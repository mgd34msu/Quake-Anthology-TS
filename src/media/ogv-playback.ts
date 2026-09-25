import { SaveReader } from "../persistence/value.ts";
import { copyCinematicFrame, readCinematicFrame } from "./types.ts";
import { VorbisPcmStream } from "../audio/streams.ts";
import { TheoraDecoder } from "../platform/theora.ts";
import { decodeOggMovie, type OggMovie } from "./ogg.ts";
import type { CinematicAudio, CinematicFrame, MediaClock } from "./types.ts";
export interface OgvPlaybackOptions {
  readonly clock: MediaClock;
  readonly loop: boolean;
  readonly hold: boolean;
  readonly silent: boolean;
  readonly onAudio: (audio: CinematicAudio) => void;
}
export class OgvPlayback {
  private readonly movie: OggMovie;
  private decoder: TheoraDecoder;
  private audio: VorbisPcmStream | null = null;
  private epoch: number;
  private pass = 0;
  private nextIndex = 0;
  private picture: CinematicFrame | null = null;
  private state: "playing" | "held" | "ended" = "playing";
  private closed = false;
  private resetAudio = true;
  private closedAudioPosition: number | null = null;
  constructor(bytes: Uint8Array, private readonly options: OgvPlaybackOptions, checkpoint?: unknown) {
    this.movie = decodeOggMovie(bytes);
    this.decoder = new TheoraDecoder(this.movie.video.slice(0, 3));
    try {
      this.audio = this.movie.audio === null || options.silent ? null : VorbisPcmStream.fromBytes(this.movie.audio);
      this.epoch = options.clock.sample();
      if (checkpoint === undefined) { this.decodeFrame(); this.queueAudio(0); }
      else this.restoreCheckpoint(checkpoint);
    } catch (error) { try { this.audio?.close(); } finally { this.decoder.close(); } throw error; }
  }
  captureCheckpoint() {
    return { epoch: this.epoch, pass: this.pass, nextIndex: this.nextIndex, picture: copyCinematicFrame(this.picture),
      state: this.state, closed: this.closed, resetAudio: this.resetAudio, audioPosition: this.closed ? this.closedAudioPosition : this.audio?.positionFrames ?? null };
  }
  private restoreCheckpoint(value: unknown): void {
    const r = new SaveReader(value, "ogv-playback");
    this.epoch = r.field("epoch").finite(); this.pass = r.field("pass").integer(0);
    const nextIndex = r.field("nextIndex").integer(0), picture = readCinematicFrame(r.field("picture"));
    if (nextIndex > this.movie.video.length - 3) r.fail("video packet cursor exceeds movie");
    // Opaque native state is reconstructed from the exact packet prefix, without output callbacks.
    while (this.nextIndex < nextIndex) this.decodeFrame();
    const actual = this.picture;
    if ((picture === null) !== (actual === null) || picture !== null && actual !== null
      && (picture.index !== actual.index || picture.width !== actual.width || picture.height !== actual.height
        || picture.rgba.length !== actual.rgba.length || picture.rgba.some((byte, index) => byte !== actual.rgba[index]))) {
      r.fail("reconstructed Theora frame differs from checkpoint");
    }
    const audioPosition = r.field("audioPosition").nullable(a => a.integer(0));
    if ((audioPosition === null) !== (this.audio === null)) r.fail("Vorbis stream ownership differs");
    if (this.audio !== null && audioPosition !== null) {
      if (audioPosition > this.audio.frameCount) r.fail("Vorbis sample cursor exceeds movie");
      while (this.audio.positionFrames < audioPosition) {
        if (this.audio.read(Math.min(4096, audioPosition - this.audio.positionFrames)) === null) r.fail("Vorbis prefix ended early");
      }
    }
    this.picture = picture; this.state = r.field("state").choice("playing", "held", "ended");
    this.resetAudio = r.field("resetAudio").boolean();
    if (r.field("closed").boolean()) this.close();
  }

  get dimensions(): { width: number; height: number } { return { width: this.decoder.width, height: this.decoder.height }; }
  get currentFrame(): CinematicFrame | null { return this.picture; }
  private decodeFrame(): void {
    const packet = this.movie.video[this.nextIndex + 3];
    if (packet === undefined) throw new Error("Missing Theora frame packet");
    const image = this.decoder.decode(packet), sourceTime = this.nextIndex * this.decoder.frameMilliseconds;
    this.picture = { ...image, index: this.nextIndex++, loop: this.pass, sourceTime, time: this.epoch + sourceTime };
  }
  private queueAudio(elapsed: number): void {
    const audio = this.audio;
    if (audio === null) return;
    const wanted = Math.min(audio.frameCount, Math.ceil((elapsed + 200) * audio.sampleRate / 1000));
    while (audio.positionFrames < wanted) {
      const sourceSample = audio.positionFrames, chunk = audio.read(Math.min(4096, wanted - sourceSample));
      if (chunk === null) break;
      const sourceTime = sourceSample * 1000 / chunk.sampleRate;
      this.options.onAudio({ ...chunk, sourceSample, sourceTime, time: this.epoch + sourceTime, loop: this.pass, resetStream: this.resetAudio });
      this.resetAudio = false;
    }
  }
  run(clock: MediaClock): { status: "playing" | "looped" | "held" | "ended"; update: { kind: "unchanged" } | { kind: "frame"; frame: CinematicFrame | null } } {
    if (this.closed || this.state !== "playing") return { status: this.state, update: { kind: "unchanged" } };
    const now = clock.sample();
    if (!Number.isFinite(now) || now < this.epoch) throw new RangeError("OGV clock must be finite and monotonic");
    const count = this.movie.video.length - 3, duration = count * this.decoder.frameMilliseconds;
    let elapsed = now - this.epoch, looped = false;
    if (elapsed >= duration) {
      if (this.options.hold) {
        while (this.nextIndex < count) this.decodeFrame();
        this.state = "held";
        return { status: "held", update: { kind: "frame", frame: this.picture } };
      }
      if (!this.options.loop) { this.state = "ended"; return { status: "ended", update: { kind: "unchanged" } }; }
      const passes = Math.floor(elapsed / duration);
      const next = new TheoraDecoder(this.movie.video.slice(0, 3));
      this.decoder.close(); this.decoder = next; this.audio?.seek(0);
      this.pass += passes; this.epoch += passes * duration; elapsed = now - this.epoch; this.nextIndex = 0; this.resetAudio = true; looped = true;
    }
    const target = Math.min(count - 1, Math.floor(elapsed / this.decoder.frameMilliseconds));
    let changed = false;
    while (this.nextIndex <= target) { this.decodeFrame(); changed = true; }
    this.queueAudio(elapsed);
    return { status: looped ? "looped" : "playing", update: changed ? { kind: "frame", frame: this.picture } : { kind: "unchanged" } };
  }
  close(): void {
    if (this.closed) return;
    this.closedAudioPosition = this.audio?.positionFrames ?? null;
    this.closed = true; this.state = "ended";
    try { this.audio?.close(); } finally { this.decoder.close(); }
  }
}
