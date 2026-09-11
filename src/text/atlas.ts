// SPDX-License-Identifier: GPL-2.0-or-later
// Quake rerelease kfont/TrueType glyph providers and classic charset fallback.
import type { ImageLevel, RenderImage, RendererImage } from "../contracts/render.ts";
import { decodePng } from "../formats/images/png.ts";
import { decodeTga } from "../formats/images/tga.ts";
import { buildFontAtlas, parseFont } from "./truetype.ts";
import { ParseKfont } from "./kfont.ts";
import type { ImagePicture, TextureRect } from "./draw2d.ts";

export interface AtlasGlyph {
  readonly x: number; readonly y: number; readonly width: number; readonly height: number;
  readonly advance: number; readonly color: boolean;
}
export interface TextAtlas {
  readonly kind: "classic" | "kfont" | "truetype";
  readonly name: string;
  readonly picture: ImagePicture;
  readonly lineHeight: number;
  readonly glyphs: ReadonlyMap<number, AtlasGlyph>;
}
export type TextFontSelection = { readonly kind: "classic"; readonly classic: TextAtlas; readonly unicode: TextAtlas | null }
  | { readonly kind: "atlas"; readonly font: TextAtlas; readonly classic: TextAtlas };
export interface FontImageServices {
  read(path: string): Promise<Uint8Array | null>;
  registerImage(name: string, content: RenderImage): Promise<RendererImage>;
  releaseImage(image: RendererImage): void;
}
export type TextFontRequest = { readonly kind: "classic"; readonly unicodeFont: string | null }
  | { readonly kind: "kfont"; readonly path: string }
  | { readonly kind: "truetype"; readonly path: string; readonly pixelSize: number; readonly codepoints: readonly number[] };

export function classicCharset(image: RendererImage, name = "conchars", colorPolicy: "baked" | "tinted" = "baked"): TextAtlas {
  if (image.width % 16 !== 0 || image.height % 16 !== 0) throw new RangeError("Charset needs 16 by 16 glyph cells");
  const width = image.width / 16, height = image.height / 16, glyphs = new Map<number, AtlasGlyph>();
  for (let code = 0; code < 256; code++) glyphs.set(code, {
    x: (code & 15) * width, y: (code >> 4) * height, width, height, advance: width, color: colorPolicy === "baked",
  });
  return { kind: "classic", name, picture: { kind: "image", name, image }, lineHeight: height, glyphs };
}

