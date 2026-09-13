import type { GameFamily } from "../../contracts/content.ts";
import type { RendererImage } from "../../contracts/render.ts";
import { openMountPlan } from "../../content/mounts/index.ts";
import type { InstalledCatalog } from "../../content/catalog/index.ts";
import { propMetric } from "../../text/q3-font.ts";
import type { AtlasGlyph } from "../../text/atlas.ts";
import type { TextAtlas } from "../../text/atlas.ts";
import type { MountedContent } from "../../content/mounts/index.ts";
import { decodePalette, decodePcx, decodeWad, indexedRenderImage } from "../../formats/images/index.ts";
import { SceneTextureLoader } from "../../render/scene/index.ts";
import type { SceneImageRegistry } from "../../render/scene/index.ts";
import { classicCharset } from "../../text/atlas.ts";
import type { TextFontSelection } from "../../text/atlas.ts";
import { createMountedTextFonts } from "../../text/mounted.ts";
import { mountedImageReader } from "./image-reader.ts";

export interface MenuFontOptions {
  readonly catalog: InstalledCatalog;
  readonly mounts: MountedContent;
  readonly family: GameFamily;
  readonly rerelease: boolean;
  readonly images: SceneImageRegistry;
}
export async function loadMenuFont(options: MenuFontOptions): Promise<{ readonly font: TextFontSelection; close(): void }> {
  const { mounts, family, images } = options;
  let image: RendererImage;
  if (family === "q1") {
    const wad = await mounts.open("gfx.wad"), palette = await mounts.open("gfx/palette.lmp");
    if (wad === null || palette === null) throw new Error("Quake console requires gfx.wad and its palette");
    const lump = decodeWad(wad.bytes, "gfx.wad").lumps.find(value => value.name === "conchars");
    if (lump === undefined || lump.compression !== 0 || lump.bytes.length !== 128 * 128) throw new Error("Quake conchars is missing or malformed");
    image = images.register("conchars", indexedRenderImage([{ width: 128, height: 128, pixels: lump.bytes }], decodePalette(palette.bytes, palette.reference),
      { kind: "index", index: 0 }), { wrap: "clamp", filter: "nearest" }, { kind: "resource", resource: wad.reference });
  } else {
    const paletteAsset = family === "q2" ? await mounts.open("pics/colormap.pcx") : null;
    const colors = paletteAsset === null ? null : decodePcx(paletteAsset.bytes, "pics/colormap.pcx").palette;
    const palette = paletteAsset === null || colors === null ? null : { colors, source: paletteAsset.reference };
    const textures = new SceneTextureLoader(images, mountedImageReader(options.catalog, mounts), palette);
    const texture = await textures.load(family === "q2" ? "pics/conchars.pcx" : "gfx/2d/bigchars", { family, mipmap: false, wrap: "clamp" });
    if (texture === null) throw new Error("Quake III console charset is missing");
    image = images.register("conchars", texture.content, { wrap: "clamp", filter: "nearest" }, texture.image.source);
    images.release(texture.image);
  }
  const classic = classicCharset(image, "conchars", family === "q3" ? "tinted" : "baked");
  const fonts = createMountedTextFonts(mounts, images);
  try {
    const font = family === "q2" && options.rerelease ? await fonts.select({ kind: "kfont", path: "fonts/qconfont.kfont" }, classic)
      : { kind: "classic", classic, unicode: null } satisfies TextFontSelection;
    return { font, close() { fonts.close(); images.release(image); } };
  } catch (error) { fonts.close(); images.release(image); throw error; }
}

export interface MenuTypography {
  readonly body: TextFontSelection;
  readonly title: TextFontSelection;
  close(): void;
}

export async function loadMenuTypography(catalog: InstalledCatalog,
  images: SceneImageRegistry, classic: TextAtlas): Promise<MenuTypography> {
  const product = catalog.products.find(product => product.availability.kind === "installed"
    && product.expectation.edition === "rerelease" && (product.expectation.family === "q1" || product.expectation.family === "q2"));
  if (product === undefined) {
    const q3 = catalog.products.find(product => product.availability.kind === "installed" && product.expectation.family === "q3");
    if (q3 === undefined) {
      const font: TextFontSelection = { kind: "classic", classic, unicode: null };
      return { body: font, title: font, close() {} };
    }
    const mounts = await catalog.mountsFor(q3.id);
    const mounted = await openMountPlan({ id: "mount-plan:menu:typography", mounts, defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] });
    try {
      const textures = new SceneTextureLoader(images, mountedImageReader(catalog, mounted));
      const texture = await textures.load("menu/art/font1_prop.tga", { family: "q3", mipmap: false, wrap: "clamp" });
      if (texture === null) throw new Error("Quake III proportional menu font is missing");
      const glyphs = new Map<number, AtlasGlyph>();
      for (let code = 32; code < 127; code++) {
        const [x, y, width] = propMetric(code);
        glyphs.set(code, { x, y, width, height: 27, advance: width + 3, color: false });
      }
      const font: TextFontSelection = { kind: "atlas", classic, font: { kind: "kfont", name: "Q3 proportional", picture: { kind: "image", name: texture.name, image: texture.image }, lineHeight: 27, glyphs } };
      return { body: font, title: font, close() { images.release(texture.image); mounted.close(); } };
    } catch (error) { mounted.close(); throw error; }
  }
  const mounts = await catalog.mountsFor(product.id);
  const mounted = await openMountPlan({ id: "mount-plan:menu:typography", mounts, defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] });
  const fonts = createMountedTextFonts(mounted, images);
  try {
    const codepoints = Array.from({ length: 224 }, (_, index) => index + 32);
    const body = await fonts.loadTrueType("fonts/Montserrat-Regular.ttf", 48, codepoints);
    const title = await fonts.loadTrueType("fonts/NotoSans-Bold.ttf", 72, codepoints);
    if (body === null || title === null) throw new Error("Installed proportional menu fonts are missing");
    return { body: { kind: "atlas", font: body, classic }, title: { kind: "atlas", font: title, classic }, close() { fonts.close(); mounted.close(); } };
  } catch (error) { fonts.close(); mounted.close(); throw error; }
}
