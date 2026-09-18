import type { Bounds } from "../../../contracts/math.ts";
import type { ModelTransform, Q3MeshModel } from "../../../contracts/scene.ts";
import { addPointToBounds, emptyBounds } from "../../../core/math.ts";
import { modelWorldBounds } from "./transform.ts";

interface FrameEnvelope { readonly bounds: Bounds; readonly counts: readonly number[]; }
// Decoded model positions are immutable. Authored bounds remain the LOD/fog authority.
const envelopes = new WeakMap<Q3MeshModel, Map<number, FrameEnvelope | null>>();

function finite(bounds: Bounds): boolean {
  return Number.isFinite(bounds.min.x) && Number.isFinite(bounds.min.y) && Number.isFinite(bounds.min.z)
    && Number.isFinite(bounds.max.x) && Number.isFinite(bounds.max.y) && Number.isFinite(bounds.max.z)
    && bounds.min.x <= bounds.max.x && bounds.min.y <= bounds.max.y && bounds.min.z <= bounds.max.z;
}
function frameEnvelope(model: Q3MeshModel, index: number): FrameEnvelope | null {
  let frames = envelopes.get(model);
  if (frames === undefined) { frames = new Map<number, FrameEnvelope | null>(); envelopes.set(model, frames); }
  const cached = frames.get(index);
  if (cached !== undefined) return cached;
  let bounds = emptyBounds();
  const counts: number[] = [];
  for (const surface of model.surfaces) {
    const vertices = surface.frames[index];
    if (vertices === undefined || vertices.length > surface.textureCoordinates.length) { frames.set(index, null); return null; }
    counts.push(vertices.length);
    for (const vertex of vertices) {
      const point = vertex.position;
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) { frames.set(index, null); return null; }
      bounds = addPointToBounds(bounds, point);
    }
  }
  const result = finite(bounds) ? { bounds, counts } : null;
  frames.set(index, result); return result;
}

/** Bound the same ordered binary32 position operations used by interpolateMd3Frames. */
export function md3WorldEnvelope(model: Q3MeshModel, frame: number, previousFrame: number, backLerp: number, transform: ModelTransform): Bounds | null {
  const current = frameEnvelope(model, frame);
  if (current === null || !Number.isFinite(backLerp)) return null;
  let bounds = current.bounds;
  if (backLerp !== 0) {
    const previous = frameEnvelope(model, previousFrame);
    if (previous === null || current.counts.some((count, index) => count !== previous.counts[index])) return null;
    const back = Math.fround(backLerp), front = Math.fround(1 - back);
    const oldScale = Math.fround((1 / 64) * back), newScale = Math.fround((1 / 64) * front);
    if (!Number.isFinite(oldScale) || !Number.isFinite(newScale)) return null;
    const component = (old: number, next: number): number => Math.fround(
      Math.fround(Math.fround(old * 64) * oldScale) + Math.fround(Math.fround(next * 64) * newScale));
    const oldMin = oldScale < 0 ? previous.bounds.max : previous.bounds.min;
    const oldMax = oldScale < 0 ? previous.bounds.min : previous.bounds.max;
    const newMin = newScale < 0 ? current.bounds.max : current.bounds.min;
    const newMax = newScale < 0 ? current.bounds.min : current.bounds.max;
    bounds = { min: { x: component(oldMin.x, newMin.x), y: component(oldMin.y, newMin.y), z: component(oldMin.z, newMin.z) },
      max: { x: component(oldMax.x, newMax.x), y: component(oldMax.y, newMax.y), z: component(oldMax.z, newMax.z) } };
  }
  if (!finite(bounds)) return null;
  const world = modelWorldBounds(transform, bounds);
  return finite(world) ? world : null;
}
