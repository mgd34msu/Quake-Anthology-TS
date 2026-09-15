import type { SeatId } from "../contracts/identity.ts";
import type { SeatInputEvent } from "../contracts/ui.ts";
import type { ControllerEvent, ControllerOperationResult, ControllerSelection, SdlControllers } from "../platform/controller.ts";
import type { SdlEvent, SdlInputLease, SdlWindow } from "../platform/sdl.ts";
import { controllerAxisName, normalizedControllerAxis } from "./gamepad.ts";
import type { GyroCalibrationState } from "./gamepad.ts";
import { sdlEventTime, sdlGameKey } from "./sdl-keys.ts";
import { SeatInput } from "./seat.ts";

type InputWindow = Pick<SdlWindow, "beginInput" | "logicalSize" | "drawableSize" | "pollEvents">;

export interface InputSeatRoute { readonly input: SeatInput; readonly controller: ControllerSelection; }
export interface InputRouterOptions {
  readonly seats: readonly InputSeatRoute[];
  readonly keyboardSeat: SeatId | null;
  readonly controllers: Pick<SdlControllers, "setAssignments" | "setSensorEnabled" | "pollEvents" | "snapshot" | "assignments"> | null;
  readonly now: () => number;
  readonly ticks: () => number;
  readonly subframe: boolean;
  readonly unhandled: (event: SdlEvent | ControllerEvent) => void;
  readonly deferPlatform?: boolean;
  readonly controllerOperation?: (seat: SeatId, result: ControllerOperationResult) => void;
}

