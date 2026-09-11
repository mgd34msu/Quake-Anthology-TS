import type { SceneEntity } from "../../contracts/scene.ts";
import type { CompiledMaterial } from "../../materials/compile.ts";
import { deformGeometry } from "../../materials/deform.ts";
import type { MaterialDrawContext } from "../../materials/evaluate.ts";
import { MaterialDeformState } from "../../materials/geometry.ts";
import type { MaterialGeometry } from "../../materials/geometry.ts";

/** View models, transparent effects and sprites have no world-space silhouette. */
export function entityCastsShadow(entity: SceneEntity, viewModel = false): boolean {
  if (viewModel || entity.model.kind === "q1-spr" || entity.model.kind === "q2-sp2") return false;
  if (entity.flags.kind === "q2") return (entity.flags.bits & (4 | 16 | 32 | 128 | 8192 | 0x00200000)) === 0;
  if (entity.flags.kind === "q3" && (entity.flags.bits & (4 | 8 | 64)) !== 0) return false;
  return entity.color.w >= 1;
}

/** Run the same deformation and shader clock as the color pass before projection. */
export function shadowMaterialGeometry(shader: CompiledMaterial, geometry: MaterialGeometry, context: MaterialDrawContext): MaterialGeometry | null {
  const definition = shader.registered.definition;
  if (shader.finished.iterator.kind === "sky" || shader.finished.sort > 3
    || definition.surfaceParms.some(value => ["nodraw", "trans", "water", "slime", "lava"].includes(value))
    || definition.deforms.some(value => value.kind === "autosprite" || value.kind === "autosprite2" || value.kind === "projectionshadow")) return null;
  let time = context.time - context.timeOffset;
  if (definition.clampTime !== 0 && time >= definition.clampTime) time = definition.clampTime;
  return deformGeometry(new MaterialDeformState(geometry, context.refdefTime, context.renderText, definition), definition.deforms,
    context.deformView, Math.fround(time), context.noise, context.projectionShadow);
}
