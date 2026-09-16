// SPDX-License-Identifier: GPL-2.0-or-later
import { CString, dlopen, ptr, toArrayBuffer } from "bun:ffi";
import type { Pointer } from "bun:ffi";
import { endianness } from "node:os";
import { openNativeLibrary } from "./native-libraries.ts";

function loadSdl2() {
  const loaded = openNativeLibrary("sdl2", path => dlopen(path, {
    SDL_SetMainReady: { args: [], returns: "void" },
    SDL_InitSubSystem: { args: ["u32"], returns: "i32" },
    SDL_SetHint: { args: ["buffer", "buffer"], returns: "i32" },
    SDL_GetHint: { args: ["buffer"], returns: "ptr" },
    SDL_QuitSubSystem: { args: ["u32"], returns: "void" },
    SDL_GetError: { args: [], returns: "cstring" },
    SDL_GetNumAudioDevices: { args: ["i32"], returns: "i32" },
    SDL_GetAudioDeviceName: { args: ["i32", "i32"], returns: "cstring" },
    SDL_GetPerformanceCounter: { args: [], returns: "u64" },
    SDL_GetPerformanceFrequency: { args: [], returns: "u64" },
    SDL_OpenAudioDevice: { args: ["ptr", "i32", "buffer", "buffer", "i32"], returns: "u32" },
    SDL_QueueAudio: { args: ["u32", "buffer", "u32"], returns: "i32" },
    SDL_GetQueuedAudioSize: { args: ["u32"], returns: "u32" },
    SDL_PauseAudioDevice: { args: ["u32", "i32"], returns: "void" },
    SDL_ClearQueuedAudio: { args: ["u32"], returns: "void" },
    SDL_CloseAudioDevice: { args: ["u32"], returns: "void" },
  }));
  loaded.symbols.SDL_SetMainReady();
  return loaded;
}

function loadSdl3() {
  return openNativeLibrary("sdl3", path => dlopen(path, {
    SDL_SetMainReady: { args: [], returns: "void" },
    SDL_InitSubSystem: { args: ["u32"], returns: "bool" },
    SDL_SetHint: { args: ["buffer", "buffer"], returns: "bool" },
    SDL_GetHint: { args: ["buffer"], returns: "ptr" },
    SDL_QuitSubSystem: { args: ["u32"], returns: "void" },
    SDL_GetError: { args: [], returns: "cstring" },
    SDL_GetAudioPlaybackDevices: { args: ["buffer"], returns: "ptr" },
    SDL_GetAudioDeviceName: { args: ["u32"], returns: "cstring" },
    SDL_free: { args: ["ptr"], returns: "void" },
    SDL_GetAudioDeviceFormat: { args: ["u32", "buffer", "buffer"], returns: "bool" },
    SDL_GetAudioStreamDevice: { args: ["ptr"], returns: "u32" },
    SDL_GetAudioStreamFormat: { args: ["ptr", "buffer", "ptr"], returns: "bool" },
    SDL_OpenAudioDeviceStream: { args: ["u32", "buffer", "ptr", "ptr"], returns: "ptr" },
    SDL_GetAudioStreamQueued: { args: ["ptr"], returns: "i32" },
    SDL_PutAudioStreamData: { args: ["ptr", "buffer", "i32"], returns: "bool" },
    SDL_ClearAudioStream: { args: ["ptr"], returns: "bool" },
    SDL_PauseAudioStreamDevice: { args: ["ptr"], returns: "bool" },
    SDL_ResumeAudioStreamDevice: { args: ["ptr"], returns: "bool" },
    SDL_DestroyAudioStream: { args: ["ptr"], returns: "void" },
    SDL_GetPerformanceCounter: { args: [], returns: "u64" },
    SDL_GetPerformanceFrequency: { args: [], returns: "u64" },
  }));
}
const audioSubsystem = 0x10;
const littleEndian = endianness() === "LE";
const signed16Native = littleEndian ? 0x8010 : 0x9010;
const text = (value: string): Uint8Array => Buffer.from(`${value}\0`);
function requiredHint(name: string, value: string, set: (name: Uint8Array, value: Uint8Array) => boolean,
  get: (name: Uint8Array) => Pointer | null, error: () => string): void {
  const key = text(name);
  if (set(key, text(value))) return;
  const current = get(key);
  if (current === null || String(new CString(current)) !== value) throw new Error(`SDL_SetHint ${name}: ${error()}`);
}
export interface SdlAudioOptions {
  readonly sampleRate: number;
  readonly channels: 1 | 2;
  readonly sampleBits?: 8 | 16;
  readonly deviceName?: string | null;
  /** Advisory buffer duration in input frames; actual duration may be adjusted by the backend. */
  readonly bufferFrames?: number;
}
type OpenOptions = Required<SdlAudioOptions>;
interface AudioPort {
  readonly bufferFrames: number;
  queuedBytes(): number;
  put(samples: Int16Array | Uint8Array): void;
  clear(): void;
  pause(): void;
  resume(): void;
  close(): void;
}
interface AudioBackend {
  readonly library: object;
  initialize(): void;
  quit(): void;
  names(): readonly string[];
  open(options: OpenOptions): AudioPort;
  counter(): bigint;
  frequency(): bigint;
}
/** An unavailable native device leaves source SNDDMA_Init unstarted. */
export class SdlAudioUnavailableError extends Error {}

