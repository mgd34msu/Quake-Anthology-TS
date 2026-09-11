import { BinaryReader } from "../core/binary/index.ts";
import type { SeatId } from "../contracts/identity.ts";
import type { ImageResourceOperation, Rect, RenderCommand, RendererImage } from "../contracts/render.ts";
import { CinematicPlayback, type CinematicSource } from "./playback.ts";
import { RoqDecoder, RoqDecoderScratch } from "./roq.ts";
import { RoqStream } from "./roq-stream.ts";
import { readMedia } from "./source.ts";
import { UnsupportedMediaError, type CinematicFrame } from "./types.ts";

/** Reads movie metadata without retaining another decoder or output device. */
export function cinematicDimensions(source: CinematicSource): { readonly width: number; readonly height: number } {
  if (source.format === "ogv") throw new UnsupportedMediaError("ogv");
  if (source.format === "image") return { width: source.width, height: source.height };
  if (source.format === "cin") {
    const input = source.open();
    try {
      const reader = new BinaryReader(readMedia(input, 0, 8), source.source);
      const width = reader.i32(), height = reader.i32();
      if (width <= 0 || height <= 0 || width * height > 0x1000000) throw new RangeError("Invalid CIN dimensions");
      return { width, height };
    } finally { input.close(); }
  }
  const scratch = new RoqDecoderScratch();
  const stream = RoqStream.open(source.open, source.source, scratch.file);
  if (stream === undefined) throw new Error(`Empty cinematic: ${source.source}`);
  try {
    const decoder = new RoqDecoder(stream, source.source, { scratch, silent: true });
    for (;;) {
      const event = decoder.nextChunk();
      if (event.kind === "info") return { width: event.width, height: event.height };
      if (event.kind === "end") throw new Error(`Cinematic contains no video info: ${source.source}`);
    }
  } finally { stream.close(); }
}

export interface CinematicImageUpload {
  readonly operation: ImageResourceOperation;
  complete(): undefined;
}

/** Upload acknowledgments follow backend execution, including deferred material draws. */
export class CinematicImage {
  private uploaded = false;
  private uploadedRevision = -1;
  private closed = false;
  constructor(readonly image: RendererImage) {}

  prepare(frame: CinematicFrame, revision: number): CinematicImageUpload | null {
    if (this.closed) throw new Error("Cinematic image is closed");
    if (revision === this.uploadedRevision) return null;
    if (frame.width !== this.image.width || frame.height !== this.image.height) throw new RangeError("Cinematic image dimensions changed");
    const content = { width: frame.width, height: frame.height, pixels: frame.rgba.slice() };
    const operation: ImageResourceOperation = this.uploaded
      ? { kind: "update-image", image: this.image, level: 0, content }
      : { kind: "create-image", image: this.image, content: { kind: "rgba8", levels: [content], borderColor: { x: 0, y: 0, z: 0, w: 1 } }, sampling: { filter: "linear", wrap: "clamp" } };
    let completed = false;
    return { operation, complete: () => {
      if (completed) throw new Error("Cinematic upload completion was already used");
      if (this.closed) throw new Error("Cinematic upload completed after image release");
      completed = true; this.uploaded = true; this.uploadedRevision = revision;
      return undefined;
    } };
  }

  release(): ImageResourceOperation | null {
    if (this.closed) return null;
    this.closed = true;
    return this.uploaded ? { kind: "release-image", image: this.image } : null;
  }
}

export interface FullscreenCinematicDraw {
  readonly seat: SeatId;
  readonly viewport: Rect;
  readonly blank: boolean;
  readonly commands: readonly RenderCommand[];
  complete(): undefined;
}

/** One seat owns its focus and viewport; callers clear only this viewport for blank frames. */
export class FullscreenCinematic {
  readonly seat: SeatId;
  private readonly image: CinematicImage;
  private focusPaused = false;
  constructor(readonly playback: CinematicPlayback, image: RendererImage) {
    if (playback.target.kind !== "seat") throw new Error("Fullscreen cinematic requires a seat target");
    this.seat = playback.target.seat;
    this.image = new CinematicImage(image);
  }

  prepare(viewport: Rect, focus: "game" | "console" | "menu" = "game"): FullscreenCinematicDraw {
    if (focus !== "game" && this.playback.status === "playing") {
      this.focusPaused = true;
      this.playback.pause(true);
    } else if (focus === "game" && this.focusPaused) {
      this.focusPaused = false;
      this.playback.pause(false);
    }
    const tick = this.playback.tick();
    const visible = focus !== "menu" && tick.status !== "ended" && tick.status !== "stopped" && tick.frame !== null;
    const upload = visible && tick.frame !== null ? this.image.prepare(tick.frame, this.playback.revision) : null;
    const commands: RenderCommand[] = [];
    if (upload !== null) commands.push({ kind: "image-resource", operation: upload.operation });
    if (visible) commands.push({ kind: "set-color", color: { x: 1, y: 1, z: 1, w: 1 } },
      { kind: "stretch-pic", rect: viewport, uv: { s1: 0, t1: 0, s2: 1, t2: 1 }, image: this.image.image });
    return { seat: this.seat, viewport, blank: !visible, commands, complete: () => { upload?.complete(); return undefined; } };
  }

  close(): ImageResourceOperation | null { this.playback.close(); return this.image.release(); }
}

/** Q3's source SCR_AdjustFrom640 stretches within the selected seat's viewport. */
export function cinematicPixelRect(rect: Rect, viewport: Rect): Rect {
  const f = Math.fround;
  return { x: viewport.x + Math.trunc(f(f(rect.x) * f(viewport.width / 640))),
    y: viewport.y + Math.trunc(f(f(rect.y) * f(viewport.height / 480))),
    width: Math.trunc(f(f(rect.width) * f(viewport.width / 640))),
    height: Math.trunc(f(f(rect.height) * f(viewport.height / 480))) };
}
