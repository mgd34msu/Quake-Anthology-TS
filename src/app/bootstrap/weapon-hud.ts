import type { ResourceId } from "../../contracts/content.ts";
import type { WeaponHudIcon, WeaponHudStatus } from "../../contracts/ui.ts";
import type { PictureAsset } from "../../text/draw2d.ts";
import { decodeQpic, decodeWad, indexedRenderImage } from "../../formats/images/index.ts";
import { weaponHudIcons } from "../../content/catalog/weapon-hud.ts";
import type { ApplicationAssets } from "./assets.ts";

export class ApplicationWeaponHudAssets {
  private readonly pending = new Map<string, Promise<ResourceId>>();
  private readonly pictures = new Map<ResourceId, PictureAsset>();
  private readonly textureIcons = new Map<string, WeaponHudIcon>();
  constructor(readonly assets: ApplicationAssets) {}
  picture(id: ResourceId): PictureAsset | undefined { return this.pictures.get(id); }
  async prepareImageRefresh(providers: Pick<ApplicationAssets, "provider">): Promise<() => void> {
    const pictures = new Map<ResourceId, PictureAsset>();
    for (const [key, icon] of this.textureIcons) await this.loadIcon(icon, key, providers, pictures);
    return () => { for (const [id, picture] of pictures) this.pictures.set(id, picture); };
  }
  aspect(id: ResourceId | null): number {
    if (id === null) return 1;
    const picture = this.pictures.get(id);
    if (picture?.kind === "image") return picture.image.width / picture.image.height;
    if (picture?.kind === "material") for (const stage of picture.material.compiled.registered.stages) {
      if (stage.kind !== "loaded" || stage.binding.kind !== "images") continue;
      const playback = stage.binding.playback, image = playback.kind === "single" ? playback.image.image : playback.frames[0].image;
      return image.width / image.height;
    }
    return 1;
  }
  async prepare(status: WeaponHudStatus | null): Promise<{ readonly weapon: ResourceId | null; readonly ammo: ResourceId | null }> {
    if (status === null) return { weapon: null, ammo: null };
    const icons = weaponHudIcons(status.source, this.assets.content.catalog.product(status.source.content).expectation, status.item);
    if (icons === null) return { weapon: null, ammo: null };
    const load = (icon: WeaponHudIcon | null): Promise<ResourceId | null> => icon === null ? Promise.resolve(null) : this.load(icon);
    const [weapon, ammo] = await Promise.all([load(icons.selectedWeapon ?? icons.weapon), load(icons.ammo)]);
    return { weapon, ammo };
  }
  private load(icon: WeaponHudIcon): Promise<ResourceId> {
    const key = icon.kind === "shader" ? `${icon.content}/${icon.name}` : `${icon.resource.content}/${icon.resource.path}/${icon.kind === "wad-picture" ? icon.lump : ""}`;
    const prior = this.pending.get(key); if (prior !== undefined) return prior;
    const pending = this.loadIcon(icon, key); this.pending.set(key, pending); return pending;
  }
  private async loadIcon(icon: WeaponHudIcon, key: string, providers: Pick<ApplicationAssets, "provider"> = this.assets,
    pictures: Map<ResourceId, PictureAsset> = this.pictures): Promise<ResourceId> {
    const id: ResourceId = `resource:weapon-hud:${key}`;
    const provider = await providers.provider(icon.kind === "shader" ? icon.content : icon.resource.content);
    if (icon.kind === "shader") pictures.set(id, await provider.shaders.registerPicture(icon.name));
    else if (provider.family === "q1") {
      const asset = await provider.mounts.open(icon.resource.path);
      if (asset === null || provider.palette === null) throw new Error(`Weapon HUD picture missing: ${key}`);
      const lump = icon.kind === "wad-picture" ? decodeWad(asset.bytes, icon.resource.path).lumps.find(entry => entry.name === icon.lump) : null;
      if (icon.kind === "wad-picture" && lump == null) throw new Error(`Weapon HUD WAD lump missing: ${key}`);
      const picture = decodeQpic(lump?.bytes ?? asset.bytes, key);
      const image = this.assets.images.register(key, indexedRenderImage([{ width: picture.width, height: picture.height, pixels: picture.indices }], provider.palette,
        { kind: "index", index: 255 }), { wrap: "clamp", filter: "linear" }, { kind: "resource", resource: asset.reference });
      pictures.set(id, { kind: "image", name: key, image });
    } else {
      const texture = await provider.textures.load(icon.resource.path, { family: provider.family, mipmap: false, wrap: "clamp" });
      if (texture === null) throw new Error(`Weapon HUD image missing: ${key}`);
      pictures.set(id, { kind: "image", name: key, image: texture.image });
      this.textureIcons.set(key, icon);
    }
    return id;
  }
}
