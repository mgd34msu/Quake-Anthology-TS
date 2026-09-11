// SPDX-License-Identifier: GPL-2.0-or-later
// Q1/Q2 gamepad_assign.ts supplies explicit-before-automatic assignment intent.
// SDL2 SDL_events.h, SDL_gamecontroller.h and SDL_joystick.h define the device ABI.
import { CString, JSCallback, dlopen, ptr } from "bun:ffi";
import type { Pointer } from "bun:ffi";
import { endianness } from "node:os";
import { isMainThread } from "node:worker_threads";
import { openNativeLibrary } from "./native-libraries.ts";

function loadControllers() {
  return openNativeLibrary("sdl2", path => dlopen(path, {
    SDL_SetMainReady: { args: [], returns: "void" },
    SDL_SetHint: { args: ["buffer", "buffer"], returns: "i32" },
    SDL_InitSubSystem: { args: ["u32"], returns: "i32" },
    SDL_QuitSubSystem: { args: ["u32"], returns: "void" },
    SDL_GetError: { args: [], returns: "cstring" },
    SDL_GetVersion: { args: ["buffer"], returns: "void" },
    SDL_GetRevision: { args: [], returns: "cstring" },
    SDL_GetTicks: { args: [], returns: "u32" },
    SDL_NumJoysticks: { args: [], returns: "i32" },
    SDL_JoystickGetDeviceInstanceID: { args: ["i32"], returns: "i32" },
    SDL_JoystickInstanceID: { args: ["ptr"], returns: "i32" },
    SDL_JoystickIsVirtual: { args: ["i32"], returns: "i32" },
    SDL_IsGameController: { args: ["i32"], returns: "i32" },
    SDL_GameControllerOpen: { args: ["i32"], returns: "ptr" },
    SDL_GameControllerClose: { args: ["ptr"], returns: "void" },
    SDL_GameControllerGetJoystick: { args: ["ptr"], returns: "ptr" },
    SDL_GameControllerGetAttached: { args: ["ptr"], returns: "i32" },
    SDL_GameControllerName: { args: ["ptr"], returns: "ptr" },
    SDL_GameControllerGetSerial: { args: ["ptr"], returns: "ptr" },
    SDL_GameControllerMapping: { args: ["ptr"], returns: "ptr" },
    SDL_GameControllerAddMapping: { args: ["buffer"], returns: "i32" },
    SDL_free: { args: ["ptr"], returns: "void" },
    SDL_GameControllerUpdate: { args: [], returns: "void" },
    SDL_GameControllerEventState: { args: ["i32"], returns: "i32" },
    SDL_GameControllerHasAxis: { args: ["ptr", "i32"], returns: "i32" },
    SDL_GameControllerHasButton: { args: ["ptr", "i32"], returns: "i32" },
    SDL_GameControllerGetAxis: { args: ["ptr", "i32"], returns: "i16" },
    SDL_GameControllerGetButton: { args: ["ptr", "i32"], returns: "u8" },
    SDL_GameControllerHasRumble: { args: ["ptr"], returns: "i32" },
    SDL_GameControllerHasRumbleTriggers: { args: ["ptr"], returns: "i32" },
    SDL_GameControllerHasLED: { args: ["ptr"], returns: "i32" },
    SDL_GameControllerRumble: { args: ["ptr", "u16", "u16", "u32"], returns: "i32" },
    SDL_GameControllerRumbleTriggers: { args: ["ptr", "u16", "u16", "u32"], returns: "i32" },
    SDL_GameControllerSetLED: { args: ["ptr", "u8", "u8", "u8"], returns: "i32" },
    SDL_GameControllerGetNumTouchpads: { args: ["ptr"], returns: "i32" },
    SDL_GameControllerHasSensor: { args: ["ptr", "i32"], returns: "i32" },
    SDL_GameControllerSetSensorEnabled: { args: ["ptr", "i32", "i32"], returns: "i32" },
    SDL_GameControllerIsSensorEnabled: { args: ["ptr", "i32"], returns: "i32" },
    SDL_GameControllerGetSensorDataRate: { args: ["ptr", "i32"], returns: "f32" },
    SDL_GameControllerGetSensorData: { args: ["ptr", "i32", "buffer", "i32"], returns: "i32" },
    SDL_PeepEvents: { args: ["buffer", "i32", "i32", "u32", "u32"], returns: "i32" },
  }));
}

