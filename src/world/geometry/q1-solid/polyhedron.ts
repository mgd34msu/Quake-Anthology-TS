/* BSP cell clipping follows id Software's winding clipping and convex brush
 * representation. Copyright (C) 1996-2005 Id Software. GPL-2.0-or-later. */
import type { Bounds, Plane, Vec3 } from "../../../contracts/math.ts";

export interface CellFace { readonly plane: Plane; readonly vertices: readonly Vec3[]; }
export interface ConvexCell { readonly faces: readonly CellFace[]; }
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const length = (a: Vec3): number => Math.sqrt(dot(a, a));
export const unit = (a: Vec3): Vec3 => scale(a, 1 / length(a));
export const negatePlane = (p: Plane): Plane => ({ normal: scale(p.normal, -1), distance: -p.distance });
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => add(a, scale(sub(b, a), t));
export const AXES: readonly [Vec3, Vec3, Vec3] = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }];

export function boxCell(bounds: Bounds): ConvexCell {
  const { min: a, max: b } = bounds;
  const p000 = { x: a.x, y: a.y, z: a.z }, p001 = { x: a.x, y: a.y, z: b.z };
  const p010 = { x: a.x, y: b.y, z: a.z }, p011 = { x: a.x, y: b.y, z: b.z };
  const p100 = { x: b.x, y: a.y, z: a.z }, p101 = { x: b.x, y: a.y, z: b.z };
  const p110 = { x: b.x, y: b.y, z: a.z }, p111 = { x: b.x, y: b.y, z: b.z };
  return { faces: [
    { plane: { normal: AXES[0], distance: b.x }, vertices: [p100, p110, p111, p101] },
    { plane: { normal: scale(AXES[0], -1), distance: -a.x }, vertices: [p000, p001, p011, p010] },
    { plane: { normal: AXES[1], distance: b.y }, vertices: [p010, p011, p111, p110] },
    { plane: { normal: scale(AXES[1], -1), distance: -a.y }, vertices: [p000, p100, p101, p001] },
    { plane: { normal: AXES[2], distance: b.z }, vertices: [p001, p101, p111, p011] },
    { plane: { normal: scale(AXES[2], -1), distance: -a.z }, vertices: [p000, p010, p110, p100] },
  ] };
}

/** Keep n.p <= d. The query envelope bounds otherwise unbounded BSP cells. */
export function clipCell(cell: ConvexCell, plane: Plane): ConvexCell | null {
  const faces: CellFace[] = [], cap: Vec3[] = [];
  let outside = false, inside = false;
  classify: for (const face of cell.faces) for (const point of face.vertices) {
    const d = dot(point, plane.normal) - plane.distance;
    if (d > 1e-8) outside = true;
    if (d < -1e-8) inside = true;
    if (outside && inside) break classify;
  }
  if (!outside) return cell;
  if (!inside) return null;
  for (const face of cell.faces) {
    const vertices: Vec3[] = [];
    for (let i = 0; i < face.vertices.length; i++) {
      const a = face.vertices[i], b = face.vertices[(i + 1) % face.vertices.length];
      if (a === undefined || b === undefined) continue;
      const da = dot(a, plane.normal) - plane.distance, db = dot(b, plane.normal) - plane.distance;
      if (da <= 0) vertices.push(a);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
        const point = lerp(a, b, da / (da - db));
        vertices.push(point);
        if (!cap.some(v => length(sub(v, point)) < 1e-7)) cap.push(point);
      } else if (da === 0 && !cap.some(v => length(sub(v, a)) < 1e-7)) cap.push(a);
    }
    if (vertices.length >= 3) faces.push({ plane: face.plane, vertices });
  }
  if (cap.length >= 3) {
    const center = scale(cap.reduce(add, { x: 0, y: 0, z: 0 }), 1 / cap.length);
    const axis = Math.abs(plane.normal.z) < 0.9 ? AXES[2] : AXES[1];
    const u = unit(cross(axis, plane.normal)), v = cross(plane.normal, u);
    cap.sort((a, b) => Math.atan2(dot(sub(a, center), v), dot(sub(a, center), u)) - Math.atan2(dot(sub(b, center), v), dot(sub(b, center), u)));
    faces.push({ plane, vertices: cap });
  }
  return faces.length >= 4 ? { faces } : null;
}

export function cellVertices(cell: ConvexCell): readonly Vec3[] {
  return cell.faces.flatMap(face => face.vertices);
}

/** Full separating axes include edge cross products, not only BSP face planes. */
export function boxSeparatingPlanes(cell: ConvexCell, axes: readonly Vec3[]): readonly Plane[] {
  const normals: Vec3[] = [];
  const insert = (normal: Vec3): void => {
    const magnitude = length(normal);
    if (magnitude < 1e-8) return;
    const n = scale(normal, 1 / magnitude);
    if (!normals.some(p => dot(p, n) > 1 - 1e-10)) normals.push(n);
  };
  for (const face of cell.faces) {
    insert(face.plane.normal);
    for (let i = 0; i < face.vertices.length; i++) {
      const a = face.vertices[i], b = face.vertices[(i + 1) % face.vertices.length];
      if (a === undefined || b === undefined) continue;
      const edge = sub(b, a);
      for (const axis of axes) { const n = cross(edge, axis); insert(n); insert(scale(n, -1)); }
    }
  }
  for (const axis of axes) { insert(axis); insert(scale(axis, -1)); }
  const vertices = cellVertices(cell);
  return normals.map(normal => ({ normal, distance: vertices.reduce((d, p) => Math.max(d, dot(normal, p)), -Infinity) }));
}
