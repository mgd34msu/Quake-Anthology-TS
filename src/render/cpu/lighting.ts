/* Q2 fragment and shadow equations ported from the reference port
 * Copyright (C) Id Software and contributors. GPL-2.0-or-later. */
import type { Vec3, Vec4 } from "../../contracts/math.ts";
import type { Q2FragmentLight, Q2ModelShadowLight, BatchLighting, DepthImageLevel, MultitextureVertex, Q2ShadowAtlas, Q2ShadowProjection } from "../../contracts/render.ts";
import { calcDynamicLightContributionInto } from "../../materials/q2-lighting.ts";
import type { Sample } from "./triangle-kernel.ts";

export interface CpuVertex extends MultitextureVertex {
  readonly worldPosition: Vec3;
  readonly worldNormal: Vec3;
}
export interface CpuLighting {
  readonly parameters: BatchLighting;
  readonly depth: DepthImageLevel | null;
}
export interface CpuTriangleLighting extends CpuLighting {
  readonly positions: readonly [Vec3, Vec3, Vec3];
  readonly normals: readonly [Vec3, Vec3, Vec3];
}

/** Drop dynamic lights that cannot reach any fragment of this triangle.
 * Falloff is exactly zero beyond reach, and every fragment position lies
 * inside the triangle's AABB, so culling by AABB distance is exact. */
export function cullTriangleLights(lighting: CpuLighting, positions: readonly [Vec3, Vec3, Vec3]): CpuLighting {
  const parameters = lighting.parameters;
  if (parameters.kind !== "q2-world" || parameters.lights.length === 0) return lighting;
{}
  const minX = Math.min(positions[0].x, positions[1].x, positions[2].x), maxX = Math.max(positions[0].x, positions[1].x, positions[2].x);
  const minY = Math.min(positions[0].y, positions[1].y, positions[2].y), maxY = Math.max(positions[0].y, positions[1].y, positions[2].y);
  const minZ = Math.min(positions[0].z, positions[1].z, positions[2].z), maxZ = Math.max(positions[0].z, positions[1].z, positions[2].z);
  const keep = (light: Q2FragmentLight): boolean => {
    if (light.scale === 0 || light.color.x === 0 && light.color.y === 0 && light.color.z === 0) return false;
    const reach = light.radius + (light.cone === null ? 16 : 0);
    const dx = light.origin.x < minX ? minX - light.origin.x : light.origin.x > maxX ? light.origin.x - maxX : 0;
    const dy = light.origin.y < minY ? minY - light.origin.y : light.origin.y > maxY ? light.origin.y - maxY : 0;
    const dz = light.origin.z < minZ ? minZ - light.origin.z : light.origin.z > maxZ ? light.origin.z - maxZ : 0;
    return dx * dx + dy * dy + dz * dz <= reach * reach;
  };
  if (parameters.pass === "model") {
    const lights = parameters.lights.filter(keep);
    return lights.length === parameters.lights.length ? lighting : { ...lighting, parameters: { ...parameters, lights } };
  }
  const lights = parameters.lights.filter(keep);
  return lights.length === parameters.lights.length ? lighting : { ...lighting, parameters: { ...parameters, lights } };
}

const ZERO_WORLD_ATTRIBUTES: Pick<CpuVertex, "worldPosition" | "worldNormal"> = { worldPosition: { x: 0, y: 0, z: 0 }, worldNormal: { x: 0, y: 0, z: 0 } };

export function worldAttributes(lighting: BatchLighting, index: number): Pick<CpuVertex, "worldPosition" | "worldNormal"> {
  if (lighting.kind === "vertex") return ZERO_WORLD_ATTRIBUTES;
  const position = lighting.worldPositions[index], normal = lighting.kind === "q2-world" ? lighting.normals[index] : { x: 0, y: 0, z: 0 };
  if (position === undefined || normal === undefined) throw new RangeError("CPU fragment lighting arrays do not cover the vertex");
  return { worldPosition: position, worldNormal: normal };
}

function bound(value: number, low: number, high: number): number { return Math.min(high, Math.max(low, value)); }
function depthSample(image: DepthImageLevel, u: number, v: number): number {
  const x = bound(Math.floor(u * image.width), 0, image.width - 1), y = bound(Math.floor(v * image.height), 0, image.height - 1);
  const value = image.pixels[y * image.width + x];
  if (value === undefined) throw new RangeError("CPU shadow atlas sample escaped its image");
  return value;
}

