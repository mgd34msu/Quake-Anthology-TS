/*
 * Flat binary32 vector storage, following the shared C foundation's value
 * vectors (include/qa/math.h, qa_vec3): components live in one Float32Array
 * (structure-of-arrays friendly, three elements per vector, six per bounds)
 * and operations read/write slots without allocating per-vector objects.
 * Stored writes round to binary32; dot/normalize retain the exact staged
 * rounding of src/core/math.ts so store math matches object math bit for bit
 * for finite values and infinities. NaN payloads canonicalize through typed
 * array storage (as they do through C float stores), unlike plain Vec3
 * objects, which preserve the producing operation's NaN sign.
 * Operations snapshot their inputs into locals first, so output may alias
 * input. This is engine math storage, not guest memory: overlapping guest
 * vectors keep using Float32VectorView. GPL-2.0-or-later.
 */

/** Plain retained scratch for out-parameter math over engine Vec3 values. */
export interface Vec3Scratch {
  x: number;
  y: number;
  z: number;
}

export function vec3Scratch(): Vec3Scratch {
  return { x: 0, y: 0, z: 0 };
}

export function createVec3Store(capacity: number): Float32Array {
  if (!Number.isSafeInteger(capacity) || capacity < 0) throw new RangeError("Vector store capacity must be a nonnegative safe integer");
  return new Float32Array(capacity * 3);
}

export function createBoundsStore(capacity: number): Float32Array {
  if (!Number.isSafeInteger(capacity) || capacity < 0) throw new RangeError("Bounds store capacity must be a nonnegative safe integer");
  return new Float32Array(capacity * 6);
}

export function vec3Set(store: Float32Array, index: number, x: number, y: number, z: number): void {
  const offset = index * 3;
  store[offset] = x;
  store[offset + 1] = y;
  store[offset + 2] = z;
}

export function vec3Copy(store: Float32Array, out: number, a: number): void {
  const from = a * 3;
  const x = store[from] ?? 0;
  const y = store[from + 1] ?? 0;
  const z = store[from + 2] ?? 0;
  vec3Set(store, out, x, y, z);
}

export function vec3Add(store: Float32Array, out: number, a: number, b: number): void {
  const ao = a * 3;
  const bo = b * 3;
  const x = (store[ao] ?? 0) + (store[bo] ?? 0);
  const y = (store[ao + 1] ?? 0) + (store[bo + 1] ?? 0);
  const z = (store[ao + 2] ?? 0) + (store[bo + 2] ?? 0);
  vec3Set(store, out, x, y, z);
}

export function vec3Sub(store: Float32Array, out: number, a: number, b: number): void {
  const ao = a * 3;
  const bo = b * 3;
  const x = (store[ao] ?? 0) - (store[bo] ?? 0);
  const y = (store[ao + 1] ?? 0) - (store[bo + 1] ?? 0);
  const z = (store[ao + 2] ?? 0) - (store[bo + 2] ?? 0);
  vec3Set(store, out, x, y, z);
}

export function vec3Scale(store: Float32Array, out: number, a: number, scale: number): void {
  const ao = a * 3;
  const x = (store[ao] ?? 0) * scale;
  const y = (store[ao + 1] ?? 0) * scale;
  const z = (store[ao + 2] ?? 0) * scale;
  vec3Set(store, out, x, y, z);
}

/** out = a + scale * b, with the object path's staged binary32 rounding. */
export function vec3MA(store: Float32Array, out: number, a: number, scale: number, b: number): void {
  const ao = a * 3;
  const bo = b * 3;
  const s = Math.fround(scale);
  const x = (store[ao] ?? 0) + s * (store[bo] ?? 0);
  const y = (store[ao + 1] ?? 0) + s * (store[bo + 1] ?? 0);
  const z = (store[ao + 2] ?? 0) + s * (store[bo + 2] ?? 0);
  vec3Set(store, out, x, y, z);
}

/** Matches dot3 exactly, including each intermediate binary32 rounding. */
export function vec3Dot(store: Float32Array, a: number, b: number): number {
  const ao = a * 3;
  const bo = b * 3;
  return Math.fround(Math.fround(Math.fround((store[ao] ?? 0) * (store[bo] ?? 0))
    + Math.fround((store[ao + 1] ?? 0) * (store[bo + 1] ?? 0)))
    + Math.fround((store[ao + 2] ?? 0) * (store[bo + 2] ?? 0)));
}

