/* Shadow atlas preparation adapted from quake-2-re-ts gl_shadowmap.ts.
 * The TS donor adds depth maps for KEX shadow lights; native q2repro has no atlas.
 * Copyright (C) Id Software and contributors. GPL-2.0-or-later. */
import type { Mat4, Vec3, Vec4 } from "../../contracts/math.ts";
import type { DepthAtlasDraw, DepthAtlasPass, Q2FragmentLight, Q2ShadowAtlas, Q2ShadowProjection, Rect, RendererImage, RenderOperation } from "../../contracts/render.ts";
import type { SceneLight } from "../../contracts/scene.ts";
import type { MaterialGeometry } from "../../materials/geometry.ts";
import type { SceneImageRegistry } from "./resources.ts";

export const Q2_SHADOW_ATLAS_SIZE = 2048;
export const Q2_SHADOW_NEAR = 4;
const minimumResolution = 128, maximumLights = 8;
const f = Math.fround;

export interface ShadowMesh { readonly positions: readonly Vec3[]; readonly indices: readonly number[]; }
export interface ShadowSphere {
  readonly origin: Vec3;
  readonly radius: number;
}
export interface ShadowCaster extends ShadowSphere {
  readonly meshes: readonly ShadowMesh[];
}
export interface ShadowAtlasOptions { readonly enabled?: boolean; readonly resolutionCap?: number; }
export interface PreparedShadows {
  readonly lighting: { readonly lights: readonly Q2FragmentLight[]; readonly atlas: Q2ShadowAtlas | null };
  readonly operations: readonly RenderOperation[];
  readonly stats: { readonly lights: number; readonly cachedLights: number; readonly rebuiltLights: number; readonly facesRendered: number; readonly entityCasters: number };
}
interface Candidate { readonly index: number; readonly light: Q2FragmentLight; face: number; readonly casters: readonly ShadowCaster[]; }
interface FaceBasis { readonly forward: Vec3; readonly right: Vec3; readonly up: Vec3; }
export const Q2_SHADOW_CUBE_FACES: readonly FaceBasis[] = [
  { forward: { x: 1, y: 0, z: 0 }, right: { x: 0, y: -1, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  { forward: { x: -1, y: 0, z: 0 }, right: { x: 0, y: 1, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  { forward: { x: 0, y: 1, z: 0 }, right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  { forward: { x: 0, y: -1, z: 0 }, right: { x: -1, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  { forward: { x: 0, y: 0, z: 1 }, right: { x: 0, y: 1, z: 0 }, up: { x: 1, y: 0, z: 0 } },
  { forward: { x: 0, y: 0, z: -1 }, right: { x: 0, y: -1, z: 0 }, up: { x: 1, y: 0, z: 0 } },
];
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const difference = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const unit = (a: Vec3): Vec3 => { const size = length(a); return { x: a.x / size, y: a.y / size, z: a.z / size }; };

export function shadowMesh(geometry: MaterialGeometry): ShadowMesh {
  return { positions: geometry.vertices.map(vertex => vertex.position), indices: geometry.indices };
}
export function shadowCaster(origin: Vec3, meshes: readonly ShadowMesh[]): ShadowCaster {
  let radius = 0;
  for (const mesh of meshes) for (const position of mesh.positions) radius = Math.max(radius, length(difference(position, origin)));
  return { origin, radius: radius > 0 ? radius : 64, meshes };
}

export function shadowMapResolution(requested: number, cap = 1024): number {
  const maximum = Math.max(minimumResolution, Math.min(cap > 0 ? cap : 1024, 1024));
  const wanted = Math.max(minimumResolution, Math.min(requested > 0 ? requested : 512, maximum));
  return 2 ** Math.floor(Math.log2(wanted));
}
export function packShadowAtlas(requests: readonly { readonly width: number; readonly height: number }[], size = Q2_SHADOW_ATLAS_SIZE): readonly (Rect | null)[] {
  let x = 0, y = 0, shelfHeight = 0;
  return requests.map(({ width, height }) => {
    if (width <= 0 || height <= 0 || width > size || height > size) return null;
    if (x + width > size) { y += shelfHeight; shelfHeight = 0; x = 0; }
    if (y + height > size) return null;
    const rect = { x, y, width, height }; x += width; shelfHeight = Math.max(shelfHeight, height); return rect;
  });
}
function extent(candidate: Candidate): { readonly width: number; readonly height: number } {
  return candidate.light.cone === null ? { width: candidate.face * 3, height: candidate.face * 2 } : { width: candidate.face, height: candidate.face };
}
function fit(candidates: Candidate[]): readonly (Rect | null)[] {
  const pack = (): readonly (Rect | null)[] => {
    candidates.sort((a, b) => { const first = extent(a), second = extent(b); return second.width * second.height - first.width * first.height; });
    return packShadowAtlas(candidates.map(extent));
  };
  let slots = pack();
  for (let attempt = 0; attempt < 4 && slots.some(slot => slot === null); attempt++) {
    let shrank = false;
    for (const candidate of candidates) if (candidate.light.cone === null && candidate.face > minimumResolution) { candidate.face /= 2; shrank = true; }
    if (!shrank) break;
    slots = pack();
  }
  return slots;
}

/** Donor matrices accumulate binary64 products and round each stored cell once. */
export function shadowMatrixMultiply(a: Mat4, b: Mat4): Mat4 {
  const cell = (column: 0 | 4 | 8 | 12, row: 0 | 1 | 2 | 3): number => {
    let result = 0;
    for (let k = 0; k < 4; k++) result += (a[k * 4 + row] ?? 0) * (b[column + k] ?? 0);
    return f(result);
  };
  return [cell(0, 0), cell(0, 1), cell(0, 2), cell(0, 3), cell(4, 0), cell(4, 1), cell(4, 2), cell(4, 3),
    cell(8, 0), cell(8, 1), cell(8, 2), cell(8, 3), cell(12, 0), cell(12, 1), cell(12, 2), cell(12, 3)];
}
export function shadowProject(matrix: Mat4, position: Vec3): Vec4 {
  const { x, y, z } = position;
  return { x: matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12], y: matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    z: matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14], w: matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15] };
}
function perspective(fov: number, radius: number): Mat4 {
  const scale = 1 / Math.tan(fov * Math.PI / 360), far = Math.max(radius, 8), near = Q2_SHADOW_NEAR;
  return [f(scale), 0, 0, 0, 0, f(scale), 0, 0, 0, 0, f((far + near) / (near - far)), -1, 0, 0, f(2 * far * near / (near - far)), 0];
}
function view(origin: Vec3, basis: FaceBasis): Mat4 {
  const { right: r, up: u, forward: v } = basis;
  return [f(r.x), f(u.x), f(-v.x), 0, f(r.y), f(u.y), f(-v.y), 0, f(r.z), f(u.z), f(-v.z), 0,
    f(-dot(r, origin)), f(-dot(u, origin)), f(dot(v, origin)), 1];
}
function coneBasis(direction: Vec3): FaceBasis {
  const forward = length(direction) < 1e-6 ? { x: 0, y: 0, z: -1 } : unit(direction);
  const reference = Math.abs(forward.z) >= 0.99 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 };
  const right = unit(cross(forward, reference)); return { forward, right, up: cross(right, forward) };
}
export function shadowConeFov(cosHalfAngle: number): number {
  return Math.min(Math.acos(Math.min(1, Math.max(-1, cosHalfAngle))) * 180 / Math.PI * 2 * 1.15, 175);
}
export function shadowConeMatrix(light: Q2FragmentLight): Mat4 {
  if (light.cone === null) throw new Error("A cone projection requires a spotlight direction");
  return shadowMatrixMultiply(perspective(shadowConeFov(light.cone.cosHalfAngle), light.radius), view(light.origin, coneBasis(light.cone.direction)));
}
const depthBias: Mat4 = [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 0.5, 0.5, 0.5, 1];

function lightContainsSphere(light: Pick<Q2FragmentLight, "origin" | "radius" | "cone">): (caster: ShadowSphere) => boolean {
  const cone = light.cone;
  const diagonal = cone === null ? Math.PI : Math.atan(Math.SQRT2 * Math.tan(Math.min(shadowConeFov(cone.cosHalfAngle) * Math.PI / 360, 87 * Math.PI / 180)));
  const limit = Math.cos(diagonal);
  return caster => {
    const delta = difference(caster.origin, light.origin), distance = length(delta);
    if (distance > light.radius + caster.radius) return false;
    if (cone !== null && distance > caster.radius) {
      const angle = Math.acos(Math.min(1, Math.max(-1, dot(delta, cone.direction) / distance)));
      const separation = angle - Math.asin(Math.min(1, caster.radius / distance));
      if (Math.cos(Math.min(Math.PI, Math.max(0, separation))) < limit) return false;
    }
    return true;
  };
}

function eligibleShadowLight(light: SceneLight): boolean {
  return light.profile.kind === "q2" && !(light.radius <= 0) && (light.profile.shadow.kind === "cast" || light.profile.cone !== null);
}

/** The atlas selects the first eight Q2 lights before testing shadow eligibility. */
export function shadowBodyFilter(source: readonly SceneLight[]): (sphere: ShadowSphere) => boolean {
  const tests = source.filter(light => light.profile.kind === "q2").slice(0, maximumLights).filter(eligibleShadowLight)
    .map(light => lightContainsSphere({ ...light, cone: light.profile.kind === "q2" ? light.profile.cone : null }));
  return sphere => tests.some(test => test(sphere));
}
function worldMeshVisible(mesh: ShadowMesh, light: Q2FragmentLight, forward: Vec3 | null): boolean {
  let inRadius = false, inFront = forward === null;
  const radiusSquared = Math.max(light.radius, 8) ** 2;
  for (const position of mesh.positions) {
    const delta = difference(position, light.origin);
    inRadius ||= dot(delta, delta) <= radiusSquared;
    inFront ||= forward !== null && dot(delta, forward) > 0;
    if (inRadius && inFront) return true;
  }
  return false;
}
function draw(mesh: ShadowMesh, matrix: Mat4, entity: boolean): DepthAtlasDraw {
  return { positions: mesh.positions.map(position => shadowProject(matrix, position)), indices: mesh.indices, cull: "none",
    polygonOffset: entity ? { factor: 1, units: 2 } : { factor: 2, units: 4 } };
}
function depthPass(candidate: Candidate, viewport: Rect, matrix: Mat4, world: readonly ShadowMesh[], forward: Vec3 | null): DepthAtlasPass {
  const draws = world.filter(mesh => worldMeshVisible(mesh, candidate.light, forward)).map(mesh => draw(mesh, matrix, false));
  for (const caster of candidate.casters) {
    if (forward !== null && dot(difference(caster.origin, candidate.light.origin), forward) + caster.radius <= 0) continue;
    draws.push(...caster.meshes.map(mesh => draw(mesh, matrix, true)));
  }
  return { viewport, clearDepth: 1, draws };
}

/** Geometry digests include actual interpolated/deformed positions, including attached models. */
function geometryDigest(meshes: readonly ShadowMesh[]): string {
  const hash = new Bun.CryptoHasher("sha256");
  for (const mesh of meshes) {
    hash.update(new Float64Array([mesh.positions.length, mesh.indices.length]));
    const positions = new Float64Array(mesh.positions.length * 3);
    let offset = 0;
    for (const position of mesh.positions) {
      positions[offset++] = position.x; positions[offset++] = position.y; positions[offset++] = position.z;
    }
    hash.update(positions);
    hash.update(new Float64Array(mesh.indices));
  }
  return hash.digest("hex");
}

/** An atlas belongs to one prepared scene, including every seat using that scene. */
export class Q2ShadowScene {
  private image: RendererImage | null = null;
  private cached = new Map<number, string>();
  constructor(readonly images: SceneImageRegistry) {}

  prepare(source: readonly SceneLight[], world: readonly ShadowMesh[], casters: readonly ShadowCaster[], options: ShadowAtlasOptions = {}): PreparedShadows {
    const lights: Q2FragmentLight[] = source.filter(light => light.profile.kind === "q2").slice(0, maximumLights).map(light => ({ origin: light.origin, radius: light.radius,
      color: light.color, scale: light.profile.kind === "q2" ? light.profile.scale : 1, cone: light.profile.kind === "q2" ? light.profile.cone : null, shadow: { kind: "none" } }));
    const q2Source = source.filter(light => light.profile.kind === "q2"), candidates: Candidate[] = [];
    if (options.enabled !== false) for (const [index, light] of lights.slice(0, maximumLights).entries()) {
      const original = q2Source[index];
      if (original === undefined || original.profile.kind !== "q2" || !eligibleShadowLight(original)) continue;
      candidates.push({ index, light, face: shadowMapResolution(original.profile.shadow.kind === "cast" ? original.profile.shadow.resolution : 0, options.resolutionCap), casters: casters.filter(lightContainsSphere(light)) });
    }
    if (options.enabled === false) this.close();
    if (candidates.length === 0) return { lighting: { lights, atlas: null }, operations: [], stats: { lights: 0, cachedLights: 0, rebuiltLights: 0, facesRendered: 0, entityCasters: 0 } };
    if (this.image === null) this.image = this.images.register("*q2-shadow-atlas", { kind: "depth32f",
      levels: [{ width: Q2_SHADOW_ATLAS_SIZE, height: Q2_SHADOW_ATLAS_SIZE, pixels: new Float32Array(Q2_SHADOW_ATLAS_SIZE ** 2).fill(1) }] }, { wrap: "clamp", filter: "nearest" });
    const slots = fit(candidates), passes: DepthAtlasPass[] = [], signatures = new Map<number, string>();
    const worldKey = geometryDigest(world), casterKeys = new Map<ShadowCaster, string>();
    let cachedLights = 0, rebuiltLights = 0, entityCasters = 0;
    for (const [index, candidate] of candidates.entries()) {
      const slot = slots[index]; if (slot === null || slot === undefined) continue;
      const light = candidate.light, matrix = light.cone === null ? null : shadowConeMatrix(light);
      const atlasRect: Vec4 = { x: slot.x / Q2_SHADOW_ATLAS_SIZE, y: slot.y / Q2_SHADOW_ATLAS_SIZE, z: slot.width / Q2_SHADOW_ATLAS_SIZE, w: slot.height / Q2_SHADOW_ATLAS_SIZE };
      const shadow: Q2ShadowProjection = matrix === null ? { kind: "point", atlasRect } : { kind: "cone", atlasRect, matrix: shadowMatrixMultiply(depthBias, matrix) };
      lights[candidate.index] = { ...light, shadow };
      const signature = JSON.stringify([light.origin, light.radius, light.cone, slot, worldKey, candidate.casters.map(caster => {
        let key = casterKeys.get(caster);
        if (key === undefined) { key = geometryDigest(caster.meshes); casterKeys.set(caster, key); }
        return [caster.origin, caster.radius, key];
      })]);
      signatures.set(candidate.index, signature);
      if (this.cached.get(candidate.index) === signature) { cachedLights++; continue; }
      rebuiltLights++; entityCasters += candidate.casters.length;
      if (matrix !== null) passes.push(depthPass(candidate, slot, matrix, world, null));
      else for (const [face, basis] of Q2_SHADOW_CUBE_FACES.entries()) {
        const projection = shadowMatrixMultiply(perspective(90, light.radius), view(light.origin, basis));
        passes.push(depthPass(candidate, { x: slot.x + face % 3 * candidate.face, y: slot.y + Math.floor(face / 3) * candidate.face,
          width: candidate.face, height: candidate.face }, projection, world, basis.forward));
      }
    }
    this.cached = signatures;
    return { lighting: { lights, atlas: { image: this.image, texelSize: 1 / Q2_SHADOW_ATLAS_SIZE, nearPlane: Q2_SHADOW_NEAR } },
      operations: passes.length === 0 ? [] : [{ kind: "depth-atlas", image: this.image, passes }],
      stats: { lights: cachedLights + rebuiltLights, cachedLights, rebuiltLights, facesRendered: passes.length, entityCasters } };
  }

  close(): void { if (this.image !== null) { this.images.release(this.image); this.image = null; } this.cached.clear(); }
}