let library: ReturnType<typeof loadControllers> | undefined;
function sdl() { library ??= loadControllers(); return library.symbols; }
const subsystem = 0x2000;
const littleEndian = endianness() === "LE";
const axisCount = 6, buttonCount = 21;

function mainThread(): void {
  if (!isMainThread) throw new Error("SDL controllers must be owned by the main thread");
}
function checked(value: number, operation: string): number {
  if (value < 0) throw new Error(`${operation}: ${sdl().SDL_GetError()}`);
  return value;
}
function required(value: Pointer | null, operation: string): Pointer {
  if (value === null) throw new Error(`${operation}: ${sdl().SDL_GetError()}`);
  return value;
}
function cString(value: string): Buffer {
  if (value.includes("\0")) throw new Error("SDL controller text contains NUL");
  return Buffer.from(`${value}\0`);
}
function nativeString(pointer: Pointer | null): string | null {
  return pointer === null ? null : String(new CString(pointer));
}
function integer(value: number, minimum: number, maximum: number, name: string): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new RangeError(`${name} must be an integer in ${minimum}..${maximum}`);
}
function amplitude(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError("Rumble amplitude must be finite and in 0..1");
  return Math.round(value * 65535);
}
function initialize(): void {
  mainThread();
  const api = sdl();
  api.SDL_SetMainReady();
  if (api.SDL_SetHint(cString("SDL_NO_SIGNAL_HANDLERS"), cString("1")) !== 1)
    throw new Error("SDL must leave signal handling to the Unix signal owner");
  checked(api.SDL_InitSubSystem(subsystem), "SDL_InitSubSystem controller");
}

export type ControllerSensor = "accelerometer" | "gyro" | "accelerometer-left" | "gyro-left" | "accelerometer-right" | "gyro-right";
const sensors: Readonly<Record<ControllerSensor, number>> = {
  accelerometer: 1, gyro: 2, "accelerometer-left": 3, "gyro-left": 4, "accelerometer-right": 5, "gyro-right": 6,
};
const sensorNames: readonly ControllerSensor[] = ["accelerometer", "gyro", "accelerometer-left", "gyro-left", "accelerometer-right", "gyro-right"];
export interface ControllerCapabilities {
  readonly axes: readonly boolean[];
  readonly buttons: readonly boolean[];
  readonly rumble: boolean;
  readonly triggerRumble: boolean;
  readonly led: boolean;
  readonly touchpads: number;
  readonly sensors: readonly { readonly kind: ControllerSensor; readonly enabled: boolean; readonly rateHz: number }[];
}
export interface ControllerDevice {
  readonly instance: number;
  readonly name: string;
  readonly guid: string | null;
  readonly serial: string | null;
  /** Stable while this provider is open, even when an earlier identical pad disconnects. */
  readonly ordinal: number;
  readonly virtual: boolean;
  readonly capabilities: ControllerCapabilities;
}
export interface ControllerState {
  readonly axes: readonly number[];
  readonly buttons: readonly boolean[];
}
export type ControllerSelection =
  | { readonly kind: "automatic" }
  | { readonly kind: "none" }
  | { readonly kind: "device"; readonly guid: string; readonly ordinal: number }
  | { readonly kind: "serial"; readonly guid: string; readonly serial: string };
export type ControllerOperationResult =
  | { readonly kind: "accepted" }
  | { readonly kind: "unsupported" | "disconnected" | "failed"; readonly reason: string };
