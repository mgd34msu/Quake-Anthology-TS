/* Convex separating-axis sweeps retain BSP cell edges for foreign box sizes.
 * Capsule sweeps use segment-to-polyhedron distance. GPL-2.0-or-later. */
import type { Plane, Vec3 } from "../../../contracts/math.ts";
import { add, boxSeparatingPlanes, cross, dot, length, lerp, scale, sub } from "./polyhedron.ts";
import type { ConvexCell } from "./polyhedron.ts";

export type CellShape = { readonly kind: "box"; readonly axes: readonly [Vec3, Vec3, Vec3]; readonly extents: Vec3 }
  | { readonly kind: "capsule"; readonly axis: Vec3; readonly radius: number; readonly halfSegment: number };
export interface SweepInterval { readonly enter: number; readonly exit: number; readonly plane: Plane; readonly contact: number; }

export function shapeSupport(shape: CellShape, normal: Vec3): number {
  if (shape.kind === "capsule") return shape.radius + Math.abs(dot(normal, shape.axis)) * shape.halfSegment;
  return Math.abs(dot(normal, shape.axes[0])) * shape.extents.x + Math.abs(dot(normal, shape.axes[1])) * shape.extents.y + Math.abs(dot(normal, shape.axes[2])) * shape.extents.z;
}
export function sweepBoxCell(cell: ConvexCell, start: Vec3, end: Vec3, shape: Extract<CellShape, { kind: "box" }>, epsilon: number): SweepInterval | null {
  let enter = -Infinity, exit = Infinity, contact = -Infinity;
  let plane: Plane = { normal: { x: 0, y: 0, z: 0 }, distance: 0 };
  for (const candidate of boxSeparatingPlanes(cell, shape.axes)) {
    const distance = candidate.distance + shapeSupport(shape, candidate.normal);
    const a = dot(start, candidate.normal) - distance, b = dot(end, candidate.normal) - distance;
    if (a > 0 && b > 0) return null;
    if (a <= 0 && b <= 0) continue;
    const fraction = a / (a - b);
    if (a > b) {
      if (fraction > enter) { enter = fraction; plane = candidate; }
      contact = Math.max(contact, (a - epsilon) / (a - b));
    } else exit = Math.min(exit, fraction);
    if (enter > exit) return null;
  }
  return enter <= 1 && exit >= 0 ? { enter, exit, plane, contact } : null;
}

interface Closest { readonly a: Vec3; readonly b: Vec3; readonly squared: number; }
function pair(a: Vec3, b: Vec3): Closest { const d = sub(a, b); return { a, b, squared: dot(d, d) }; }
function nearest(first: Closest, second: Closest): Closest { return first.squared <= second.squared ? first : second; }
function pointTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): Closest {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return pair(p, a);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return pair(p, b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return pair(p, add(a, scale(ab, d1 / (d1 - d3))));
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return pair(p, c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return pair(p, add(a, scale(ac, d2 / (d2 - d6))));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return pair(p, lerp(b, c, (d4 - d3) / (d4 - d3 + d5 - d6)));
  const sum = va + vb + vc;
  if (Math.abs(sum) < 1e-25) return nearest(nearest(pair(p, a), pair(p, b)), pair(p, c));
  return pair(p, add(a, add(scale(ab, vb / sum), scale(ac, vc / sum))));
}
const clamp = (f: number): number => Math.max(0, Math.min(1, f));
function segments(p: Vec3, q: Vec3, a: Vec3, b: Vec3): Closest {
  const u = sub(q, p), v = sub(b, a), w = sub(p, a);
  const uu = dot(u, u), uv = dot(u, v), vv = dot(v, v), uw = dot(u, w), vw = dot(v, w);
  let s = uu === 0 ? 0 : clamp((uv * vw - vv * uw) / (uu * vv - uv * uv || 1));
  let t = vv === 0 ? 0 : (uv * s + vw) / vv;
  if (t < 0) { t = 0; s = uu === 0 ? 0 : clamp(-uw / uu); }
  else if (t > 1) { t = 1; s = uu === 0 ? 0 : clamp((uv - uw) / uu); }
  return pair(lerp(p, q, s), lerp(a, b, t));
}
function segmentCell(cell: ConvexCell, p: Vec3, q: Vec3): Closest {
  let enter = 0, exit = 1;
  for (const { plane } of cell.faces) {
    const a = dot(p, plane.normal) - plane.distance, b = dot(q, plane.normal) - plane.distance;
    if (a > 0 && b > 0) { enter = Infinity; break; }
    if (a > b && a > 0) enter = Math.max(enter, a / (a - b));
    if (a < b && b > 0) exit = Math.min(exit, a / (a - b));
  }
  if (enter <= exit) { const point = lerp(p, q, enter); return pair(point, point); }
  let result: Closest = { a: p, b: p, squared: Infinity };
  for (const face of cell.faces) {
    const a = face.vertices[0];
    if (a === undefined) continue;
    for (let i = 1; i + 1 < face.vertices.length; i++) {
      const b = face.vertices[i], c = face.vertices[i + 1];
      if (b === undefined || c === undefined) continue;
      if (length(cross(sub(b, a), sub(c, a))) < 1e-12) continue;
      result = nearest(result, pointTriangle(p, a, b, c)); result = nearest(result, pointTriangle(q, a, b, c));
      result = nearest(result, segments(p, q, a, b)); result = nearest(result, segments(p, q, b, c)); result = nearest(result, segments(p, q, c, a));
    }
  }
  return result;
}

function capsuleEntrance(cell: ConvexCell, start: Vec3, end: Vec3, shape: Extract<CellShape, { kind: "capsule" }>, margin: number): { fraction: number; plane: Plane } | null {
  const offset = scale(shape.axis, shape.halfSegment), movement = sub(end, start);
  let fraction = 0;
  for (let iteration = 0; iteration < 96; iteration++) {
    const center = lerp(start, end, fraction);
    const closest = segmentCell(cell, sub(center, offset), add(center, offset));
    const distance = Math.sqrt(closest.squared), separation = distance - shape.radius - margin;
    const normal = distance > 1e-12 ? scale(sub(closest.a, closest.b), 1 / distance) : { x: 0, y: 0, z: 0 };
    if (separation <= 1e-7) return { fraction, plane: { normal, distance: dot(normal, closest.b) } };
    const closing = -dot(movement, normal);
    if (closing <= 0) return null;
    const step = separation / closing;
    if (fraction + step > 1) return null;
    fraction += step;
  }
  throw new Error("Quake solid-cell capsule sweep did not converge");
}
export function sweepCapsuleCell(cell: ConvexCell, start: Vec3, end: Vec3, shape: Extract<CellShape, { kind: "capsule" }>, epsilon: number): SweepInterval | null {
  const entrance = capsuleEntrance(cell, start, end, shape, 0);
  if (entrance === null) return null;
  const reverse = capsuleEntrance(cell, end, start, shape, 0);
  const contact = capsuleEntrance(cell, start, end, shape, epsilon);
  return { enter: entrance.fraction, exit: reverse === null ? entrance.fraction : 1 - reverse.fraction,
    plane: entrance.plane, contact: contact?.fraction ?? entrance.fraction };
}
