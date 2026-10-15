/*
 * Translated vector and angle routines from Quake III Arena's q_math.c and
 * q_shared.h. Copyright (C) 1999-2005 Id Software, Inc.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import type { Vec2, Vec3, Vec4, MutableVec3, Bounds, Plane, Axis, AngleVectors, Mat4 } from "../contracts/math.ts";
import type { NumericOperations } from "../contracts/numeric.ts";
import { createNumericOperations, Q1_DONOR_PROFILE, Q2_DONOR_PROFILE, qvmFloatToInt } from "./numeric.ts";
export type { Vec2, Vec3, Vec4, MutableVec3, Bounds, Plane, Axis, AngleVectors, Mat4 } from "../contracts/math.ts";

/** The unqualified helpers retain the Q3 donor's operation sequence. */
const DEGREES_TO_RADIANS = Math.PI * 2 / 360;

export function vec2(x: number, y: number): Vec2 {
  return { x: Math.fround(x), y: Math.fround(y) };
}

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x: Math.fround(x), y: Math.fround(y), z: Math.fround(z) };
}

export function vec4(x: number, y: number, z: number, w: number): Vec4 {
  return {
    x: Math.fround(x),
    y: Math.fround(y),
    z: Math.fround(z),
    w: Math.fround(w),
  };
}

export function add3(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.x + b.x, a.y + b.y, a.z + b.z);
}

/** Allocation-free add3 for caller-owned scratch; output may alias an input. */
export function add3Into(out: MutableVec3, a: Vec3, b: Vec3): void {
  const x = Math.fround(a.x + b.x);
  const y = Math.fround(a.y + b.y);
  const z = Math.fround(a.z + b.z);
  out.x = x;
  out.y = y;
  out.z = z;
}

export function sub3(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Allocation-free sub3 for caller-owned scratch; output may alias an input. */
export function sub3Into(out: MutableVec3, a: Vec3, b: Vec3): void {
  const x = Math.fround(a.x - b.x);
  const y = Math.fround(a.y - b.y);
  const z = Math.fround(a.z - b.z);
  out.x = x;
  out.y = y;
  out.z = z;
}

export function scale3(value: Vec3, scale: number): Vec3 {
  return vec3(value.x * scale, value.y * scale, value.z * scale);
}

/** Allocation-free scale3 for caller-owned scratch; output may alias the input. */
export function scale3Into(out: MutableVec3, value: Vec3, scale: number): void {
  const x = Math.fround(value.x * scale);
  const y = Math.fround(value.y * scale);
  const z = Math.fround(value.z * scale);
  out.x = x;
  out.y = y;
  out.z = z;
}

export function dot3(a: Vec3, b: Vec3): number {
  return Math.fround(Math.fround(Math.fround(a.x * b.x) + Math.fround(a.y * b.y)) + Math.fround(a.z * b.z));
}

export function cross3(a: Vec3, b: Vec3): Vec3 {
  return vec3(
    Math.fround(a.y * b.z) - Math.fround(a.z * b.y),
    Math.fround(a.z * b.x) - Math.fround(a.x * b.z),
    Math.fround(a.x * b.y) - Math.fround(a.y * b.x),
  );
}

/** Allocation-free cross3; inputs are snapshotted first, so output may alias either input. */
export function cross3Into(out: MutableVec3, a: Vec3, b: Vec3): void {
  const ax = a.x;
  const ay = a.y;
  const az = a.z;
  const bx = b.x;
  const by = b.y;
  const bz = b.z;
  const x = Math.fround(Math.fround(ay * bz) - Math.fround(az * by));
  const y = Math.fround(Math.fround(az * bx) - Math.fround(ax * bz));
  const z = Math.fround(Math.fround(ax * by) - Math.fround(ay * bx));
  out.x = x;
  out.y = y;
  out.z = z;
}

export function length3(value: Vec3): number {
  return Math.fround(Math.sqrt(dot3(value, value)));
}

export function normalize3(value: Vec3): Vec3 {
  const length = length3(value);
  if (length === 0) {
    return vec3(value.x, value.y, value.z);
  }
  return scale3(value, Math.fround(1 / length));
}

/** q_math.c VectorNormalize2 clears its output when the stored length is zero. */
export function normalize3OrZero(value: Vec3): Vec3 {
  const length = length3(value);
  if (length === 0) {
    return vec3(0, 0, 0);
  }
  return scale3(value, Math.fround(1 / length));
}

/** Allocation-free normalize3; returns the length. Output may alias the input. */
export function normalize3Into(out: MutableVec3, value: Vec3): number {
  const length = length3(value);
  if (length === 0) {
    const x = Math.fround(value.x);
    const y = Math.fround(value.y);
    const z = Math.fround(value.z);
    out.x = x;
    out.y = y;
    out.z = z;
    return length;
  }
  scale3Into(out, value, Math.fround(1 / length));
  return length;
}

/** Allocation-free normalize3OrZero; returns the length. Output may alias the input. */
export function normalize3OrZeroInto(out: MutableVec3, value: Vec3): number {
  const length = length3(value);
  if (length === 0) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return length;
  }
  scale3Into(out, value, Math.fround(1 / length));
  return length;
}

function mathSignedInteger(value: number): number {
  if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
    throw new RangeError("q_math integer argument must be a signed 32-bit integer");
  }
  return value | 0;
}

/** q_math.c ClampShort consumes an int, not a floating-point conversion. */
export function clampShort(value: number): number {
  const integer = mathSignedInteger(value);
  if (integer < -32768) return -32768;
  if (integer > 32767) return 32767;
  return integer;
}

/** Q_log2 returns zero for zero; negative arithmetic shifts never terminate. */
export function qLog2(value: number): number {
  let integer = mathSignedInteger(value);
  if (integer < 0) throw new RangeError("Q_log2 does not terminate for negative source integers");
  let answer = 0;
  while ((integer >>= 1) !== 0) answer++;
  return answer;
}

/** NormalizeColor retains its ordered maximum and supports in-place output. */
export function normalizeColor(input: Vec3, output: MutableVec3): number {
  let maximum = Math.fround(input.x);
  if (Math.fround(input.y) > maximum) maximum = Math.fround(input.y);
  if (Math.fround(input.z) > maximum) maximum = Math.fround(input.z);
  if (maximum === 0) {
    output.x = 0;
    output.y = 0;
    output.z = 0;
  } else {
    output.x = Math.fround(Math.fround(input.x) / maximum);
    output.y = Math.fround(Math.fround(input.y) / maximum);
    output.z = Math.fround(Math.fround(input.z) / maximum);
  }
  return maximum;
}

