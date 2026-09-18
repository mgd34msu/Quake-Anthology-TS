// SPDX-License-Identifier: GPL-2.0-or-later
import type { Vec4 } from "../../contracts/math.ts";
import type { DrawBatch, Rect, RendererImage, RenderVertex } from "../../contracts/render.ts";

/** q2repro client/entities.c: a newly visible damage blend must not fade in late. */
export function interpolateQ2DamageBlend(previous: Vec4 | null, current: Vec4, fraction: number): Vec4 {
  if (previous === null || previous.w === 0) return current;
  const component = (before: number, after: number): number => Math.fround(before + Math.fround(Math.fround(after - before) * fraction));
  return { x: component(previous.x, current.x), y: component(previous.y, current.y), z: component(previous.z, current.z), w: component(previous.w, current.w) };
}

/** q2repro refresh/draw.c GL_Blend/GL_DrawVignette, with its default 0.2 border. */
export function prepareQ2DamageBlend(blend: Vec4, viewport: Rect, white: RendererImage, fraction = 0.2): readonly DrawBatch[] {
  if (blend.w === 0 || viewport.width <= 0 || viewport.height <= 0) return [];
  const byte = (value: number): number => (Math.trunc(Math.fround(value * 255)) & 255) / 255;
  const outer = { x: byte(blend.x), y: byte(blend.y), z: byte(blend.z), w: byte(blend.w) }, inner = { ...outer, w: 0 };
  const width = viewport.width, height = viewport.height;
  const vertex = (x: number, y: number, color: Vec4): RenderVertex => ({ position: { x: 2 * x / width - 1, y: 1 - 2 * y / height, z: 0, w: 1 }, texCoord: { x: 0, y: 0 }, color });
  const vertices = [vertex(0, 0, outer), vertex(width, 0, outer), vertex(width, height, outer), vertex(0, height, outer)];
  let indices = [0, 1, 2, 0, 2, 3];
  if (fraction > 0) {
    const distance = Math.trunc(Math.fround(Math.min(width, height) * Math.fround(Math.min(fraction, 0.5))));
    vertices.push(vertex(distance, distance, inner), vertex(width - distance, distance, inner), vertex(width - distance, height - distance, inner), vertex(distance, height - distance, inner));
    indices = [0, 5, 4, 0, 1, 5, 1, 6, 5, 1, 2, 6, 6, 2, 3, 6, 3, 7, 0, 7, 3, 0, 4, 7];
  }
  return [{ primitive: "triangles", texturing: "single", lighting: { kind: "vertex" }, texture: { kind: "bind-image", image: white }, vertices, indices,
    state: { blend: { source: "src-alpha", destination: "one-minus-src-alpha" }, depthTest: "always", depthWrite: false, alphaTest: "none", cull: "none", depthRange: [0, 1], polygonOffset: null } }];
}
