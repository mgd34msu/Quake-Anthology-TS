/* Brush face reconstruction and water subdivision from gl_rsurf.c/gl_warp.c.
 * Copyright (C) 1996-1997 Id Software, Inc. GPL-2.0-or-later. */
import type { Bounds, Plane, Vec2, Vec3 } from "../../contracts/math.ts";
import type { BspFace, Q1WorldGeometry, Q2WorldGeometry } from "../../contracts/scene.ts";
import type { LightmapFace, LightmapProjection } from "../../materials/lighting.ts";
import { lightmapAtlasCoordinates } from "../../materials/lighting.ts";
import type { MaterialGeometry, MaterialVertex } from "../../materials/geometry.ts";
import { dot3, scale3 } from "../../core/math.ts";

function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new RangeError(`Brush surface index ${index} outside ${values.length}`);
  return value;
}

export function geometryBounds(vertices: readonly { readonly position: Vec3 }[]): Bounds {
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const vertex of vertices) {
    min.x = Math.min(min.x, vertex.position.x); min.y = Math.min(min.y, vertex.position.y); min.z = Math.min(min.z, vertex.position.z);
    max.x = Math.max(max.x, vertex.position.x); max.y = Math.max(max.y, vertex.position.y); max.z = Math.max(max.z, vertex.position.z);
  }
  return vertices.length === 0 ? { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } } : { min, max };
}

function splitWater(points: readonly Vec3[], size: number): readonly (readonly Vec3[])[] {
  const bounds = geometryBounds(points.map(position => ({ position })));
  for (const axis of ["x", "y", "z"] satisfies readonly (keyof Vec3)[]) {
    const middle = size * Math.floor((bounds.min[axis] + bounds.max[axis]) * 0.5 / size + 0.5);
    if (bounds.max[axis] - middle < 8 || middle - bounds.min[axis] < 8) continue;
    const front: Vec3[] = [], back: Vec3[] = [];
    for (let i = 0; i < points.length; i++) {
      const point = at(points, i), next = at(points, (i + 1) % points.length);
      const distance = point[axis] - middle, nextDistance = next[axis] - middle;
      if (distance >= 0) front.push(point);
      if (distance <= 0) back.push(point);
      if (distance === 0 || nextDistance === 0 || (distance > 0) === (nextDistance > 0)) continue;
      const fraction = distance / (distance - nextDistance);
      const intersection = { x: point.x + fraction * (next.x - point.x), y: point.y + fraction * (next.y - point.y), z: point.z + fraction * (next.z - point.z) };
      front.push(intersection); back.push(intersection);
    }
    return [...splitWater(front, size), ...splitWater(back, size)];
  }
  return [points];
}

export interface PreparedBrushFace {
  readonly geometry: MaterialGeometry;
  readonly plane: Plane;
  readonly lightmap: LightmapFace;
  readonly decoupled: boolean;
}

export function prepareBrushFace(map: Q1WorldGeometry | Q2WorldGeometry, face: BspFace, faceIndex: number,
  imageSize: Vec2, warp: boolean, subdivision = 64): PreparedBrushFace {
  const info = at<(Q1WorldGeometry | Q2WorldGeometry)["textureInfo"][number]>(map.textureInfo, face.textureInfo), rawPlane = at(map.planes, face.plane);
  const plane = face.back ? { normal: scale3(rawPlane.normal, -1), distance: -rawPlane.distance } : rawPlane;
  const points: Vec3[] = [];
  for (let edgeIndex = 0; edgeIndex < face.edges.count; edgeIndex++) {
    const signed = at(map.surfaceEdges, face.edges.first + edgeIndex), edge = at(map.edges, Math.abs(signed));
    points.push(at(map.vertices, edge.vertices[signed >= 0 ? 0 : 1]));
  }
  const texture = (position: Vec3): Vec2 => ({ x: dot3(position, info.projection.s) + info.projection.s.w, y: dot3(position, info.projection.t) + info.projection.t.w });
  let minS = Infinity, minT = Infinity, maxS = -Infinity, maxT = -Infinity;
  for (const point of points) {
    const uv = texture(point); minS = Math.min(minS, uv.x); minT = Math.min(minT, uv.y); maxS = Math.max(maxS, uv.x); maxT = Math.max(maxT, uv.y);
  }
  const mins = { x: Math.floor(minS / 16) * 16, y: Math.floor(minT / 16) * 16 };
  const mapping = map.decoupledLightmaps?.[faceIndex] ?? null;
  const projection: LightmapProjection = mapping === null ? { kind: "classic", texture: info.projection, textureMins: mins } : { kind: "decoupled", mapping };
  const width = mapping?.width ?? Math.ceil(maxS / 16) - Math.floor(minS / 16) + 1;
  const height = mapping?.height ?? Math.ceil(maxT / 16) - Math.floor(minT / 16) + 1;
  const offset = mapping === null ? face.lightingOffset : mapping.lightingOffset;
  const lightmap: LightmapFace = { width, height, plane, projection, lighting: offset === null ? null : map.lighting, offset: offset ?? 0, styles: face.styles };
  const polygons = warp ? splitWater(points, subdivision) : [points];
  const vertices: MaterialVertex[] = [], indices: number[] = [];
  for (const polygon of polygons) {
    const first = vertices.length;
    for (const position of polygon) {
      const uv = texture(position);
      vertices.push({ position, normal: plane.normal, texCoord: warp ? uv : { x: uv.x / imageSize.x, y: uv.y / imageSize.y },
        lightmapCoord: lightmapAtlasCoordinates(position, projection, { x: 0, y: 0 }, width, height), color: { x: 255, y: 255, z: 255, w: 255 } });
    }
    for (let index = 2; index < polygon.length; index++) indices.push(first, first + index - 1, first + index);
  }
  return { geometry: { vertices, indices }, plane, lightmap, decoupled: mapping !== null };
}
