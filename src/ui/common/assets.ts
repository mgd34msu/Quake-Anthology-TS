// SPDX-License-Identifier: GPL-2.0-or-later
import { mainMenuBackground, menuBackground, menuFocus, menuPanel } from "./art-manifest.ts";
import type { MenuArtFile, MenuArtFrame } from "./art-manifest.ts";
import type { ResourceId } from "../../contracts/content.ts";
import type { ImageLevel, RendererImage } from "../../contracts/render.ts";
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
export interface NativeUiArtSelection {
  /** The full-screen background and the panel and focus frames. Production menus use the flat menuSkin and never draw them. */
  readonly frames?: boolean;
  /** The startup menu's backdrop. */
  readonly mainBackground?: boolean;
}
const menuBackgroundId: ResourceId = "resource:engine-menu:background";
const mainBackgroundId: ResourceId = "resource:engine-menu:main-background";
const panelId: ResourceId = "resource:engine-menu:panel";
const focusId: ResourceId = "resource:engine-menu:focus";

export async function loadNativeUiArt(
  font: ResourceId,
  images: SceneImageRegistry,
  read: (path: string) => Promise<ImageLevel>,
  selection: NativeUiArtSelection = {},
): Promise<NativeUiArt> {
  const { frames = true, mainBackground = true } = selection;
  const assets: readonly { readonly resource: ResourceId; readonly file: MenuArtFile }[] = [
    ...(frames ? [{ resource: menuBackgroundId, file: menuBackground }] : []),
    ...(mainBackground ? [{ resource: mainBackgroundId, file: mainMenuBackground }] : []),
    ...(frames
      ? [
          { resource: panelId, file: menuPanel },
          { resource: focusId, file: menuFocus },
        ]
      : []),
  ];
  const decoded = await Promise.all(assets.map(async asset => ({ ...asset, image: await read(asset.file.file) })));
  const pictures = new Map<ResourceId, ImagePicture>(),
    owned: RendererImage[] = [];
  try {
    for (const asset of decoded) {
      if (asset.image.width !== asset.file.width || asset.image.height !== asset.file.height)
        throw new Error(`Menu image dimensions differ from the manifest: ${asset.file.file}`);
      const image = images.register(asset.file.file, rgbaImage(asset.image), { wrap: "clamp", filter: "linear" });
      owned.push(image);
      pictures.set(asset.resource, { kind: "image", name: asset.file.file, image });
    }
    const whiteImage = images.register("menu-white", rgbaImage({ width: 1, height: 1, pixels: new Uint8Array([255, 255, 255, 255]) }), {
      wrap: "clamp",
      filter: "nearest",
    });
    owned.push(whiteImage);
    const slice = (resource: ResourceId, frame: MenuArtFrame): UiImageSlice => ({
      resource,
      width: frame.region.width,
      height: frame.region.height,
      uv: frame.region.uv,
      border: frame.border,
      borderScale: frame.borderScale,
    });
    let closed = false;
    const skin = frames
      ? {
          ...defaultUiSkin(font),
          background: menuBackgroundId,
          panel: slice(panelId, menuPanel),
          focus: slice(focusId, menuFocus),
        }
      : { ...defaultUiSkin(font), background: null, panel: null, focus: null };
    return {
      skin,
      white: { kind: "image", name: "menu-white", image: whiteImage },
      picture(resource) {
        const picture = pictures.get(resource);
        if (picture === undefined || closed) throw new Error(`Unregistered native UI image: ${resource}`);
        return picture;
      },
      close() {
        if (closed) return;
        closed = true;
        for (const image of owned) images.release(image);
        pictures.clear();
      },
    };
  } catch (error) {
    for (const image of owned) images.release(image);
    throw error;
  }
}