function nativeColorByte(value: number): number {
  const integer = Math.trunc(Math.fround(Math.fround(value) * 255));
  if (!Number.isFinite(integer) || integer < 0 || integer > 255) {
    throw new RangeError("ColorBytes3 native float-to-byte conversion is outside its defined range");
  }
  return integer;
}

/** Native little-endian ColorBytes3; the caller supplies the retained fourth byte. */
export function colorBytes3(red: number, green: number, blue: number, storage: DataView): number {
  if (storage.byteLength < 4) throw new RangeError("ColorBytes3 requires a retained four-byte word");
  storage.setUint8(0, nativeColorByte(red));
  storage.setUint8(1, nativeColorByte(green));
  storage.setUint8(2, nativeColorByte(blue));
  return storage.getUint32(0, true);
}

export function lerp3(from: Vec3, to: Vec3, fraction: number): Vec3 {
  return vec3(
    from.x + fraction * (to.x - from.x),
    from.y + fraction * (to.y - from.y),
    from.z + fraction * (to.z - from.z),
  );
}

/** Allocation-free lerp3 for caller-owned scratch; output may alias an input. */
export function lerp3Into(out: MutableVec3, from: Vec3, to: Vec3, fraction: number): void {
  const x = Math.fround(from.x + fraction * (to.x - from.x));
  const y = Math.fround(from.y + fraction * (to.y - from.y));
  const z = Math.fround(from.z + fraction * (to.z - from.z));
  out.x = x;
  out.y = y;
  out.z = z;
}

/**
 * Double-precision vector arithmetic for sources whose intermediates stay
 * in JavaScript numbers (compiled Q2 gameplay, bot reasoning). One shared
 * definition per operation; binary32 sources use the staged forms above.
 */
