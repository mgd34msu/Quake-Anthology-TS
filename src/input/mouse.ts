// Q3 CL_MouseMove and Q1/Q2 IN_MouseMove filtering/scaling.
// Copyright (C) id Software. GPL-2.0-or-later.
import type { Vec2 } from "../contracts/math.ts";
export interface MouseTuning {
  readonly sensitivity: number;
  readonly acceleration: number;
  readonly filter: boolean;
  readonly yaw: number;
  readonly pitch: number;
  readonly side: number;
  readonly forward: number;
  readonly freeLook: boolean;
  readonly invertPitch: boolean;
}
export const defaultMouseTuning: MouseTuning = Object.freeze({ sensitivity: 3, acceleration: 0, filter: false,
  yaw: 0.022, pitch: 0.022, side: 0.8, forward: 1, freeLook: true, invertPitch: false });
export interface MouseMove { readonly yaw: number; readonly pitch: number; readonly side: number; readonly forward: number; }
export interface MouseTuningStore {
  read(): MouseTuning;
  write(value: MouseTuning): void;
}
export class MouseInput {
  private previous: Vec2 = { x: 0, y: 0 };
  constructor(private settings: MouseTuning | MouseTuningStore = defaultMouseTuning) {}
  bindSettings(settings: MouseTuningStore): void { this.settings = settings; }
  get tuning(): MouseTuning { return "read" in this.settings ? this.settings.read() : this.settings; }
  set tuning(value: MouseTuning) { if ("read" in this.settings) this.settings.write(value); else this.settings = value; }
  sample(raw: Vec2, frameMilliseconds: number, strafe: boolean, mouseLook: boolean, zoomSensitivity = 1, binary32 = false): MouseMove {
    if (!(frameMilliseconds > 0) || !Number.isFinite(frameMilliseconds)) throw new RangeError("Mouse sample needs a positive frame duration");
    const f = binary32 ? Math.fround : (value: number): number => value;
    const tuning = this.tuning;
    let x = tuning.filter ? f((raw.x + this.previous.x) * 0.5) : f(raw.x);
    let y = tuning.filter ? f((raw.y + this.previous.y) * 0.5) : f(raw.y);
    this.previous = raw;
    const rate = f(Math.sqrt(f(f(x * x) + f(y * y))) / f(frameMilliseconds));
    const gain = f(f(tuning.sensitivity + f(rate * tuning.acceleration)) * zoomSensitivity);
    x = f(x * gain); y = f(y * gain);
    return { yaw: strafe ? 0 : f(-tuning.yaw * x), side: strafe ? f(tuning.side * x) : 0,
      pitch: !strafe && (mouseLook || tuning.freeLook) ? f(tuning.pitch * y * (tuning.invertPitch ? -1 : 1)) : 0,
      forward: strafe || !(mouseLook || tuning.freeLook) ? f(-tuning.forward * y) : 0 };
  }
  clear(): void { this.previous = { x: 0, y: 0 }; }
}
