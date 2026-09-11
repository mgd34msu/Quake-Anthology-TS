// Q1 Ironwail-style radial curve and Q2 gamepad_map.ts axial curve.
// Copyright (C) id Software and donor contributors. GPL-2.0-or-later.
import type { Vec2, Vec3 } from "../contracts/math.ts";
import type { ControllerAxis } from "../contracts/ui.ts";

export type StickCurve =
  | { readonly kind: "radial"; readonly deadzone: number; readonly outerThreshold: number; readonly exponent: number }
  | { readonly kind: "axial"; readonly deadzone: number; readonly exponent: number };
export interface GamepadTuning {
  readonly move: StickCurve;
  readonly look: StickCurve;
  readonly swapSticks: boolean;
  readonly yawDegreesPerSecond: number;
  readonly pitchDegreesPerSecond: number;
  readonly invertPitch: boolean;
  readonly forwardSensitivity: number;
  readonly sideSensitivity: number;
  readonly triggerThreshold: number;
  readonly gyro: { readonly enabled: boolean; readonly yawSensitivity: number; readonly pitchSensitivity: number; readonly yawAxis: "y" | "z" };
}
export const defaultGamepadTuning: GamepadTuning = Object.freeze({
  move: { kind: "radial", deadzone: 0.175, outerThreshold: 0.02, exponent: 2 },
  look: { kind: "radial", deadzone: 0.175, outerThreshold: 0.02, exponent: 2 },
  swapSticks: false, yawDegreesPerSecond: 240, pitchDegreesPerSecond: 130,
  invertPitch: false, forwardSensitivity: 1, sideSensitivity: 1, triggerThreshold: 0.2,
  gyro: { enabled: false, yawSensitivity: 1, pitchSensitivity: 1, yawAxis: "y" },
} satisfies GamepadTuning);
export function validateGamepadTuning(tuning: GamepadTuning): GamepadTuning {
  for (const curve of [tuning.move, tuning.look]) {
    if (!Number.isFinite(curve.deadzone) || curve.deadzone < 0 || curve.deadzone >= 1
      || !Number.isFinite(curve.exponent) || curve.exponent <= 0
      || curve.kind === "radial" && (!Number.isFinite(curve.outerThreshold) || curve.outerThreshold < 0 || curve.deadzone + curve.outerThreshold >= 1))
      throw new RangeError("Invalid gamepad deadzone or response curve");
  }
  for (const value of [tuning.yawDegreesPerSecond, tuning.pitchDegreesPerSecond, tuning.forwardSensitivity,
    tuning.sideSensitivity, tuning.gyro.yawSensitivity, tuning.gyro.pitchSensitivity]) if (!Number.isFinite(value)) throw new RangeError("Invalid gamepad sensitivity");
  if (!Number.isFinite(tuning.triggerThreshold) || tuning.triggerThreshold < 0 || tuning.triggerThreshold > 1) throw new RangeError("Invalid trigger threshold");
  return tuning;
}
export function applyStickCurve(axis: Vec2, curve: StickCurve): Vec2 {
  if (curve.kind === "axial") {
    const apply = (value: number): number => Math.sign(value) * Math.pow(Math.max(0, Math.min(1, (Math.abs(value) - curve.deadzone) / (1 - curve.deadzone))), curve.exponent);
    return { x: apply(axis.x), y: apply(axis.y) };
  }
  const magnitude = Math.hypot(axis.x, axis.y);
  if (magnitude <= curve.deadzone) return { x: 0, y: 0 };
  const scale = Math.pow(Math.min(1, (magnitude - curve.deadzone) / (1 - curve.deadzone - curve.outerThreshold)), curve.exponent) / magnitude;
  return { x: axis.x * scale, y: axis.y * scale };
}
const axisNames: readonly ControllerAxis[] = ["left-x", "left-y", "right-x", "right-y", "left-trigger", "right-trigger"];
export function controllerAxisName(axis: number): ControllerAxis | null { return axisNames[axis] ?? null; }
export function normalizedControllerAxis(axis: ControllerAxis, raw: number): number {
  return Math.max(axis.endsWith("trigger") ? 0 : -1, Math.min(1, raw / 32767));
}
export interface GamepadSample { readonly move: Vec2; readonly lookDegrees: Vec2; }
export class GamepadInput {
  private readonly axes = new Map<ControllerAxis, number>();
  private gyroSample: Vec3 = { x: 0, y: 0, z: 0 };
  constructor(public tuning: GamepadTuning = defaultGamepadTuning) { validateGamepadTuning(tuning); }
  axis(axis: ControllerAxis, value: number): void { this.axes.set(axis, Math.max(-1, Math.min(1, value))); }
  gyro(value: Vec3): void { this.gyroSample = value; }
  sample(frameMilliseconds: number): GamepadSample {
    const left = { x: this.axes.get("left-x") ?? 0, y: this.axes.get("left-y") ?? 0 };
    const right = { x: this.axes.get("right-x") ?? 0, y: this.axes.get("right-y") ?? 0 };
    const move = applyStickCurve(this.tuning.swapSticks ? right : left, this.tuning.move);
    const look = applyStickCurve(this.tuning.swapSticks ? left : right, this.tuning.look);
    const seconds = frameMilliseconds / 1000, gyro = this.tuning.gyro, gyroScale = gyro.enabled ? 180 / Math.PI * seconds : 0;
    const gyroYaw = gyro.yawAxis === "y" ? this.gyroSample.y : this.gyroSample.z;
    return {
      move: { x: move.x * this.tuning.sideSensitivity, y: -move.y * this.tuning.forwardSensitivity },
      lookDegrees: { x: look.x * this.tuning.yawDegreesPerSecond * seconds - gyroYaw * gyro.yawSensitivity * gyroScale,
        y: (look.y * this.tuning.pitchDegreesPerSecond * seconds - this.gyroSample.x * gyro.pitchSensitivity * gyroScale) * (this.tuning.invertPitch ? -1 : 1) },
    };
  }
  clear(): void { this.axes.clear(); this.gyroSample = { x: 0, y: 0, z: 0 }; }
}
