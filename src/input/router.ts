import type { SeatId } from "../contracts/identity.ts";
import type { SeatInputEvent } from "../contracts/ui.ts";
import type { ControllerEvent, ControllerOperationResult, ControllerSelection, SdlControllers } from "../platform/controller.ts";
import type { SdlEvent, SdlInputLease, SdlWindow } from "../platform/sdl.ts";
import { controllerAxisName, normalizedControllerAxis } from "./gamepad.ts";
import { sdlEventTime, sdlGameKey } from "./sdl-keys.ts";
import { SeatInput } from "./seat.ts";

export interface InputSeatRoute { readonly input: SeatInput; readonly controller: ControllerSelection; }
export interface InputRouterOptions {
  readonly seats: readonly InputSeatRoute[];
  readonly keyboardSeat: SeatId | null;
  readonly controllers: SdlControllers | null;
  readonly now: () => number;
  readonly ticks: () => number;
  readonly subframe: boolean;
  readonly unhandled: (event: SdlEvent | ControllerEvent) => void;
  readonly controllerOperation?: (seat: SeatId, result: ControllerOperationResult) => void;
}

/** Borrows platform event ownership. The caller can feed a shared event loop or use pump(). */
export class InputRouter {
  private readonly routes: readonly InputSeatRoute[];
  private keyboard: SeatInput | null = null;
  private readonly keyboardKeys = new Map<number, number>();
  private readonly deviceSeats = new Map<number, SeatInput>();
  private lease: SdlInputLease | null = null;
  private window: SdlWindow | null = null;
  private closed = false;
  constructor(private readonly options: InputRouterOptions) {
    for (const [index, route] of options.seats.entries()) if (options.seats.slice(0, index).some(previous => previous.input.seat.equals(route.input.seat))) throw new Error("Duplicate input seat");
    this.routes = [...options.seats];
    this.setKeyboardSeat(options.keyboardSeat);
    options.controllers?.setAssignments(this.routes.map(route => route.controller));
  }
  seat(id: SeatId): SeatInput | null { return this.routes.find(route => route.input.seat.equals(id))?.input ?? null; }
  controllerFor(id: SeatId): number | null {
    for (const [instance, input] of this.deviceSeats) if (input.seat.equals(id)) return instance;
    return null;
  }
  setGyroEnabled(id: SeatId, enabled: boolean): ControllerOperationResult {
    const seat = this.seat(id), instance = this.controllerFor(id);
    if (seat === null) throw new Error("Gyro route refers to an unregistered seat");
    if (instance === null || this.options.controllers === null) return { kind: "disconnected", reason: "Seat has no assigned controller" };
    const result = this.options.controllers.setSensorEnabled(instance, "gyro", enabled);
    if (result.kind === "accepted") seat.gamepad.tuning = { ...seat.gamepad.tuning, gyro: { ...seat.gamepad.tuning.gyro, enabled } };
    return result;
  }
  setKeyboardSeat(id: SeatId | null): void {
    this.keyboard?.release(this.options.now()); this.keyboardKeys.clear();
    this.keyboard = id === null ? null : this.seat(id);
    if (id !== null && this.keyboard === null) throw new Error("Keyboard route refers to an unregistered seat");
  }
  attachWindow(window: SdlWindow): void {
    this.detachWindow(); this.window = window; this.lease = window.beginInput(); this.updateCapture();
  }
  detachWindow(): void {
    for (const route of this.routes) route.input.release(this.options.now());
    this.keyboardKeys.clear(); this.lease?.close(); this.lease = null; this.window = null;
  }
  updateCapture(): void {
    const playing = this.keyboard !== null && this.keyboard.focused && this.keyboard.focus.kind === "game";
    this.lease?.setRelativeMouse(playing);
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
      case "mouse-motion": translated = { ...common, kind: "mouse-motion", position: { x: event.x, y: event.y }, delta: { x: event.dx, y: event.dy } }; break;
      case "mouse-button": translated = { ...common, kind: "mouse-button", button: event.button, down: event.down }; break;
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
        this.deviceSeats.delete(event.previous);
      }
      const seat = this.routes[event.slot]?.input;
      if (event.instance !== null && seat !== undefined) {
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
      case "disconnected": seat.releaseDevice(event.instance, timeMilliseconds); this.deviceSeats.delete(event.instance); break;
      case "button": seat.input({ ...common, kind: "controller-button", button: event.button, down: event.down }); break;
      case "axis": {
        const axis = controllerAxisName(event.axis);
        if (axis !== null) seat.input({ ...common, kind: "controller-axis", axis, value: normalizedControllerAxis(axis, event.value) });
        break;
      }
      case "sensor": if (event.sensor === "gyro") seat.gyro({ x: event.x, y: event.y, z: event.z }); else this.options.unhandled(event); break;
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
    for (const route of this.routes) route.input.release(this.options.now());
    this.deviceSeats.clear(); this.keyboardKeys.clear();
    this.options.controllers?.setAssignments(this.routes.map(route => route.controller));
    const assignments = this.options.controllers?.assignments ?? [];
    for (const [slot, instance] of assignments.entries()) {
      const input = this.routes[slot]?.input;
      if (instance !== null && input !== undefined) { input.remapControllerBindings(instance); this.deviceSeats.set(instance, input); }
    }
    this.updateCapture();
  }
  close(): void { if (this.closed) return; this.detachWindow(); this.deviceSeats.clear(); this.closed = true; }
}
