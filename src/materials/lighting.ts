/* Lightstyles, lightmap accumulation and BSPX coordinates from Q1/Q2
 * gl_rlight.c/gl_light.c/gl_rsurf.c, Ironwail and q2repro.
 * Copyright (C) 1996-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { Vec2, Vec3, Vec4, Plane } from "../contracts/math.ts";
import type { BspLighting, DecoupledLightmap, TextureProjection } from "../contracts/scene.ts";
import type { ImageLevel } from "../contracts/render.ts";
import { dot3, scale3, sub3 } from "../core/math.ts";

export interface Q2LightStyle { readonly rgb: Vec3; readonly white: number; }

/** Q1 stores 8.8 values. Mode 1 leaves jumps of six letters or more unsmoothed. */
export function q1LightStyle(map: string, time: number, interpolation: 0 | 1 | 2 = 0): number {
  if (map.length === 0) return 256;
  const phase = time * 10, frame = Math.floor(phase), index = ((frame % map.length) + map.length) % map.length;
  const current = map.charCodeAt(index) - 97;
  let next = map.charCodeAt((index + 1) % map.length) - 97;
  if (interpolation < 2 && Math.abs(next - current) >= 6) next = current;
  return Math.trunc(current * 22 + (next - current) * 22 * (interpolation === 0 ? 0 : phase - frame));
}

/** CL_RunLightStyles uses 100 ms ticks and 'm' = 1.0, unlike Q1's m = 264. */
export function q2LightStyle(map: string, milliseconds: number): Q2LightStyle {
  const frame = Math.trunc(milliseconds / 100);
  const value = map.length === 0 ? 1 : (map.charCodeAt(((frame % map.length) + map.length) % map.length) - 97) / 12;
  const component = Math.fround(value);
  return { rgb: { x: component, y: component, z: component }, white: Math.fround(Math.fround(component + component) + component) };
}

export type LightmapProjection = {
  readonly kind: "classic"; readonly texture: TextureProjection; readonly textureMins: Vec2;
} | { readonly kind: "decoupled"; readonly mapping: DecoupledLightmap };

export function lightmapCoordinates(position: Vec3, projection: LightmapProjection): Vec2 {
  if (projection.kind === "decoupled") return {
    x: dot3(position, projection.mapping.axes[0]) + projection.mapping.offset.x,
    y: dot3(position, projection.mapping.axes[1]) + projection.mapping.offset.y,
  };
  return { x: (dot3(position, projection.texture.s) + projection.texture.s.w - projection.textureMins.x) / 16,
    y: (dot3(position, projection.texture.t) + projection.texture.t.w - projection.textureMins.y) / 16 };
}

export interface LightmapFace {
  readonly width: number;
  readonly height: number;
  readonly lighting: BspLighting | null;
  readonly offset: number;
  readonly styles: readonly number[];
  readonly plane: Plane;
  readonly projection: LightmapProjection;
}

export interface SurfaceDynamicLight {
  readonly origin: Vec3;
  readonly radius: number;
  readonly minimum: number;
  readonly color: Vec3;
}

function element(values: ArrayLike<number>, index: number): number {
  const value = values[index];
  if (value === undefined) throw new RangeError(`Lightmap sample ${index} is outside ${values.length} values`);
  return value;
}

function faceSize(face: LightmapFace): number {
  if (!Number.isSafeInteger(face.width) || !Number.isSafeInteger(face.height) || face.width < 1 || face.height < 1)
    throw new RangeError("Lightmap dimensions must be positive integers");
  return face.width * face.height;
}

function sample(face: LightmapFace, style: number, pixel: number, channel: number): number {
  if (face.lighting === null) return 255;
  const channels = face.lighting.kind === "luminance8" ? 1 : 3;
  return element(face.lighting.samples, face.offset + (style * face.width * face.height + pixel) * channels + (channels === 1 ? 0 : channel));
}

/** Classic uses the source octagonal distance metric, in 16-unit texel steps.
 * Decoupled maps use their own texel axes rather than a mismatched classic grid. */
