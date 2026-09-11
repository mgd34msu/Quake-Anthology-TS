/* Adapted from Q1 VID_SetPalette/Check_Gamma and Q2 GL_Upload8/GL_InitImages.
 * Copyright (C) 1996-1997 Id Software, Inc. GPL-2.0-or-later. */
import type { ResolvedResourceReference } from "../../contracts/content.ts";
import type { ImageLevel, Palette, PaletteTransparency, RenderImage } from "../../contracts/render.ts";

export type IndexedRenderImage = Extract<RenderImage, { readonly kind: "indexed8" }>;

export function decodePalette(bytes: Uint8Array, source: ResolvedResourceReference): Palette {
  if (bytes.length !== 768) throw new RangeError("A Quake palette requires 256 RGB entries");
  return { colors: bytes.slice(), source };
}

/** Keep the colormap, including its fullbright-count trailer, for software lighting. */
export function decodeQ1Colormap(bytes: Uint8Array): { readonly levels: Uint8Array; readonly fullbright: { readonly first: number; readonly last: number } } {
  if (bytes.length < 16385) throw new RangeError("Q1 colormap requires 64 lighting rows and a fullbright count");
  const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint8(16384);
  return { levels: bytes.slice(0, 16384), fullbright: { first: 256 - count, last: 255 } };
}

export function indexedRenderImage(levels: readonly [ImageLevel, ...ImageLevel[]], palette: Palette,
  transparency: PaletteTransparency = { kind: "opaque" }, fullbright: IndexedRenderImage["fullbright"] = null,
  translation: Uint8Array | null = null): IndexedRenderImage {
  if (palette.colors.length !== 768) throw new RangeError("A Quake palette requires 256 RGB entries");
  if (translation !== null && translation.length !== 256) throw new RangeError("Palette translation requires 256 entries");
  for (const level of levels) {
    if (!Number.isSafeInteger(level.width) || !Number.isSafeInteger(level.height) || level.width <= 0 || level.height <= 0
      || level.pixels.length !== level.width * level.height) throw new RangeError("Indexed image dimensions do not match its indices");
  }
  return { kind: "indexed8", levels, palette, transparency, fullbright, translation };
}

/** Q1 player shirts/pants reverse high palette ramps, matching R_TranslatePlayerSkin. */
export function q1PlayerTranslation(topColor: number, bottomColor: number): Uint8Array {
  if (!Number.isInteger(topColor) || !Number.isInteger(bottomColor) || topColor < 0 || topColor > 13 || bottomColor < 0 || bottomColor > 13)
    throw new RangeError("Q1 player colors must be in 0..13");
  const translation = Uint8Array.from({ length: 256 }, (_, index) => index);
  for (let index = 0; index < 16; index++) {
    const top = topColor * 16, bottom = bottomColor * 16;
    translation[16 + index] = top < 128 ? top + index : top + 15 - index;
    translation[96 + index] = bottom < 128 ? bottom + index : bottom + 15 - index;
  }
  return translation;
}

export type PaletteLayer = "combined" | "ordinary" | "fullbright";

/** Derive upload pixels while leaving indexed source data and palette untouched. */
export function expandIndexedImage(image: IndexedRenderImage, level = 0, layer: PaletteLayer = "combined"): ImageLevel {
  const indexed = image.levels[level];
  if (indexed === undefined) throw new RangeError(`Missing image mip ${level}`);
  const colors = new DataView(image.palette.colors.buffer, image.palette.colors.byteOffset, image.palette.colors.byteLength);
  const pixels = new Uint8Array(indexed.pixels.length * 4);
  for (const [offset, original] of indexed.pixels.entries()) {
    const index = image.translation === null ? original : image.translation[original];
    if (index === undefined) throw new RangeError("Incomplete palette translation");
    const transparent = image.transparency.kind !== "opaque" && original === image.transparency.index;
    const fullbright = image.fullbright !== null && index >= image.fullbright.first && index <= image.fullbright.last;
    const visible = !transparent && (layer === "combined" || (layer === "fullbright" ? fullbright : !fullbright));
    pixels[offset * 4] = colors.getUint8(index * 3);
    pixels[offset * 4 + 1] = colors.getUint8(index * 3 + 1);
    pixels[offset * 4 + 2] = colors.getUint8(index * 3 + 2);
    pixels[offset * 4 + 3] = visible ? 255 : 0;
  }
  return { width: indexed.width, height: indexed.height, pixels };
}

export type GammaProfile = { readonly kind: "q1-gl"; readonly gamma: number }
  | { readonly kind: "q2-gl"; readonly gamma: number; readonly intensity: number; readonly onlyGamma: boolean }
  | { readonly kind: "q3"; readonly gamma: number; readonly intensity: number; readonly overbrightBits: number; readonly onlyGamma: boolean };

export function buildGammaTable(profile: GammaProfile): Uint8Array {
  if (!Number.isFinite(profile.gamma) || profile.gamma <= 0) throw new RangeError("Gamma must be positive and finite");
  if (profile.kind === "q3" && (!Number.isInteger(profile.overbrightBits) || profile.overbrightBits < 0 || profile.overbrightBits > 2))
    throw new RangeError("Q3 overbright bits must be in 0..2");
  const table = new Uint8Array(256);
  for (let index = 0; index < 256; index++) {
    let value: number;
    if (profile.kind === "q1-gl") value = Math.fround(Math.fround(Math.fround(Math.pow((index + 1) / 256, Math.fround(profile.gamma))) * 255) + 0.5);
    else if (profile.gamma === 1) value = index;
    else if (profile.kind === "q3") value = 255 * Math.pow(Math.fround(index / 255), Math.fround(1 / Math.fround(profile.gamma))) + 0.5;
    else value = Math.fround(255 * Math.pow((index + 0.5) / 255.5, Math.fround(profile.gamma)) + 0.5);
    if (profile.kind === "q3") value = Math.trunc(value) * 2 ** profile.overbrightBits;
    table[index] = Math.max(0, Math.min(255, Math.trunc(value)));
  }
  return table;
}

export function applyImageGamma(level: ImageLevel, profile: GammaProfile): ImageLevel {
  if (level.pixels.length !== level.width * level.height * 4) throw new RangeError("Gamma input must be RGBA8");
  const table = buildGammaTable(profile), pixels = level.pixels.slice();
  const intensity = profile.kind === "q1-gl" || profile.onlyGamma ? 1 : Math.max(1, profile.intensity);
  if (!Number.isFinite(intensity)) throw new RangeError("Intensity must be finite");
  for (let offset = 0; offset < pixels.length; offset++) {
    if (offset % 4 === 3) continue;
    const value = pixels[offset];
    if (value === undefined) throw new RangeError("Missing pixel");
    const corrected = table[Math.min(255, Math.trunc(Math.fround(value * Math.fround(intensity))))];
    if (corrected === undefined) throw new RangeError("Missing gamma entry");
    pixels[offset] = corrected;
  }
  return { width: level.width, height: level.height, pixels };
}
