/* BSP_LookupLightgrid/GL_LightGridPoint/GL_AdjustColor from q2repro.
 * Copyright (C) 2003-2006 Andrey Nazarov. GPL-2.0-or-later. */
import type { Vec3 } from "../contracts/math.ts";
import type { Q2Lightgrid, Q2LightgridSample } from "../contracts/scene.ts";
import { add3, scale3, vec3 } from "../core/math.ts";
import type { Q2LightStyle } from "./lighting.ts";

/** The map decoder validates the octree; preserve the source uint32 leaf offset. */
export function lookupQ2Lightgrid(grid: Q2Lightgrid, point: Vec3): readonly Q2LightgridSample[] | null {
  let child = grid.root;
  while (child.kind !== "occluded") {
    if (child.kind === "leaf") {
      const leaf = grid.leaves[child.index];
      if (leaf === undefined) return null;
      const x = (point.x - leaf.min.x) >>> 0, y = (point.y - leaf.min.y) >>> 0, z = (point.z - leaf.min.z) >>> 0;
      const index = (Math.imul(leaf.size.x, (Math.imul(leaf.size.y, z) + y) >>> 0) + x) >>> 0;
      if (index >= leaf.pointCount) return null;
      const start = leaf.firstSample + index * grid.styleCount;
      return grid.samples.slice(start, start + grid.styleCount);
    }
    const node = grid.nodes[child.index];
    if (node === undefined) return null;
    const index = (point.x >= node.point.x ? 4 : 0) | (point.y >= node.point.y ? 2 : 0) | (point.z >= node.point.z ? 1 : 0);
    const next = node.children[index];
    if (next === undefined) return null;
    child = next;
  }
  return null;
}

export interface Q2LightingAdjustment { readonly add: number; readonly modulate: number; readonly saturation: number; }
export function adjustQ2Lighting(color: Vec3, adjustment: Q2LightingAdjustment): Vec3 {
  const f = Math.fround;
  const r = Math.max(0, f(f(color.x + adjustment.add) * adjustment.modulate));
  const g = Math.max(0, f(f(color.y + adjustment.add) * adjustment.modulate));
  const b = Math.max(0, f(f(color.z + adjustment.add) * adjustment.modulate));
  if (adjustment.saturation === 1) return scale3({ x: r, y: g, z: b }, f(1 / 255));
  const luminance = f(f(f(r * f(0.2126)) + f(g * f(0.7152))) + f(b * f(0.0722)));
  return scale3(vec3(luminance + f(f(r - luminance) * adjustment.saturation),
    luminance + f(f(g - luminance) * adjustment.saturation), luminance + f(f(b - luminance) * adjustment.saturation)), f(1 / 255));
}

/** Missing corners take the mean of valid corners before trilinear interpolation. */
export function q2LightGridPoint(grid: Q2Lightgrid, position: Vec3, styles: readonly Q2LightStyle[],
  adjustment: Q2LightingAdjustment = { add: 0, modulate: 1, saturation: 1 }): Vec3 | null {
  if (grid.leaves.length === 0) return null;
  const point = vec3((position.x - grid.min.x) * grid.scale.x, (position.y - grid.min.y) * grid.scale.y, (position.z - grid.min.z) * grid.scale.z);
  const base = { x: Math.trunc(point.x) >>> 0, y: Math.trunc(point.y) >>> 0, z: Math.trunc(point.z) >>> 0 };
  const corners: (Vec3 | null)[] = [];
  let average = vec3(0, 0, 0), count = 0;
  for (let index = 0; index < 8; index++) {
    const samples = lookupQ2Lightgrid(grid, { x: (base.x + (index & 1)) >>> 0, y: (base.y + ((index >> 1) & 1)) >>> 0, z: (base.z + ((index >> 2) & 1)) >>> 0 });
    let color = vec3(0, 0, 0), valid = false;
    if (samples !== null) for (const sample of samples) {
      if (sample.style === 255) break;
      const style = styles[sample.style];
      if (style === undefined) break;
      // q2repro white is monochrome intensity; vanilla Q2 white is the RGB sum.
      color = add3(color, scale3(sample.rgb, style.rgb.x)); valid = true;
    }
    if (valid) { count++; average = add3(average, color); corners.push(color); }
    else corners.push(null);
  }
  if (count === 0) return null;
  average = scale3(average, Math.fround(1 / count));
  const values = corners.map(corner => corner ?? average);
  const component = (index: number): Vec3 => values[index] ?? average;
  const interpolate = (a: Vec3, b: Vec3, fraction: number): Vec3 => add3(scale3(a, Math.fround(1 - fraction)), scale3(b, fraction));
  const fx = Math.fround(point.x - base.x), fy = Math.fround(point.y - base.y), fz = Math.fround(point.z - base.z);
  const bottom = interpolate(interpolate(component(0), component(1), fx), interpolate(component(2), component(3), fx), fy);
  const top = interpolate(interpolate(component(4), component(5), fx), interpolate(component(6), component(7), fx), fy);
  return adjustQ2Lighting(interpolate(bottom, top, fz), adjustment);
}