interface DeviceEvent { readonly timestamp: number; readonly instance: number; readonly slot: number | null }
export type ControllerEvent =
  | { readonly kind: "connected" | "remapped"; readonly timestamp: number; readonly device: ControllerDevice }
  | { readonly kind: "assignment"; readonly timestamp: number; readonly slot: number; readonly previous: number | null; readonly instance: number | null }
  | (DeviceEvent & { readonly kind: "disconnected" })
  | (DeviceEvent & { readonly kind: "axis"; readonly axis: number; readonly value: number })
  | (DeviceEvent & { readonly kind: "button"; readonly button: number; readonly down: boolean })
  | (DeviceEvent & { readonly kind: "touchpad"; readonly phase: "down" | "motion" | "up"; readonly touchpad: number; readonly finger: number; readonly x: number; readonly y: number; readonly pressure: number })
  | (DeviceEvent & { readonly kind: "sensor"; readonly sensor: ControllerSensor; readonly x: number; readonly y: number; readonly z: number; readonly timestampUs: bigint })
  | (DeviceEvent & { readonly kind: "unrecognized"; readonly type: number; readonly bytes: Uint8Array });
interface OwnedController {
  readonly pointer: Pointer;
  readonly instance: number;
  readonly ordinal: number;
  readonly virtual: boolean;
  readonly axes: number[];
  readonly buttons: boolean[];
  guid: string | null;
  name: string;
  serial: string | null;
}

function identity(pointer: Pointer): { readonly guid: string | null; readonly name: string; readonly serial: string | null } {
  const api = sdl(), mapping = api.SDL_GameControllerMapping(pointer);
  let guid: string | null = null;
  try {
    const text = nativeString(mapping), head = text?.split(",", 1)[0];
    if (head !== undefined && /^[0-9a-f]{32}$/i.test(head)) guid = head.toLowerCase();
  } finally { if (mapping !== null) api.SDL_free(mapping); }
  return { guid, name: nativeString(api.SDL_GameControllerName(pointer)) ?? "Unnamed SDL controller", serial: nativeString(api.SDL_GameControllerGetSerial(pointer)) };
}
function capabilities(pointer: Pointer): ControllerCapabilities {
  const api = sdl();
  return {
    axes: Array.from({ length: axisCount }, (_, axis) => api.SDL_GameControllerHasAxis(pointer, axis) !== 0),
    buttons: Array.from({ length: buttonCount }, (_, button) => api.SDL_GameControllerHasButton(pointer, button) !== 0),
    rumble: api.SDL_GameControllerHasRumble(pointer) !== 0,
    triggerRumble: api.SDL_GameControllerHasRumbleTriggers(pointer) !== 0,
    led: api.SDL_GameControllerHasLED(pointer) !== 0,
    touchpads: checked(api.SDL_GameControllerGetNumTouchpads(pointer), "SDL_GameControllerGetNumTouchpads"),
    sensors: sensorNames.filter(kind => api.SDL_GameControllerHasSensor(pointer, sensors[kind]) !== 0).map(kind => ({
      kind, enabled: api.SDL_GameControllerIsSensorEnabled(pointer, sensors[kind]) !== 0,
      rateHz: api.SDL_GameControllerGetSensorDataRate(pointer, sensors[kind]),
    })),
  };
}
function describe(device: OwnedController): ControllerDevice {
  return { instance: device.instance, name: device.name, guid: device.guid, serial: device.serial,
    ordinal: device.ordinal, virtual: device.virtual, capabilities: capabilities(device.pointer) };
}

/** One event owner, with independently routed native handles. No gameplay or key bindings. */
export class SdlControllers {
  private static owner: SdlControllers | null = null;
  private readonly opened = new Map<number, OwnedController>();
  private pending: ControllerEvent[] = [];
  private selections: ControllerSelection[] = [];
  private routes: (number | null)[] = [];
  private constructor(private readonly previousEventState: number) {}

