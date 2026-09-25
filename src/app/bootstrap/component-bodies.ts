import type { ContentId } from "../../contracts/content.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { PresentationOwner } from "../../contracts/presentation.ts";
import type { QvmBodyPart } from "../../contracts/qvm-mod-presentation.ts";
import type { SceneEntity } from "../../contracts/scene.ts";
import type { RefModelEntity } from "../../content/q3/presentation/ref-entity.ts";
import type { ModelSourceOptions } from "../../render/scene/models/types.ts";

export type BodyMaterial = Pick<RefModelEntity, "customShader" | "customSkin" | "shaderRGBA" | "shaderTexCoord" | "shaderTime" | "renderFlags" | "lightingOrigin" | "shadowPlane" | "nonNormalizedAxes">;
export interface ComponentBody {
  readonly owner: PresentationOwner;
  readonly actor: ActorId;
  readonly content: ContentId;
  readonly time: number;
  readonly parts: readonly { readonly part: QvmBodyPart; readonly base: boolean; readonly passes: readonly BodyMaterial[] }[];
}
/** A native primary body already posed by its original cgame, including its original material passes. */
export interface PreparedPrimaryBody {
  readonly actor: ActorId;
  readonly part: QvmBodyPart;
  readonly content: ContentId;
  readonly entity: SceneEntity;
  readonly base: boolean;
  readonly options: ModelSourceOptions;
  readonly shaderContent: ContentId;
  readonly time: number;
}

function materialKey(pass: BodyMaterial): string {
  const c = pass.shaderRGBA, uv = pass.shaderTexCoord, light = pass.lightingOrigin;
  // An explicit Q3 shader replaces skin lookup; inactive body-part skin maps do not create extra passes.
  return JSON.stringify([pass.customShader?.name ?? null, c.x, c.y, c.z, c.w, uv.x, uv.y, pass.shaderTime,
    pass.renderFlags, light.x, light.y, light.z, pass.shadowPlane, pass.nonNormalizedAxes, pass.customShader === null ? pass.customSkin?.surfaces ?? null : null]);
}

/** Equal passes from distinct source body parts collapse; repetitions inside one helper remain. */
export function bodyMaterials(body: ComponentBody, part: QvmBodyPart): readonly BodyMaterial[] {
  const result: BodyMaterial[] = [], seen = new Set<string>();
  for (const source of body.parts) {
    if (part !== "body" && source.part !== "body" && source.part !== part) continue;
    const occurrences = new Map<string, number>();
    for (const pass of source.passes) {
      const key = materialKey(pass), ordinal = occurrences.get(key) ?? 0; occurrences.set(key, ordinal + 1);
      const occurrence = `${key}/${ordinal}`;
      if (!seen.has(occurrence)) { result.push(pass); seen.add(occurrence); }
    }
  }
  return result;
}

export function bodyBaseVisible(bodies: readonly ComponentBody[], actor: ActorId, part: QvmBodyPart): boolean {
  return bodies.filter(body => body.actor.equals(actor)).every(body => body.parts.length !== 0
    && body.parts.filter(source => part === "body" || source.part === "body" || source.part === part).every(source => source.base));
}