/** Cone normalized depth bias and cube world-unit slope bias follow the donor GLSL. */
export function shadowVisibility(position: Vec3, origin: Vec3, radius: number, shadow: Q2ShadowProjection,
  atlas: Q2ShadowAtlas, depth: DepthImageLevel, model: boolean): number {
  if (shadow.kind === "none") return 1;
  const rect = shadow.atlasRect, texel = atlas.texelSize;
  let baseX: number, baseY: number, lowX: number, lowY: number, highX: number, highY: number;
  let visible: (stored: number) => boolean;
  let coneLimit = 0;
  if (shadow.kind === "cone") {
    const matrix = shadow.matrix;
    const clipW = matrix[3] * position.x + matrix[7] * position.y + matrix[11] * position.z + matrix[15];
    if (clipW <= 0) return 1;
    const x = (matrix[0] * position.x + matrix[4] * position.y + matrix[8] * position.z + matrix[12]) / clipW;
    const y = (matrix[1] * position.x + matrix[5] * position.y + matrix[9] * position.z + matrix[13]) / clipW;
    const z = (matrix[2] * position.x + matrix[6] * position.y + matrix[10] * position.z + matrix[14]) / clipW;
    if (x < 0 || x > 1 || y < 0 || y > 1 || z > 1) return 1;
    baseX = x * rect.z + rect.x; baseY = y * rect.w + rect.y;
    lowX = rect.x + texel; lowY = rect.y + texel;
    highX = rect.x + rect.z - texel; highY = rect.y + rect.w - texel;
    coneLimit = z - (model ? 0.0025 : 0.0005);
    visible = stored => coneLimit <= stored;
  } else {
    const x = position.x - origin.x, y = position.y - origin.y, z = position.z - origin.z;
    const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    let face: number, right: number, up: number, axial: number;
    if (ax >= ay && ax >= az) { face = x >= 0 ? 0 : 1; right = x >= 0 ? -y : y; up = z; axial = ax; }
    else if (ay >= az) { face = y >= 0 ? 2 : 3; right = y >= 0 ? x : -x; up = z; axial = ay; }
    else { face = z >= 0 ? 4 : 5; right = z >= 0 ? y : -y; up = x; axial = az; }
    const near = atlas.nearPlane;
    if (axial <= near) return 1;
    const far = Math.max(radius, near * 2), pa = (far + near) / (near - far), pb = 2 * far * near / (near - far);
    const cellWidth = rect.z / 3, cellHeight = rect.w / 2;
    const cellX = rect.x + face % 3 * cellWidth, cellY = rect.y + Math.floor(face / 3) * cellHeight;
    baseX = cellX + (right / axial * 0.5 + 0.5) * cellWidth;
    baseY = cellY + (up / axial * 0.5 + 0.5) * cellHeight;
    lowX = cellX + texel; lowY = cellY + texel;
    highX = cellX + cellWidth - texel; highY = cellY + cellHeight - texel;
    const bias = (model ? 5 : 1) + axial * (2 / (cellWidth / texel)) * (model ? 6 : 2);
    visible = stored => axial - bias <= pb / (2 * stored - 1 + pa);
  }
  let lit = 0;
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    const sample = depthSample(depth, bound(baseX + (x - 0.5) * texel, lowX, highX),
      bound(baseY + (y - 0.5) * texel, lowY, highY));
    if (visible(sample)) lit++;
  }
  return lit * 0.25;
}

function aliasShade(position: Vec3, vertex: Vec4, scale: number, lights: readonly Q2ModelShadowLight[], atlas: Q2ShadowAtlas, depth: DepthImageLevel): Vec3 {
  let keepR = 1, keepG = 1, keepB = 1;
  for (const light of lights) {
    if (light.fraction.x === 0 && light.fraction.y === 0 && light.fraction.z === 0) continue;
    const occluded = 1 - shadowVisibility(position, light.origin, light.radius, light.shadow, atlas, depth, true);
    keepR -= light.fraction.x * occluded; keepG -= light.fraction.y * occluded; keepB -= light.fraction.z * occluded;
  }
  return { x: Math.min(vertex.x * scale * Math.max(keepR, 0), 1), y: Math.min(vertex.y * scale * Math.max(keepG, 0), 1),
    z: Math.min(vertex.z * scale * Math.max(keepB, 0), 1) };
}

