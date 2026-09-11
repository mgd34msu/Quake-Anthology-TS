// ComputeColors, R_BindAnimatedImage and entity lighting from Q3 renderer.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.
import { dot3, sub3, vec3 } from "../core/math.ts";
import type { Vec3, Vec4 } from "../contracts/math.ts";
import { inverseSqrt32, normalizeFast3 } from "../core/renderer-math.ts";
import type { MaterialVertex } from "./geometry.ts";
import type { RendererNoise } from "./deform.ts";
import { evaluateWaveform, SourceColorGenerator } from "./material.ts";
import type { ShaderStage, Waveform } from "./material.ts";

import type { EntityLighting } from "./q3-lighting.ts";

export interface StageColorContext {
  readonly time: number;
  readonly identityLight: number;
  readonly entityRGBA: Vec4;
  readonly lighting: EntityLighting | null;
  readonly viewOrigin: Vec3;
  readonly localViewOrigin: Vec3;
  readonly noise: RendererNoise;
  readonly previousColor: Vec4;
}

const f = Math.fround;
const byte = (value: number): number => {
  const integer = Math.trunc(value);
  if (!Number.isFinite(integer) || integer < -2147483648 || integer > 2147483647)
    throw new RangeError("Shader color reaches undefined source float-to-integer conversion");
  return integer & 255;
};
const normalizedByte = (value: number): number => byte(f(f(value) * 255));
const waveByte = (value: number): number => normalizedByte(Math.max(0, Math.min(1, value)));

/** Source unsigned-byte stage storage, returned normalized for both renderer backends. */
export function evaluateStageColor(stage: ShaderStage, vertex: MaterialVertex, context: StageColorContext, skipAlpha = false, sourceRgb: SourceColorGenerator | null = null): Vec4 {
  const color = evaluateStageRgbColor(stage, vertex, context, sourceRgb);
  return skipAlpha ? color : evaluateStageAlpha(stage, vertex, { ...context, previousColor: color }, sourceRgb);
}

function waveformColor(wave: Waveform, time: number, identityLight: number, noise: RendererNoise): Vec4 {
  const glow = wave.kind === "noise"
    ? f(wave.base + f(noise.sample(0, 0, 0, f(f(time + wave.phase) * wave.frequency)) * wave.amplitude))
    : f(evaluateWaveform(wave, time) * identityLight);
  const color = waveByte(glow) / 255;
  return { x: color, y: color, z: color, w: 1 };
}

function evaluateStageRgbColor(stage: ShaderStage, vertex: MaterialVertex, context: StageColorContext, sourceRgb: SourceColorGenerator | null): Vec4 {
  const { identityLight, entityRGBA, time } = context;
  let red = 0, green = 0, blue = 0, alpha = normalizedByte(context.previousColor.w);
  if (sourceRgb === SourceColorGenerator.Bad) red = green = blue = alpha = normalizedByte(identityLight);
  else switch (stage.rgbGen.kind) {
    case "identity": red = green = blue = alpha = 255; break;
    case "identitylighting": red = green = blue = alpha = normalizedByte(identityLight); break;
    case "entity": red = entityRGBA.x; green = entityRGBA.y; blue = entityRGBA.z; alpha = entityRGBA.w; break;
    case "oneminusentity": red = 255 - entityRGBA.x; green = 255 - entityRGBA.y; blue = 255 - entityRGBA.z; alpha = 255 - entityRGBA.w; break;
    case "vertex":
      red = byte(f(vertex.color.x * identityLight)); green = byte(f(vertex.color.y * identityLight)); blue = byte(f(vertex.color.z * identityLight)); alpha = vertex.color.w; break;
    case "exactvertex": red = vertex.color.x; green = vertex.color.y; blue = vertex.color.z; alpha = vertex.color.w; break;
    case "oneminusvertex":
      red = byte(f((255 - vertex.color.x) * identityLight)); green = byte(f((255 - vertex.color.y) * identityLight)); blue = byte(f((255 - vertex.color.z) * identityLight)); break;
    case "const":
      red = normalizedByte(stage.rgbGen.color.x); green = normalizedByte(stage.rgbGen.color.y); blue = normalizedByte(stage.rgbGen.color.z);
      alpha = stage.alphaGen.kind === "const" ? byte(stage.alphaGen.alpha * 255) : 0; break;
    case "wave": return waveformColor(stage.rgbGen.wave, time, identityLight, context.noise);
    case "lightingdiffuse": {
      if (context.lighting === null) throw new Error("lightingDiffuse requires entity lighting");
      const color = diffuseColor(vertex.normal, context.lighting);
      red = color.x; green = color.y; blue = color.z;
      alpha = dot3(vertex.normal, context.lighting.lightDir) <= 0 ? context.lighting.ambientLightInt >>> 24 : 255;
      break;
    }
  }
  return { x: byte(red) / 255, y: byte(green) / 255, z: byte(blue) / 255, w: byte(alpha) / 255 };
}