function sdl3Backend(library: ReturnType<typeof loadSdl3>): AudioBackend {
  const api = library.symbols;
  api.SDL_SetMainReady();
  const checked = (success: boolean, operation: string): void => { if (!success) throw new Error(`${operation}: ${api.SDL_GetError()}`); };
  const devices = (): readonly { readonly id: number; readonly name: string }[] => {
    const count = new Uint8Array(4), allocation = api.SDL_GetAudioPlaybackDevices(count);
    if (allocation === null) throw new SdlAudioUnavailableError(`SDL_GetAudioPlaybackDevices: ${api.SDL_GetError()}`);
    try {
      const length = new DataView(count.buffer).getInt32(0, littleEndian);
      if (length < 0 || length > 65536) throw new Error("Invalid SDL playback device count");
      const values = new DataView(toArrayBuffer(allocation, 0, (length + 1) * 4));
      return Array.from({ length }, (_, index) => {
        const id = values.getUint32(index * 4, littleEndian), name = String(api.SDL_GetAudioDeviceName(id));
        if (id === 0 || name.length === 0) throw new Error(`SDL_GetAudioDeviceName: ${api.SDL_GetError()}`);
        return { id, name };
      });
    } finally { api.SDL_free(allocation); }
  };
  return {
    library,
    initialize: () => {
      requiredHint("SDL_NO_SIGNAL_HANDLERS", "1", api.SDL_SetHint, api.SDL_GetHint, () => String(api.SDL_GetError()));
      if (process.env["SDL_AUDIO_DRIVER"] === undefined && process.env["SDL_AUDIODRIVER"] !== undefined)
        requiredHint("SDL_AUDIO_DRIVER", process.env["SDL_AUDIODRIVER"] ?? "", api.SDL_SetHint, api.SDL_GetHint, () => String(api.SDL_GetError()));
      if (!api.SDL_InitSubSystem(audioSubsystem)) throw new SdlAudioUnavailableError(`SDL_InitSubSystem AUDIO: ${api.SDL_GetError()}`);
    },
    quit: () => api.SDL_QuitSubSystem(audioSubsystem), names: () => devices().map(device => device.name),
    counter: () => api.SDL_GetPerformanceCounter(), frequency: () => api.SDL_GetPerformanceFrequency(),
    open: options => {
      const id = options.deviceName === null ? 0xffffffff : devices().find(device => device.name === options.deviceName)?.id;
      if (id === undefined) throw new SdlAudioUnavailableError(`Audio output is unavailable: ${options.deviceName}`);
      const spec = new Uint8Array(12), view = new DataView(spec.buffer), frames = new Uint8Array(4);
      checked(api.SDL_GetAudioDeviceFormat(id, spec, frames), "SDL_GetAudioDeviceFormat preferred");
      const preferredRate = view.getInt32(8, littleEndian);
      if (preferredRate <= 0) throw new Error("SDL returned an invalid preferred audio rate");
      // The hint is in hardware frames; the public request is in input frames.
      api.SDL_SetHint(text("SDL_AUDIO_DEVICE_SAMPLE_FRAMES"), text(String(Math.ceil(options.bufferFrames * preferredRate / options.sampleRate))));
      const format = options.sampleBits === 16 ? signed16Native : 0x0008;
      view.setInt32(0, format, littleEndian); view.setInt32(4, options.channels, littleEndian); view.setInt32(8, options.sampleRate, littleEndian);
      const stream = api.SDL_OpenAudioDeviceStream(id, spec, null, null);
      if (stream === null) throw new SdlAudioUnavailableError(`SDL_OpenAudioDeviceStream: ${api.SDL_GetError()}`);
      try {
        checked(api.SDL_GetAudioStreamFormat(stream, spec, null), "SDL_GetAudioStreamFormat");
        if (view.getInt32(0, littleEndian) !== format || view.getInt32(4, littleEndian) !== options.channels || view.getInt32(8, littleEndian) !== options.sampleRate)
          throw new Error("SDL changed the requested audio input format");
        checked(api.SDL_GetAudioDeviceFormat(api.SDL_GetAudioStreamDevice(stream), spec, frames), "SDL_GetAudioDeviceFormat opened");
        const hardwareRate = view.getInt32(8, littleEndian), hardwareFrames = new DataView(frames.buffer).getInt32(0, littleEndian);
        if (hardwareRate <= 0 || hardwareFrames <= 0) throw new Error("SDL returned an invalid audio buffer specification");
        return {
          bufferFrames: Math.ceil(hardwareFrames * options.sampleRate / hardwareRate),
          queuedBytes: () => { const count = api.SDL_GetAudioStreamQueued(stream); if (count < 0) throw new Error(`SDL_GetAudioStreamQueued: ${api.SDL_GetError()}`); return count; },
          put: samples => checked(api.SDL_PutAudioStreamData(stream, samples, samples.byteLength), "SDL_PutAudioStreamData"),
          clear: () => checked(api.SDL_ClearAudioStream(stream), "SDL_ClearAudioStream"),
          pause: () => checked(api.SDL_PauseAudioStreamDevice(stream), "SDL_PauseAudioStreamDevice"),
          resume: () => checked(api.SDL_ResumeAudioStreamDevice(stream), "SDL_ResumeAudioStreamDevice"),
          close: () => api.SDL_DestroyAudioStream(stream),
        };
      } catch (error) { api.SDL_DestroyAudioStream(stream); throw error; }
    },
  };
}
function sdl2Backend(library: ReturnType<typeof loadSdl2>): AudioBackend {
  const api = library.symbols;
  const checked = (result: number, operation: string): void => { if (result < 0) throw new Error(`${operation}: ${api.SDL_GetError()}`); };
  return {
    library,
    initialize: () => {
      requiredHint("SDL_NO_SIGNAL_HANDLERS", "1", (name, value) => api.SDL_SetHint(name, value) === 1, api.SDL_GetHint, () => String(api.SDL_GetError()));
      if (api.SDL_InitSubSystem(audioSubsystem) < 0) throw new SdlAudioUnavailableError(`SDL_InitSubSystem AUDIO: ${api.SDL_GetError()}`);
    },
    quit: () => api.SDL_QuitSubSystem(audioSubsystem),
    counter: () => api.SDL_GetPerformanceCounter(), frequency: () => api.SDL_GetPerformanceFrequency(),
    names: () => {
      const count = api.SDL_GetNumAudioDevices(0), names: string[] = [];
      for (let index = 0; index < count; index++) {
        const name = String(api.SDL_GetAudioDeviceName(index, 0));
        if (name.length === 0) throw new Error(`SDL_GetAudioDeviceName: ${api.SDL_GetError()}`);
        names.push(name);
      }
      return names;
    },
    open: options => {
      // SDL2's 64-bit AudioSpec differs from SDL3: freq0,format4,channels6,samples8.
      const desired = new Uint8Array(32), view = new DataView(desired.buffer), obtained = new Uint8Array(32), actual = new DataView(obtained.buffer);
      const format = options.sampleBits === 16 ? signed16Native : 0x0008;
      view.setInt32(0, options.sampleRate, littleEndian); view.setUint16(4, format, littleEndian);
      view.setUint8(6, options.channels);
      const requestedFrames = Math.min(32768, Math.max(64, 2 ** Math.ceil(Math.log2(options.bufferFrames))));
      view.setUint16(8, requestedFrames, littleEndian);
      if (options.deviceName !== null) api.SDL_GetNumAudioDevices(0);
      const name = options.deviceName === null ? null : text(options.deviceName);
      const device = api.SDL_OpenAudioDevice(name === null ? null : ptr(name), 0, desired, obtained, 0);
      if (device === 0) throw new SdlAudioUnavailableError(`SDL_OpenAudioDevice: ${api.SDL_GetError()}`);
      try {
        if (actual.getInt32(0, littleEndian) !== options.sampleRate || actual.getUint16(4, littleEndian) !== format || actual.getUint8(6) !== options.channels)
          throw new Error("SDL changed the requested audio format");
        const bufferFrames = actual.getUint16(8, littleEndian);
        if (bufferFrames === 0 || actual.getUint32(12, littleEndian) !== bufferFrames * options.channels * (options.sampleBits / 8)
          || actual.getUint8(7) !== (options.sampleBits === 16 ? 0 : 128)) throw new Error("SDL returned an invalid audio buffer specification");
        return {
          bufferFrames, queuedBytes: () => api.SDL_GetQueuedAudioSize(device),
          put: samples => checked(api.SDL_QueueAudio(device, samples, samples.byteLength), "SDL_QueueAudio"),
          clear: () => api.SDL_ClearQueuedAudio(device), pause: () => api.SDL_PauseAudioDevice(device, 1),
          resume: () => api.SDL_PauseAudioDevice(device, 0), close: () => api.SDL_CloseAudioDevice(device),
        };
      } catch (error) { api.SDL_CloseAudioDevice(device); throw error; }
    },
  };
}
let backend: AudioBackend | undefined;
function audio(): AudioBackend {
  if (backend !== undefined) return backend;
  let library: ReturnType<typeof loadSdl3>;
  try { library = loadSdl3(); }
  catch (error) {
    // Explicit SDL3 overrides remain authoritative. Device failures never select another backend.
    if (process.env["QUAKE_SDL3_LIBRARY"] !== undefined) throw error;
    backend = sdl2Backend(loadSdl2()); return backend;
  }
  backend = sdl3Backend(library); return backend;
}

