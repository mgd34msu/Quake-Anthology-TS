/* Texture animation, liquids, classic sky and lightmap passes from Q1/Q2
 * gl_rsurf.c/gl_warp.c. Copyright (C) 1996-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { Vec2, Vec3, Vec4 } from "../contracts/math.ts";
import type { DrawBatch, RenderMaterial, RendererImage, RenderState, SurfaceLighting, RenderImage, ImageLevel, BatchLighting } from "../contracts/render.ts";
import type { MaterialGeometry } from "./geometry.ts";
import { sourceTurbulence } from "./turbulence.ts";
import type { Q1LightmapEncoding } from "./lighting.ts";

export type Q1Material = Extract<RenderMaterial, { readonly kind: "q1" }>;
export type Q2Material = Extract<RenderMaterial, { readonly kind: "q2" }>;

export function q1SurfaceKind(name: string): Q1Material["surface"] {
  if (name.startsWith("sky")) return "sky";
  if (name.startsWith("{")) return "fence";
  if (!name.startsWith("*")) return "ordinary";
  if (name.startsWith("*lava")) return "lava";
  if (name.startsWith("*slime")) return "slime";
  if (name.startsWith("*tele")) return "teleport";
  return "water";
}

export function createQ1Material(name: string, texture: RendererImage, lighting: SurfaceLighting, options: {
  readonly alpha?: number; readonly animation?: Q1Material["animation"]; readonly alternateAnimation?: Q1Material["alternateAnimation"];
} = {}): Q1Material {
  return { kind: "q1", name, texture, lighting, surface: q1SurfaceKind(name), alpha: options.alpha ?? 1,
    animation: options.animation ?? [], alternateAnimation: options.alternateAnimation ?? [] };
}

/** Q1 names +0..+9 and +A..+J form independent two-tenth-second loops. */
export function q1TextureAnimations(name: string, textures: readonly { readonly name: string; readonly image: RendererImage }[]): {
  readonly animation: Q1Material["animation"]; readonly alternateAnimation: Q1Material["alternateAnimation"];
} {
  if (!name.startsWith("+")) return { animation: [], alternateAnimation: [] };
  const primary = new Map<number, RendererImage>(), alternate = new Map<number, RendererImage>();
  for (const texture of textures) {
    if (!texture.name.startsWith("+") || texture.name.slice(2) !== name.slice(2)) continue;
    const code = texture.name.toUpperCase().charCodeAt(1);
    if (code >= 48 && code <= 57) primary.set(code - 48, texture.image);
    else if (code >= 65 && code <= 74) alternate.set(code - 65, texture.image);
    else throw new Error(`Bad Q1 animated texture frame ${texture.name}`);
  }
  function sequence(frames: ReadonlyMap<number, RendererImage>): Q1Material["animation"] {
    const result: { image: RendererImage; startTenths: number; endTenths: number }[] = [];
    const count = frames.size === 0 ? 0 : Math.max(...frames.keys()) + 1;
    for (let frame = 0; frame < count; frame++) {
      const image = frames.get(frame);
      if (image === undefined) throw new Error(`Missing Q1 animation frame ${frame} in ${name}`);
      result.push({ image, startTenths: frame * 2, endTenths: (frame + 1) * 2 });
    }
    return result;
  }
  const animation = sequence(primary), alternateAnimation = sequence(alternate);
  const code = name.toUpperCase().charCodeAt(1);
  return code >= 65 ? { animation: alternateAnimation, alternateAnimation: animation } : { animation, alternateAnimation };
}

export function q1AnimatedTexture(material: Q1Material, time: number, alternate: boolean): RendererImage {
  const frames = alternate && material.alternateAnimation.length !== 0 ? material.alternateAnimation : material.animation;
  const last = frames[frames.length - 1];
  if (last === undefined) return material.texture;
  const phase = ((Math.trunc(time * 10) % last.endTenths) + last.endTenths) % last.endTenths;
  const frame = frames.find(frame => phase >= frame.startTenths && phase < frame.endTenths);
  if (frame === undefined) throw new Error(`Broken animation cycle in ${material.name}`);
  return frame.image;
}