export function vec3Cross(store: Float32Array, out: number, a: number, b: number): void {
  const ao = a * 3;
  const bo = b * 3;
  const ax = store[ao] ?? 0;
  const ay = store[ao + 1] ?? 0;
  const az = store[ao + 2] ?? 0;
  const bx = store[bo] ?? 0;
  const by = store[bo + 1] ?? 0;
  const bz = store[bo + 2] ?? 0;
  vec3Set(store, out,
    Math.fround(ay * bz) - Math.fround(az * by),
    Math.fround(az * bx) - Math.fround(ax * bz),
    Math.fround(ax * by) - Math.fround(ay * bx));
}

export function vec3Length(store: Float32Array, a: number): number {
  return Math.fround(Math.sqrt(vec3Dot(store, a, a)));
}

/** Matches normalize3: a zero vector is retained, including signed zero. */
export function vec3Normalize(store: Float32Array, out: number, a: number): number {
  const length = vec3Length(store, a);
  if (length === 0) {
    if (out !== a) vec3Copy(store, out, a);
    return length;
  }
  vec3Scale(store, out, a, Math.fround(1 / length));
  return length;
}

const DEGREES_TO_RADIANS = Math.PI * 2 / 360;

/** Matches angleVectors exactly; angles are pitch/yaw/roll degrees in one slot. */
export function vec3AngleVectors(store: Float32Array, forward: number, right: number, up: number, angles: number): void {
  const ao = angles * 3;
  const pitchDegrees = store[ao] ?? 0;
  const yawDegrees = store[ao + 1] ?? 0;
  const rollDegrees = store[ao + 2] ?? 0;
  const yaw = Math.fround(yawDegrees * DEGREES_TO_RADIANS);
  const pitch = Math.fround(pitchDegrees * DEGREES_TO_RADIANS);
  const roll = Math.fround(rollDegrees * DEGREES_TO_RADIANS);
  const sy = Math.fround(Math.sin(yaw));
  const cy = Math.fround(Math.cos(yaw));
  const sp = Math.fround(Math.sin(pitch));
  const cp = Math.fround(Math.cos(pitch));
  const sr = Math.fround(Math.sin(roll));
  const cr = Math.fround(Math.cos(roll));
  vec3Set(store, forward, cp * cy, cp * sy, -sp);
  vec3Set(store, right,
    Math.fround(Math.fround(-sr * sp) * cy) + Math.fround(-cr * -sy),
    Math.fround(Math.fround(-sr * sp) * sy) + Math.fround(-cr * cy),
    -sr * cp);
  vec3Set(store, up,
    Math.fround(Math.fround(cr * sp) * cy) + Math.fround(-sr * -sy),
    Math.fround(Math.fround(cr * sp) * sy) + Math.fround(-sr * cy),
    cr * cp);
}

export function vec3Equal(store: Float32Array, a: number, b: number): boolean {
  const ao = a * 3;
  const bo = b * 3;
  return store[ao] === store[bo] && store[ao + 1] === store[bo + 1] && store[ao + 2] === store[bo + 2];
}

export function boundsSet(store: Float32Array, index: number, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): void {
  const offset = index * 6;
  store[offset] = minX;
  store[offset + 1] = minY;
  store[offset + 2] = minZ;
  store[offset + 3] = maxX;
  store[offset + 4] = maxY;
  store[offset + 5] = maxZ;
}

export function boundsOverlap(store: Float32Array, a: number, b: number): boolean {
  const ao = a * 6;
  const bo = b * 6;
  return (store[ao] ?? 0) <= (store[bo + 3] ?? 0) && (store[ao + 3] ?? 0) >= (store[bo] ?? 0)
    && (store[ao + 1] ?? 0) <= (store[bo + 4] ?? 0) && (store[ao + 4] ?? 0) >= (store[bo + 1] ?? 0)
    && (store[ao + 2] ?? 0) <= (store[bo + 5] ?? 0) && (store[ao + 5] ?? 0) >= (store[bo + 2] ?? 0);
}

export function boundsContainsPoint(store: Float32Array, index: number, x: number, y: number, z: number): boolean {
  const offset = index * 6;
  return x >= (store[offset] ?? 0) && x <= (store[offset + 3] ?? 0)
    && y >= (store[offset + 1] ?? 0) && y <= (store[offset + 4] ?? 0)
    && z >= (store[offset + 2] ?? 0) && z <= (store[offset + 5] ?? 0);
}
