/* Quaternion arithmetic from q2repro common/math.c. GPL-2.0-or-later. */
import type { Vec3, Vec4 } from "../../contracts/math.ts";
import { vec3, vec4 } from "../../core/math.ts";

export function md5Quaternion(value: Vec3): Vec4 {
  const square = 1 - value.x * value.x - value.y * value.y - value.z * value.z;
  return vec4(value.x, value.y, value.z, square < 0 ? 0 : -Math.sqrt(square));
}

export function conjugateQuaternion(value: Vec4): Vec4 { return vec4(-value.x, -value.y, -value.z, value.w); }

export function multiplyQuaternion(a: Vec4, b: Vec4): Vec4 {
  return vec4(
    a.x * b.w + a.w * b.x + a.y * b.z - a.z * b.y,
    a.y * b.w + a.w * b.y + a.z * b.x - a.x * b.z,
    a.z * b.w + a.w * b.z + a.x * b.y - a.y * b.x,
    a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  );
}

export function normalizeQuaternion(value: Vec4): Vec4 {
  const length = Math.sqrt(value.x * value.x + value.y * value.y + value.z * value.z + value.w * value.w);
  if (length === 0) return value;
  return vec4(value.x / length, value.y / length, value.z / length, value.w / length);
}

export function rotateQuaternion(orientation: Vec4, position: Vec3): Vec3 {
  const product = multiplyQuaternion(multiplyQuaternion(orientation, { ...position, w: 0 }), conjugateQuaternion(orientation));
  return vec3(product.x, product.y, product.z);
}

/** q2repro's runtime Quat_ToAxis followed by VectorRotate. */
export function rotateQuaternionAxis(q: Vec4, v: Vec3): Vec3 {
  return vec3(
    v.x * Math.fround(2 * (q.w * q.w + q.x * q.x) - 1) + v.y * Math.fround(2 * (q.x * q.y - q.w * q.z)) + v.z * Math.fround(2 * (q.x * q.z + q.w * q.y)),
    v.x * Math.fround(2 * (q.x * q.y + q.w * q.z)) + v.y * Math.fround(2 * (q.w * q.w + q.y * q.y) - 1) + v.z * Math.fround(2 * (q.y * q.z - q.w * q.x)),
    v.x * Math.fround(2 * (q.x * q.z - q.w * q.y)) + v.y * Math.fround(2 * (q.y * q.z + q.w * q.x)) + v.z * Math.fround(2 * (q.w * q.w + q.z * q.z) - 1),
  );
}

export type QuaternionRotationRows = readonly [number, number, number, number, number, number, number, number, number];

/** The same Quat_ToAxis coefficients, retained only by a skinning call. */
export function quaternionRotationRows(q: Vec4): QuaternionRotationRows {
  return [
    Math.fround(2 * (q.w * q.w + q.x * q.x) - 1), Math.fround(2 * (q.x * q.y - q.w * q.z)), Math.fround(2 * (q.x * q.z + q.w * q.y)),
    Math.fround(2 * (q.x * q.y + q.w * q.z)), Math.fround(2 * (q.w * q.w + q.y * q.y) - 1), Math.fround(2 * (q.y * q.z - q.w * q.x)),
    Math.fround(2 * (q.x * q.z - q.w * q.y)), Math.fround(2 * (q.y * q.z + q.w * q.x)), Math.fround(2 * (q.w * q.w + q.z * q.z) - 1),
  ];
}

export function rotateQuaternionRows(rows: QuaternionRotationRows, v: Vec3): Vec3 {
  return vec3(v.x * rows[0] + v.y * rows[1] + v.z * rows[2],
    v.x * rows[3] + v.y * rows[4] + v.z * rows[5],
    v.x * rows[6] + v.y * rows[7] + v.z * rows[8]);
}

export function slerpQuaternion(previous: Vec4, current: Vec4, backLerp: number): Vec4 {
  if (backLerp <= 0) return current;
  if (backLerp >= 1) return previous;
  let cosine = previous.x * current.x + previous.y * current.y + previous.z * current.z + previous.w * current.w;
  const sign = cosine < 0 ? -1 : 1;
  cosine *= sign;
  let a = backLerp;
  let b = 1 - backLerp;
  if (cosine <= 0.9995) {
    const sine = Math.sqrt(1 - cosine * cosine);
    const omega = Math.atan2(sine, cosine);
    a = Math.sin(backLerp * omega) / sine;
    b = Math.sin((1 - backLerp) * omega) / sine;
  }
  b *= sign;
  return vec4(a * previous.x + b * current.x, a * previous.y + b * current.y, a * previous.z + b * current.z, a * previous.w + b * current.w);
}
