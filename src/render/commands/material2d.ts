import type { DrawBatch, Rect } from "../../contracts/render.ts";
import type { MaterialDrawContext } from "../../materials/evaluate.ts";
import { prepareMaterialBatches } from "../../materials/evaluate.ts";
import type { MaterialGeometry } from "../../materials/geometry.ts";
import type { MaterialTextDraw } from "../../text/draw2d.ts";
import { clipPicture } from "./frame.ts";

/** Material fonts and menu pictures use their registered stages within one seat. */
export function prepareMaterialText(draw: MaterialTextDraw, viewport: Rect, context: MaterialDrawContext): readonly DrawBatch[] {
  const clipped = clipPicture(draw.rect, { s1: draw.uv.s, t1: draw.uv.t, s2: draw.uv.s2, t2: draw.uv.t2 }, viewport);
  if (clipped === null) return [];
  const { rect, uv } = clipped, right = rect.x + rect.width, bottom = rect.y + rect.height;
  const color = { x: draw.color.x * 255, y: draw.color.y * 255, z: draw.color.z * 255, w: draw.color.w * 255 };
  const geometry: MaterialGeometry = { indices: [0, 1, 2, 0, 2, 3], vertices: [
    { x: rect.x, y: rect.y, s: uv.s1, t: uv.t1 }, { x: right, y: rect.y, s: uv.s2, t: uv.t1 },
    { x: right, y: bottom, s: uv.s2, t: uv.t2 }, { x: rect.x, y: bottom, s: uv.s1, t: uv.t2 },
  ].map(vertex => ({ position: { x: vertex.x, y: vertex.y, z: 0 }, normal: { x: 0, y: 0, z: 1 },
    texCoord: { x: vertex.s, y: vertex.t }, lightmapCoord: { x: 0, y: 0 }, color })) };
  return prepareMaterialBatches(draw.picture.material.compiled, geometry, { ...context, fog: null, entityRGBA: color,
    project: position => ({ x: 2 * (position.x - viewport.x) / viewport.width - 1,
      y: 1 - 2 * (position.y - viewport.y) / viewport.height, z: 0, w: 1 }) })
    .map(batch => ({ ...batch, state: { ...batch.state, depthTest: "always", depthWrite: false, cull: "none" } }));
}