  static get runtime(): { readonly version: string; readonly revision: string } {
    mainThread();
    const bytes = new Uint8Array(3); sdl().SDL_GetVersion(bytes);
    return { version: [...bytes].join("."), revision: String(sdl().SDL_GetRevision()) };
  }

  static open(): SdlControllers {
    mainThread();
    if (SdlControllers.owner !== null) throw new Error("SDL controller events already have an owner");
    initialize();
    const api = sdl(), previous = api.SDL_GameControllerEventState(-1);
    const owner = new SdlControllers(previous);
    SdlControllers.owner = owner;
    try {
      api.SDL_GameControllerEventState(1);
      owner.discover(api.SDL_GetTicks());
      return owner;
    } catch (error) { owner.close(); throw error; }
  }
  get closed(): boolean { return SdlControllers.owner !== this; }
  private requireOpen(): void { mainThread(); if (this.closed) throw new Error("SDL controller provider is closed"); }
  get devices(): readonly ControllerDevice[] { this.requireOpen(); return [...this.opened.values()].map(describe); }
  get assignments(): readonly (number | null)[] { this.requireOpen(); return [...this.routes]; }
  get version(): string {
    this.requireOpen(); return SdlControllers.runtime.version;
  }
  snapshot(instance: number): ControllerState | null {
    this.requireOpen();
    const device = this.opened.get(instance);
    if (device === undefined || sdl().SDL_GameControllerGetAttached(device.pointer) === 0) return null;
    return { axes: [...device.axes], buttons: [...device.buttons] };
  }
  setAssignments(selections: readonly ControllerSelection[]): void {
    this.requireOpen();
    for (const selection of selections) {
      if (selection.kind === "device" || selection.kind === "serial") {
        if (!/^[0-9a-f]{32}$/i.test(selection.guid)) throw new Error("Controller assignment GUID requires 32 hexadecimal digits");
        if (selection.kind === "device") integer(selection.ordinal, 0, 0x7fffffff, "Controller ordinal");
        else if (selection.serial.length === 0 || selection.serial.includes("\0")) throw new Error("Controller serial must be nonempty and contain no NUL");
      }
    }
    this.collect();
    this.selections = selections.map(selection => selection.kind === "device" || selection.kind === "serial"
      ? { ...selection, guid: selection.guid.toLowerCase() } : { ...selection });
    this.resolve(sdl().SDL_GetTicks());
  }
  private slot(instance: number): number | null { const slot = this.routes.indexOf(instance); return slot < 0 ? null : slot; }
  private resolve(timestamp: number): void {
    const devices = [...this.opened.values()], claimed = new Set<number>();
    const routes: (number | null)[] = this.selections.map(() => null);
    for (const [slot, selection] of this.selections.entries()) {
      if (selection.kind !== "device" && selection.kind !== "serial") continue;
      const matches = devices.filter(device => !claimed.has(device.instance) && device.guid === selection.guid
        && (selection.kind === "device" ? device.ordinal === selection.ordinal : device.serial === selection.serial));
      const device = matches.length === 1 ? matches[0] : undefined;
      if (device !== undefined) { routes[slot] = device.instance; claimed.add(device.instance); }
    }
    for (const [slot, selection] of this.selections.entries()) {
      if (selection.kind !== "automatic") continue;
      const device = devices.find(candidate => !claimed.has(candidate.instance));
      if (device !== undefined) { routes[slot] = device.instance; claimed.add(device.instance); }
    }
    for (let slot = 0; slot < Math.max(routes.length, this.routes.length); slot++) {
      const previous = this.routes[slot] ?? null, instance = routes[slot] ?? null;
      if (previous === instance) continue;
      if (previous !== null) this.stop(previous);
      this.pending.push({ kind: "assignment", timestamp, slot, previous, instance });
    }
    this.routes = routes;
  }
  private discover(timestamp: number, deviceIndex: number | null = null): void {
    const api = sdl(), count = checked(api.SDL_NumJoysticks(), "SDL_NumJoysticks");
    const end = deviceIndex === null ? count : Math.min(count, deviceIndex + 1);
    for (let index = deviceIndex ?? 0; index >= 0 && index < end; index++) {
      const instance = api.SDL_JoystickGetDeviceInstanceID(index);
      if (instance < 0 || this.opened.has(instance) || api.SDL_IsGameController(index) === 0) continue;
      const pointer = required(api.SDL_GameControllerOpen(index), "SDL_GameControllerOpen");
      try {
        const joystick = required(api.SDL_GameControllerGetJoystick(pointer), "SDL_GameControllerGetJoystick");
        if (checked(api.SDL_JoystickInstanceID(joystick), "SDL_JoystickInstanceID") !== instance)
          throw new Error("SDL controller instance changed while opening");
        const fields = identity(pointer);
        const ordinals = new Set([...this.opened.values()].filter(device => device.guid === fields.guid).map(device => device.ordinal));
        let ordinal = 0; while (ordinals.has(ordinal)) ordinal++;
        const device: OwnedController = { pointer, instance, ordinal, virtual: api.SDL_JoystickIsVirtual(index) !== 0, ...fields,
          axes: Array.from({ length: axisCount }, (_, axis) => api.SDL_GameControllerGetAxis(pointer, axis)),
          buttons: Array.from({ length: buttonCount }, (_, button) => api.SDL_GameControllerGetButton(pointer, button) !== 0) };
        const description = describe(device);
        this.opened.set(instance, device);
        this.pending.push({ kind: "connected", timestamp, device: description });
      } catch (error) { api.SDL_GameControllerClose(pointer); throw error; }
    }
    this.resolve(timestamp);
  }
  private remove(device: OwnedController, timestamp: number): void {
    const slot = this.slot(device.instance);
    this.stop(device.instance);
    this.opened.delete(device.instance);
    sdl().SDL_GameControllerClose(device.pointer);
    this.pending.push({ kind: "disconnected", timestamp, instance: device.instance, slot });
    this.resolve(timestamp);
  }
  private collect(): void {
    const api = sdl(), bytes = new Uint8Array(56), view = new DataView(bytes.buffer);
    api.SDL_GameControllerUpdate();
    for (;;) {
      const count = checked(api.SDL_PeepEvents(bytes, 1, 2, 0x650, 0x66f), "SDL_PeepEvents controller");
      if (count === 0) break;
      const type = view.getUint32(0, littleEndian), timestamp = view.getUint32(4, littleEndian), instance = view.getInt32(8, littleEndian);
      // ADDED carries a device index. Opening the whole final device list here
      // would open later arrivals before queued removals release their ordinals.
      if (type === 0x653) { this.discover(timestamp, instance); continue; }
      const device = this.opened.get(instance);
      if (device === undefined) continue;
      const common = { timestamp, instance, slot: this.slot(instance) };
      switch (type) {
        case 0x650: {
          const axis = view.getUint8(12), value = view.getInt16(16, littleEndian);
          if (axis < axisCount) { device.axes[axis] = value; this.pending.push({ kind: "axis", ...common, axis, value }); }
          break;
        }
        case 0x651: case 0x652: {
          const button = view.getUint8(12), down = type === 0x651;
          if (button < buttonCount) { device.buttons[button] = down; this.pending.push({ kind: "button", ...common, button, down }); }
          break;
        }
        case 0x654: this.remove(device, timestamp); break;
        case 0x655:
          Object.assign(device, identity(device.pointer));
          for (let axis = 0; axis < axisCount; axis++) device.axes[axis] = api.SDL_GameControllerGetAxis(device.pointer, axis);
          for (let button = 0; button < buttonCount; button++) device.buttons[button] = api.SDL_GameControllerGetButton(device.pointer, button) !== 0;
          this.pending.push({ kind: "remapped", timestamp, device: describe(device) });
          this.resolve(timestamp);
          break;
        case 0x656: case 0x657: case 0x658:
          this.pending.push({ kind: "touchpad", ...common, phase: type === 0x656 ? "down" : type === 0x657 ? "motion" : "up",
            touchpad: view.getInt32(12, littleEndian), finger: view.getInt32(16, littleEndian), x: view.getFloat32(20, littleEndian),
            y: view.getFloat32(24, littleEndian), pressure: view.getFloat32(28, littleEndian) });
          break;
        case 0x659: {
          const sensor = sensorNames.find(kind => sensors[kind] === view.getInt32(12, littleEndian));
          if (sensor !== undefined) this.pending.push({ kind: "sensor", ...common, sensor, x: view.getFloat32(16, littleEndian),
            y: view.getFloat32(20, littleEndian), z: view.getFloat32(24, littleEndian), timestampUs: view.getBigUint64(32, littleEndian) });
          else this.pending.push({ kind: "unrecognized", ...common, type, bytes: bytes.slice() });
          break;
        }
        default: this.pending.push({ kind: "unrecognized", ...common, type, bytes: bytes.slice() });
      }
    }
    // A device can disappear while SDL events are disabled by another subsystem.
    for (const device of this.opened.values()) if (api.SDL_GameControllerGetAttached(device.pointer) === 0)
      this.remove(device, api.SDL_GetTicks());
  }
  pollEvents(): readonly ControllerEvent[] {
    this.requireOpen(); this.collect(); const events = this.pending; this.pending = []; return events;
  }
  addMapping(mapping: string): "added" | "updated" {
    this.requireOpen();
    if (!/^[0-9a-f]{32},[^,]+,/i.test(mapping)) throw new Error("SDL controller mapping requires a GUID, name and bindings");
    const result = checked(sdl().SDL_GameControllerAddMapping(cString(mapping)), "SDL_GameControllerAddMapping");
    this.discover(sdl().SDL_GetTicks());
    return result === 0 ? "updated" : "added";
  }
  private operate(instance: number, capability: "rumble" | "triggerRumble" | "led" | ControllerSensor,
    operation: (pointer: Pointer) => number): ControllerOperationResult {
    this.requireOpen();
    const device = this.opened.get(instance), api = sdl();
    if (device === undefined || api.SDL_GameControllerGetAttached(device.pointer) === 0)
      return { kind: "disconnected", reason: `SDL controller ${instance} is not connected` };
    const support = capabilities(device.pointer);
    const supported = capability === "rumble" || capability === "triggerRumble" || capability === "led"
      ? support[capability] : support.sensors.some(sensor => sensor.kind === capability);
    if (!supported) return { kind: "unsupported", reason: `${device.name} does not support ${capability}` };
    if (operation(device.pointer) >= 0) return { kind: "accepted" };
    const error = String(api.SDL_GetError());
    return { kind: "failed", reason: error || `SDL controller ${capability} failed without an SDL error message` };
  }
  rumble(instance: number, low: number, high: number, durationMs: number): ControllerOperationResult {
    const lowMagnitude = amplitude(low), highMagnitude = amplitude(high); integer(durationMs, 0, 0xffffffff, "Rumble duration");
    return this.operate(instance, "rumble", pointer => sdl().SDL_GameControllerRumble(pointer, lowMagnitude, highMagnitude, durationMs));
  }
  rumbleTriggers(instance: number, left: number, right: number, durationMs: number): ControllerOperationResult {
    const leftMagnitude = amplitude(left), rightMagnitude = amplitude(right); integer(durationMs, 0, 0xffffffff, "Rumble duration");
    return this.operate(instance, "triggerRumble", pointer => sdl().SDL_GameControllerRumbleTriggers(pointer, leftMagnitude, rightMagnitude, durationMs));
  }
  setLed(instance: number, red: number, green: number, blue: number): ControllerOperationResult {
    for (const component of [red, green, blue]) integer(component, 0, 255, "LED component");
    return this.operate(instance, "led", pointer => sdl().SDL_GameControllerSetLED(pointer, red, green, blue));
  }
  setSensorEnabled(instance: number, sensor: ControllerSensor, enabled: boolean): ControllerOperationResult {
    return this.operate(instance, sensor, pointer => sdl().SDL_GameControllerSetSensorEnabled(pointer, sensors[sensor], Number(enabled)));
  }
  readSensor(instance: number, sensor: ControllerSensor):
    ControllerOperationResult | { readonly kind: "sample"; readonly x: number; readonly y: number; readonly z: number } {
    const values = new Float32Array(3);
    const result = this.operate(instance, sensor, pointer => sdl().SDL_GameControllerGetSensorData(pointer, sensors[sensor], values, 3));
    if (result.kind !== "accepted") return result;
    const [x, y, z] = values;
    if (x === undefined || y === undefined || z === undefined) throw new Error("SDL sensor buffer has invalid dimensions");
    return { kind: "sample", x, y, z };
  }
  private stop(instance: number): void {
    const device = this.opened.get(instance), api = sdl();
    if (device === undefined || api.SDL_GameControllerGetAttached(device.pointer) === 0) return;
    if (api.SDL_GameControllerHasRumble(device.pointer)) api.SDL_GameControllerRumble(device.pointer, 0, 0, 0);
    if (api.SDL_GameControllerHasRumbleTriggers(device.pointer)) api.SDL_GameControllerRumbleTriggers(device.pointer, 0, 0, 0);
  }
  close(): void {
    mainThread(); if (this.closed) return;
    const api = sdl();
    for (const device of this.opened.values()) { this.stop(device.instance); api.SDL_GameControllerClose(device.pointer); }
    this.opened.clear(); this.pending = []; this.routes = []; this.selections = [];
    api.SDL_GameControllerEventState(this.previousEventState);
    api.SDL_QuitSubSystem(subsystem); SdlControllers.owner = null;
  }
  [Symbol.dispose](): void { this.close(); }
}

