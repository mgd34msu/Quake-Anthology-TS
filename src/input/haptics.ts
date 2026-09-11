// BNVIB format and motor downmix ported from quake-2-re-ts qcommon/bnvib.ts
// and platform/haptics.ts. Scheduling and device ownership are per seat.
// GPL-2.0-or-later.
import type { SeatId } from "../contracts/identity.ts";
import { BinaryReader } from "../core/binary/index.ts";
import type { ControllerOperationResult, SdlControllers } from "../platform/controller.ts";

export interface BnvibSample { readonly ampLow: number; readonly freqLow: number; readonly ampHigh: number; readonly freqHigh: number; }
export interface BnvibPattern {
  readonly sampleRateHz: number;
  readonly samples: readonly BnvibSample[];
  readonly loop: { readonly startSample: number; readonly endSample: number; readonly intervalSamples: number } | null;
}
export function parseBnvib(bytes: Uint8Array): BnvibPattern {
  const reader = new BinaryReader(bytes, "BNVIB"), size = reader.u32();
  if (size !== 4 && size !== 12 && size !== 16) throw new Error(`Unsupported BNVIB metadata size ${size}`);
  if (reader.u16() !== 3) throw new Error("Unsupported BNVIB format");
  const sampleRateHz = reader.u16();
  if (sampleRateHz === 0) throw new Error("BNVIB sample rate must be positive");
  const loop = size === 4 ? null : { startSample: reader.u32(), endSample: reader.u32(), intervalSamples: size === 16 ? reader.u32() : 0 };
  const dataSize = reader.u32();
  if (dataSize % 4 !== 0) throw new Error("BNVIB data size is not a multiple of four");
  const samples: BnvibSample[] = [];
  for (let index = 0; index < dataSize / 4; index++) samples.push({ ampLow: reader.u8(), freqLow: reader.u8(), ampHigh: reader.u8(), freqHigh: reader.u8() });
  if (loop !== null && (loop.startSample >= loop.endSample || loop.endSample > samples.length)) throw new Error("BNVIB loop exceeds sample data");
  return { sampleRateHz, samples, loop };
}
export function bnvibFrequency(byte: number): number { return 10 * 2 ** (byte / 32); }
export function tactilePathForSound(sound: string): string | null {
  const path = sound.startsWith("#") ? sound.slice(1) : sound;
  if (!path.endsWith(".wav") || path.length <= 4) return null;
  return `tactile/${path.slice(0, -4)}.bnvib`;
}
export interface RumbleSink { setMotors(low: number, high: number, durationMilliseconds: number): ControllerOperationResult; }
export type HapticsResult = ControllerOperationResult | { readonly kind: "unchanged" };
export class BnvibScheduler {
  private playing: { readonly pattern: BnvibPattern; readonly started: number } | null = null;
  private lastIndex = -1;
  private lastOutput = -Infinity;
  constructor(private readonly sink: RumbleSink) {}
  get active(): boolean { return this.playing !== null; }
  play(pattern: BnvibPattern, nowMilliseconds: number): HapticsResult {
    this.playing = { pattern, started: nowMilliseconds }; this.lastIndex = -1;
    return this.update(nowMilliseconds);
  }
  stop(): ControllerOperationResult {
    this.playing = null; this.lastIndex = -1;
    return this.sink.setMotors(0, 0, 0);
  }
  update(nowMilliseconds: number): HapticsResult {
    const playing = this.playing;
    if (playing === null) return { kind: "unchanged" };
    const { pattern, started } = playing, period = 1000 / pattern.sampleRateHz;
    let index = Math.max(0, Math.floor((nowMilliseconds - started) / period));
    if (index >= pattern.samples.length) {
      const loop = pattern.loop;
      if (loop === null) return this.stop();
      const loopLength = loop.endSample - loop.startSample, position = (index - pattern.samples.length) % (loopLength + loop.intervalSamples);
      index = position >= loopLength ? -2 : loop.startSample + position;
    }
    const hold = Math.max(50, Math.ceil(period) + 20);
    if (index === this.lastIndex && nowMilliseconds - this.lastOutput < hold / 2) return { kind: "unchanged" };
    this.lastIndex = index; this.lastOutput = nowMilliseconds;
    if (index === -2) return this.sink.setMotors(0, 0, hold);
    const sample = pattern.samples[index];
    if (sample === undefined) return this.stop();
    return this.sink.setMotors(sample.ampLow / 255, sample.ampHigh / 255, hold);
  }
}
export interface SeatHapticsOptions {
  readonly seat: SeatId;
  readonly controllers: SdlControllers;
  readonly controller: (seat: SeatId) => number | null;
  readonly load: (path: string) => Promise<Uint8Array | null>;
  readonly now: () => number;
}
export class SeatHaptics {
  readonly scheduler: BnvibScheduler;
  private readonly cache = new Map<string, Promise<BnvibPattern | null>>();
  private sequence = 0;
  private lastDevice: number | null = null;
  private enabled = true;
  constructor(private readonly options: SeatHapticsOptions) {
    this.scheduler = new BnvibScheduler({ setMotors: (low, high, duration) => {
      const instance = options.controller(options.seat);
      if (this.lastDevice !== null && this.lastDevice !== instance) options.controllers.rumble(this.lastDevice, 0, 0, 0);
      this.lastDevice = instance;
      return instance === null ? { kind: "disconnected", reason: "Seat has no assigned controller" }
        : options.controllers.rumble(instance, low, high, duration);
    } });
  }
  setEnabled(enabled: boolean): HapticsResult {
    this.enabled = enabled;
    if (!enabled) { this.sequence++; return this.scheduler.stop(); }
    return { kind: "unchanged" };
  }
  async sound(sound: string): Promise<HapticsResult | null> {
    if (!this.enabled) return null;
    const path = tactilePathForSound(sound);
    if (path === null) return null;
    const sequence = ++this.sequence;
    let pending = this.cache.get(path);
    if (pending === undefined) {
      pending = this.options.load(path).then(bytes => bytes === null ? null : parseBnvib(bytes));
      this.cache.set(path, pending);
    }
    const pattern = await pending;
    if (pattern === null || sequence !== this.sequence || !this.enabled) return null;
    return this.scheduler.play(pattern, this.options.now());
  }
  update(): HapticsResult { return this.scheduler.update(this.options.now()); }
  invalidateAssets(): void { this.cache.clear(); }
  close(): ControllerOperationResult { this.enabled = false; this.sequence++; this.cache.clear(); return this.scheduler.stop(); }
}