export function createQ2Material(name: string, frames: readonly RendererImage[], lighting: SurfaceLighting, surfaceFlags = 0, material = ""): Q2Material {
  if (frames.length === 0) throw new Error("Q2 material requires at least one texture frame");
  return { kind: "q2", name, frames, lighting, surfaceFlags, material,
    flowing: (surfaceFlags & 64) !== 0, warp: (surfaceFlags & 8) !== 0,
    alpha: (surfaceFlags & 16) !== 0 ? 0.33 : (surfaceFlags & 32) !== 0 ? 0.66 : 1 };
}

export function q2AnimatedTexture(material: Q2Material, frame: number): RendererImage {
  const index = ((Math.trunc(frame) % material.frames.length) + material.frames.length) % material.frames.length;
  const image = material.frames[index];
  if (image === undefined) throw new Error(`Broken Q2 animation cycle in ${material.name}`);
  return image;
}

/** Input UVs are texture-space distances, before dividing by the 64-unit tile. */
export function liquidTexCoords(uv: Vec2, time: number, profile: "q1" | "q2", flowing = false): Vec2 {
  const scroll = profile === "q2" && flowing ? -64 * (time * 0.5 - Math.trunc(time * 0.5)) : 0;
  return { x: Math.fround((uv.x + sourceTurbulence(uv.y * 0.125 + time, profile) + scroll) / 64),
    y: Math.fround((uv.y + sourceTurbulence(uv.x * 0.125 + time, profile)) / 64) };
}

export function q2FlowingTexCoords(uv: Vec2, time: number): Vec2 {
  const scroll = -64 * (time / 40 - Math.trunc(time / 40));
  return { x: uv.x + (scroll === 0 ? -64 : scroll), y: uv.y };
}

export function q1SkyTexCoords(position: Vec3, viewOrigin: Vec3, time: number, layer: "solid" | "overlay"): Vec2 {
  const x = position.x - viewOrigin.x, y = position.y - viewOrigin.y, z = (position.z - viewOrigin.z) * 3;
  const scale = 378 / Math.sqrt(x * x + y * y + z * z);
  let scroll = time * (layer === "solid" ? 8 : 16);
  scroll -= Math.trunc(scroll) & ~127;
  return { x: (scroll + x * scale) / 128, y: (scroll + y * scale) / 128 };
}

export interface LegacyMaterialDrawContext {
  readonly entityRGBA?: Vec4;
  readonly time: number;
  readonly animationFrame: number;
  readonly alternateAnimation: boolean;
  readonly fullbright: RendererImage | null;
  readonly q1FogActive?: boolean;
  readonly q1LightmapEncoding: Q1LightmapEncoding;
  /** Uploaded directLightmapPixels result for translucent or fragment-lit lightmaps. */
  readonly translucentLightmap?: RendererImage;
  readonly fragmentLighting?: Extract<BatchLighting, { readonly kind: "q2-world" }>;
  readonly cull: RenderState["cull"];
  readonly depthRange: RenderState["depthRange"];
  project(position: Vec3): Vec4;
}

