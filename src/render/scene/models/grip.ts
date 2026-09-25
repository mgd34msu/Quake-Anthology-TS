import type { ModelAttachmentDefinition } from "../../../contracts/model-attachment.ts";
import type { ModelTransform, SceneEntity } from "../../../contracts/scene.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import { cross3, length3, scale3, sub3 } from "../../../core/math.ts";
import { alignModelAttachment } from "./attachment.ts";
import { at, composeModelTransform, modelAttachmentTag } from "./transform.ts";
import { interpolateSceneMd2, repairFrames } from "./prepare.ts";

function triangle(a: Vec3, b: Vec3, c: Vec3): ModelTransform | null {
  const forward = sub3(b, a), normal = cross3(forward, sub3(c, a)), length = length3(forward), area = length3(normal);
  if (length === 0 || area === 0) return null;
  const x = scale3(forward, 1 / length), z = scale3(normal, 1 / area);
  return { origin: a, axis: [x, cross3(z, x), z], scale: { x: 1, y: 1, z: 1 } };
}

/** Qualified source geometry supplies the animated socket; no destination weapon pose is simulated. */
export function createModelGrip(reference: SceneEntity, definition: ModelAttachmentDefinition): (entity: SceneEntity) => ModelTransform | null {
  if (reference.resource.digest !== definition.digest) throw new Error("Model attachment digest differs from its source bytes");
  if (definition.kind === "joint") return entity => {
    if (entity.resource.id !== reference.resource.id) throw new Error("Model attachment source changed");
    const pose = entity.pose.kind === "frame" ? { kind: "frame", ...repairFrames(entity) } satisfies SceneEntity["pose"] : entity.pose;
    const tag = modelAttachmentTag({ ...entity, pose }, definition.name); if (tag === null) throw new Error(`Source model has no attachment ${definition.name}`);
    return composeModelTransform({ origin: tag.origin, axis: tag.axis, scale: { x: tag.scale, y: tag.scale, z: tag.scale } }, definition.grip);
  };
  const source = reference.model;
  if (source.kind !== "q2-md2") throw new Error("Mesh attachment requires its declared MD2 source");
  const model = { ...source, frames: source.frames.map(frame => ({ ...frame,
    vertices: definition.vertices.map(index => at(frame.vertices, index, "attachment vertex")),
    compressedVertices: definition.vertices.map(index => at(frame.compressedVertices, index, "attachment packed vertex")) })) };
  const positions = at(model.frames, definition.referenceFrame, "attachment reference frame").vertices;
  const initial = triangle(at(positions, 0, "attachment vertex").position, at(positions, 1, "attachment vertex").position, at(positions, 2, "attachment vertex").position);
  if (initial === null) throw new Error("Model attachment reference is degenerate");
  const inverse = alignModelAttachment(initial, { origin: { x: 0, y: 0, z: 0 }, axis: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }], scale: { x: 1, y: 1, z: 1 } });
  const relative = composeModelTransform(inverse, definition.grip);
  return entity => {
    if (entity.resource.id !== reference.resource.id || entity.pose.kind !== "frame") throw new Error("Mesh attachment lost its original source pose");
    const { frame, previousFrame, backLerp } = repairFrames(entity);
    const vertices = interpolateSceneMd2(model, entity, frame, previousFrame, backLerp, false);
    const current = triangle(at(vertices, 0, "attachment vertex").position, at(vertices, 1, "attachment vertex").position, at(vertices, 2, "attachment vertex").position);
    return current === null ? null : composeModelTransform(current, relative);
  };
}
