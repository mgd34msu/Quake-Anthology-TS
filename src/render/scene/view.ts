/* View matrices, frustum and clip conversion from Q3 tr_main.c/tr_backend.c.
 * Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { Axis, Bounds, Mat4, Plane, Vec3, Vec4 } from "../../contracts/math.ts";
import type { SceneCamera } from "../../contracts/render.ts";
import { add3, dot3, multiplyMat4, scale3, sub3 } from "../../core/math.ts";

export interface ModelTransform { readonly origin: Vec3; readonly axis: Axis; readonly scale?: number; }

export function modelScale(model: ModelTransform): number {
  const scale = model.scale ?? 1;
  if (!Number.isFinite(scale) || scale === 0) throw new RangeError("Model scale must be finite and nonzero");
  return scale;
}

export function localVector(vector: Vec3, model: ModelTransform): Vec3 {
  const scale = modelScale(model);
  return { x: dot3(vector, model.axis[0]) / scale, y: dot3(vector, model.axis[1]) / scale, z: dot3(vector, model.axis[2]) / scale };
}

export function localPoint(point: Vec3, model: ModelTransform): Vec3 { return localVector(sub3(point, model.origin), model); }
const f = Math.fround;

export function perspectiveProjection(fovX: number, fovY: number, far: number, near = 4): Mat4 {
  if (![fovX, fovY].every(value => Number.isFinite(value) && value > 0 && value < 180)
    || !Number.isFinite(far) || !Number.isFinite(near) || near <= 0 || far <= near)
    throw new RangeError("Camera requires finite fields of view and ordered positive clipping distances");
  const width = f(2 * f(near * Math.tan(fovX * Math.PI / 360)));
  const height = f(2 * f(near * Math.tan(fovY * Math.PI / 360))), depth = f(far - near);
  return [f(2 * near / width), 0, 0, 0, 0, f(2 * near / height), 0, 0,
    0, 0, f(-f(far + near) / depth), -1, 0, 0, f(f(-2 * far * near) / depth), 0];
}

/** Full world-to-clip matrix for a camera: projection * view (column-major). */
export function viewProjectionMatrix(camera: SceneCamera): Mat4 {
  const [forward, left, up] = camera.axis;
  const eyeX = { x: -left.x, y: -left.y, z: -left.z, w: dot3(camera.origin, left) };
  const eyeY = { ...up, w: -dot3(camera.origin, up) };
  const eyeZ = { x: -forward.x, y: -forward.y, z: -forward.z, w: dot3(camera.origin, forward) };
  const view: Mat4 = [
    eyeX.x, eyeY.x, eyeZ.x, 0,
    eyeX.y, eyeY.y, eyeZ.y, 0,
    eyeX.z, eyeY.z, eyeZ.z, 0,
    eyeX.w, eyeY.w, eyeZ.w, 1,
  ];
  return multiplyMat4(camera.projection, view);
}

/** Stage-frounded matrix projection, matching createViewProjector's arithmetic. */
export function projectPoint(matrix: Mat4, point: Vec3): Vec4 {
  const component = (a: number, b: number, c: number, d: number): number =>
    f(f(f(f(point.x * a) + f(point.y * b)) + f(point.z * c)) + d);
  return { x: component(matrix[0], matrix[4], matrix[8], matrix[12]),
    y: component(matrix[1], matrix[5], matrix[9], matrix[13]),
    z: component(matrix[2], matrix[6], matrix[10], matrix[14]),
    w: component(matrix[3], matrix[7], matrix[11], matrix[15]) };
}

export function createViewProjector(camera: SceneCamera, model?: ModelTransform): (point: Vec3) => Vec4 {
  const [forward, left, up] = camera.axis, projection = camera.projection;
  const row = (axis: Vec3, translation: number): Vec4 => model === undefined ? { ...axis, w: translation }
    : { x: f(dot3(model.axis[0], axis) * modelScale(model)), y: f(dot3(model.axis[1], axis) * modelScale(model)), z: f(dot3(model.axis[2], axis) * modelScale(model)),
      w: f(dot3(model.origin, axis) + translation) };
  const eyeX = row(scale3(left, -1), dot3(camera.origin, left));
  const eyeY = row(up, -dot3(camera.origin, up));
  const eyeZ = row(scale3(forward, -1), dot3(camera.origin, forward));
  const component = (x: number, y: number, z: number, a: number, b: number, c: number, d: number): number =>
    f(f(f(f(x * a) + f(y * b)) + f(z * c)) + d);
  return point => {
    const x = f(dot3(point, eyeX) + eyeX.w), y = f(dot3(point, eyeY) + eyeY.w), z = f(dot3(point, eyeZ) + eyeZ.w);
    return { x: component(x, y, z, projection[0], projection[4], projection[8], projection[12]),
      y: component(x, y, z, projection[1], projection[5], projection[9], projection[13]),
      z: component(x, y, z, projection[2], projection[6], projection[10], projection[14]),
      w: component(x, y, z, projection[3], projection[7], projection[11], projection[15]) };
  };
}

export function cameraFrustum(camera: SceneCamera): readonly Plane[] {
  const side = (direction: Vec3, scale: number, sign: number): Plane => {
    const inverse = 1 / Math.hypot(1, scale);
    const normal = add3(scale3(camera.axis[0], inverse), scale3(direction, scale * inverse * sign));
    return { normal, distance: dot3(camera.origin, normal) };
  };
  const result = [side(camera.axis[1], camera.projection[0], 1), side(camera.axis[1], camera.projection[0], -1),
    side(camera.axis[2], camera.projection[5], 1), side(camera.axis[2], camera.projection[5], -1)];
  if (camera.clip.kind === "portal") result.push(camera.clip.plane);
  return result;
}

export function boundsInFrustum(bounds: Bounds, planes: readonly Plane[]): boolean {
  for (const plane of planes) {
    const x = plane.normal.x >= 0 ? bounds.max.x : bounds.min.x;
    const y = plane.normal.y >= 0 ? bounds.max.y : bounds.min.y;
    const z = plane.normal.z >= 0 ? bounds.max.z : bounds.min.z;
    if (x * plane.normal.x + y * plane.normal.y + z * plane.normal.z < plane.distance) return false;
  }
  return true;
}

export function farClip(origin: Vec3, bounds: Bounds): number {
  let maximum = 0;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    const relative = sub3({ x, y, z }, origin);
    maximum = Math.max(maximum, dot3(relative, relative));
  }
  return f(Math.sqrt(maximum));
}

export function portalClipPlane(camera: SceneCamera): Vec4 | null {
  if (camera.clip.kind === "none") return null;
  const plane = camera.clip.plane, projection = camera.projection;
  const a = dot3(camera.axis[0], plane.normal), b = dot3(camera.axis[1], plane.normal), c = dot3(camera.axis[2], plane.normal);
  const d = f(dot3(plane.normal, camera.origin) - plane.distance);
  return { x: -b / projection[0], y: c / projection[5], z: d / projection[14], w: a + d * projection[10] / projection[14] };
}

export function worldVector(point: Vec3, model: ModelTransform): Vec3 {
  const scale = modelScale(model);
  return add3(add3(scale3(model.axis[0], point.x * scale), scale3(model.axis[1], point.y * scale)), scale3(model.axis[2], point.z * scale));
}

export function worldPoint(point: Vec3, model: ModelTransform): Vec3 { return add3(model.origin, worldVector(point, model)); }