function addDynamicLights(block: Float32Array | Uint32Array, face: LightmapFace, lights: readonly SurfaceDynamicLight[], scale: number): void {
  for (const light of lights) {
    const distance = Math.fround(dot3(light.origin, face.plane.normal) - face.plane.distance);
    const radius = Math.fround(light.radius - Math.abs(distance));
    if (radius < light.minimum) continue;
    const threshold = radius - light.minimum, impact = sub3(light.origin, scale3(face.plane.normal, distance));
    const uv = lightmapCoordinates(impact, face.projection);
    const stepS = face.projection.kind === "classic" ? 16 : 1 / Math.hypot(face.projection.mapping.axes[0].x, face.projection.mapping.axes[0].y, face.projection.mapping.axes[0].z);
    const stepT = face.projection.kind === "classic" ? 16 : 1 / Math.hypot(face.projection.mapping.axes[1].x, face.projection.mapping.axes[1].y, face.projection.mapping.axes[1].z);
    for (let y = 0; y < face.height; y++) for (let x = 0; x < face.width; x++) {
      const sd = Math.abs(Math.trunc((uv.x - x) * stepS)), td = Math.abs(Math.trunc((uv.y - y) * stepT));
      const separation = sd > td ? sd + (td >> 1) : td + (sd >> 1);
      if (separation >= threshold) continue;
      const value = (radius - separation) * scale, offset = (y * face.width + x) * 3;
      block[offset] = element(block, offset) + value * light.color.x;
      block[offset + 1] = element(block, offset + 1) + value * light.color.y;
      block[offset + 2] = element(block, offset + 2) + value * light.color.z;
    }
  }
}

export type Q1LightmapEncoding = "rgb" | "inverted-luminance" | "inverted-alpha";
export interface BuiltLightmap { readonly image: ImageLevel; readonly encoding: Q1LightmapEncoding | "q2-rgb" | "q2-mono"; }

/** Q1 accumulates unsigned 8.8 samples and doubles brightness with the >>7 store. */
export function buildQ1Lightmap(face: LightmapFace, styles: readonly number[], options: {
  readonly encoding?: Q1LightmapEncoding; readonly fullbright?: boolean; readonly dynamicLights?: readonly SurfaceDynamicLight[];
} = {}): BuiltLightmap {
  const size = faceSize(face), block = new Uint32Array(size * 3), encoding = options.encoding ?? (face.lighting?.kind === "rgb8" ? "rgb" : "inverted-luminance");
  if (options.fullbright === true || face.lighting === null) block.fill(255 * 256);
  else for (const [map, style] of face.styles.entries()) {
    if (style === 255) break;
    const scale = element(styles, style);
    for (let pixel = 0; pixel < size; pixel++) for (let channel = 0; channel < 3; channel++) {
      const offset = pixel * 3 + channel;
      block[offset] = element(block, offset) + sample(face, map, pixel, channel) * scale;
    }
  }
  if (options.fullbright !== true && face.lighting !== null) addDynamicLights(block, face, options.dynamicLights ?? [], 256);
  const pixels = new Uint8Array(size * 4);
  for (let pixel = 0; pixel < size; pixel++) {
    const brightness = (channel: number): number => Math.min(255, element(block, pixel * 3 + channel) >> 7);
    if (encoding === "rgb") pixels.set([brightness(0), brightness(1), brightness(2), 255], pixel * 4);
    else if (encoding === "inverted-luminance") {
      const value = 255 - brightness(0); pixels.set([value, value, value, 255], pixel * 4);
    } else pixels.set([0, 0, 0, 255 - brightness(0)], pixel * 4);
  }
  return { image: { width: face.width, height: face.height, pixels }, encoding };
}

export function buildQ2Lightmap(face: LightmapFace, styles: readonly Q2LightStyle[], options: {
  readonly modulate?: number; readonly mono?: "0" | "L" | "I" | "C" | "A"; readonly dynamicLights?: readonly SurfaceDynamicLight[];
} = {}): BuiltLightmap {
  const size = faceSize(face), block = new Float32Array(size * 3), modulate = options.modulate ?? 1, mono = options.mono ?? "0";
  if (face.lighting === null) block.fill(255);
  else for (const [map, styleIndex] of face.styles.entries()) {
    if (styleIndex === 255) break;
    const style = styles[styleIndex];
    if (style === undefined) throw new RangeError(`Missing Q2 lightstyle ${styleIndex}`);
    const scales = [Math.fround(style.rgb.x * modulate), Math.fround(style.rgb.y * modulate), Math.fround(style.rgb.z * modulate)];
    for (let pixel = 0; pixel < size; pixel++) for (let channel = 0; channel < 3; channel++) {
      const offset = pixel * 3 + channel;
      block[offset] = element(block, offset) + Math.fround(sample(face, map, pixel, channel) * element(scales, channel));
    }
  }
  if (face.lighting !== null) addDynamicLights(block, face, options.dynamicLights ?? [], 1);
  const pixels = new Uint8Array(size * 4);
  for (let pixel = 0; pixel < size; pixel++) {
    let r = Math.max(0, Math.trunc(element(block, pixel * 3))), g = Math.max(0, Math.trunc(element(block, pixel * 3 + 1))), b = Math.max(0, Math.trunc(element(block, pixel * 3 + 2)));
    let a = Math.max(r, g, b);
    if (a > 255) { const scale = Math.fround(255 / a); r = Math.trunc(Math.fround(r * scale)); g = Math.trunc(Math.fround(g * scale)); b = Math.trunc(Math.fround(b * scale)); a = Math.trunc(Math.fround(a * scale)); }
    switch (mono) {
      case "0": break;
      case "L": case "I": r = a; g = b = 0; break;
      case "A": r = g = b = 0; a = 255 - a; break;
      case "C": a = 255 - Math.trunc((r + g + b) / 3); r = Math.trunc(r * (a / 255)); g = Math.trunc(g * (a / 255)); b = Math.trunc(b * (a / 255)); break;
    }
    pixels.set([r, g, b, a], pixel * 4);
  }
  return { image: { width: face.width, height: face.height, pixels }, encoding: mono === "0" ? "q2-rgb" : "q2-mono" };
}

