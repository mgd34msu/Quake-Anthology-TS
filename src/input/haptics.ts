// BNVIB format and motor downmix ported from quake-2-re-ts qcommon/bnvib.ts
// and platform/haptics.ts. Scheduling and device ownership are per seat.
// GPL-2.0-or-later.
import type { ContentId, ResourceRequest } from "../contracts/content.ts";
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
  readonly controllers: Pick<SdlControllers, "rumble">;
  readonly controller: (seat: SeatId) => number | null;
  readonly load: (request: ResourceRequest) => Promise<Uint8Array | null>;
  readonly now: () => number;
}
export class SeatHaptics {
  readonly scheduler: BnvibScheduler;
  private readonly cache = new Map<string, Promise<BnvibPattern | null>>();
  private generation = 0;
  private requested = 0;
  private accepted = 0;
  private device: number | null;
  private active = true;
  private preference = true;
  private closed = false;
  get enabled(): boolean { return this.preference; }
  constructor(private readonly options: SeatHapticsOptions) {
    this.device = null;
    this.scheduler = new BnvibScheduler({ setMotors: (low, high, duration) => this.device === null
      ? { kind: "disconnected", reason: "Seat has no assigned controller" }
      : options.controllers.rumble(this.device, low, high, duration) });
  }
  setEnabled(enabled: boolean): HapticsResult {
    this.preference = enabled;
    return enabled ? { kind: "unchanged" } : this.cancel();
  }
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (!active) this.cancel();
  }
  private synchronizeDevice(): void {
    const device = this.options.controller(this.options.seat);
    if (device === this.device) return;
    this.cancel();
    this.device = device;
  }
  cancel(): ControllerOperationResult {
    this.generation++;
    return this.scheduler.stop();
  }
  async sound(content: ContentId, sound: string): Promise<HapticsResult | null> {
    if (this.closed) return null;
    this.synchronizeDevice();
    if (!this.preference || !this.active || this.device === null) return null;
    const path = tactilePathForSound(sound.startsWith("sound/") ? sound.slice(6) : sound);
    if (path === null) return null;
    const generation = this.generation, requested = ++this.requested, key = `${content}/${path}`;
    let pending = this.cache.get(key);
    if (pending === undefined) {
      pending = this.options.load({ content, path }).then(bytes => bytes === null ? null : parseBnvib(bytes));
      this.cache.set(key, pending);
    }
    const pattern = await pending;
    if (this.closed || generation !== this.generation) return null;
    this.synchronizeDevice();
    if (pattern === null || generation !== this.generation || requested < this.accepted || this.closed || !this.preference || !this.active) return null;
    this.accepted = requested;
    return this.scheduler.play(pattern, this.options.now());
  }
  update(): HapticsResult {
    if (this.closed) return { kind: "unchanged" };
    this.synchronizeDevice();
    return this.scheduler.update(this.options.now());
  }
  invalidateAssets(): void { this.cancel(); this.cache.clear(); }
  close(): ControllerOperationResult {
    this.closed = true; this.cache.clear();
    return this.cancel();
  }
}
