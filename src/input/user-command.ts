// CL_AdjustAngles, CL_BaseMove and CL_FinishMove from Quake I/II/III cl_input.c.
// Copyright (C) id Software. GPL-2.0-or-later.
import type { CommandDialect } from "../contracts/common.ts";
import type { Vec3 } from "../contracts/math.ts";
import type { UserCommand, AngleWords } from "../contracts/protocol.ts";
import { MouseInput } from "./mouse.ts";
import type { SeatInputSample, SourceAction } from "./seat.ts";

export type UserCommandFrame =
  | { readonly kind: "q1-netquake"; readonly acknowledgedServerTimeSeconds: number }
  | { readonly kind: "q1-quakeworld" }
  | { readonly kind: "q2-classic"; readonly deltaAngles: Vec3; readonly lightLevel: number; readonly attackAllowed: boolean }
  | { readonly kind: "q2-rerelease"; readonly deltaAngles: Vec3; readonly serverFrame: number; readonly attackAllowed: boolean }
  | { readonly kind: "q3"; readonly serverTimeMilliseconds: number; readonly weapon: number; readonly sensitivity: number };
export interface ViewInputTuning {
  readonly forwardSpeed: number;
  readonly backSpeed: number;
  readonly sideSpeed: number;
  readonly upSpeed: number;
  readonly yawSpeed: number;
  readonly pitchSpeed: number;
  readonly angleSpeedMultiplier: number;
  readonly moveSpeedMultiplier: number;
  readonly alwaysRun: boolean;
}
export function defaultViewInputTuning(dialect: CommandDialect): ViewInputTuning {
  return { forwardSpeed: 200, backSpeed: 200, sideSpeed: dialect.startsWith("q1") ? 350 : 200, upSpeed: 200,
    yawSpeed: 140, pitchSpeed: 150, angleSpeedMultiplier: 1.5, moveSpeedMultiplier: 2, alwaysRun: !dialect.startsWith("q1") };
}
function words(angles: Vec3): AngleWords {
  const word = (angle: number): number => Math.trunc(angle * 65536 / 360) & 65535;
  return [word(angles.x), word(angles.y), word(angles.z)];
}
function q1Yaw(angle: number): number { return (Math.trunc(angle * 65536 / 360) & 65535) * (360 / 65536); }
function clamp(value: number, maximum: number): number { return Math.max(-maximum, Math.min(maximum, value)); }

