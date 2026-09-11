import type { Axis, Vec3 } from "../../contracts/math.ts";
import type { ModelTag, ModelTransform, Q3MeshModel, SkeletonJointPose } from "../../contracts/scene.ts";
import type { Md3Model } from "./md3.ts";
import { rotateQuaternionAxis } from "./quaternion.ts";

export interface DecodedSceneMd3 extends Q3MeshModel { readonly sourceModel: Md3Model; }

export function toSceneMd3(model: Md3Model): DecodedSceneMd3 {
  return { kind: "q3-md3", name: model.name, sourceModel: model,
    frames: model.frames.map(frame => ({ ...frame, localOrigin: frame.origin })),
    tags: model.tags.map(tags => tags.map(tag => ({ name: tag.name, origin: tag.origin, axis: tag.axes }))),
    surfaces: model.surfaces.map(surface => ({ name: surface.name, shaders: surface.shaders.map(shader => shader.name),
      textureCoordinates: surface.texCoords, indices: surface.triangles.flatMap(triangle => triangle.indices), frames: surface.frames })) };
}

export type CharacterAttachment = {
  readonly name: string;
  readonly modelPart: string;
  readonly transform: ModelTransform;
  readonly anchor: { readonly kind: "md3-tag"; readonly tag: string }
    | { readonly kind: "skeleton-joint"; readonly joint: string }
    | { readonly kind: "model-origin" };
};

export interface CharacterModelMetadata {
  readonly sourceFamily: "q1" | "q2" | "q3";
  readonly parts: readonly { readonly name: string; readonly modelPath: string; readonly skinPath: string | null }[];
  readonly attachments: readonly CharacterAttachment[];
  /** Animation semantics are authored by the character provider, independently of movement. */
  readonly animations: readonly { readonly action: string; readonly part: string; readonly clip: string }[];
  readonly visualScale: Vec3;
}

export interface JointAttachmentPose extends ModelTag { readonly scale: number; }

export function jointAttachmentTag(name: string, pose: SkeletonJointPose): JointAttachmentPose {
  const axis: Axis = [rotateQuaternionAxis(pose.orientation, { x: 1, y: 0, z: 0 }),
    rotateQuaternionAxis(pose.orientation, { x: 0, y: 1, z: 0 }), rotateQuaternionAxis(pose.orientation, { x: 0, y: 0, z: 1 })];
  return { name, origin: pose.position, axis, scale: pose.scale };
}