export class SdlAudioDevice {
  private device: AudioPort | null;
  private readonly clockFrequency: bigint;
  private elapsedTicks = 0n;
  private playingSince: bigint | null = null;
  readonly maxQueuedFrames: number;
  private constructor(device: AudioPort, readonly sampleRate: number, readonly channels: 1 | 2,
    readonly sampleBits: 8 | 16, readonly deviceName: string | null, readonly bufferFrames: number) {
    this.device = device; this.clockFrequency = audio().frequency();
    if (this.clockFrequency <= 0n) throw new Error("SDL returned an invalid performance counter frequency");
    this.maxQueuedFrames = sampleRate * 2;
  }
  static outputDeviceNames(): readonly string[] {
    const api = audio(); api.initialize();
    try { return api.names(); } finally { api.quit(); }
  }
  static open(options: SdlAudioOptions): SdlAudioDevice {
    const { sampleRate, channels } = options, sampleBits = options.sampleBits ?? 16, deviceName = options.deviceName ?? null, bufferFrames = options.bufferFrames ?? 1024;
    if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error("Audio sample rate must be an integer in 8000..192000 Hz");
    if (channels !== 1 && channels !== 2) throw new Error("Audio channels must be mono or stereo");
    if (sampleBits !== 8 && sampleBits !== 16) throw new Error("Audio sample bits must be 8 or 16");
    if (deviceName !== null && (deviceName.length === 0 || deviceName.includes("\0"))) throw new Error("Audio device name must be nonempty and contain no NUL");
    if (!Number.isSafeInteger(bufferFrames) || bufferFrames < 1 || bufferFrames > 32768) throw new Error("Audio buffer frames must be an integer in 1..32768");
    const api = audio(); api.initialize(); let port: AudioPort | null = null;
    try {
      port = api.open({ sampleRate, channels, sampleBits, deviceName, bufferFrames });
      // Both adapters must expose exact input-byte counts while paused, including resampling tails.
      const probe = sampleBits === 16 ? new Int16Array(channels * 8) : new Uint8Array(channels * 8).fill(128);
      port.put(probe); const queuedBytes = port.queuedBytes(); port.clear();
      if (queuedBytes !== probe.byteLength || port.queuedBytes() !== 0)
        throw new SdlAudioUnavailableError("SDL audio driver cannot report exact queued input frames at this sample rate");
      return new SdlAudioDevice(port, sampleRate, channels, sampleBits, deviceName, port.bufferFrames);
    } catch (error) { port?.close(); api.quit(); throw error; }
  }
  private opened(): AudioPort { if (this.device === null) throw new Error("SDL audio device is closed"); return this.device; }
  get queuedFrames(): number {
    const bytes = this.opened().queuedBytes(), frameBytes = this.channels * (this.sampleBits / 8);
    if (bytes % frameBytes !== 0) throw new Error("SDL queued audio size is not frame aligned");
    return bytes / frameBytes;
  }
  /** Logical playing time, including empty-queue silence; not a speaker-position measurement. */
  get playbackFrames(): number {
    this.opened(); const frames = this.playingTicks() * BigInt(this.sampleRate) / this.clockFrequency;
    if (frames > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("SDL playback clock exceeds safe frame positions");
    return Number(frames);
  }
  private playingTicks(): bigint {
    if (this.playingSince === null) return this.elapsedTicks;
    const now = audio().counter();
    if (now < this.playingSince) throw new Error("SDL performance counter moved backward");
    return this.elapsedTicks + now - this.playingSince;
  }
  queue(samples: Int16Array | Uint8Array): void {
    const device = this.opened();
    if ((this.sampleBits === 16 && !(samples instanceof Int16Array)) || (this.sampleBits === 8 && !(samples instanceof Uint8Array)))
      throw new Error("Audio samples do not match the device format");
    if (samples.length % this.channels !== 0) throw new Error("Audio sample count is not channel aligned");
    const frames = samples.length / this.channels;
    if (this.queuedFrames + frames > this.maxQueuedFrames) throw new Error("SDL audio queue exceeds the two-second limit");
    if (frames !== 0) device.put(samples);
  }
  clear(): void { this.opened().clear(); }
  pause(): void {
    const device = this.opened(); if (this.playingSince === null) return;
    device.pause(); this.elapsedTicks = this.playingTicks(); this.playingSince = null;
  }
  resume(): void {
    const device = this.opened(); if (this.playingSince !== null) return;
    const now = audio().counter(); device.resume(); this.playingSince = now;
  }
  start(): void { this.resume(); }
  get state(): "paused" | "playing" | "closed" { return this.device === null ? "closed" : this.playingSince === null ? "paused" : "playing"; }
  [Symbol.dispose](): void { this.close(); }
  close(): void { const device = this.device; if (device === null) return; this.device = null; try { device.close(); } finally { audio().quit(); } }
}
