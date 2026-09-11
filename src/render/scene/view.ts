/* View matrices, frustum and clip conversion from Q3 tr_main.c/tr_backend.c.
 * Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { Axis, Bounds, Mat4, Plane, Vec3, Vec4 } from "../../contracts/math.ts";
import type { SceneCamera } from "../../contracts/render.ts";
import { add3, dot3, scale3, sub3 } from "../../core/math.ts";

export interface ModelTransform { readonly origin: Vec3; readonly axis: Axis; }
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

export function createViewProjector(camera: SceneCamera, model?: ModelTransform): (point: Vec3) => Vec4 {
  const [forward, left, up] = camera.axis, projection = camera.projection;
  const row = (axis: Vec3, translation: number): Vec4 => model === undefined ? { ...axis, w: translation }
    : { x: f(dot3(model.axis[0], axis)), y: f(dot3(model.axis[1], axis)), z: f(dot3(model.axis[2], axis)),
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
  return planes.every(plane => dot3({ x: plane.normal.x >= 0 ? bounds.max.x : bounds.min.x,
    y: plane.normal.y >= 0 ? bounds.max.y : bounds.min.y,
    z: plane.normal.z >= 0 ? bounds.max.z : bounds.min.z }, plane.normal) >= plane.distance);
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

export function worldPoint(point: Vec3, model: ModelTransform): Vec3 {
  return add3(model.origin, add3(add3(scale3(model.axis[0], point.x), scale3(model.axis[1], point.y)), scale3(model.axis[2], point.z)));
}
