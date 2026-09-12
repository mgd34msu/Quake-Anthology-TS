/* Q3 R_GetPortalOrientations and SurfIsOffscreen from tr_main.c.
 * Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { Axis, Plane, Vec3 } from "../../contracts/math.ts";
import type { SceneCamera } from "../../contracts/render.ts";
import type { MaterialGeometry } from "../../materials/geometry.ts";
import { add3, normalize3, cross3, dot3, perpendicularVector, rotatePointAroundVector, scale3, sub3 } from "../../core/math.ts";
import type { ModelTransform } from "./view.ts";
import { createViewProjector, worldPoint, worldVector } from "./view.ts";

export interface PortalEntity {
  readonly origin: Vec3;
  readonly oldOrigin: Vec3;
  readonly axis: Axis;
  readonly frame: number;
  readonly oldFrame: number;
  readonly skinNum: number;
}
export interface PortalCamera {
  readonly camera: SceneCamera;
  readonly pvsOrigin: Vec3;
  readonly mirror: boolean;
}
const f = Math.fround;

function transform(vector: Vec3, surface: Axis, camera: Axis): Vec3 {
  let result = { x: 0, y: 0, z: 0 };
  for (const index of [0, 1, 2] satisfies readonly (0 | 1 | 2)[]) result = add3(result, scale3(camera[index], dot3(vector, surface[index])));
  return result;
}

/** First source entity within 64 units wins, including a translated inline plane. */
export function portalCamera(original: Plane, entities: readonly PortalEntity[], view: SceneCamera, milliseconds: number,
  model: ModelTransform | null = null): PortalCamera | null {
  const normal = model === null ? original.normal : normalize3(worldVector(original.normal, model));
  const distance = model === null ? original.distance : dot3(normal, worldPoint(scale3(original.normal, original.distance), model));
  const entity = entities.find(candidate => Math.abs(f(dot3(candidate.origin, normal) - distance)) <= 64);
  if (entity === undefined) return null;
  const side = perpendicularVector(normal), surfaceAxis: Axis = [normal, side, cross3(normal, side)];
  const mirror = entity.origin.x === entity.oldOrigin.x && entity.origin.y === entity.oldOrigin.y && entity.origin.z === entity.oldOrigin.z;
  let surfaceOrigin: Vec3, cameraOrigin: Vec3, cameraAxis: Axis;
  if (mirror) {
    surfaceOrigin = scale3(normal, distance); cameraOrigin = surfaceOrigin;
    cameraAxis = [scale3(normal, -1), surfaceAxis[1], surfaceAxis[2]];
  } else {
    surfaceOrigin = add3(entity.origin, scale3(normal, -f(dot3(entity.origin, normal) - distance)));
    cameraOrigin = entity.oldOrigin;
    const forward = scale3(entity.axis[0], -1), left = scale3(entity.axis[1], -1);
    let angle: number | null = null;
    if (entity.oldFrame !== 0) angle = entity.frame !== 0 ? f(f(f(milliseconds) / 1000) * f(entity.frame))
      : f(f(entity.skinNum) + f(f(Math.sin(f(f(milliseconds) * f(0.003)))) * 4));
    else if (entity.skinNum !== 0) angle = f(entity.skinNum);
    const rotated = angle === null ? left : rotatePointAroundVector(forward, left, angle);
    cameraAxis = [forward, rotated, angle === null ? entity.axis[2] : cross3(forward, rotated)];
  }
  const planeNormal = scale3(cameraAxis[0], -1);
  return { camera: { ...view, origin: add3(transform(sub3(view.origin, surfaceOrigin), surfaceAxis, cameraAxis), cameraOrigin),
    axis: [transform(view.axis[0], surfaceAxis, cameraAxis), transform(view.axis[1], surfaceAxis, cameraAxis), transform(view.axis[2], surfaceAxis, cameraAxis)],
    clip: { kind: "portal", mirror, plane: { normal: planeNormal, distance: dot3(cameraOrigin, planeNormal) } } }, pvsOrigin: { ...entity.oldOrigin }, mirror };
}

export function portalSurfaceOffscreen(mesh: MaterialGeometry, camera: SceneCamera, range: number, mirror: boolean): boolean {
  const project = createViewProjector(camera);
  let pointAnd = -1;
  for (const vertex of mesh.vertices) {
    const clip = project(vertex.position);
    let flags = 0;
    for (const [index, component] of [clip.x, clip.y, clip.z].entries()) {
      if (component >= clip.w) flags |= 1 << (index * 2);
      else if (component <= -clip.w) flags |= 1 << (index * 2 + 1);
    }
    pointAnd &= flags;
  }
  if (pointAnd !== 0) return true;
  let triangles = mesh.indices.length / 3, shortest = 100000000;
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const vertexIndex = mesh.indices[index], vertex = vertexIndex === undefined ? undefined : mesh.vertices[vertexIndex];
    if (vertex === undefined) throw new RangeError("Portal triangle index is outside its vertices");
    const relative = sub3(vertex.position, camera.origin);
    shortest = Math.min(shortest, dot3(relative, relative));
    if (dot3(relative, vertex.normal) >= 0) triangles--;
  }
  return triangles === 0 || !mirror && shortest > f(f(range) * f(range));
}
