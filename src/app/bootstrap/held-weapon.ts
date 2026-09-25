import type { Q3CharacterPass, Q3CharacterView } from "../../content/q3/foundation/presentation.ts";
import type { HeldWeaponModel } from "../../contracts/held-weapon.ts";
import { q1HeldWeapon } from "../../content/q1/foundation/held-weapons.ts";
import { q2HeldWeapon } from "../../content/q2/foundation/held-weapons.ts";
import { Q3_WEAPON_HAND_GRIP } from "../../content/q3/foundation/held-weapons.ts";
import { alignModelAttachment } from "../../render/scene/models/attachment.ts";
import type { ApplicationAssets, ModelAsset } from "./assets.ts";
import type { SimulationPresentation } from "./simulation/types.ts";

export class ForeignHeldWeapons {
  private readonly models = new Map<string, Promise<ModelAsset | null>>();

  constructor(private readonly assets: ApplicationAssets) {}

  private model(source: SimulationPresentation, held: HeldWeaponModel): Promise<ModelAsset | null> {
    const key = `${source.content}/${held.path}/${held.part?.vertices.join(",") ?? ""}`, existing = this.models.get(key);
    if (existing !== undefined) return existing;
    const loaded = (async () => {
      const provider = await this.assets.provider(source.content);
      let path = held.path;
      if (await provider.mounts.open(path) === null) { if (held.fallback === undefined || await provider.mounts.open(held.fallback) === null) return null; path = held.fallback; }
      const asset = await this.assets.model(source.content, path);
      if (held.part === undefined) return asset;
      if (!held.part.digests.includes(asset.resource.digest) || asset.model.kind !== "q1-mdl") throw new Error(`Held model subset is not qualified for ${source.content}/${path}`);
      const model = asset.model, vertices = new Set(held.part.vertices);
      const triangles = model.triangles.filter(triangle => triangle.vertices.every(index => vertices.has(index)));
      if (triangles.length === 0) throw new Error("Held model part has no source triangles");
      return { ...asset, model: { ...model, triangles, replacement: null } };
    })();
    this.models.set(key, loaded); return loaded;
  }

  async frame(source: SimulationPresentation, character: Pick<Q3CharacterView, "origin" | "color" | "opacity">): Promise<readonly Q3CharacterPass[]> {
    const held = source.family === "q2" ? q2HeldWeapon(source.path, source.weaponItem) : source.family === "q1" ? q1HeldWeapon(source.path) : null;
    if (held === null) return [];
    const asset = await this.model(source, held);
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
