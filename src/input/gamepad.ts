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
export type GyroCalibrationState =
  | { readonly kind: "idle" }
  | { readonly kind: "calibrating"; readonly progress: number; readonly samples: number }
  | { readonly kind: "ready"; readonly bias: Vec3 };
interface GyroCapture {
  readonly start: number;
  readonly last: number;
  readonly samples: number;
  readonly mean: Vec3;
  readonly deviation: Vec3;
}
// Shared calibration policy, in radians/second: explicitly collect a still controller,
// never learn motion during gameplay. A gyro alone cannot detect constant rotation.
const gyroCalibrationDuration = 2000, gyroCalibrationSamples = 64;
export class GamepadInput {
  private readonly axes = new Map<ControllerAxis, number>();
  private readonly previewAxes = new Map<ControllerAxis, number>();
  previewAxis(axis: ControllerAxis, value: number): void { this.previewAxes.set(axis, Math.max(-1, Math.min(1, value))); }
  preview(): { readonly move: { readonly raw: Vec2; readonly curved: Vec2 }; readonly look: { readonly raw: Vec2; readonly curved: Vec2 } } {
    const left = { x: this.previewAxes.get("left-x") ?? 0, y: this.previewAxes.get("left-y") ?? 0 };
    const right = { x: this.previewAxes.get("right-x") ?? 0, y: this.previewAxes.get("right-y") ?? 0 };
    const move = this.tuning.swapSticks ? right : left, look = this.tuning.swapSticks ? left : right;
    return { move: { raw: move, curved: applyStickCurve(move, this.tuning.move) }, look: { raw: look, curved: applyStickCurve(look, this.tuning.look) } };
  }
  private gyroSample: Vec3 | null = null;
  private gyroBias: Vec3 | null = null;
  private calibrating = false;
  private capture: GyroCapture | null = null;
  constructor(public tuning: GamepadTuning = defaultGamepadTuning) { validateGamepadTuning(tuning); }
  axis(axis: ControllerAxis, value: number): void { this.previewAxis(axis, value); this.axes.set(axis, Math.max(-1, Math.min(1, value))); }
  get gyroCalibration(): GyroCalibrationState {
    if (this.calibrating) return { kind: "calibrating", samples: this.capture?.samples ?? 0,
      progress: this.capture === null ? 0 : Math.min(1, (this.capture.last - this.capture.start) / gyroCalibrationDuration,
        this.capture.samples / gyroCalibrationSamples) };
    return this.gyroBias === null ? { kind: "idle" } : { kind: "ready", bias: { ...this.gyroBias } };
  }
  beginGyroCalibration(): void { this.calibrating = true; this.capture = null; this.gyroSample = null; }
  cancelGyroCalibration(): void { this.calibrating = false; this.capture = null; this.gyroSample = null; }
  resetGyroCalibration(): void { this.cancelGyroCalibration(); this.gyroBias = null; }
  gyro(value: Vec3, timeMilliseconds: number, aiming = true): void {
    if (![value.x, value.y, value.z, timeMilliseconds].every(Number.isFinite) || timeMilliseconds < 0)
      throw new RangeError("Invalid gyro sample or timestamp");
    this.gyroSample = aiming ? { ...value } : null;
    if (!this.calibrating) return;
    this.gyroSample = null;
    if (Math.hypot(value.x, value.y, value.z) > 0.15) { this.capture = null; return; }
    let previous = this.capture;
    if (previous !== null && timeMilliseconds === previous.last) return;
    if (previous !== null && (timeMilliseconds < previous.last || timeMilliseconds - previous.last > 250)) previous = null;
    if (previous === null) {
      this.capture = { start: timeMilliseconds, last: timeMilliseconds, samples: 1, mean: { ...value }, deviation: { x: 0, y: 0, z: 0 } };
      return;
    }
    const samples = previous.samples + 1;
    const mean = { x: previous.mean.x + (value.x - previous.mean.x) / samples,
      y: previous.mean.y + (value.y - previous.mean.y) / samples, z: previous.mean.z + (value.z - previous.mean.z) / samples };
    const deviation = { x: previous.deviation.x + (value.x - previous.mean.x) * (value.x - mean.x),
      y: previous.deviation.y + (value.y - previous.mean.y) * (value.y - mean.y),
      z: previous.deviation.z + (value.z - previous.mean.z) * (value.z - mean.z) };
    if (Math.max(deviation.x, deviation.y, deviation.z) / (samples - 1) > 0.01 ** 2) { this.capture = null; return; }
    this.capture = { start: previous.start, last: timeMilliseconds, samples, mean, deviation };
    if (timeMilliseconds - previous.start >= gyroCalibrationDuration && samples >= gyroCalibrationSamples) {
      this.gyroBias = mean; this.cancelGyroCalibration();
    }
  }
  sample(frameMilliseconds: number): GamepadSample {
    const left = { x: this.axes.get("left-x") ?? 0, y: this.axes.get("left-y") ?? 0 };
    const right = { x: this.axes.get("right-x") ?? 0, y: this.axes.get("right-y") ?? 0 };
    const move = applyStickCurve(this.tuning.swapSticks ? right : left, this.tuning.move);
    const look = applyStickCurve(this.tuning.swapSticks ? left : right, this.tuning.look);
    const seconds = frameMilliseconds / 1000, gyro = this.tuning.gyro;
    const gyroScale = gyro.enabled && !this.calibrating && this.gyroSample !== null ? 180 / Math.PI * seconds : 0;
    const gyroYaw = this.gyroSample === null ? 0 : this.gyroSample[gyro.yawAxis] - (this.gyroBias?.[gyro.yawAxis] ?? 0);
    const gyroPitch = this.gyroSample === null ? 0 : this.gyroSample.x - (this.gyroBias?.x ?? 0);
    return {
      move: { x: move.x * this.tuning.sideSensitivity, y: -move.y * this.tuning.forwardSensitivity },
      lookDegrees: { x: look.x * this.tuning.yawDegreesPerSecond * seconds - gyroYaw * gyro.yawSensitivity * gyroScale,
        y: (look.y * this.tuning.pitchDegreesPerSecond * seconds - gyroPitch * gyro.pitchSensitivity * gyroScale) * (this.tuning.invertPitch ? -1 : 1) },
    };
  }
  clear(): void { this.previewAxes.clear(); this.axes.clear(); this.cancelGyroCalibration(); }
}
