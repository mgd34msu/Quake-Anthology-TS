// SPDX-License-Identifier: GPL-2.0-or-later
import { menuBackground, menuFocus, menuPanel } from "./art-manifest.ts";
import type { MenuArtFile, MenuArtFrame } from "./art-manifest.ts";
import type { ResourceId } from "../../contracts/content.ts";
import type { RendererImage } from "../../contracts/render.ts";
import { decodePng } from "../../formats/images/png.ts";
import { rgbaImage } from "../../render/scene/resources.ts";
import type { SceneImageRegistry } from "../../render/scene/resources.ts";
import type { ImagePicture } from "../../text/draw2d.ts";
import { defaultUiSkin } from "./skin.ts";
import type { UiImageSlice, UiSkin } from "./skin.ts";

export interface NativeUiArt {
  readonly skin: UiSkin;
  readonly white: ImagePicture;
  picture(resource: ResourceId): ImagePicture;
  close(): void;
}
/** The application supplies its installed-asset reader; the renderer owns all uploads. */
export async function loadNativeUiArt(font: ResourceId, images: SceneImageRegistry, read: (path: string) => Promise<Uint8Array>): Promise<NativeUiArt> {
  const assets: readonly { readonly resource: ResourceId; readonly file: MenuArtFile }[] = [
    { resource: "resource:engine-menu:background", file: menuBackground },
    { resource: "resource:engine-menu:panel", file: menuPanel },
    { resource: "resource:engine-menu:focus", file: menuFocus },
  ];
  const decoded = await Promise.all(assets.map(async asset => ({ ...asset, image: decodePng(await read(asset.file.file), asset.file.file) })));
  const pictures = new Map<ResourceId, ImagePicture>(), owned: RendererImage[] = [];
  try {
    for (const asset of decoded) {
      if (asset.image.width !== asset.file.width || asset.image.height !== asset.file.height) throw new Error(`Menu image dimensions differ from the manifest: ${asset.file.file}`);
      const image = images.register(asset.file.file, rgbaImage(asset.image), { wrap: "clamp", filter: "linear" }); owned.push(image);
      pictures.set(asset.resource, { kind: "image", name: asset.file.file, image });
    }
    const whiteImage = images.register("menu-white", rgbaImage({ width: 1, height: 1, pixels: new Uint8Array([255, 255, 255, 255]) }), { wrap: "clamp", filter: "nearest" });
    owned.push(whiteImage);
    const slice = (resource: ResourceId, frame: MenuArtFrame): UiImageSlice => ({ resource, width: frame.region.width, height: frame.region.height,
      uv: frame.region.uv, border: frame.border, borderScale: frame.borderScale });
    let closed = false;
    return { skin: { ...defaultUiSkin(font), background: "resource:engine-menu:background", panel: slice("resource:engine-menu:panel", menuPanel),
      focus: slice("resource:engine-menu:focus", menuFocus) }, white: { kind: "image", name: "menu-white", image: whiteImage },
      picture(resource) { const picture = pictures.get(resource); if (picture === undefined || closed) throw new Error(`Unregistered native UI image: ${resource}`); return picture; },
      close() { if (closed) return; closed = true; for (const image of owned) images.release(image); pictures.clear(); },
    };
  } catch (error) { for (const image of owned) images.release(image); throw error; }
}
