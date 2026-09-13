import type { Q3CharacterPass, Q3CharacterView } from "../../content/q3/foundation/presentation.ts";
import { q2HeldWeapon } from "../../content/q2/foundation/held-weapons.ts";
import { Q3_WEAPON_HAND_GRIP } from "../../content/q3/foundation/held-weapons.ts";
import { alignModelAttachment } from "../../render/scene/models/attachment.ts";
import type { ApplicationAssets, ModelAsset } from "./assets.ts";
import type { SimulationPresentation } from "./simulation/types.ts";

export class ForeignHeldWeapons {
  private readonly models = new Map<string, Promise<ModelAsset | null>>();

  constructor(private readonly assets: ApplicationAssets) {}

  private model(source: SimulationPresentation, path: string): Promise<ModelAsset | null> {
    const key = `${source.content}/${path}`, existing = this.models.get(key);
    if (existing !== undefined) return existing;
    const loaded = (async () => {
      const provider = await this.assets.provider(source.content);
      return await provider.mounts.open(path) === null ? null : this.assets.model(source.content, path);
    })();
    this.models.set(key, loaded); return loaded;
  }

  async frame(source: SimulationPresentation, character: Q3CharacterView): Promise<readonly Q3CharacterPass[]> {
    const held = source.family === "q2" ? q2HeldWeapon(source.path) : null;
    if (held === null) return [];
    const asset = await this.model(source, held.path);
    if (asset === null) return [];
    const transform = alignModelAttachment(held.grip, Q3_WEAPON_HAND_GRIP);
    return [{ content: source.content, shader: null, options: () => ({}), entity: {
      actor: source.actor, resource: asset.resource, model: asset.model,
      transform, previousOrigin: transform.origin,
      pose: { kind: "frame", frame: held.referenceFrame, previousFrame: held.referenceFrame, backLerp: 0 },
      skin: 0, color: character.color, opacity: character.opacity ?? 1,
      shaderTime: { kind: "seconds", value: 0 }, flags: { kind: source.family, bits: 0 },
      lightingOrigin: character.origin, shadowPlane: 0, attachments: [],
    } }];
  }
}