export class InputCommandBuilder {
  private angles: Vec3 = { x: 0, y: 0, z: 0 };
  private tuningValue: ViewInputTuning;
  private runPreference: { read(): boolean; write(value: boolean): void } | null = null;
  constructor(readonly dialect: CommandDialect, readonly mouse = new MouseInput(), tuning = defaultViewInputTuning(dialect)) { this.tuningValue = tuning; }
  get tuning(): ViewInputTuning { return this.tuningValue; }
  set tuning(value: ViewInputTuning) {
    const preference = this.runPreference;
    if (preference === null) this.tuningValue = value;
    else {
      preference.write(value.alwaysRun);
      this.tuningValue = { ...value, get alwaysRun() { return preference.read(); } };
    }
  }
  bindAlwaysRun(preference: { read(): boolean; write(value: boolean): void }): void {
    this.runPreference = preference;
    this.tuningValue = { ...this.tuningValue, get alwaysRun() { return preference.read(); } };
  }
  get viewAngles(): Vec3 { return { ...this.angles }; }
  setViewAngles(angles: Vec3): void {
    if (![angles.x, angles.y, angles.z].every(Number.isFinite)) throw new RangeError("View angles must be finite");
    this.angles = { ...angles };
  }
  centerView(deltaPitch = 0): void { this.angles = { ...this.angles, x: -deltaPitch }; }
  clear(): void { this.angles = { x: 0, y: 0, z: 0 }; this.mouse.clear(); }
  build(sample: SeatInputSample, frame: UserCommandFrame, sourceFrameMilliseconds = sample.frameMilliseconds): UserCommand {
    if (frame.kind !== this.dialect) throw new Error("User-command frame and input dialect differ");
    const q3 = frame.kind === "q3", q1 = frame.kind === "q1-netquake" || frame.kind === "q1-quakeworld";
    const f = q3 ? Math.fround : (value: number): number => value;
    const states = new Map(sample.buttons.map(button => [button.action, button]));
    const fraction = (action: SourceAction): number => states.get(action)?.fraction ?? 0;
    const active = (action: SourceAction): boolean => states.get(action)?.active ?? false;
    const pressed = (action: SourceAction): boolean => active(action) || (states.get(action)?.pressed ?? false);
    const speed = active("walk"), strafe = active("strafe"), klook = active("klook");
    const angleSpeed = f(sourceFrameMilliseconds / 1000 * (speed ? this.tuning.angleSpeedMultiplier : 1));
    const previousPitch = this.angles.x;
    let pitch = this.angles.x, yaw = this.angles.y, roll = this.angles.z;
    if (!strafe) {
      yaw = f(yaw - f(f(angleSpeed * this.tuning.yawSpeed) * fraction("turn-right")));
      yaw = f(yaw + f(f(angleSpeed * this.tuning.yawSpeed) * fraction("turn-left")));
      if (q1) yaw = q1Yaw(yaw);
    }
    if (klook && !q3) {
      pitch = f(pitch - f(angleSpeed * this.tuning.pitchSpeed * fraction("forward")));
      pitch = f(pitch + f(angleSpeed * this.tuning.pitchSpeed * fraction("back")));
    }
    pitch = f(pitch - f(f(angleSpeed * this.tuning.pitchSpeed) * fraction("look-up")));
    pitch = f(pitch + f(f(angleSpeed * this.tuning.pitchSpeed) * fraction("look-down")));
    if (q1) { pitch = Math.max(-70, Math.min(80, pitch)); roll = clamp(roll, 50); }
    const running = speed !== this.tuning.alwaysRun;
    const moveSpeed = q3 ? running ? 127 : 64 : 1;
    let forward = 0, side = 0, up = 0;
    const add = (value: number, amount: number): number => q3 ? Math.trunc(f(f(value) + f(amount))) : value + amount;
    if (strafe) {
      side = add(side, f((q3 ? moveSpeed : this.tuning.sideSpeed) * fraction("turn-right")));
      side = add(side, -f((q3 ? moveSpeed : this.tuning.sideSpeed) * fraction("turn-left")));
    }
    side = add(side, f((q3 ? moveSpeed : this.tuning.sideSpeed) * fraction("move-right")));
    side = add(side, -f((q3 ? moveSpeed : this.tuning.sideSpeed) * fraction("move-left")));
    const jump = q1 ? fraction("move-up") : Math.max(fraction("jump"), fraction("move-up"));
    const crouch = q1 ? fraction("move-down") : Math.max(fraction("crouch"), fraction("move-down"));
    up = add(up, f((q3 ? moveSpeed : this.tuning.upSpeed) * jump));
    up = add(up, -f((q3 ? moveSpeed : this.tuning.upSpeed) * crouch));
    if (!klook || q3) {
      forward = add(forward, f((q3 ? moveSpeed : this.tuning.forwardSpeed) * fraction("forward")));
      forward = add(forward, -f((q3 ? moveSpeed : this.tuning.backSpeed) * fraction("back")));
    }
    if (!q3 && running) { forward *= this.tuning.moveSpeedMultiplier; side *= this.tuning.moveSpeedMultiplier; up *= this.tuning.moveSpeedMultiplier; }
    const mouse = this.mouse.sample(sample.mouse, sample.frameMilliseconds, strafe, active("mlook"), frame.kind === "q3" ? frame.sensitivity : 1, q3);
    forward = add(forward, mouse.forward); side = add(side, mouse.side);
    yaw = f(yaw + mouse.yaw - sample.gamepadLookDegrees.x); pitch = f(pitch + mouse.pitch + sample.gamepadLookDegrees.y);
    const padForward = q3 ? moveSpeed : this.tuning.forwardSpeed * (running ? this.tuning.moveSpeedMultiplier : 1);
    const padSide = q3 ? moveSpeed : this.tuning.sideSpeed * (running ? this.tuning.moveSpeedMultiplier : 1);
    forward = add(forward, sample.gamepadMove.y * padForward); side = add(side, sample.gamepadMove.x * padSide);
    let buttons = 0;
    const any = sample.anyKeyDown !== 0;
    if (q3) {
      for (let index = 0; index < 15; index++) if (pressed(`button${index}`)) buttons |= 1 << index;
      if (pressed("attack")) buttons |= 1;
      if (pressed("use")) buttons |= 4;
      if (!running) buttons |= 16;
      if (sample.focus.kind !== "game") buttons |= 2;
      else if (any) buttons |= 2048;
      pitch = Math.max(previousPitch - 90, Math.min(previousPitch + 90, pitch));
    } else {
      if (pressed("attack") && (frame.kind === "q1-netquake" || frame.kind === "q1-quakeworld" || frame.attackAllowed)) buttons |= 1;
      if (q1 && pressed("jump") || !q1 && pressed("use")) buttons |= 2;
      if (!q1 && any && sample.focus.kind === "game") buttons |= 128;
      if (frame.kind === "q2-rerelease") {
        if (pressed("holster")) buttons |= 4;
        if (pressed("jump") || pressed("move-up")) buttons |= 8;
        if (pressed("crouch") || pressed("move-down")) buttons |= 16;
      }
    }
    if (q1) pitch = Math.max(-70, Math.min(80, pitch));
    if (frame.kind === "q2-classic" || frame.kind === "q2-rerelease") {
      let delta = frame.deltaAngles.x;
      if (delta > 180) delta -= 360;
      if (pitch + delta < -360) pitch += 360;
      if (pitch + delta > 360) pitch -= 360;
      pitch = Math.max(-89 - delta, Math.min(89 - delta, pitch));
      forward = clamp(forward, 400); side = clamp(side, 400);
    }
    this.angles = { x: pitch, y: yaw, z: roll };
    const milliseconds = Math.trunc(sourceFrameMilliseconds > 250 ? 100 : sourceFrameMilliseconds);
    switch (frame.kind) {
      case "q1-netquake": return { kind: frame.kind, acknowledgedServerTimeSeconds: frame.acknowledgedServerTimeSeconds, viewAngles: this.viewAngles,
        forwardMove: Math.trunc(forward), sideMove: Math.trunc(side), upMove: Math.trunc(up), buttons, impulse: sample.impulse };
      case "q1-quakeworld": return { kind: frame.kind, milliseconds, angles: this.viewAngles,
        forwardMove: Math.trunc(forward), sideMove: Math.trunc(side), upMove: Math.trunc(up), buttons, impulse: sample.impulse };
      case "q2-classic": return { kind: frame.kind, milliseconds, angleShorts: words(this.angles),
        forwardMove: Math.trunc(forward), sideMove: Math.trunc(side), upMove: Math.trunc(up), buttons, impulse: sample.impulse, lightLevel: frame.lightLevel };
      case "q2-rerelease": return { kind: frame.kind, milliseconds, angles: this.viewAngles, forwardMove: forward, sideMove: side, buttons, serverFrame: frame.serverFrame };
      case "q3": return { kind: frame.kind, serverTimeMilliseconds: frame.serverTimeMilliseconds, angleWords: words(this.angles),
        forwardMove: Math.trunc(clamp(forward, 127)), rightMove: Math.trunc(clamp(side, 127)), upMove: Math.trunc(clamp(up, 127)), buttons, weapon: frame.weapon };
    }
  }
}
