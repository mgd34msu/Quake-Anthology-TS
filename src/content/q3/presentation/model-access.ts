import type { Axis, Bounds, Vec3 } from "../../../contracts/math.ts";
import { interpolateMd3Tags } from "../../../formats/q3-model/md3.ts";
import { sampleMd5Pose } from "../../../formats/q3-model/md5.ts";
import { jointAttachmentTag } from "../../../formats/q3-model/scene.ts";
import type { SceneModel } from "./ref-entity.ts";
const ZERO: Bounds = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
export function modelBounds(source: SceneModel): Bounds {
  if (source.kind === "default") return ZERO;
  if (source.kind === "inline") return source.bounds;
  const model = source.model;
  if ("bounds" in model) return model.bounds;
  if (model.kind === "brush-model") return model.world.models[model.model]?.bounds ?? ZERO;
  return model.frames[0]?.bounds ?? ZERO;
}
export function lerpModelTag(source: SceneModel, name: string, start: number, end: number, fraction: number): { readonly origin: Vec3; readonly axes: Axis } | null {
  if (source.kind !== "model") return null;
  const model = source.model;
  if (model.kind === "q3-md3") {
    const first = model.tags[Math.min(start, model.frames.length - 1)]?.find(tag => tag.name === name);
    const second = model.tags[Math.min(end, model.frames.length - 1)]?.find(tag => tag.name === name);
    return first === undefined || second === undefined ? null : interpolateMd3Tags({ ...first, axes: first.axis }, { ...second, axes: second.axis }, name, fraction);
  }
  if (model.kind === "md5") {
    const index = model.joints.findIndex(joint => joint.name === name);
    const pose = sampleMd5Pose(model, end, start, 1 - fraction)[index];
    if (pose === undefined) return null;
    const tag = jointAttachmentTag(name, pose);
    return { origin: tag.origin, axes: tag.axis };
  }
  return null;
}
