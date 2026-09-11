// Source joystick profiles from Quake III linux_joystick.c and win_input.c. GPL-2.0-or-later.
import { KeyCode } from "./key-codes.ts";
import type { SdlJoystickEvent } from "../platform/sdl.ts";
export type SourceJoystickProfile = "linux" | "windows";

/** IN_JoyMove's diagnostic row, from the same sample consumed by the frame. */
export function windowsJoystickDebug(events: readonly SdlJoystickEvent[]): string {
  let buttons = 0, pov = 65535;
  const axes = new Int16Array(6);
  for (const event of events) {
    if (event.kind === "joystick-button" && event.button < 32) {
      if (event.down) buttons |= 1 << event.button;
      else buttons &= ~(1 << event.button);
    }
    else if (event.kind === "joystick-axis" && event.axis < 6) axes[event.axis] = event.value;
    else if (event.kind === "joystick-hat" && event.hat === 0) {
      switch (event.value) {
        case 1: pov = 0; break;
        case 3: pov = 4500; break;
        case 2: pov = 9000; break;
        case 6: pov = 13500; break;
        case 4: pov = 18000; break;
        case 12: pov = 22500; break;
        case 8: pov = 27000; break;
        case 9: pov = 31500; break;
        default: pov = 65535;
      }
    }
  }
  const fields = [(buttons >>> 0).toString(16).padStart(8), String(pov).padStart(5)];
  for (const [axis, value] of axes.entries()) {
    fields.push(axis < 4 ? Math.fround(value / 32768).toFixed(2).padStart(5) : String(value).padStart(6));
  }
  return `${fields.join(" ")}\n`;
}

export function sdlJoystickAxes(values: Int16Array, threshold: number): number {
  let axes = 0;
  for (const [index, value] of values.entries()) {
    if (index >= 16) break;
    const fraction = Math.fround(value / 32767);
    if (fraction < -threshold) axes |= 1 << (index * 2);
    else if (fraction > threshold) axes |= 1 << (index * 2 + 1);
  }
  return axes;
}

const joystickKeys: readonly number[] = [KeyCode.Left, KeyCode.Right, KeyCode.Up, KeyCode.Down,
  KeyCode.Joy16, KeyCode.Joy17, KeyCode.Joy18, KeyCode.Joy19,
  KeyCode.Joy20, KeyCode.Joy21, KeyCode.Joy22, KeyCode.Joy23,
  KeyCode.Joy24, KeyCode.Joy25, KeyCode.Joy26, KeyCode.Joy27];

export class SourceJoystickState {
  private readonly heldButtons = new Set<number>();
  private readonly axes = new Int16Array(16);
  private oldAxes = 0;
  private hat = 0;

  button(button: number, down: boolean, queueKey: (key: number, down: boolean, time: number) => undefined, transitionsOnly = false): void {
    if (!Number.isInteger(button) || button < 0 || button > 255) throw new RangeError("Joystick button requires an unsigned byte");
    const key = KeyCode.Joy1 + button;
    if (transitionsOnly && this.heldButtons.has(key) === down) return;
    queueKey(key, down, 0);
    if (down) this.heldButtons.add(key); else this.heldButtons.delete(key);
  }

  axis(axis: number, value: number): void {
    if (axis < 16) this.axes[axis] = value;
  }

  pov(hat: number, value: number): void {
    if (hat === 0) this.hat = value;
  }

  frame(threshold: number | null, queueKey: (key: number, down: boolean, time: number) => undefined): void {
    const axes = threshold === null ? 0 : sdlJoystickAxes(this.axes, threshold);
    this.publishAxes(axes, queueKey);
  }

  windowsFrame(threshold: number | null, axisCount: number, ballScale: number,
    queueKey: (key: number, down: boolean, time: number) => undefined,
    queueMouse: (dx: number, dy: number, time: number) => undefined): void {
    let axes = 0;
    if (threshold !== null) {
      for (let index = 0; index < Math.min(axisCount, 4); index++) {
        const value = this.axes[index];
        if (value === undefined) throw new Error("Missing Windows joystick axis");
        const fraction = Math.fround(value / 32768);
        if (fraction < -threshold) axes |= 1 << (index * 2);
        else if (fraction > threshold) axes |= 1 << (index * 2 + 1);
      }
      // SDL hat bits are up/right/down/left; source accepts cardinal POV only.
      if (this.hat === 1) axes |= 1 << 12;
      else if (this.hat === 4) axes |= 1 << 13;
      else if (this.hat === 2) axes |= 1 << 14;
      else if (this.hat === 8) axes |= 1 << 15;
    }
    this.publishAxes(axes, queueKey);
    if (threshold !== null && axisCount >= 6) {
      const u = this.axes[4], v = this.axes[5];
      if (u === undefined || v === undefined) throw new Error("Missing Windows joystick U/V axes");
      const dx = Math.trunc(Math.fround(u * Math.fround(ballScale)));
      const dy = Math.trunc(Math.fround(v * Math.fround(ballScale)));
      if (dx !== 0 || dy !== 0) queueMouse(dx, dy, 0);
    }
  }

  private publishAxes(axes: number, queueKey: (key: number, down: boolean, time: number) => undefined): void {
    for (const [bit, key] of joystickKeys.entries()) {
      const mask = 1 << bit;
      if ((axes & mask) !== (this.oldAxes & mask)) queueKey(key, (axes & mask) !== 0, 0);
    }
    this.oldAxes = axes;
  }

  removeDevice(queueKey: (key: number, down: boolean, time: number) => undefined): void {
    for (const key of this.heldButtons) queueKey(key, false, 0);
    this.heldButtons.clear(); this.axes.fill(0); this.hat = 0;
  }

  release(time: number, queueKey: (key: number, down: boolean, time: number) => undefined): void {
    const held = new Set(this.heldButtons);
    for (const [bit, key] of joystickKeys.entries()) if ((this.oldAxes & (1 << bit)) !== 0) held.add(key);
    for (const key of held) queueKey(key, false, time);
    this.clear();
  }

  clear(): void {
    this.heldButtons.clear(); this.axes.fill(0); this.oldAxes = 0; this.hat = 0;
  }
}

