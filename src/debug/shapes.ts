// Geometry adapted from q2repro refresh/debug.c. GPL-2.0-or-later.
import type { Vec3, Vec4 } from '../contracts/math.ts';
import { add3, sub3, scale3, dot3, normalize3, length3 } from '../core/math.ts';

export interface DebugLine { readonly start: Vec3; readonly end: Vec3; readonly color: Vec4; readonly depthTest: boolean; }
export type DebugShape = { readonly kind: 'line'; readonly start: Vec3; readonly end: Vec3 }
  | { readonly kind: 'point'; readonly origin: Vec3; readonly size: number }
  | { readonly kind: 'circle'; readonly origin: Vec3; readonly radius: number }
  | { readonly kind: 'sphere'; readonly origin: Vec3; readonly radius: number }
  | { readonly kind: 'bounds'; readonly min: Vec3; readonly max: Vec3 }
  | { readonly kind: 'cylinder'; readonly origin: Vec3; readonly halfHeight: number; readonly radius: number }
  | { readonly kind: 'arrow'; readonly start: Vec3; readonly end: Vec3; readonly size: number; readonly capColor: Vec4 }
  | { readonly kind: 'ray'; readonly origin: Vec3; readonly direction: Vec3; readonly length: number; readonly size: number };

export function debugShapeLines(shape: DebugShape, color: Vec4, depthTest: boolean): readonly DebugLine[] {
  const lines: DebugLine[] = [];
  const line = (start: Vec3, end: Vec3, tint = color): void => { lines.push({ start, end, color: tint, depthTest }); };
  const arrow = (start: Vec3, end: Vec3, size: number, capColor: Vec4): void => {
    const delta = sub3(end, start), length = length3(delta), dir = normalize3(delta);
    const apex = length > size ? add3(start, scale3(dir, length - size)) : end;
    if (length > size) line(start, apex);
    const extent = length > size ? size : length, tip = add3(apex, scale3(dir, extent));
    const rotated = { x: dir.z, y: -dir.x, z: dir.y };
    const right = normalize3(sub3(rotated, scale3(dir, dot3(rotated, dir))));
    line(apex, tip, capColor);
    line(add3(apex, scale3(right, extent)), tip, capColor);
    line(add3(apex, scale3(right, -extent)), tip, capColor);
  };
  switch (shape.kind) {
    case 'line': line(shape.start, shape.end); break;
    case 'point': {
      const h = shape.size * 0.5;
      for (const axis of [{ x: h, y: 0, z: 0 }, { x: 0, y: h, z: 0 }, { x: 0, y: 0, z: h }]) line(sub3(shape.origin, axis), add3(shape.origin, axis));
      break;
    }
    case 'bounds': {
      const corner = (i: number, z: number): Vec3 => ({ x: i > 1 ? shape.min.x : shape.max.x, y: (i + 1) % 4 > 1 ? shape.min.y : shape.max.y, z });
      for (let i = 0; i < 4; i++) {
        line(corner(i, shape.min.z), corner(i, shape.max.z));
        for (const z of [shape.min.z, shape.max.z]) line(corner(i, z), corner((i + 1) % 4, z));
      }
      break;
    }
    case 'circle': case 'cylinder': {
      const count = Math.trunc(Math.min(5 + shape.radius / 8, 16));
      const point = (i: number, z: number): Vec3 => ({ x: shape.origin.x + Math.cos(i * Math.PI * 2 / count) * shape.radius, y: shape.origin.y + Math.sin(i * Math.PI * 2 / count) * shape.radius, z });
      for (let i = 0; i < count; i++) {
        if (shape.kind === 'circle') line(point(i, shape.origin.z), point((i + 1) % count, shape.origin.z));
        else {
          const bottom = shape.origin.z - shape.halfHeight, top = shape.origin.z + shape.halfHeight;
          line(point(i, bottom), point((i + 1) % count, bottom));
          line(point(i, top), point((i + 1) % count, top));
          line(point(i, bottom), point(i, top));
        }
      }
      break;
    }
    case 'sphere': {
      const stacks = Math.trunc(Math.min(4 + shape.radius / 32, 10)), slices = Math.trunc(Math.min(6 + shape.radius / 32, 16));
      const ring = (stack: number, slice: number): Vec3 => {
        const phi = Math.PI * (stack + 1) / stacks, theta = Math.PI * 2 * slice / slices;
        return add3(shape.origin, scale3({ x: Math.sin(phi) * Math.cos(theta), y: Math.sin(phi) * Math.sin(theta), z: Math.cos(phi) }, shape.radius));
      };
      const north = add3(shape.origin, { x: 0, y: 0, z: shape.radius }), south = sub3(shape.origin, { x: 0, y: 0, z: shape.radius });
      for (let i = 0; i < slices; i++) {
        const next = (i + 1) % slices;
        line(north, ring(0, next)); line(ring(0, next), ring(0, i)); line(ring(0, i), north);
        line(south, ring(stacks - 2, i)); line(ring(stacks - 2, i), ring(stacks - 2, next)); line(ring(stacks - 2, next), south);
      }
      for (let j = 0; j < stacks - 2; j++) for (let i = 0; i < slices; i++) {
        const next = (i + 1) % slices;
        line(ring(j, i), ring(j, next)); line(ring(j, next), ring(j + 1, next));
        line(ring(j + 1, next), ring(j + 1, i)); line(ring(j + 1, i), ring(j, i));
      }
      break;
    }
    case 'arrow': arrow(shape.start, shape.end, shape.size, shape.capColor); break;
    case 'ray': arrow(shape.origin, add3(shape.origin, scale3(shape.direction, shape.length)), shape.size, color); break;
    default: { const exhaustive: never = shape; return exhaustive; }
  }
  return lines;
}
