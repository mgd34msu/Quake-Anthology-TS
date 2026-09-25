import { SaveReader } from "../persistence/value.ts";
import type { SeatId } from "../contracts/identity.ts";

export interface MediaClock { sample(): number; }
export type CinematicTarget = { readonly kind: "seat"; readonly seat: SeatId }
  | { readonly kind: "material"; readonly id: string };
export interface CinematicFrame {
  readonly rgba: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly index: number;
  readonly loop: number;
  readonly sourceTime: number;
  readonly time: number;
}
export interface CinematicAudio {
  readonly samples: Int16Array | Uint8Array;
  readonly channels: 1 | 2;
  readonly sampleRate: number;
  readonly sourceSample: number;
  readonly sourceTime: number;
  readonly time: number;
  readonly loop: number;
  readonly resetStream: boolean;
}
export type CinematicStatus = "playing" | "paused" | "held" | "ended" | "stopped";
export interface CinematicTimeline {
  readonly source: string;
  readonly sourceTimeMilliseconds: number;
  readonly elapsedMilliseconds: number;
  readonly loop: number;
  readonly status: CinematicStatus;
}
export type CinematicEndReason = "finished" | "skipped" | "stopped";
export interface CinematicTick {
  readonly status: CinematicStatus;
  readonly frame: CinematicFrame | null;
  readonly changed: boolean;
}
export interface CinematicOptions {
  readonly clock: MediaClock;
  readonly target: CinematicTarget;
  readonly loop?: boolean;
  readonly hold?: boolean;
  readonly silent?: boolean;
  readonly onAudio: (audio: CinematicAudio, target: CinematicTarget) => void;
  readonly onAudioReset: (target: CinematicTarget) => void;
  readonly onAudioPause: (paused: boolean, target: CinematicTarget) => void;
  readonly onComplete: (reason: CinematicEndReason, target: CinematicTarget) => void;
  readonly developerPrint?: (message: string) => void;
}

export function copyCinematicFrame(frame: CinematicFrame | null): CinematicFrame | null {
  return frame === null ? null : { ...frame, rgba: frame.rgba.slice() };
}
export function readCinematicFrame(reader: SaveReader): CinematicFrame | null {
  return reader.nullable(value => {
    const width = value.field("width").integer(1), height = value.field("height").integer(1);
    const rgba = value.field("rgba").bytes().slice();
    if (width * height * 4 !== rgba.length) value.fail("frame dimensions differ from pixels");
    return { width, height, rgba, index: value.field("index").integer(0), loop: value.field("loop").integer(0),
      sourceTime: value.field("sourceTime").finite(), time: value.field("time").finite() };
  });
}