function loadVirtualControllers() {
  return openNativeLibrary("sdl2", path => dlopen(path, {
    SDL_JoystickAttachVirtualEx: { args: ["buffer"], returns: "i32" },
    SDL_JoystickDetachVirtual: { args: ["i32"], returns: "i32" },
    SDL_JoystickOpen: { args: ["i32"], returns: "ptr" },
    SDL_JoystickClose: { args: ["ptr"], returns: "void" },
    SDL_JoystickSetVirtualAxis: { args: ["ptr", "i32", "i16"], returns: "i32" },
    SDL_JoystickSetVirtualButton: { args: ["ptr", "i32", "u8"], returns: "i32" },
    SDL_JoystickUpdate: { args: [], returns: "void" },
  }));
}
let virtualLibrary: ReturnType<typeof loadVirtualControllers> | undefined;
function virtualSdl() { virtualLibrary ??= loadVirtualControllers(); return virtualLibrary.symbols; }
export interface VirtualControllerRumble { readonly kind: "rumble" | "trigger-rumble"; readonly low: number; readonly high: number }

/** A real SDL virtual joystick, for platform diagnostics without fabricated input records. */
export class VirtualSdlController {
  private constructor(private pointer: Pointer | null, readonly instance: number,
    private readonly callbacks: readonly JSCallback[], private readonly effects: VirtualControllerRumble[]) {}
  static attach(options: { readonly name?: string; readonly rumble?: boolean } = {}): VirtualSdlController {
    initialize();
    const callbacks: JSCallback[] = [], effects: VirtualControllerRumble[] = [];
    let pointer: Pointer | null = null, index = -1;
    try {
      if (process.arch !== "x64" && process.arch !== "arm64") throw new Error("SDL virtual descriptor requires a 64-bit host");
      const descriptor = new Uint8Array(88), view = new DataView(descriptor.buffer);
      const name = cString(options.name ?? "Quake SDL virtual controller");
      view.setUint16(0, 1, littleEndian); view.setUint16(2, 1, littleEndian);
      view.setUint16(4, axisCount, littleEndian); view.setUint16(6, buttonCount, littleEndian);
      view.setUint32(16, (1 << buttonCount) - 1, littleEndian); view.setUint32(20, (1 << axisCount) - 1, littleEndian);
      view.setBigUint64(24, BigInt(ptr(name)), littleEndian);
      if (options.rumble === true) {
        for (const [offset, kind] of new Map<number, "rumble" | "trigger-rumble">([[56, "rumble"], [64, "trigger-rumble"]])) {
          const callback = new JSCallback((_data: unknown, low: number, high: number): number => { effects.push({ kind, low, high }); return 0; },
            { args: ["ptr", "u16", "u16"], returns: "i32" });
          callbacks.push(callback);
          view.setBigUint64(offset, BigInt(required(callback.ptr, "SDL virtual rumble callback")), littleEndian);
        }
      }
      const api = virtualSdl();
      index = checked(api.SDL_JoystickAttachVirtualEx(descriptor), "SDL_JoystickAttachVirtualEx");
      pointer = required(api.SDL_JoystickOpen(index), "SDL_JoystickOpen virtual");
      const instance = checked(sdl().SDL_JoystickInstanceID(pointer), "SDL_JoystickInstanceID virtual");
      // Virtual trigger joysticks use -32768 for the unpressed end of their mapping.
      for (const axis of [4, 5]) checked(api.SDL_JoystickSetVirtualAxis(pointer, axis, -32768), "SDL_JoystickSetVirtualAxis trigger");
      api.SDL_JoystickUpdate();
      return new VirtualSdlController(pointer, instance, callbacks, effects);
    } catch (error) {
      if (index >= 0) virtualSdl().SDL_JoystickDetachVirtual(index);
      if (pointer !== null) virtualSdl().SDL_JoystickClose(pointer);
      for (const callback of callbacks) callback.close();
      sdl().SDL_QuitSubSystem(subsystem); throw error;
    }
  }
  get closed(): boolean { return this.pointer === null; }
  private opened(): Pointer { mainThread(); if (this.pointer === null) throw new Error("SDL virtual controller is closed"); return this.pointer; }
  setAxis(axis: number, value: number): void {
    const pointer = this.opened(); integer(axis, 0, axisCount - 1, "Controller axis"); integer(value, -32768, 32767, "Controller axis value");
    checked(virtualSdl().SDL_JoystickSetVirtualAxis(pointer, axis, value), "SDL_JoystickSetVirtualAxis");
    virtualSdl().SDL_JoystickUpdate();
  }
  setButton(button: number, down: boolean): void {
    const pointer = this.opened(); integer(button, 0, buttonCount - 1, "Controller button");
    checked(virtualSdl().SDL_JoystickSetVirtualButton(pointer, button, Number(down)), "SDL_JoystickSetVirtualButton");
    virtualSdl().SDL_JoystickUpdate();
  }
  drainRumble(): readonly VirtualControllerRumble[] { this.opened(); return this.effects.splice(0); }
  close(): void {
    mainThread(); const pointer = this.pointer; if (pointer === null) return;
    const api = virtualSdl(), count = checked(sdl().SDL_NumJoysticks(), "SDL_NumJoysticks virtual detach");
    for (let index = 0; index < count; index++) if (sdl().SDL_JoystickGetDeviceInstanceID(index) === this.instance) {
      checked(api.SDL_JoystickDetachVirtual(index), "SDL_JoystickDetachVirtual"); break;
    }
    this.pointer = null; api.SDL_JoystickClose(pointer);
    for (const callback of this.callbacks) callback.close();
    sdl().SDL_QuitSubSystem(subsystem);
  }
  [Symbol.dispose](): void { this.close(); }
}