export function shadeQ2Fragment(lighting: CpuLighting, position: Vec3, normal: Vec3,
  vertex: Vec4, texel: Readonly<Sample>): Sample {
  const out: Sample = { r: 0, g: 0, b: 0, a: 0 };
  shadeQ2FragmentInto(out, lighting, position, normal, vertex, texel);
  return out;
}

const lightContributionScratch = { x: 0, y: 0, z: 0 };

/** Allocation-free form for per-fragment loops; identical arithmetic. */
export function shadeQ2FragmentInto(out: Sample, lighting: CpuLighting, position: Vec3, normal: Vec3,
  vertex: Vec4, texel: Readonly<Sample>): void {
  const parameters = lighting.parameters;
  if (parameters.kind === "vertex") {
    out.r = vertex.x * texel.r; out.g = vertex.y * texel.g;
    out.b = vertex.z * texel.b; out.a = vertex.w * texel.a;
    return;
  }
  if (parameters.kind === "q2-world") {
    let r = parameters.pass === "model" ? vertex.x : parameters.pass !== "texture" ? texel.r : texel.r * vertex.x;
    let g = parameters.pass === "model" ? vertex.y : parameters.pass !== "texture" ? texel.g : texel.g * vertex.y;
    let b = parameters.pass === "model" ? vertex.z : parameters.pass !== "texture" ? texel.b : texel.b * vertex.z;
    if (parameters.pass === "model" && parameters.shadeScale !== null) {
      if (parameters.atlas === null || lighting.depth === null) throw new Error("CPU model shadows require their depth atlas");
      const shade = aliasShade(position, vertex, parameters.shadeScale, parameters.lights, parameters.atlas, lighting.depth);
      r = shade.x; g = shade.y; b = shade.z;
    }
    for (const light of parameters.lights) {
      if (light.scale === 0 || light.color.x === 0 && light.color.y === 0 && light.color.z === 0) continue;
      // Falloff reaches zero at the light radius; point lights shift 16
      // units along the (at most unit) interpolated normal first.
      const dx = light.origin.x - position.x, dy = light.origin.y - position.y, dz = light.origin.z - position.z;
      const reach = light.radius + (light.cone === null ? 16 : 0);
      if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
      calcDynamicLightContributionInto(lightContributionScratch, light, position, normal);
      const contribution = lightContributionScratch;
      if (contribution.x === 0 && contribution.y === 0 && contribution.z === 0) continue;
      let visibility = 1;
      if (light.shadow.kind !== "none") {
        if (parameters.atlas === null || lighting.depth === null) throw new Error("CPU shadow light requires its depth atlas");
        visibility = shadowVisibility(position, light.origin, light.radius, light.shadow, parameters.atlas, lighting.depth, false);
      }
      r += contribution.x * visibility; g += contribution.y * visibility; b += contribution.z * visibility;
    }
    if (parameters.pass === "model") { r *= texel.r; g *= texel.g; b *= texel.b; }
    if (parameters.pass === "material-lightmap") { r *= vertex.x; g *= vertex.y; b *= vertex.z; }
    out.r = r; out.g = g; out.b = b; out.a = parameters.pass === "lightmap" ? 1 : texel.a * vertex.w;
    return;
  }
  if (lighting.depth === null) throw new Error("CPU model shadows require their depth atlas");
  const shade = aliasShade(position, vertex, parameters.shadeScale, parameters.lights, parameters.atlas, lighting.depth);
  out.r = texel.r * shade.x; out.g = texel.g * shade.y; out.b = texel.b * shade.z; out.a = texel.a * vertex.w;
}

export function interpolateWorld(a: Vec3, b: Vec3, c: Vec3, wa: number, wb: number, wc: number): Vec3 {
  return { x: a.x * wa + b.x * wb + c.x * wc, y: a.y * wa + b.y * wb + c.y * wc, z: a.z * wa + b.z * wb + c.z * wc };
}

/** Allocation-free form for the per-fragment kernel; identical arithmetic. */
export function interpolateWorldInto(out: { x: number; y: number; z: number }, a: Vec3, b: Vec3, c: Vec3, wa: number, wb: number, wc: number): void {
  out.x = a.x * wa + b.x * wb + c.x * wc;
  out.y = a.y * wa + b.y * wb + c.y * wc;
  out.z = a.z * wa + b.z * wb + c.z * wc;
}
