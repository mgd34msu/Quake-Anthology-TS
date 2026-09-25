import type { ContentId } from "../../contracts/content.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { ModelTransform, SceneEntity } from "../../contracts/scene.ts";
import { readModelAttachment } from "../../content/model-attachment.ts";
import { q2WeaponAttachment } from "../../content/q2/foundation/weapon-attachments.ts";
import { Q3_WEAPON_HAND_GRIP } from "../../content/q3/foundation/held-weapons.ts";
import { createModelGrip } from "../../render/scene/models/grip.ts";
import { alignModelAttachment } from "../../render/scene/models/attachment.ts";
import { composeModelTransform } from "../../render/scene/models/transform.ts";
import { replacementEntity, selectModelEntity } from "../../render/scene/models/replacements.ts";
import type { ModelReplacementPolicy } from "../../render/scene/models/replacements.ts";
import type { MountedContent } from "../../content/mounts/index.ts";

interface NativeHeldAssets {
  readonly modelPolicy: ModelReplacementPolicy;
  provider(content: ContentId): Promise<{ readonly mounts: Pick<MountedContent, "open"> }>;
}

type Grip = (entity: SceneEntity) => ModelTransform | null;
export type ResolvedHeldEntity = (camera: Vec3, purpose: "view" | "shadow") => SceneEntity | null;

export class NativeHeldWeapons {
  private readonly grips = new Map<string, Promise<Grip>>();
  constructor(private readonly assets: NativeHeldAssets) {}

  private grip(content: ContentId, entity: SceneEntity): Promise<Grip> {
    const key = `${content}/${entity.resource.id}`, existing = this.grips.get(key);
    if (existing !== undefined) return existing;
    const pending = (async () => {
      const path = `${entity.resource.requestedPath}.attachment.json`;
      const file = await (await this.assets.provider(content)).mounts.open(path);
      const definition = file === null ? q2WeaponAttachment(entity.resource.digest) : readModelAttachment(file.bytes);
      if (definition === null) throw new Error(`Native held model ${content}/${entity.resource.requestedPath} requires ${path}`);
      return createModelGrip(entity, definition);
    })();
    this.grips.set(key, pending); return pending;
  }

  async attachment(content: ContentId, carrier: SceneEntity): Promise<(child: SceneEntity) => ResolvedHeldEntity> {
    const original = await this.grip(content, carrier), replacement = replacementEntity(carrier);
    const enhanced = replacement === null ? null : await this.grip(content, replacement);
    return child => {
      const inherit = (entity: SceneEntity): SceneEntity => ({ ...entity, flags: carrier.flags,
        opacity: carrier.opacity ?? 1, lightingOrigin: carrier.lightingOrigin, shadowPlane: carrier.shadowPlane,
        attachments: entity.attachments.map(attachment => ({ ...attachment, entity: inherit(attachment.entity) })) });
      const held = inherit(child);
      return (camera, purpose) => {
        const selected = selectModelEntity(carrier, camera, this.assets.modelPolicy, purpose);
        const sample = selected.resource.id === carrier.resource.id ? original : enhanced;
        if (sample === null) throw new Error("Native attachment replacement changed after preparation");
        const grip = sample(selected);
        if (grip === null) return null;
        const hand = composeModelTransform(selected.transform, grip);
        const transform = composeModelTransform(alignModelAttachment(Q3_WEAPON_HAND_GRIP, hand), held.transform);
        return { ...held, transform, previousOrigin: transform.origin };
      };
    };
  }
}
