import type { SimulationPresentation } from "./simulation/types.ts";
import type { Q3CharacterPass, Q3CharacterView } from "../../content/q3/foundation/presentation.ts";
import { q2WeaponAttachment } from "../../content/q2/foundation/weapon-attachments.ts";
import type { HeldWeaponDeclaration, HeldWeaponModel } from "../../contracts/held-weapon.ts";
import { q1HeldWeapon } from "../../content/q1/foundation/held-weapons.ts";
import { q2HeldWeapon } from "../../content/q2/foundation/held-weapons.ts";
import { Q3_WEAPON_HAND_GRIP } from "../../content/q3/foundation/held-weapons.ts";
import { alignModelAttachment } from "../../render/scene/models/attachment.ts";
import type { ModelAsset } from "./assets.ts";
import type { ContentId } from "../../contracts/content.ts";
import type { MountedContent } from "../../content/mounts/index.ts";
import { readHeldWeaponFile } from "../../content/held-weapon.ts";

type HeldAsset = Pick<ModelAsset, "resource" | "model">;
interface HeldAssets {
  provider(content: ContentId): Promise<{ readonly mounts: Pick<MountedContent, "open"> }>;
  model(content: ContentId, path: string): Promise<HeldAsset>;
}

export class ForeignHeldWeapons {
  private readonly declarations = new Map<string, Promise<HeldWeaponDeclaration | undefined>>();
  private readonly models = new Map<string, Promise<HeldAsset | null>>();

  constructor(private readonly assets: HeldAssets) {}

  declaration(source: SimulationPresentation): Promise<HeldWeaponDeclaration | undefined> {
    if (source.heldWeapon !== undefined || source.path === "") return Promise.resolve(source.heldWeapon);
    const key = `${source.content}/${source.path}`, existing = this.declarations.get(key);
    if (existing !== undefined) return existing;
    const pending = (async () => {
      const file = await (await this.assets.provider(source.content)).mounts.open(`${source.path}.held.json`);
      return file === null ? undefined : readHeldWeaponFile(file.bytes);
    })();
    this.declarations.set(key, pending); return pending;
  }

  private model(source: SimulationPresentation, held: HeldWeaponModel): Promise<HeldAsset | null> {
    const key = `${source.content}/${held.path}/${held.fallback ?? ""}/${held.part?.digests.join(",") ?? ""}/${held.part?.vertices.join(",") ?? ""}`, existing = this.models.get(key);
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
    const declaration = await this.declaration(source);
    if (declaration?.kind === "none") return [];
    const held = declaration?.model ?? (source.family === "q2" ? q2HeldWeapon(source.path, source.weaponItem) : source.family === "q1" ? q1HeldWeapon(source.path) : null);
    if (held === null) throw new Error(`Selected weapon ${source.content}/${source.path} has no authored held model declaration`);
    const asset = await this.model(source, held);
    if (asset === null) throw new Error(`Source held model is absent: ${source.content}/${held.path}`);
    if (held.digest !== undefined && held.digest !== asset.resource.digest) throw new Error("Held model digest differs from its source declaration");
    if (asset.model.kind === "brush-model" || held.referenceFrame >= asset.model.frames.length) throw new Error("Held model reference frame is outside its source animation");
    const sourceGrip = declaration === undefined && source.family === "q2" ? q2WeaponAttachment(asset.resource.digest) : null;
    const transform = alignModelAttachment(sourceGrip?.kind === "mesh" ? sourceGrip.grip : held.grip, Q3_WEAPON_HAND_GRIP);
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