/** BSPX DECOUPLED_LM maps into an atlas with a half-texel center bias. */
export function lightmapAtlasCoordinates(position: Vec3, projection: LightmapProjection, location: Vec2, atlasWidth: number, atlasHeight: number): Vec2 {
  const uv = lightmapCoordinates(position, projection);
  return { x: (uv.x + location.x + 0.5) / atlasWidth, y: (uv.y + location.y + 0.5) / atlasHeight };
}

/** A sample helper for entity lighting. Source Q1/Q2 classic uses nearest texels. */
export function sampleLightmap(image: ImageLevel, uv: Vec2, filtering: "nearest" | "bilinear" = "nearest"): Vec4 | null {
  if (uv.x < 0 || uv.y < 0 || uv.x > image.width - 1 || uv.y > image.height - 1) return null;
  const x = Math.floor(uv.x), y = Math.floor(uv.y);
  const read = (sx: number, sy: number, channel: number): number => element(image.pixels, (sy * image.width + sx) * 4 + channel);
  const component = (channel: number): number => {
    if (filtering === "nearest") return read(x, y, channel);
    const x1 = Math.min(x + 1, image.width - 1), y1 = Math.min(y + 1, image.height - 1), fx = uv.x - x, fy = uv.y - y;
    return (read(x, y, channel) * (1 - fx) + read(x1, y, channel) * fx) * (1 - fy)
      + (read(x, y1, channel) * (1 - fx) + read(x1, y1, channel) * fx) * fy;
  };
  return { x: component(0), y: component(1), z: component(2), w: component(3) };
}

/** Original skyline allocation, extended to caller-selected BSPX page dimensions. */
export class LightmapAtlas {
  private readonly heights: Int32Array;
  constructor(readonly width = 128, readonly height = 128) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new RangeError("Invalid lightmap atlas dimensions");
    this.heights = new Int32Array(width);
  }
  clear(): void { this.heights.fill(0); }
  allocate(width: number, height: number): Vec2 | null {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new RangeError("Invalid lightmap rectangle");
    let best = this.height, location = -1;
    for (let x = 0; x <= this.width - width; x++) {
      let top = 0, accepted = true;
      for (let column = 0; column < width; column++) {
        const value = element(this.heights, x + column);
        if (value >= best) { accepted = false; break; }
        top = Math.max(top, value);
      }
      if (accepted) { best = top; location = x; }
    }
    if (location < 0 || best + height > this.height) return null;
    for (let column = 0; column < width; column++) this.heights[location + column] = best + height;
    return { x: location, y: best };
  }
}

/** Keep source storage in BuiltLightmap; use this upload when alpha must remain opaque. */
export function directLightmapPixels(built: BuiltLightmap): ImageLevel {
  if (built.encoding === "q2-mono") throw new Error("Q2 alternate monochrome encodings require their matching texture environment");
  const pixels = built.image.pixels.slice();
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (built.encoding === "inverted-alpha") {
      const value = 255 - element(pixels, offset + 3);
      pixels[offset] = value; pixels[offset + 1] = value; pixels[offset + 2] = value;
    } else if (built.encoding === "inverted-luminance") {
      for (let channel = 0; channel < 3; channel++) pixels[offset + channel] = 255 - element(pixels, offset + channel);
    }
    pixels[offset + 3] = 255;
  }
  return { ...built.image, pixels };
}
