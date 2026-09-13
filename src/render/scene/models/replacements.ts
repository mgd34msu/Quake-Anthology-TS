import type { Vec3 } from "../../../contracts/math.ts";
import type { GameFamily } from "../../../contracts/content.ts";
import type { SceneEntity } from "../../../contracts/scene.ts";
import { length3, sub3 } from "../../../core/math.ts";

export interface ModelReplacementPolicy {
  readonly q1Enhanced: boolean;
  readonly q2Load: boolean;
  readonly q2Use: boolean;
  readonly q2Distance: number;
  readonly distance: number | "source";
}
export const DEFAULT_MODEL_REPLACEMENT_POLICY: ModelReplacementPolicy = {
  q1Enhanced: true, q2Load: true, q2Use: true, q2Distance: 2048, distance: "source",
};

export function loadModelReplacement(family: GameFamily, policy: ModelReplacementPolicy): boolean {
  return family === "q1" ? policy.q1Enhanced : family === "q2" && policy.q2Load;
}

export function replacementEntity(entity: SceneEntity): SceneEntity | null {
  const model = entity.model;
  if (model.kind !== "q1-mdl" && model.kind !== "q2-md2") return null;
  const replacement = model.replacement;
  return replacement == null ? null : { ...entity, resource: replacement.resource, model: replacement.model };
}

/** Q2 shadows use the loaded skeleton independently of the eye-distance LOD. */
export function selectModelEntity(entity: SceneEntity, camera: Vec3, policy: ModelReplacementPolicy,
  purpose: "view" | "shadow" = "view"): SceneEntity {
  const model = entity.model;
  if (model.kind !== "q1-mdl" && model.kind !== "q2-md2") return entity;
  if (model.kind === "q1-mdl" ? !policy.q1Enhanced : !policy.q2Load || !policy.q2Use) return entity;
  const distance = policy.distance === "source" ? model.kind === "q2-md2" ? policy.q2Distance : 0 : policy.distance;
  if (purpose === "view" && distance > 0 && length3(sub3(entity.transform.origin, camera)) > distance) return entity;
  return replacementEntity(entity) ?? entity;
}