/** Fullbright palette pixels are an unlit alpha-masked pass after lightmaps. */
export function prepareLegacyMaterialBatches(material: Q1Material | Q2Material, geometry: MaterialGeometry,
  context: LegacyMaterialDrawContext): readonly DrawBatch[] {
  if (material.kind === "q1" && material.surface === "sky" || material.kind === "q2" && (material.surfaceFlags & 4) !== 0)
    throw new Error("Sky surfaces require the sky geometry and layer path");
  const image = material.kind === "q1" ? q1AnimatedTexture(material, context.time, context.alternateAnimation) : q2AnimatedTexture(material, context.animationFrame);
  const tint = context.entityRGBA ?? { x: 255, y: 255, z: 255, w: 255 };
  const alpha = material.alpha * tint.w / 255, blended = alpha < 1;
  const fence = material.kind === "q1" && material.surface === "fence";
  const lightmap = material.lighting.kind === "lightmap" || material.lighting.kind === "decoupled-lightmap" ? material.lighting.image : null;
  const state: RenderState = { blend: blended ? { source: "src-alpha", destination: "one-minus-src-alpha" } : { source: "one", destination: "zero" },
    depthTest: "less-equal", depthWrite: !blended, alphaTest: fence ? "gt0" : "none", cull: context.cull, depthRange: context.depthRange, polygonOffset: null };
  const vertices = geometry.vertices.map(vertex => {
    let uv = vertex.texCoord;
    if (material.kind === "q1" && ["water", "slime", "lava", "teleport"].includes(material.surface)) uv = liquidTexCoords(uv, context.time, "q1");
    else if (material.kind === "q2") {
      if (material.warp) uv = liquidTexCoords(uv, context.time, "q2", material.flowing);
      else if (material.flowing) uv = q2FlowingTexCoords(uv, context.time);
    }
    // Q2 R_RenderBrushPoly/R_DrawAlphaSurfaces undo texture intensity on unlit brush passes.
    const intensity = material.kind === "q2" && material.lighting.kind !== "vertex" && (material.warp || blended) ? 0.5 : 1;
    const color = material.lighting.kind === "vertex" ? { x: vertex.color.x / 255, y: vertex.color.y / 255, z: vertex.color.z / 255, w: alpha }
      : { x: intensity, y: intensity, z: intensity, w: alpha };
    return { position: context.project(vertex.position), texCoord: uv,
      color: { x: color.x * tint.x / 255, y: color.y * tint.y / 255, z: color.z * tint.z / 255, w: color.w } };
  });
  const fragmentLighting = context.fragmentLighting;
  const textureLighting: BatchLighting = fragmentLighting !== undefined && lightmap === null
    ? { ...fragmentLighting, pass: "texture" } : { kind: "vertex" };
  const batches: DrawBatch[] = [{ lighting: textureLighting, primitive: "triangles", texturing: "single", indices: geometry.indices, vertices, state, texture: { kind: "bind-image", image } }];
  if (lightmap !== null) {
    if (blended || context.q1FogActive === true) {
      const combinedLightmap = context.translucentLightmap;
      if (combinedLightmap === undefined) throw new Error("Translucent lightmapped surfaces require an uploaded directLightmapPixels image");
      const paired = vertices.map((vertex, index) => {
        const source = geometry.vertices[index];
        if (source === undefined) throw new Error("Missing translucent lightmap coordinates");
        return { ...vertex, texCoord2: source.lightmapCoord };
      });
      if (fragmentLighting === undefined) {
        batches[0] = { lighting: { kind: "vertex" }, primitive: "triangles", texturing: "pair", indices: geometry.indices, vertices: paired, state,
          texture: { kind: "bind-image", image }, secondTexture: { binding: { kind: "bind-image", image: combinedLightmap }, environment: "modulate" } };
      } else {
        // Evaluate dynamic lighting on the lightmap before multiplying by base RGB.
        batches[0] = { lighting: { ...fragmentLighting, pass: "texture" }, primitive: "triangles", texturing: "pair", indices: geometry.indices,
          vertices: paired.map(vertex => ({ ...vertex, texCoord: vertex.texCoord2, texCoord2: vertex.texCoord })), state,
          texture: { kind: "bind-image", image: combinedLightmap }, secondTexture: { binding: { kind: "bind-image", image }, environment: "modulate" } };
      }
    } else {
      const blend: RenderState["blend"] = material.kind === "q1" && context.q1LightmapEncoding !== "rgb" && fragmentLighting === undefined
        ? { source: "zero", destination: context.q1LightmapEncoding === "inverted-alpha" ? "one-minus-src-alpha" : "one-minus-src-color" }
        : { source: "dst-color", destination: "zero" };
      const lighting: BatchLighting = fragmentLighting === undefined ? { kind: "vertex" } : { ...fragmentLighting, pass: "lightmap" };
      const direct = material.kind === "q1" && fragmentLighting !== undefined ? context.translucentLightmap : lightmap;
      if (direct === undefined) throw new Error("Fragment-lit lightmap requires uploaded direct RGB pixels");
      batches.push({ lighting, primitive: "triangles", texturing: "single", texture: { kind: "bind-image", image: direct }, indices: geometry.indices,
        state: { ...state, blend, depthTest: "equal", depthWrite: false, alphaTest: "none" },
        vertices: vertices.map((vertex, index) => {
          const source = geometry.vertices[index];
          if (source === undefined) throw new Error("Missing opaque lightmap coordinates");
          return { position: vertex.position, texCoord: source.lightmapCoord, color: { x: 1, y: 1, z: 1, w: 1 } };
        }) });
    }
  }
  if (context.fullbright !== null) batches.push({ lighting: { kind: "vertex" }, primitive: "triangles", texturing: "single", texture: { kind: "bind-image", image: context.fullbright }, indices: geometry.indices,
    vertices: vertices.map(vertex => ({ ...vertex, color: { x: tint.x / 255, y: tint.y / 255, z: tint.z / 255, w: alpha } })),
    state: { ...state, blend: { source: "src-alpha", destination: "one-minus-src-alpha" }, depthTest: blended ? "less-equal" : "equal", depthWrite: false, alphaTest: "gt0" } });
  return batches;
}