/** A registry belongs to one mounted-content and renderer resource lifetime. */
export class TextFontRegistry {
  private readonly cache = new Map<string, Promise<TextAtlas | null>>();
  private readonly images = new Set<RendererImage>();
  private closed = false;
  constructor(private readonly services: FontImageServices) {}
  async select(request: TextFontRequest, classic: TextAtlas): Promise<TextFontSelection> {
    if (request.kind === "classic") return { kind: "classic", classic,
      unicode: request.unicodeFont === null ? null : await this.loadKfont(request.unicodeFont) };
    const font = request.kind === "kfont" ? await this.loadKfont(request.path)
      : await this.loadTrueType(request.path, request.pixelSize, request.codepoints);
    return font === null ? { kind: "classic", classic, unicode: null } : { kind: "atlas", font, classic };
  }
  loadKfont(path: string): Promise<TextAtlas | null> {
    return this.cached(`kfont:${path}`, async () => {
      const bytes = await this.services.read(path);
      if (bytes === null) return null;
      const parsed = ParseKfont(new TextDecoder().decode(bytes));
      if (parsed === null) return null;
      const bitmap = await this.services.read(parsed.textureToken);
      if (bitmap === null) return null;
      const level = parsed.textureToken.toLowerCase().endsWith(".png")
        ? decodePng(bitmap, parsed.textureToken) : decodeTga(bitmap, parsed.textureToken);
      const glyphs = new Map<number, AtlasGlyph>();
      for (const [code, glyph] of parsed.glyphs) {
        if (glyph.x < 0 || glyph.y < 0 || glyph.w < 0 || glyph.h < 0
          || glyph.x + glyph.w > level.width || glyph.y + glyph.h > level.height)
          throw new RangeError(`Kfont glyph ${code} exceeds ${parsed.textureToken}`);
        glyphs.set(code, { x: glyph.x, y: glyph.y, width: glyph.w, height: glyph.h, advance: glyph.w, color: false });
      }
      return this.register("kfont", path, level, parsed.line_height, glyphs);
    });
  }
  loadTrueType(path: string, pixelSize: number, codepoints: readonly number[]): Promise<TextAtlas | null> {
    if (!Number.isInteger(pixelSize) || pixelSize <= 0 || pixelSize > 1024) throw new RangeError("Invalid TrueType pixel size");
    const coverage = [...new Set([...codepoints, 32, 63])].sort((a, b) => a - b);
    for (const code of coverage) if (!Number.isInteger(code) || code < 0 || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff)
      throw new RangeError("Font coverage must contain Unicode scalar values");
    const key = `truetype:${path}:${pixelSize}:${coverage.join(",")}`;
    return this.cached(key, async () => {
      const bytes = await this.services.read(path);
      if (bytes === null) return null;
      const parsed = parseFont(bytes);
      if (!parsed.ok) throw new Error(`${path}: ${parsed.reason}`);
      const atlas = buildFontAtlas(parsed.font, coverage, pixelSize), glyphs = new Map<number, AtlasGlyph>();
      for (const [code, glyph] of atlas.glyphs) glyphs.set(code, { x: glyph.x, y: glyph.y,
        width: glyph.w, height: glyph.h, advance: glyph.w, color: glyph.color });
      return this.register("truetype", key, atlas, atlas.lineHeight, glyphs);
    });
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const image of this.images) this.services.releaseImage(image);
    this.images.clear(); this.cache.clear();
  }
  private cached(key: string, load: () => Promise<TextAtlas | null>): Promise<TextAtlas | null> {
    if (this.closed) throw new Error("Text font registry is closed");
    const existing = this.cache.get(key);
    if (existing !== undefined) return existing;
    const pending = load().then(font => {
      if (this.closed) throw new Error("Text font registry closed during font load");
      return font;
    });
    this.cache.set(key, pending);
    pending.catch(() => { if (this.cache.get(key) === pending) this.cache.delete(key); });
    return pending;
  }
  private async register(kind: "kfont" | "truetype", name: string, level: ImageLevel,
    lineHeight: number, glyphs: ReadonlyMap<number, AtlasGlyph>): Promise<TextAtlas> {
    if (this.closed) throw new Error("Text font registry is closed");
    const image = await this.services.registerImage(name, { kind: "rgba8", levels: [level], borderColor: { x: 0, y: 0, z: 0, w: 0 } });
    if (this.closed) { this.services.releaseImage(image); throw new Error("Text font registry closed during image registration"); }
    this.images.add(image);
    return { kind, name, picture: { kind: "image", name, image }, lineHeight, glyphs };
  }
}

export interface ResolvedTextGlyph { readonly atlas: TextAtlas; readonly glyph: AtlasGlyph; readonly codepoint: number; readonly visible: boolean; }
function atlasGlyph(atlas: TextAtlas, codepoint: number): ResolvedTextGlyph | null {
  const glyph = atlas.glyphs.get(codepoint);
  return glyph === undefined || glyph.width === 0 ? null : { atlas, glyph, codepoint, visible: codepoint !== 32 };
}
export function resolveTextGlyph(selection: TextFontSelection, codepoint: number, alternate = false): ResolvedTextGlyph {
  const classic = (code: number): ResolvedTextGlyph => {
    const result = atlasGlyph(selection.classic, (code & 255) | (alternate ? 128 : 0));
    if (result === null) throw new Error("Classic charset is missing a cell");
    return { ...result, visible: (code & 127) !== 32 };
  };
  if (selection.kind === "classic") {
    if (codepoint <= 255) return classic(codepoint);
    if (selection.unicode !== null) {
      const glyph = atlasGlyph(selection.unicode, codepoint) ?? atlasGlyph(selection.unicode, 63);
      if (glyph !== null) return glyph;
    }
    return classic(63);
  }
  const glyph = atlasGlyph(selection.font, codepoint);
  if (glyph !== null) return glyph;
  if (codepoint <= 255) return classic(codepoint);
  return atlasGlyph(selection.font, 63) ?? classic(63);
}
export function glyphUv(glyph: ResolvedTextGlyph): TextureRect {
  return { s: glyph.glyph.x / glyph.atlas.picture.image.width, t: glyph.glyph.y / glyph.atlas.picture.image.height,
    s2: (glyph.glyph.x + glyph.glyph.width) / glyph.atlas.picture.image.width,
    t2: (glyph.glyph.y + glyph.glyph.height) / glyph.atlas.picture.image.height };
}
export function textCodepoints(text: string): readonly number[] {
  const points = new Set<number>();
  for (const character of text) { const code = character.codePointAt(0); if (code !== undefined) points.add(code); }
  return [...points];
}