function evaluateStageAlpha(stage: ShaderStage, vertex: MaterialVertex, context: StageColorContext, sourceRgb: SourceColorGenerator | null): Vec4 {
  const { identityLight, entityRGBA, time, previousColor } = context;
  let alpha = normalizedByte(previousColor.w);
  switch (stage.alphaGen.kind) {
    case "identity":
      if (sourceRgb === SourceColorGenerator.Bad || stage.rgbGen.kind !== "identity" && (stage.rgbGen.kind !== "vertex" || identityLight !== 1)) alpha = 255;
      break;
    case "entity":
      // ParseStage compares alphaGen to CGEN_IDENTITY (2), which is AGEN_ENTITY.
      if (sourceRgb !== null || stage.rgbGen.kind !== "identity" && stage.rgbGen.kind !== "lightingdiffuse") alpha = entityRGBA.w;
      break;
    case "oneminusentity": alpha = 255 - entityRGBA.w; break;
    case "vertex": alpha = vertex.color.w; break;
    case "oneminusvertex": alpha = 255 - vertex.color.w; break;
    case "const": alpha = byte(stage.alphaGen.alpha * 255); break;
    case "wave": alpha = waveByte(evaluateWaveform(stage.alphaGen.wave, time)); break;
    case "portal": {
      const delta = sub3(vertex.position, context.viewOrigin);
      alpha = waveByte(f(f(Math.sqrt(dot3(delta, delta))) / stage.alphaGen.range)); break;
    }
    case "lightingspecular": alpha = specularAlpha(vertex.position, vertex.normal, context.localViewOrigin); break;
  }
  return { ...previousColor, w: byte(alpha) / 255 };
}

/** Keep animation phase aligned with the renderer's 1024-entry waveform table. */
export function animatedPictureIndex(time: number, frequency: number, count: number): number {
  if (!Number.isSafeInteger(count) || count < 1) throw new RangeError("Animated picture needs registered frames");
  const value = Math.trunc(f(f(time * frequency) * 1024));
  if (!Number.isFinite(value) || value < -2147483648 || value > 2147483647)
    throw new RangeError("Animated picture index reaches undefined source float-to-int conversion");
  const index = value >> 10;
  return Math.max(0, index) % count;
}

/** RB_CalcDiffuseColor outputs unsigned bytes, including source truncation. */
export function diffuseColor(normal: Vec3, lighting: EntityLighting): Vec3 {
  const incoming = dot3(normal, lighting.lightDir);
  if (incoming <= 0) return { x: lighting.ambientLightInt & 255, y: lighting.ambientLightInt >>> 8 & 255, z: lighting.ambientLightInt >>> 16 & 255 };
  const component = (ambient: number, directed: number): number => Math.min(255, Math.trunc(Math.fround(ambient + Math.fround(incoming * directed)))) & 255;
  return { x: component(lighting.ambientLight.x, lighting.directedLight.x), y: component(lighting.ambientLight.y, lighting.directedLight.y), z: component(lighting.ambientLight.z, lighting.directedLight.z) };
}

/** The stock specular helper uses this fixed local light, not entity dynamic lights. */
export function specularAlpha(position: Vec3, normal: Vec3, viewerOrigin: Vec3): number {
  const light = normalizeFast3(sub3({ x: -960, y: 1980, z: 96 }, position));
  const d = dot3(normal, light);
  const reflected = vec3(Math.fround(Math.fround(normal.x * 2) * d) - light.x,
    Math.fround(Math.fround(normal.y * 2) * d) - light.y, Math.fround(Math.fround(normal.z * 2) * d) - light.z);
  const viewer = sub3(viewerOrigin, position);
  let l = Math.fround(dot3(reflected, viewer) * inverseSqrt32(dot3(viewer, viewer)));
  if (l < 0) return 0;
  l = Math.fround(l * l); l = Math.fround(l * l);
  return Math.min(255, Math.trunc(Math.fround(l * 255)));
}