/** Borrows platform event ownership. The caller can feed a shared event loop or use pump(). */
export class InputRouter {
  private readonly routes: InputSeatRoute[];
  private keyboard: SeatInput | null = null;
  private readonly keyboardKeys = new Map<number, number>();
  private readonly deviceSeats = new Map<number, SeatInput>();
  private readonly calibrationSensors = new Set<number>();
  private lease: SdlInputLease | null = null;
  private window: InputWindow | null = null;
  private closed = false;
  private platformActive: boolean;
  constructor(private readonly options: InputRouterOptions) {
    this.platformActive = options.deferPlatform !== true;
    for (const [index, route] of options.seats.entries()) if (options.seats.slice(0, index).some(previous => previous.input.seat.equals(route.input.seat))) throw new Error("Duplicate input seat");
    this.routes = [...options.seats];
    this.setKeyboardSeat(options.keyboardSeat);
    if (this.platformActive) options.controllers?.setAssignments(this.routes.map(route => route.controller));
  }
  keyboardSeat(): SeatId | null { return this.keyboard?.seat ?? null; }
  controllerSelection(id: SeatId): ControllerSelection { const route = this.routes.find(value => value.input.seat.equals(id)); if (route === undefined) throw new Error("Unknown input seat"); return route.controller; }
  setControllerSelection(id: SeatId, selection: ControllerSelection): void {
    const index = this.routes.findIndex(value => value.input.seat.equals(id)), route = this.routes[index];
    if (route === undefined) throw new Error("Unknown input seat");
    this.routes[index] = { input: route.input, controller: selection }; this.restart();
  }
  seat(id: SeatId): SeatInput | null { return this.routes.find(route => route.input.seat.equals(id))?.input ?? null; }
  controllerFor(id: SeatId): number | null {
    for (const [instance, input] of this.deviceSeats) if (input.seat.equals(id)) return instance;
    return null;
  }
  setGyroEnabled(id: SeatId, enabled: boolean): ControllerOperationResult {
    const seat = this.seat(id), instance = this.controllerFor(id);
    if (seat === null) throw new Error("Gyro route refers to an unregistered seat");
    if (!this.platformActive || instance === null || this.options.controllers === null) return { kind: "disconnected", reason: "Seat has no assigned controller" };
    const result = this.options.controllers.setSensorEnabled(instance, "gyro", enabled);
    if (result.kind === "accepted") {
      seat.gamepad.cancelGyroCalibration(); this.calibrationSensors.delete(instance);
      seat.gamepad.tuning = { ...seat.gamepad.tuning, gyro: { ...seat.gamepad.tuning.gyro, enabled } };
    }
    return result;
  }
  private gyroSeat(id: SeatId): SeatInput {
    const seat = this.seat(id);
    if (seat === null) throw new Error("Gyro route refers to an unregistered seat");
    return seat;
  }
  gyroCalibration(id: SeatId): GyroCalibrationState { return this.gyroSeat(id).gamepad.gyroCalibration; }
  beginGyroCalibration(id: SeatId): ControllerOperationResult {
    const seat = this.gyroSeat(id), instance = this.controllerFor(id);
    if (!this.platformActive || instance === null || this.options.controllers === null) return { kind: "disconnected", reason: "Seat has no assigned controller" };
    if (!seat.focused) return { kind: "failed", reason: "Focus the game window before calibrating" };
    const result = this.options.controllers.setSensorEnabled(instance, "gyro", true);
    if (result.kind === "accepted") {
      if (!seat.gamepad.tuning.gyro.enabled) this.calibrationSensors.add(instance);
      seat.gamepad.beginGyroCalibration();
    }
    return result;
  }
  cancelGyroCalibration(id: SeatId): void { this.gyroSeat(id).gamepad.cancelGyroCalibration(); this.finishGyroCalibration(); }
  resetGyroCalibration(id: SeatId): void { this.gyroSeat(id).gamepad.resetGyroCalibration(); this.finishGyroCalibration(); }
  private finishGyroCalibration(): void {
    if (!this.platformActive) return;
    for (const instance of this.calibrationSensors) {
      const seat = this.deviceSeats.get(instance);
      if (seat?.gamepad.gyroCalibration.kind === "calibrating") continue;
      this.calibrationSensors.delete(instance);
      if (seat === undefined || seat.gamepad.tuning.gyro.enabled) continue;
      const result = this.options.controllers?.setSensorEnabled(instance, "gyro", false);
      if (result !== undefined) this.options.controllerOperation?.(seat.seat, result);
    }
  }
  setKeyboardSeat(id: SeatId | null): void {
    if (this.platformActive) this.keyboard?.release(this.options.now());
    this.keyboardKeys.clear();
    this.keyboard = id === null ? null : this.seat(id);
    if (id !== null && this.keyboard === null) throw new Error("Keyboard route refers to an unregistered seat");
  }
  attachWindow(window: InputWindow): void {
    this.detachWindow(); this.window = window; this.lease = window.beginInput(); this.updateCapture();
  }
  transferWindowTo(next: InputRouter): void {
    next.platformActive = this.platformActive;
    this.platformActive = false;
    for (const instance of this.calibrationSensors) next.calibrationSensors.add(instance);
    this.calibrationSensors.clear();
    next.window = this.window;
    next.lease = this.lease;
    this.window = null;
    this.lease = null;
  }
  detachWindow(): void {
    if (this.platformActive) for (const route of this.routes) route.input.release(this.options.now());
    this.finishGyroCalibration();
    this.keyboardKeys.clear(); this.lease?.close(); this.lease = null; this.window = null;
  }
  updateCapture(): void {
    this.finishGyroCalibration();
    const playing = this.keyboard !== null && this.keyboard.focused && this.keyboard.focus.kind === "game";
    this.lease?.setRelativeMouse(playing);
  }
  private pointerPosition(x: number, y: number): { readonly x: number; readonly y: number } {
    if (this.window === null) return { x, y };
    const logical = this.window.logicalSize, drawable = this.window.drawableSize;
    return { x: x * drawable.width / logical.width, y: y * drawable.height / logical.height };
  }
  private time(timestamp: number): number { return sdlEventTime(timestamp, this.options.ticks(), this.options.now(), this.options.subframe); }
  handlePlatform(event: SdlEvent): void {
    if (this.closed) throw new Error("Input router is closed");
    const seat = this.keyboard, timeMilliseconds = this.time(event.timestamp);
    if (event.kind === "window" && (event.event === 12 || event.event === 13)) {
      for (const route of this.routes) route.input.input({ kind: "focus", seat: route.input.seat, timeMilliseconds, focused: event.event === 12 });
      if (event.event === 13) this.keyboardKeys.clear();
      this.updateCapture(); return;
    }
    if (seat === null) { this.options.unhandled(event); return; }
    const common = { seat: seat.seat, timeMilliseconds };
    let translated: SeatInputEvent;
    switch (event.kind) {
      case "key": {
        const code = this.keyboardKeys.get(event.scancode) ?? sdlGameKey(event.keycode, event.modifiers);
        if (code === 0) return;
        if (event.down) this.keyboardKeys.set(event.scancode, code); else this.keyboardKeys.delete(event.scancode);
        translated = { ...common, kind: "key", code, down: event.down, repeat: event.repeat }; break;
      }
      case "text": translated = { ...common, kind: "text", text: event.text }; break;
      case "mouse-motion": translated = { ...common, kind: "mouse-motion", position: this.pointerPosition(event.x, event.y), delta: { x: event.dx, y: event.dy } }; break;
      case "mouse-button":
        if (seat.focus.kind !== "game") seat.input({ ...common, kind: "mouse-motion", position: this.pointerPosition(event.x, event.y), delta: { x: 0, y: 0 } });
        translated = { ...common, kind: "mouse-button", button: event.button, down: event.down }; break;
      case "mouse-wheel": translated = { ...common, kind: "mouse-wheel", delta: { x: event.preciseX * (event.flipped ? -1 : 1), y: event.preciseY * (event.flipped ? -1 : 1) } }; break;
      default: this.options.unhandled(event); return;
    }
    seat.input(translated); this.updateCapture();
  }
  handleController(event: ControllerEvent): void {
    if (this.closed) throw new Error("Input router is closed");
    const timeMilliseconds = this.time(event.timestamp);
    if (event.kind === "assignment") {
      if (event.previous !== null) {
        this.deviceSeats.get(event.previous)?.releaseDevice(event.previous, timeMilliseconds);
        this.finishGyroCalibration();
        this.deviceSeats.delete(event.previous);
      }
      const seat = this.routes[event.slot]?.input;
      if (event.instance !== null && seat !== undefined) {
        seat.gamepad.resetGyroCalibration();
        seat.remapControllerBindings(event.instance); this.deviceSeats.set(event.instance, seat);
        if (seat.gamepad.tuning.gyro.enabled) {
          const result = this.setGyroEnabled(seat.seat, true); this.options.controllerOperation?.(seat.seat, result);
        }
      }
      this.options.unhandled(event); return;
    }
    if (!("instance" in event)) { this.options.unhandled(event); return; }
    const seat = this.deviceSeats.get(event.instance);
    if (seat === undefined) { this.options.unhandled(event); return; }
    const common = { seat: seat.seat, timeMilliseconds, device: event.instance };
    switch (event.kind) {
      case "disconnected":
        seat.releaseDevice(event.instance, timeMilliseconds); this.calibrationSensors.delete(event.instance); this.deviceSeats.delete(event.instance); break;
      case "button": seat.input({ ...common, kind: "controller-button", button: event.button, down: event.down }); break;
      case "axis": {
        const axis = controllerAxisName(event.axis);
        if (axis !== null) seat.input({ ...common, kind: "controller-axis", axis, value: normalizedControllerAxis(axis, event.value) });
        break;
      }
      case "sensor":
        if (event.sensor === "gyro") {
          seat.gyro({ x: event.x, y: event.y, z: event.z }, event.timestampUs === 0n ? event.timestamp : Number(event.timestampUs) / 1000);
          this.finishGyroCalibration();
        } else this.options.unhandled(event);
        break;
      default: this.options.unhandled(event);
    }
  }
  pump(): void {
    for (const event of this.window?.pollEvents() ?? []) this.handlePlatform(event);
    for (const event of this.options.controllers?.pollEvents() ?? []) this.handleController(event);
    for (const [instance, seat] of this.deviceSeats) if (seat.focused && seat.focus.kind === "game") {
      const snapshot = this.options.controllers?.snapshot(instance);
      for (const [axisNumber, value] of snapshot?.axes.entries() ?? []) {
        const axis = controllerAxisName(axisNumber);
        if (axis !== null) seat.gamepad.axis(axis, normalizedControllerAxis(axis, value));
      }
    }
    this.updateCapture();
  }
  restart(): void {
    if (this.platformActive) for (const route of this.routes) { route.input.release(this.options.now()); route.input.gamepad.resetGyroCalibration(); }
    this.finishGyroCalibration();
    this.deviceSeats.clear(); this.keyboardKeys.clear();
    if (this.platformActive) this.options.controllers?.setAssignments(this.routes.map(route => route.controller));
    const assignments = this.options.controllers?.assignments ?? [];
    for (const [slot, instance] of assignments.entries()) {
      const input = this.routes[slot]?.input;
      if (instance !== null && input !== undefined) { if (this.platformActive) input.remapControllerBindings(instance); this.deviceSeats.set(instance, input); }
    }
    this.updateCapture();
  }
  close(): void {
    if (this.closed) return;
    this.detachWindow();
    if (this.platformActive) for (const route of this.routes) route.input.gamepad.resetGyroCalibration();
    this.deviceSeats.clear(); this.closed = true;
  }
}