export function add3Double(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub3Double(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale3Double(value: Vec3, scale: number): Vec3 {
  return { x: value.x * scale, y: value.y * scale, z: value.z * scale };
}

export function ma3Double(base: Vec3, scale: number, direction: Vec3): Vec3 {
  return { x: base.x + direction.x * scale, y: base.y + direction.y * scale, z: base.z + direction.z * scale };
}

export function dot3Double(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross3Double(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

export function length3Double(value: Vec3): number {
  return Math.sqrt(value.x * value.x + value.y * value.y + value.z * value.z);
}

export function lerp3Double(from: Vec3, to: Vec3, fraction: number): Vec3 {
  return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction, z: from.z + (to.z - from.z) * fraction };
}

/**
 * Cross product keeping double intermediates until the binary32 store,
 * matching native x87 expression evaluation in collision generation.
 */
export function cross3Stored(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

/** Sqrt-length normalization with double intermediates; zero returns the input. */
export function normalize3Stored(value: Vec3): Vec3 {
  const length = Math.sqrt(value.x * value.x + value.y * value.y + value.z * value.z);
  return length === 0 ? value : scale3(value, 1 / length);
}

/** Sqrt-length normalization with double intermediates; zero returns zero. */
export function normalize3StoredOrZero(value: Vec3): Vec3 {
  const length = Math.sqrt(value.x * value.x + value.y * value.y + value.z * value.z);
  return length === 0 ? vec3(0, 0, 0) : scale3(value, 1 / length);
}

export function hypot3(value: Vec3): number {
  return Math.hypot(value.x, value.y, value.z);
}

export function distance3Double(a: Vec3, b: Vec3): number {
  return length3Double(sub3Double(a, b));
}

/** Hypot-length normalization; a zero vector returns the input itself. */
export function normalize3DoubleHypot(value: Vec3): Vec3 {
  const magnitude = hypot3(value);
  return magnitude === 0 ? value : scale3Double(value, 1 / magnitude);
}

/** Sqrt-length normalization; a zero vector returns a fresh zero vector. */
export function normalize3DoubleOrZero(value: Vec3): Vec3 {
  const length = length3Double(value);
  if (length === 0) return { x: 0, y: 0, z: 0 };
  return { x: value.x / length, y: value.y / length, z: value.z / length };
}

function dotComponents(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  return Math.fround(Math.fround(Math.fround(ax * bx) + Math.fround(ay * by)) + Math.fround(az * bz));
}

/**
 * One AngleVectors computation for every source, following the C
 * foundation's qa_angle_math_rule: titles differ only in how degrees become
 * radians and where binary32 rounding lands. "float" is native staged
 * binary32, "vm" the QVM constant-folded conversion, "donor"/"q1" keep
 * double intermediates and round stored components (differing only in the
 * radian grouping), "native"/"bot" keep full double results.
 */
export type AngleMathRule = "float" | "vm" | "donor" | "q1" | "native" | "bot";

const VM_ANGLE_RADIANS = Math.fround(Math.PI * 2 / 360);
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Allocation-free AngleVectors under an explicit source rule. */
export function angleVectorsRuleInto(forward: MutableVec3, right: MutableVec3, up: MutableVec3, angles: Vec3, rule: AngleMathRule): void {
  if (rule === "float" || rule === "vm") {
    const yaw = rule === "vm" ? Math.fround(Math.fround(angles.y) * VM_ANGLE_RADIANS) : Math.fround(angles.y * DEGREES_TO_RADIANS);
    const pitch = rule === "vm" ? Math.fround(Math.fround(angles.x) * VM_ANGLE_RADIANS) : Math.fround(angles.x * DEGREES_TO_RADIANS);
    const roll = rule === "vm" ? Math.fround(Math.fround(angles.z) * VM_ANGLE_RADIANS) : Math.fround(angles.z * DEGREES_TO_RADIANS);
    const sy = Math.fround(Math.sin(yaw));
    const cy = Math.fround(Math.cos(yaw));
    const sp = Math.fround(Math.sin(pitch));
    const cp = Math.fround(Math.cos(pitch));
    const sr = Math.fround(Math.sin(roll));
    const cr = Math.fround(Math.cos(roll));
    forward.x = Math.fround(cp * cy);
    forward.y = Math.fround(cp * sy);
    forward.z = Math.fround(-sp);
    right.x = Math.fround(Math.fround(Math.fround(-sr * sp) * cy) + Math.fround(-cr * -sy));
    right.y = Math.fround(Math.fround(Math.fround(-sr * sp) * sy) + Math.fround(-cr * cy));
    right.z = Math.fround(-sr * cp);
    up.x = Math.fround(Math.fround(Math.fround(cr * sp) * cy) + Math.fround(-sr * -sy));
    up.y = Math.fround(Math.fround(Math.fround(cr * sp) * sy) + Math.fround(-sr * cy));
    up.z = Math.fround(cr * cp);
    return;
  }
  let yaw: number;
  let pitch: number;
  let roll: number;
  if (rule === "donor") {
    yaw = angles.y * DEGREES_TO_RADIANS; pitch = angles.x * DEGREES_TO_RADIANS; roll = angles.z * DEGREES_TO_RADIANS;
  } else if (rule === "bot") {
    yaw = angles.y * DEG_TO_RAD; pitch = angles.x * DEG_TO_RAD; roll = angles.z * DEG_TO_RAD;
  } else {
    yaw = angles.y * Math.PI / 180; pitch = angles.x * Math.PI / 180; roll = angles.z * Math.PI / 180;
  }
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch), sr = Math.sin(roll), cr = Math.cos(roll);
  if (rule === "donor" || rule === "q1") {
    forward.x = Math.fround(cp * cy); forward.y = Math.fround(cp * sy); forward.z = Math.fround(-sp);
    right.x = Math.fround(-sr * sp * cy + cr * sy); right.y = Math.fround(-sr * sp * sy - cr * cy); right.z = Math.fround(-sr * cp);
    up.x = Math.fround(cr * sp * cy + sr * sy); up.y = Math.fround(cr * sp * sy - sr * cy); up.z = Math.fround(cr * cp);
    return;
  }
  forward.x = cp * cy; forward.y = cp * sy; forward.z = -sp;
  right.x = -sr * sp * cy + cr * sy; right.y = -sr * sp * sy - cr * cy; right.z = -sr * cp;
  up.x = cr * sp * cy + sr * sy; up.y = cr * sp * sy - sr * cy; up.z = cr * cp;
}

export function angleVectorsRule(angles: Vec3, rule: AngleMathRule): AngleVectors {
  const forward = { x: 0, y: 0, z: 0 };
  const right = { x: 0, y: 0, z: 0 };
  const up = { x: 0, y: 0, z: 0 };
  angleVectorsRuleInto(forward, right, up, angles, rule);
  return { forward, right, up };
}

/** Allocation-free angleVectors for caller-owned scratch. */
export function angleVectorsInto(forward: MutableVec3, right: MutableVec3, up: MutableVec3, angles: Vec3): void {
  angleVectorsRuleInto(forward, right, up, angles, "float");
}

/** Angles use x = pitch, y = yaw, z = roll, in degrees. */
export function angleVectors(angles: Vec3): AngleVectors {
  return angleVectorsRule(angles, "float");
}

export function anglesToAxis(angles: Vec3): Axis {
  const vectors = angleVectors(angles);
  return [vectors.forward, scale3(vectors.right, -1), vectors.up];
}

/** Allocation-free anglesToAxis: writes forward, left (negated right) and up. */
export function anglesToAxisInto(forward: MutableVec3, left: MutableVec3, up: MutableVec3, angles: Vec3): void {
  angleVectorsInto(forward, left, up, angles);
  left.x = Math.fround(left.x * -1);
  left.y = Math.fround(left.y * -1);
  left.z = Math.fround(left.z * -1);
}

export type VectorToAnglesRule = "float" | "native" | "native-ai" | "bot" | "bot-q3";

/**
 * One VectorToAngles for every source. "float" is the staged binary32 form,
 * "native" the double form with wrapped pitch, "native-ai" the double form
 * without vertical/pitch wrapping, "bot" the bot brain's modulo form
 * (x holds its pitch, which is negative looking up).
 */
export function vectorToAnglesRule(value: Vec3, rule: VectorToAnglesRule): Vec3 {
  if (rule === "native") {
    if (value.x === 0 && value.y === 0) return { x: value.z > 0 ? -90 : -270, y: 0, z: 0 };
    let yaw = Math.atan2(value.y, value.x) * 180 / Math.PI;
    if (yaw < 0) yaw += 360;
    let pitch = Math.atan2(value.z, Math.hypot(value.x, value.y)) * 180 / Math.PI;
    if (pitch < 0) pitch += 360;
    return { x: -pitch, y: yaw, z: 0 };
  }
  if (rule === "native-ai") {
    const yaw = value.x === 0 && value.y === 0 ? 0 : Math.atan2(value.y, value.x) * 180 / Math.PI;
    const pitch = Math.atan2(value.z, Math.hypot(value.x, value.y)) * 180 / Math.PI;
    return { x: -pitch, y: yaw < 0 ? yaw + 360 : yaw, z: 0 };
  }
  if (rule === "bot") {
    if (value.x === 0 && value.y === 0) return { x: value.z > 0 ? -90 : 90, y: 0, z: 0 };
    const yaw = ((Math.atan2(value.y, value.x) * RAD_TO_DEG % 360) + 360) % 360;
    const forward = Math.sqrt(value.x * value.x + value.y * value.y);
    return { x: -Math.atan2(value.z, forward) * RAD_TO_DEG, y: yaw, z: 0 };
  }
  if (rule === "bot-q3") {
    let yaw: number;
    let pitch: number;
    if (value.y === 0 && value.x === 0) {
      yaw = 0;
      pitch = value.z > 0 ? 90 : 270;
    } else {
      yaw = value.x !== 0 ? Math.fround(Math.atan2(value.y, value.x) * 180 / Math.PI) : value.y > 0 ? 90 : 270;
      if (yaw < 0) yaw = Math.fround(yaw + 360);
      const forward = Math.fround(Math.sqrt(Math.fround(Math.fround(value.x * value.x) + Math.fround(value.y * value.y))));
      pitch = Math.fround(Math.atan2(value.z, forward) * 180 / Math.PI);
      if (pitch < 0) pitch = Math.fround(pitch + 360);
    }
    return vec3(-pitch, yaw, 0);
  }
  return vectorToAnglesFloat(value);
}

function vectorToAnglesFloat(value: Vec3): Vec3 {
  const qvmPi = Math.fround(Math.PI);
  let yaw: number;
  let pitch: number;

  if (value.y === 0 && value.x === 0) {
    yaw = 0;
    pitch = value.z > 0 ? 90 : 270;
  } else {
    if (value.x !== 0) {
      const yawRadians = Math.fround(Math.atan2(value.y, value.x));
      yaw = Math.fround(Math.fround(yawRadians * 180) / qvmPi);
    } else {
      yaw = value.y > 0 ? 90 : 270;
    }
    if (yaw < 0) {
      yaw = Math.fround(yaw + 360);
    }

    const xSquared = Math.fround(value.x * value.x);
    const ySquared = Math.fround(value.y * value.y);
    const forwardSquared = Math.fround(xSquared + ySquared);
    const forward = Math.fround(Math.sqrt(forwardSquared));
    const pitchRadians = Math.fround(Math.atan2(value.z, forward));
    pitch = Math.fround(Math.fround(pitchRadians * 180) / qvmPi);
    if (pitch < 0) {
      pitch = Math.fround(pitch + 360);
    }
  }

  return vec3(-pitch, yaw, 0);
}

export function vectorToAngles(value: Vec3): Vec3 {
  return vectorToAnglesFloat(value);
}

export function angleMod(angle: number): number {
  return (360 / 65536) * ((angle * (65536 / 360)) & 65535);
}

/** Q2 compiled-gameplay anglemod grouping: truncating scaled multiply first. */
export function angleModScaled(angle: number): number {
  return (Math.trunc(angle * 65536 / 360) & 65535) * 360 / 65536;
}

/** AngleMod's QVM MULF4 precedes truncation and the unsigned angle16 mask. */
export function qvmAngleMod(angle: number): number {
  const scaled = Math.fround(Math.fround(angle) * Math.fround(65536 / 360));
  return Math.fround((qvmFloatToInt(scaled) & 65535) * Math.fround(360 / 65536));
}

/** QVM float inputs, x = pitch, y = yaw, z = roll, in degrees. */
export function qvmAngleVectors(angles: Vec3): AngleVectors {
  return angleVectorsRule(angles, "vm");
}

export function qvmAnglesToAxis(angles: Vec3): Axis {
  const vectors = qvmAngleVectors(angles);
  return [vectors.forward, sub3(vec3(0, 0, 0), vectors.right), vectors.up];
}

export function angleNormalize360(angle: number): number {
  return angleMod(angle);
}

export function angleNormalize180(angle: number): number {
  const normalized = angleNormalize360(angle);
  return normalized > 180 ? normalized - 360 : normalized;
}

export function angleDelta(angle1: number, angle2: number): number {
  return angleNormalize180(angle1 - angle2);
}

/** Allocation-free projectPointOnPlane; output may alias an input. */
export function projectPointOnPlaneInto(out: MutableVec3, point: Vec3, normal: Vec3): void {
  const px = point.x;
  const py = point.y;
  const pz = point.z;
  const nx = normal.x;
  const ny = normal.y;
  const nz = normal.z;
  const inverseDenominator = Math.fround(1 / dotComponents(nx, ny, nz, nx, ny, nz));
  const distance = Math.fround(dotComponents(nx, ny, nz, px, py, pz) * inverseDenominator);
  const sx = Math.fround(nx * inverseDenominator);
  const sy = Math.fround(ny * inverseDenominator);
  const sz = Math.fround(nz * inverseDenominator);
  out.x = Math.fround(px - Math.fround(sx * distance));
  out.y = Math.fround(py - Math.fround(sy * distance));
  out.z = Math.fround(pz - Math.fround(sz * distance));
}

/** Preserves q_math.c semantics, whose normal is expected to be nonzero. */
export function projectPointOnPlane(point: Vec3, normal: Vec3): Vec3 {
  const out = { x: 0, y: 0, z: 0 };
  projectPointOnPlaneInto(out, point, normal);
  return out;
}

/** Allocation-free perpendicularVector. The source must be normalized. */
export function perpendicularVectorInto(out: MutableVec3, source: Vec3): void {
  const sx = source.x;
  const sy = source.y;
  const sz = source.z;
  let ax = 1;
  let ay = 0;
  let az = 0;
  let minimum = 1;
  if (Math.abs(sx) < minimum) {
    minimum = Math.abs(sx);
    ax = 1;
    ay = 0;
    az = 0;
  }
  if (Math.abs(sy) < minimum) {
    minimum = Math.abs(sy);
    ax = 0;
    ay = 1;
    az = 0;
  }
  if (Math.abs(sz) < minimum) {
    ax = 0;
    ay = 0;
    az = 1;
  }
  const inverseDenominator = Math.fround(1 / dotComponents(sx, sy, sz, sx, sy, sz));
  const distance = Math.fround(dotComponents(sx, sy, sz, ax, ay, az) * inverseDenominator);
  const px = Math.fround(ax - Math.fround(Math.fround(sx * inverseDenominator) * distance));
  const py = Math.fround(ay - Math.fround(Math.fround(sy * inverseDenominator) * distance));
  const pz = Math.fround(az - Math.fround(Math.fround(sz * inverseDenominator) * distance));
  const length = Math.fround(Math.sqrt(dotComponents(px, py, pz, px, py, pz)));
  if (length === 0) {
    out.x = px;
    out.y = py;
    out.z = pz;
    return;
  }
  const scale = Math.fround(1 / length);
  out.x = Math.fround(px * scale);
  out.y = Math.fround(py * scale);
  out.z = Math.fround(pz * scale);
}

/** The source vector must be normalized, matching q_math.c. */
export function perpendicularVector(source: Vec3): Vec3 {
  const out = { x: 0, y: 0, z: 0 };
  perpendicularVectorInto(out, source);
  return out;
}

type Mat3 = readonly [Vec3, Vec3, Vec3];

/** Row-major 3x3 product over flat scratch, with dot3's staged rounding per element. Plain arrays retain NaN payloads like the former vector objects; typed arrays would canonicalize them. */
function multiplyMat3Into(out: number[], a: readonly number[], b: readonly number[]): void {
  for (let row = 0; row < 3; row++) {
    const ax = a[row * 3] ?? 0;
    const ay = a[row * 3 + 1] ?? 0;
    const az = a[row * 3 + 2] ?? 0;
    for (let column = 0; column < 3; column++) {
      out[row * 3 + column] = dotComponents(ax, ay, az, b[column] ?? 0, b[3 + column] ?? 0, b[6 + column] ?? 0);
    }
  }
}

/**
 * Allocation-free RotatePointAroundVector under an explicit source rule.
 * The direction must be normalized. The VM rule rounds inputs first and
 * converts degrees through its float32 PI divide, as q3lcc emits them.
 */
export function rotatePointAroundVectorRuleInto(out: MutableVec3, direction: Vec3, point: Vec3, degrees: number, rule: "float" | "vm"): void {
  const forward: Vec3 = rule === "vm" ? vec3(direction.x, direction.y, direction.z) : direction;
  const input: Vec3 = rule === "vm" ? vec3(point.x, point.y, point.z) : point;
  const radial = { x: 0, y: 0, z: 0 };
  const vertical = { x: 0, y: 0, z: 0 };
  perpendicularVectorInto(radial, forward);
  cross3Into(vertical, radial, forward);
  const radians = rule === "vm"
    ? Math.fround(Math.fround(Math.fround(degrees) * Math.fround(Math.PI)) / 180)
    : Math.fround(Math.fround(degrees) * Math.PI / 180);
  const cosine = Math.fround(Math.cos(radians));
  const sine = Math.fround(Math.sin(radians));
  const basis: readonly number[] = [
    radial.x, vertical.x, forward.x,
    radial.y, vertical.y, forward.y,
    radial.z, vertical.z, forward.z,
  ];
  const zRotation: readonly number[] = [cosine, sine, 0, -sine, cosine, 0, 0, 0, 1];
  const inverse: readonly number[] = [
    radial.x, radial.y, radial.z,
    vertical.x, vertical.y, vertical.z,
    forward.x, forward.y, forward.z,
  ];
  const temporary: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const rotation: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  multiplyMat3Into(temporary, basis, zRotation);
  multiplyMat3Into(rotation, temporary, inverse);
  const px = input.x;
  const py = input.y;
  const pz = input.z;
  out.x = dotComponents(rotation[0] ?? 0, rotation[1] ?? 0, rotation[2] ?? 0, px, py, pz);
  out.y = dotComponents(rotation[3] ?? 0, rotation[4] ?? 0, rotation[5] ?? 0, px, py, pz);
  out.z = dotComponents(rotation[6] ?? 0, rotation[7] ?? 0, rotation[8] ?? 0, px, py, pz);
}

/** Allocation-free rotatePointAroundVector. The direction must be normalized. */
export function rotatePointAroundVectorInto(out: MutableVec3, direction: Vec3, point: Vec3, degrees: number): void {
  rotatePointAroundVectorRuleInto(out, direction, point, degrees, "float");
}

/** Direction must be normalized, as required by the original QVM routine. */
export function qvmRotatePointAroundVector(direction: Vec3, point: Vec3, degrees: number): Vec3 {
  const out = { x: 0, y: 0, z: 0 };
  rotatePointAroundVectorRuleInto(out, direction, point, degrees, "vm");
  return out;
}

/** The rotation direction must be normalized, matching q_math.c. */
export function rotatePointAroundVector(
  direction: Vec3,
  point: Vec3,
  degrees: number,
): Vec3 {
  const out = { x: 0, y: 0, z: 0 };
  rotatePointAroundVectorInto(out, direction, point, degrees);
  return out;
}

/** Inclusive axis-aligned bounds overlap over object bounds. */
export function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.y <= b.max.y && a.max.y >= b.min.y && a.min.z <= b.max.z && a.max.z >= b.min.z;
}

export function emptyBounds(): Bounds {
  return {
    min: vec3(99999, 99999, 99999),
    max: vec3(-99999, -99999, -99999),
  };
}

export function addPointToBounds(bounds: Bounds, point: Vec3): Bounds {
  return {
    min: vec3(
      point.x < bounds.min.x ? point.x : bounds.min.x,
      point.y < bounds.min.y ? point.y : bounds.min.y,
      point.z < bounds.min.z ? point.z : bounds.min.z,
    ),
    max: vec3(
      point.x > bounds.max.x ? point.x : bounds.max.x,
      point.y > bounds.max.y ? point.y : bounds.max.y,
      point.z > bounds.max.z ? point.z : bounds.max.z,
    ),
  };
}

export function radiusFromBounds(bounds: Bounds): number {
  const minX = Math.abs(bounds.min.x);
  const minY = Math.abs(bounds.min.y);
  const minZ = Math.abs(bounds.min.z);
  const maxX = Math.abs(bounds.max.x);
  const maxY = Math.abs(bounds.max.y);
  const maxZ = Math.abs(bounds.max.z);
  const cornerX = Math.fround(minX > maxX ? minX : maxX);
  const cornerY = Math.fround(minY > maxY ? minY : maxY);
  const cornerZ = Math.fround(minZ > maxZ ? minZ : maxZ);
  return Math.fround(Math.sqrt(dotComponents(cornerX, cornerY, cornerZ, cornerX, cornerY, cornerZ)));
}

/** Returns null for a degenerate triangle. Clockwise points produce an outward normal. */
export function planeFromPoints(a: Vec3, b: Vec3, c: Vec3): Plane | null {
  const firstX = Math.fround(b.x - a.x);
  const firstY = Math.fround(b.y - a.y);
  const firstZ = Math.fround(b.z - a.z);
  const secondX = Math.fround(c.x - a.x);
  const secondY = Math.fround(c.y - a.y);
  const secondZ = Math.fround(c.z - a.z);
  const crossX = Math.fround(Math.fround(secondY * firstZ) - Math.fround(secondZ * firstY));
  const crossY = Math.fround(Math.fround(secondZ * firstX) - Math.fround(secondX * firstZ));
  const crossZ = Math.fround(Math.fround(secondX * firstY) - Math.fround(secondY * firstX));
  const length = Math.fround(Math.sqrt(dotComponents(crossX, crossY, crossZ, crossX, crossY, crossZ)));
  if (length === 0) {
    return null;
  }
  const scale = Math.fround(1 / length);
  const normal = vec3(crossX * scale, crossY * scale, crossZ * scale);
  return { normal, distance: dot3(a, normal) };
}

export function distanceToPlane(plane: Plane, point: Vec3): number {
  return dot3(plane.normal, point) - plane.distance;
}

/** Returns Quake's front/back bitmask: 1 front, 2 back, or 3 crossing. */
export function boxOnPlaneSide(bounds: Bounds, plane: Plane): number {
  const nx = plane.normal.x;
  const ny = plane.normal.y;
  const nz = plane.normal.z;
  const frontDistance = dotComponents(nx, ny, nz,
    Math.fround(nx < 0 ? bounds.min.x : bounds.max.x),
    Math.fround(ny < 0 ? bounds.min.y : bounds.max.y),
    Math.fround(nz < 0 ? bounds.min.z : bounds.max.z)) - plane.distance;
  const backDistance = dotComponents(nx, ny, nz,
    Math.fround(nx < 0 ? bounds.max.x : bounds.min.x),
    Math.fround(ny < 0 ? bounds.max.y : bounds.min.y),
    Math.fround(nz < 0 ? bounds.max.z : bounds.min.z)) - plane.distance;
  let sides = 0;
  if (frontDistance >= 0) {
    sides = 1;
  }
  if (backDistance < 0) {
    sides |= 2;
  }
  return sides;
}

export function identityMat4(): Mat4 {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

export function multiplyMat4(a: Mat4, b: Mat4): Mat4 {
  return [
    a[0] * b[0] + a[4] * b[1] + a[8] * b[2] + a[12] * b[3],
    a[1] * b[0] + a[5] * b[1] + a[9] * b[2] + a[13] * b[3],
    a[2] * b[0] + a[6] * b[1] + a[10] * b[2] + a[14] * b[3],
    a[3] * b[0] + a[7] * b[1] + a[11] * b[2] + a[15] * b[3],
    a[0] * b[4] + a[4] * b[5] + a[8] * b[6] + a[12] * b[7],
    a[1] * b[4] + a[5] * b[5] + a[9] * b[6] + a[13] * b[7],
    a[2] * b[4] + a[6] * b[5] + a[10] * b[6] + a[14] * b[7],
    a[3] * b[4] + a[7] * b[5] + a[11] * b[6] + a[15] * b[7],
    a[0] * b[8] + a[4] * b[9] + a[8] * b[10] + a[12] * b[11],
    a[1] * b[8] + a[5] * b[9] + a[9] * b[10] + a[13] * b[11],
    a[2] * b[8] + a[6] * b[9] + a[10] * b[10] + a[14] * b[11],
    a[3] * b[8] + a[7] * b[9] + a[11] * b[10] + a[15] * b[11],
    a[0] * b[12] + a[4] * b[13] + a[8] * b[14] + a[12] * b[15],
    a[1] * b[12] + a[5] * b[13] + a[9] * b[14] + a[13] * b[15],
    a[2] * b[12] + a[6] * b[13] + a[10] * b[14] + a[14] * b[15],
    a[3] * b[12] + a[7] * b[13] + a[11] * b[14] + a[15] * b[15],
  ];
}

/** Builds a right-handed OpenGL perspective matrix with NDC depth [-1, 1]. */
export function perspectiveMat4(
  verticalFieldOfViewDegrees: number,
  aspectRatio: number,
  near: number,
  far: number,
): Mat4 {
  const focalLength = 1 / Math.tan(verticalFieldOfViewDegrees * DEGREES_TO_RADIANS / 2);
  const depthScale = 1 / (near - far);
  return [
    focalLength / aspectRatio, 0, 0, 0,
    0, focalLength, 0, 0,
    0, 0, (far + near) * depthScale, -1,
    0, 0, 2 * far * near * depthScale, 0,
  ];
}

/** Builds a right-handed world-to-view matrix. */
export function lookAtMat4(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  let backwardX = Math.fround(eye.x - target.x);
  let backwardY = Math.fround(eye.y - target.y);
  let backwardZ = Math.fround(eye.z - target.z);
  const backwardLength = Math.fround(Math.sqrt(dotComponents(backwardX, backwardY, backwardZ, backwardX, backwardY, backwardZ)));
  if (backwardLength !== 0) {
    const scale = Math.fround(1 / backwardLength);
    backwardX = Math.fround(backwardX * scale);
    backwardY = Math.fround(backwardY * scale);
    backwardZ = Math.fround(backwardZ * scale);
  }
  let rightX = Math.fround(Math.fround(up.y * backwardZ) - Math.fround(up.z * backwardY));
  let rightY = Math.fround(Math.fround(up.z * backwardX) - Math.fround(up.x * backwardZ));
  let rightZ = Math.fround(Math.fround(up.x * backwardY) - Math.fround(up.y * backwardX));
  const rightLength = Math.fround(Math.sqrt(dotComponents(rightX, rightY, rightZ, rightX, rightY, rightZ)));
  if (rightLength !== 0) {
    const scale = Math.fround(1 / rightLength);
    rightX = Math.fround(rightX * scale);
    rightY = Math.fround(rightY * scale);
    rightZ = Math.fround(rightZ * scale);
  }
  const cameraUpX = Math.fround(Math.fround(backwardY * rightZ) - Math.fround(backwardZ * rightY));
  const cameraUpY = Math.fround(Math.fround(backwardZ * rightX) - Math.fround(backwardX * rightZ));
  const cameraUpZ = Math.fround(Math.fround(backwardX * rightY) - Math.fround(backwardY * rightX));
  return [
    rightX, cameraUpX, backwardX, 0,
    rightY, cameraUpY, backwardY, 0,
    rightZ, cameraUpZ, backwardZ, 0,
    -dotComponents(rightX, rightY, rightZ, eye.x, eye.y, eye.z),
    -dotComponents(cameraUpX, cameraUpY, cameraUpZ, eye.x, eye.y, eye.z),
    -dotComponents(backwardX, backwardY, backwardZ, eye.x, eye.y, eye.z), 1,
  ];
}

export function transformVec4(matrix: Mat4, value: Vec4): Vec4 {
  return vec4(
    matrix[0] * value.x + matrix[4] * value.y + matrix[8] * value.z + matrix[12] * value.w,
    matrix[1] * value.x + matrix[5] * value.y + matrix[9] * value.z + matrix[13] * value.w,
    matrix[2] * value.x + matrix[6] * value.y + matrix[10] * value.z + matrix[14] * value.w,
    matrix[3] * value.x + matrix[7] * value.y + matrix[11] * value.z + matrix[15] * value.w,
  );
}

/** Shared guest storage keeps overlapping vectors and binary32 writes observable. */
export class Float32VectorView implements MutableVec3 {
  private readonly view: DataView;

  constructor(data: Uint8Array | Float32Array | DataView, byteOffset = 0) {
    if (!Number.isSafeInteger(byteOffset) || byteOffset < 0 || byteOffset > data.byteLength - 12) {
      throw new RangeError("A vector requires twelve bytes within its guest memory view");
    }
    this.view = new DataView(data.buffer, data.byteOffset + byteOffset, 12);
  }

  get x(): number { return this.view.getFloat32(0, true); }
  set x(value: number) { this.view.setFloat32(0, value, true); }
  get y(): number { return this.view.getFloat32(4, true); }
  set y(value: number) { this.view.setFloat32(4, value, true); }
  get z(): number { return this.view.getFloat32(8, true); }
  set z(value: number) { this.view.setFloat32(8, value, true); }
}

/**
 * Retained binary32 storage for caller-owned scratch. The DataView backing
 * is observable behavior, not an implementation detail: reads canonicalize
 * NaN payloads exactly like guest vector reads, which plain number fields
 * would preserve differently. Allocation-free work on plain Vec3 values
 * belongs in the *Into helpers and the foundation vector store.
 */
export function mutableVec3(x = 0, y = 0, z = 0): MutableVec3 {
  const result = new Float32VectorView(new Uint8Array(12));
  result.x = x;
  result.y = y;
  result.z = z;
  return result;
}

/** Q1/Q2 mathlib macros write each component in source order, including aliases. */
export function createMutableVectorMath(operations: NumericOperations, zeroLengthOutput: "preserve" | "clear") {
  const donorArithmetic = operations.profile.arithmetic.kind === "donor-binary64";
  function DotProduct(a: Vec3, b: Vec3): number {
    return operations.add(operations.add(operations.multiply(a.x, b.x), operations.multiply(a.y, b.y)), operations.multiply(a.z, b.z));
  }

  function VectorSet(output: MutableVec3, x: number, y: number, z: number): void {
    output.x = operations.store(x);
    output.y = operations.store(y);
    output.z = operations.store(z);
  }

  function VectorCopy(input: Vec3, output: MutableVec3): void {
    output.x = operations.store(input.x);
    output.y = operations.store(input.y);
    output.z = operations.store(input.z);
  }

  function VectorAdd(a: Vec3, b: Vec3, output: MutableVec3): void {
    output.x = operations.store(operations.add(a.x, b.x));
    output.y = operations.store(operations.add(a.y, b.y));
    output.z = operations.store(operations.add(a.z, b.z));
  }

  function VectorSubtract(a: Vec3, b: Vec3, output: MutableVec3): void {
    output.x = operations.store(operations.subtract(a.x, b.x));
    output.y = operations.store(operations.subtract(a.y, b.y));
    output.z = operations.store(operations.subtract(a.z, b.z));
  }

  function VectorScale(input: Vec3, scale: number, output: MutableVec3): void {
    output.x = operations.store(operations.multiply(input.x, scale));
    output.y = operations.store(operations.multiply(input.y, scale));
    output.z = operations.store(operations.multiply(input.z, scale));
  }

  function VectorMA(a: Vec3, scale: number, b: Vec3, output: MutableVec3): void {
    output.x = operations.store(operations.add(a.x, operations.multiply(scale, b.x)));
    output.y = operations.store(operations.add(a.y, operations.multiply(scale, b.y)));
    output.z = operations.store(operations.add(a.z, operations.multiply(scale, b.z)));
  }

  function CrossProduct(a: Vec3, b: Vec3, output: MutableVec3): void {
    output.x = operations.store(operations.subtract(operations.multiply(a.y, b.z), operations.multiply(a.z, b.y)));
    output.y = operations.store(operations.subtract(operations.multiply(a.z, b.x), operations.multiply(a.x, b.z)));
    output.z = operations.store(operations.subtract(operations.multiply(a.x, b.y), operations.multiply(a.y, b.x)));
  }

  function VectorLength(input: Vec3): number { return operations.squareRoot(DotProduct(input, input)); }

  function VectorNormalize(input: MutableVec3): number {
    const length = VectorLength(input);
    if (donorArithmetic ? Boolean(length) : length !== 0) VectorScale(input, operations.divide(1, length), input);
    return length;
  }

  function VectorNormalize2(input: Vec3, output: MutableVec3): number {
    const length = VectorLength(input);
    if (donorArithmetic ? Boolean(length) : length !== 0) VectorScale(input, operations.divide(1, length), output);
    else if (zeroLengthOutput === "clear" && length === 0) VectorSet(output, 0, 0, 0);
    return length;
  }

  function VectorClear(output: MutableVec3): void {
    // The source chained assignment visits z, y, x.
    output.z = 0;
    output.y = 0;
    output.x = 0;
  }

  function VectorNegate(input: Vec3, output: MutableVec3): void {
    output.x = operations.store(-input.x);
    output.y = operations.store(-input.y);
    output.z = operations.store(-input.z);
  }

  function VectorInverse(input: MutableVec3): void { VectorNegate(input, input); }

  function VectorCompare(a: Vec3, b: Vec3): number { return a.x === b.x && a.y === b.y && a.z === b.z ? 1 : 0; }

  function ProjectPointOnPlane(output: MutableVec3, point: Vec3, normal: Vec3): void {
    const inverse = operations.divide(1, DotProduct(normal, normal));
    const distance = operations.multiply(DotProduct(normal, point), inverse);
    const scaled = mutableVec3();
    VectorScale(normal, inverse, scaled);
    output.x = operations.store(operations.subtract(point.x, operations.multiply(distance, scaled.x)));
    output.y = operations.store(operations.subtract(point.y, operations.multiply(distance, scaled.y)));
    output.z = operations.store(operations.subtract(point.z, operations.multiply(distance, scaled.z)));
  }

  function PerpendicularVector(output: MutableVec3, source: Vec3): void {
    let axis: "x" | "y" | "z" = "x";
    let minimum = 1;
    for (const component of ["x", "y", "z"] satisfies (keyof Vec3)[]) {
      if (Math.abs(source[component]) < minimum) {
        minimum = Math.abs(source[component]);
        axis = component;
      }
    }
    const temporary = mutableVec3();
    temporary[axis] = 1;
    ProjectPointOnPlane(output, temporary, source);
    VectorNormalize(output);
  }

  function ClearBounds(minimum: MutableVec3, maximum: MutableVec3): void {
    minimum.x = minimum.y = minimum.z = 99999;
    maximum.x = maximum.y = maximum.z = -99999;
  }

  function AddPointToBounds(point: Vec3, minimum: MutableVec3, maximum: MutableVec3): void {
    for (const component of ["x", "y", "z"] satisfies (keyof Vec3)[]) {
      const value = point[component];
      if (value < minimum[component]) minimum[component] = operations.store(value);
      if (value > maximum[component]) maximum[component] = operations.store(value);
    }
  }

  return {
    operations, DotProduct, VectorSet, VectorCopy, VectorAdd, VectorSubtract,
    VectorScale, VectorMA, CrossProduct, VectorLength, VectorNormalize,
    VectorNormalize2, VectorClear, VectorNegate, VectorInverse, VectorCompare,
    ProjectPointOnPlane, PerpendicularVector, ClearBounds, AddPointToBounds,
  };
}

export const q1DonorMath = {
  ...createMutableVectorMath(createNumericOperations(Q1_DONOR_PROFILE), "preserve"),
  AngleVectors: donorAngleVectors,
  R_ConcatRotations: donorConcatRotations,
  RotatePointAroundVector: donorRotatePointAroundVector,
};
export const q2DonorMath = {
  ...createMutableVectorMath(createNumericOperations(Q2_DONOR_PROFILE), "preserve"),
  AngleVectors: donorAngleVectors,
  R_ConcatRotations: donorConcatRotations,
  RotatePointAroundVector: donorRotatePointAroundVector,
};

/** Q1/Q2 donors keep trigonometric intermediates in JavaScript numbers. */
const donorScratch: MutableVec3 = { x: 0, y: 0, z: 0 };

export function donorAngleVectors(angles: Vec3, forward: MutableVec3 | null, right: MutableVec3 | null, up: MutableVec3 | null): void {
  angleVectorsRuleInto(forward ?? donorScratch, right ?? donorScratch, up ?? donorScratch, angles, "donor");
}

export type MutableMat3 = readonly [MutableVec3, MutableVec3, MutableVec3];

export function donorConcatRotations(first: Mat3, second: Mat3, output: MutableMat3): void {
  for (const [row, target] of [[first[0], output[0]], [first[1], output[1]], [first[2], output[2]]] satisfies [Vec3, MutableVec3][]) {
    target.x = Math.fround(row.x * second[0].x + row.y * second[1].x + row.z * second[2].x);
    target.y = Math.fround(row.x * second[0].y + row.y * second[1].y + row.z * second[2].y);
    target.z = Math.fround(row.x * second[0].z + row.y * second[1].z + row.z * second[2].z);
  }
}

export function donorRotatePointAroundVector(output: MutableVec3, direction: Vec3, point: Vec3, degrees: number): void {
  const forward = mutableVec3(direction.x, direction.y, direction.z);
  const radial = mutableVec3();
  const vertical = mutableVec3();
  q1DonorMath.PerpendicularVector(radial, direction);
  q1DonorMath.CrossProduct(radial, forward, vertical);
  const basis: Mat3 = [
    vec3(radial.x, vertical.x, forward.x),
    vec3(radial.y, vertical.y, forward.y),
    vec3(radial.z, vertical.z, forward.z),
  ];
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians), sine = Math.sin(radians);
  const rotation: Mat3 = [vec3(cosine, sine, 0), vec3(-sine, cosine, 0), vec3(0, 0, 1)];
  const temporary: MutableMat3 = [mutableVec3(), mutableVec3(), mutableVec3()];
  const result: MutableMat3 = [mutableVec3(), mutableVec3(), mutableVec3()];
  donorConcatRotations(basis, rotation, temporary);
  donorConcatRotations(temporary, [radial, vertical, forward], result);
  output.x = Math.fround(q1DonorMath.DotProduct(result[0], point));
  output.y = Math.fround(q1DonorMath.DotProduct(result[1], point));
  output.z = Math.fround(q1DonorMath.DotProduct(result[2], point));
}

/** q_shared.c takes the shortest angular path before interpolating. */
export type LerpAngleRule = "native" | "delta" | "float";

/**
 * One LerpAngle for every source: "native" adjusts the end angle in double,
 * "delta" adjusts the delta in double (Q2 gameplay), "float" stages every
 * operation in binary32 (Q3 presentation/prediction).
 */
export function lerpAngleRule(from: number, to: number, fraction: number, rule: LerpAngleRule): number {
  if (rule === "delta") {
    const delta = to - from;
    return from + (delta > 180 ? delta - 360 : delta < -180 ? delta + 360 : delta) * fraction;
  }
  if (rule === "float") {
    let end = to;
    if (Math.fround(end - from) > 180) end = Math.fround(end - 360);
    if (Math.fround(end - from) < -180) end = Math.fround(end + 360);
    return Math.fround(from + Math.fround(fraction * Math.fround(end - from)));
  }
  let end = to;
  if (end - from > 180) end -= 360;
  if (end - from < -180) end += 360;
  return from + fraction * (end - from);
}

export function lerpAngle(from: number, to: number, fraction: number): number {
  return lerpAngleRule(from, to, fraction, "native");
}

/** NetQuake per-axis angle interpolation through the +540 modulo form. */
export function lerpAnglesWrapped(a: Vec3, b: Vec3, fraction: number): Vec3 {
  const axis = (from: number, to: number): number => from + (((to - from + 540) % 360) - 180) * fraction;
  return { x: axis(a.x, b.x), y: axis(a.y, b.y), z: axis(a.z, b.z) };
}

/** Quake's software renderer uses floor division, including negative numerators. */
export function floorDivMod(numerator: number, denominator: number): { quotient: number; remainder: number } {
  if (denominator <= 0) throw new RangeError("FloorDivMod: bad denominator");
  let quotient: number;
  let remainder: number;
  if (numerator >= 0) {
    quotient = Math.trunc(Math.floor(numerator / denominator));
    remainder = Math.trunc(Math.floor(numerator - quotient * denominator));
  } else {
    const positive = Math.floor(-numerator / denominator);
    quotient = -Math.trunc(positive);
    remainder = Math.trunc(Math.floor(-numerator - positive * denominator));
    if (remainder !== 0) {
      quotient--;
      remainder = Math.trunc(denominator) - remainder;
    }
  }
  return { quotient, remainder };
}

export function greatestCommonDivisor(first: number, second: number): number {
  if (first > second) return second === 0 ? first : greatestCommonDivisor(second, first % second);
  return first === 0 ? second : greatestCommonDivisor(first, second % first);
}
