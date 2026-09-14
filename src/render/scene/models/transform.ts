import type { Axis, Bounds, Vec3 } from "../../../contracts/math.ts";
import type { ModelTag, ModelTransform, SceneEntity } from "../../../contracts/scene.ts";
import { add3, addPointToBounds, cross3, dot3, emptyBounds, scale3, sub3 } from "../../../core/math.ts";
import { interpolateMd3Tags } from "../../../formats/q3-model/md3.ts";
import { sampleMd5Pose } from "../../../formats/q3-model/md5.ts";
import { jointAttachmentTag } from "../../../formats/q3-model/scene.ts";

export function at<T>(values: readonly T[], index: number, label: string): T {
  const value = values[index];
  if (value === undefined) throw new RangeError(`Missing ${label} ${index}`);
  return value;
}

export function modelWorldDirection(transform: ModelTransform, value: Vec3): Vec3 {
  const [forward, left, up] = transform.axis;
  const x = value.x * transform.scale.x, y = value.y * transform.scale.y, z = value.z * transform.scale.z;
  return {
    x: Math.fround(Math.fround(Math.fround(forward.x * x) + Math.fround(left.x * y)) + Math.fround(up.x * z)),
    y: Math.fround(Math.fround(Math.fround(forward.y * x) + Math.fround(left.y * y)) + Math.fround(up.y * z)),
    z: Math.fround(Math.fround(Math.fround(forward.z * x) + Math.fround(left.z * y)) + Math.fround(up.z * z)),
  };
}

export function modelWorldPoint(transform: ModelTransform, value: Vec3): Vec3 {
  const [forward, left, up] = transform.axis;
  const x = value.x * transform.scale.x, y = value.y * transform.scale.y, z = value.z * transform.scale.z;
  return {
    x: Math.fround(transform.origin.x + Math.fround(Math.fround(Math.fround(forward.x * x) + Math.fround(left.x * y)) + Math.fround(up.x * z))),
    y: Math.fround(transform.origin.y + Math.fround(Math.fround(Math.fround(forward.y * x) + Math.fround(left.y * y)) + Math.fround(up.y * z))),
    z: Math.fround(transform.origin.z + Math.fround(Math.fround(Math.fround(forward.z * x) + Math.fround(left.z * y)) + Math.fround(up.z * z))),
  };
}

export function modelLocalDelta(transform: ModelTransform, value: Vec3): Vec3 {
  const a = scale3(transform.axis[0], transform.scale.x), b = scale3(transform.axis[1], transform.scale.y), c = scale3(transform.axis[2], transform.scale.z);
  const bc = cross3(b, c), ca = cross3(c, a), ab = cross3(a, b), determinant = dot3(a, bc);
  if (determinant === 0) throw new RangeError("Model transform is singular");
  return { x: dot3(value, bc) / determinant, y: dot3(value, ca) / determinant, z: dot3(value, ab) / determinant };
}

/** Compose complete linear transforms into axis columns; this also retains shear. */
export function composeModelTransform(parent: ModelTransform, child: ModelTransform): ModelTransform {
  const axis: Axis = [modelWorldDirection(parent, scale3(child.axis[0], child.scale.x)),
    modelWorldDirection(parent, scale3(child.axis[1], child.scale.y)), modelWorldDirection(parent, scale3(child.axis[2], child.scale.z))];
  return { origin: modelWorldPoint(parent, child.origin), axis, scale: { x: 1, y: 1, z: 1 } };
}

export function modelWorldBounds(transform: ModelTransform, bounds: Bounds): Bounds {
  let result = emptyBounds();
  for (let corner = 0; corner < 8; corner++) result = addPointToBounds(result, modelWorldPoint(transform, {
    x: corner & 1 ? bounds.max.x : bounds.min.x, y: corner & 2 ? bounds.max.y : bounds.min.y, z: corner & 4 ? bounds.max.z : bounds.min.z,
  }));
  return result;
}

/** Only named tags/joints present in the decoded source can attach another model. */
export function modelAttachmentTag(entity: SceneEntity, name: string): (ModelTag & { readonly scale: number }) | null {
  const model = entity.model, pose = entity.pose;
  if (model.kind === "q3-md3" && pose.kind === "frame") {
    const first = model.tags[Math.min(pose.previousFrame, model.frames.length - 1)]?.find(tag => tag.name === name);
    const second = model.tags[Math.min(pose.frame, model.frames.length - 1)]?.find(tag => tag.name === name);
    if (first === undefined || second === undefined) return null;
    const tag = interpolateMd3Tags({ ...first, axes: first.axis }, { ...second, axes: second.axis }, name, 1 - pose.backLerp);
    return { name, origin: tag.origin, axis: tag.axes, scale: 1 };
  }
  if (model.kind === "md5") {
    const index = model.joints.findIndex(joint => joint.name === name);
    if (index < 0) return null;
    const joints = pose.kind === "skeleton" ? pose.joints : sampleMd5Pose(model, pose.frame, pose.previousFrame, pose.backLerp);
    const joint = joints[index];
    return joint === undefined ? null : jointAttachmentTag(name, joint);
  }
  return null;
}

export function attachSceneEntity(parent: SceneEntity, child: SceneEntity, tag: ModelTag & { readonly scale: number }): SceneEntity {
  const tagTransform = composeModelTransform(parent.transform, { origin: tag.origin, axis: tag.axis,
    scale: { x: tag.scale, y: tag.scale, z: tag.scale } });
  const transform = composeModelTransform(tagTransform, child.transform);
  const delta = modelWorldDirection(tagTransform, sub3(child.previousOrigin, child.transform.origin));
  return { ...child, transform, previousOrigin: add3(transform.origin, delta), lightingOrigin: parent.lightingOrigin };
}