/** R_InitSky: the right half is solid; index zero on the left is transparent. */
export function splitQ1SkyTexture(image: RenderImage): {
  readonly solid: ImageLevel;
  readonly overlay: ImageLevel;
} {
  const level = image.levels[0];
  if (image.kind !== "indexed8" || level.width !== 256 || level.height !== 128)
    throw new Error("Classic Q1 sky requires a 256x128 indexed texture");
  const solid = new Uint8Array(128 * 128 * 4), overlay = new Uint8Array(solid.length);
  let red = 0, green = 0, blue = 0;
  const color = (index: number): readonly [number, number, number] => {
    const r = image.palette.colors[index * 3], g = image.palette.colors[index * 3 + 1], b = image.palette.colors[index * 3 + 2];
    if (r === undefined || g === undefined || b === undefined) throw new Error("Q1 sky palette is incomplete");
    return [r, g, b];
  };
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const index = level.pixels[y * 256 + x + 128];
    if (index === undefined) throw new Error("Q1 sky texture is incomplete");
    const [r, g, b] = color(index);
    solid.set([r, g, b, 255], (y * 128 + x) * 4); red += r; green += g; blue += b;
  }
  const average = [Math.trunc(red / 16384), Math.trunc(green / 16384), Math.trunc(blue / 16384), 0];
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const index = level.pixels[y * 256 + x];
    if (index === undefined) throw new Error("Q1 sky texture is incomplete");
    overlay.set(index === 0 ? average : [...color(index), 255], (y * 128 + x) * 4);
  }
  return { solid: { width: 128, height: 128, pixels: solid }, overlay: { width: 128, height: 128, pixels: overlay } };
}

/** Ironwail Sky_LoadTextureQ64: upper translucent foreground and lower indexed background. */
export function splitQ64SkyTexture(image: RenderImage): { readonly solid: ImageLevel; readonly overlay: ImageLevel } {
  if (image.kind !== "indexed8") throw new Error("Quake64 sky requires an indexed source image");
  const level = image.levels[0];
  if (level === undefined || level.height < 2 || level.height % 2 !== 0) throw new Error("Quake64 sky requires two vertically stacked layers");
  const width = level.width, height = level.height / 2, count = width * height;
  const solid = new Uint8Array(count * 4), overlay = new Uint8Array(count * 4);
  for (let index = 0; index < count; index++) {
    const front = level.pixels[index], back = level.pixels[count + index];
    if (front === undefined || back === undefined) throw new Error("Quake64 sky texture is incomplete");
    for (let channel = 0; channel < 3; channel++) {
      const a = image.palette.colors[front * 3 + channel], b = image.palette.colors[back * 3 + channel];
      if (a === undefined || b === undefined) throw new Error("Quake64 sky palette is incomplete");
      overlay[index * 4 + channel] = a; solid[index * 4 + channel] = b;
    }
    overlay[index * 4 + 3] = 128; solid[index * 4 + 3] = 255;
  }
  return { solid: { width, height, pixels: solid }, overlay: { width, height, pixels: overlay } };
}
