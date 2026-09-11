/* Quake r_part.c and Quake II gl_rmain.c particle/beam assembly.
 * Copyright (C) 1996-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { Vec3, Vec4 } from "../../../contracts/math.ts";
import type { DrawBatch, RenderImage, RendererImage, RenderState, SceneCamera } from "../../../contracts/render.ts";
import type { SceneParticle } from "../../../contracts/scene.ts";
import { add3, length3, normalize3, perpendicularVector, rotatePointAroundVector, scale3, sub3 } from "../../../core/math.ts";
import type { MaterialGeometry, MaterialVertex } from "../../../materials/geometry.ts";
import { spriteGeometry } from "./primitives.ts";

export interface ParticlePreparationContext {
  readonly camera: SceneCamera;
  readonly indexedProfile: "q1" | "q2";
  paletteColor(index: number): Vec3;
}

export function prepareParticleGeometry(particles: readonly SceneParticle[], context: ParticlePreparationContext): MaterialGeometry {
  const vertices: MaterialVertex[] = [], indices: number[] = [];
  for (const particle of particles) {
    const offset = vertices.length;
    if (particle.kind === "rgba") {
      const geometry = spriteGeometry({ origin: particle.origin, radius: particle.size, rotation: particle.rotation,
        shaderRGBA: { x: particle.color.x * 255, y: particle.color.y * 255, z: particle.color.z * 255, w: particle.color.w * 255 } },
      context.camera.axis, context.camera.clip.kind === "portal" && context.camera.clip.mirror);
      vertices.push(...geometry.vertices); indices.push(...geometry.indices.map(index => index + offset));
      continue;
    }
    const delta = sub3(particle.origin, context.camera.origin), forward = context.camera.axis[0];
    const depth = delta.x * forward.x + delta.y * forward.y + delta.z * forward.z;
    const scale = (depth < 20 ? 1 : 1 + depth * 0.004) * particle.size;
    const palette = context.paletteColor(particle.paletteIndex), alpha = context.indexedProfile === "q1" ? 255 : Math.trunc(particle.alpha * 255) & 255;
    const color: Vec4 = { ...palette, w: alpha };
    const normal = scale3(forward, -1), up = scale3(context.camera.axis[2], 1.5 * scale), right = scale3(context.camera.axis[1], -1.5 * scale);
    const vertex = (position: Vec3, s: number, t: number): MaterialVertex => ({ position, normal, color,
      texCoord: { x: s, y: t }, lightmapCoord: { x: 0, y: 0 } });
    const uv = context.indexedProfile === "q2" ? 0.0625 : 0;
    vertices.push(vertex(particle.origin, uv, uv), vertex(add3(particle.origin, up), 1 + uv, uv), vertex(add3(particle.origin, right), uv, 1 + uv));
    indices.push(offset, offset + 1, offset + 2);
  }
  return { vertices, indices };
}

export function prepareParticleBatch(particles: readonly SceneParticle[], context: ParticlePreparationContext,
  texture: RendererImage, project: (point: Vec3) => Vec4): DrawBatch {
  const geometry = prepareParticleGeometry(particles, context);
  return { lighting: { kind: "vertex" }, primitive: "triangles", texturing: "single", indices: geometry.indices,
    vertices: geometry.vertices.map(vertex => ({ ...vertex, position: project(vertex.position), color: {
      x: vertex.color.x / 255, y: vertex.color.y / 255, z: vertex.color.z / 255, w: vertex.color.w / 255,
    } })), texture: { kind: "bind-image", image: texture }, state: {
      blend: { source: "src-alpha", destination: "one-minus-src-alpha" }, depthTest: "less-equal", depthWrite: context.indexedProfile === "q1",
      alphaTest: "none", cull: "none", depthRange: [0, 1], polygonOffset: null,
    } };
}

/** Q2's six-sided beam uses frame as diameter and oldorigin as its endpoint. */
export function q2BeamGeometry(origin: Vec3, oldOrigin: Vec3, diameter: number, color: Vec4): MaterialGeometry {
  const delta = sub3(oldOrigin, origin);
  if (length3(delta) === 0) return { vertices: [], indices: [] };
  const direction = normalize3(delta), perpendicular = scale3(perpendicularVector(direction), diameter / 2);
  const vertices: MaterialVertex[] = [], indices: number[] = [];
  for (let segment = 0; segment < 6; segment++) {
    const normal = rotatePointAroundVector(direction, perpendicular, segment * 60);
    const start = add3(origin, normal), end = add3(start, delta);
    for (const position of [start, end]) vertices.push({ position, normal: normalize3(normal), texCoord: { x: 0, y: 0 }, lightmapCoord: { x: 0, y: 0 }, color });
    const a = segment * 2, b = ((segment + 1) % 6) * 2;
    indices.push(a, a + 1, b, b, a + 1, b + 1);
  }
  return { vertices, indices };
}

export function q2BeamBatch(origin: Vec3, oldOrigin: Vec3, diameter: number, color: Vec4,
  project: (point: Vec3) => Vec4, whiteImage: RendererImage, state: RenderState): DrawBatch {
  const geometry = q2BeamGeometry(origin, oldOrigin, diameter, color);
  return { lighting: { kind: "vertex" }, texturing: "single", primitive: "triangles", indices: geometry.indices,
    vertices: geometry.vertices.map(vertex => ({ ...vertex, position: project(vertex.position), color: {
      x: color.x / 255, y: color.y / 255, z: color.z / 255, w: color.w / 255,
    } })), texture: { kind: "bind-image", image: whiteImage }, state: { ...state, depthWrite: false,
      blend: { source: "src-alpha", destination: "one-minus-src-alpha" }, alphaTest: "none" } };
}

export function legacyParticleImage(profile: "q1" | "q2" = "q2"): RenderImage {
  const dot: readonly string[] = profile === "q1"
    ? ["01100000", "11110000", "11110000", "01100000", "00000000", "00000000", "00000000", "00000000"]
    : ["00000000", "00110000", "01111000", "01111000", "00110000", "00000000", "00000000", "00000000"];
  const pixels = new Uint8Array(8 * 8 * 4);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) pixels.set([255, 255, 255, dot[x]?.[y] === "1" ? 255 : 0], (y * 8 + x) * 4);
  return { kind: "rgba8", levels: [{ width: 8, height: 8, pixels }], borderColor: { x: 0, y: 0, z: 0, w: 0 } };
}

export type Q1ParticleType = "static" | "fire" | "explode" | "explode2" | "blob" | "blob2" | "gravity" | "slow-gravity";
export interface Q1ParticleState {
  readonly origin: Vec3; readonly velocity: Vec3; readonly color: number; readonly ramp: number;
  readonly die: number; readonly type: Q1ParticleType;
}
const ramp1: readonly number[] = [111, 109, 107, 105, 103, 101, 99, 97];
const ramp2: readonly number[] = [111, 110, 109, 108, 107, 106, 104, 102];
const ramp3: readonly number[] = [109, 107, 6, 5, 4, 3, 0, 0];

/** Call once per client frame after taking the render sample, never once per seat. */
export function advanceQ1Particle(particle: Q1ParticleState, seconds: number, gravity: number): Q1ParticleState {
  const origin = { x: Math.fround(particle.origin.x + particle.velocity.x * seconds), y: Math.fround(particle.origin.y + particle.velocity.y * seconds),
    z: Math.fround(particle.origin.z + particle.velocity.z * seconds) };
  let { velocity, ramp, die, color } = particle;
  const grav = seconds * gravity * 0.05, dvel = 4 * seconds;
  const scale = (amount: number, z: boolean): Vec3 => ({ x: Math.fround(velocity.x + velocity.x * amount),
    y: Math.fround(velocity.y + velocity.y * amount), z: z ? Math.fround(velocity.z + velocity.z * amount) : velocity.z });
  switch (particle.type) {
    case "static": break;
    case "fire":
      ramp = Math.fround(ramp + seconds * 5); if (ramp >= 6) die = -1; else color = ramp3[Math.trunc(ramp)] ?? color;
      velocity = { ...velocity, z: Math.fround(velocity.z + grav) }; break;
    case "explode":
      ramp = Math.fround(ramp + seconds * 10); if (ramp >= 8) die = -1; else color = ramp1[Math.trunc(ramp)] ?? color;
      velocity = scale(dvel, true); velocity = { ...velocity, z: Math.fround(velocity.z - grav) }; break;
    case "explode2":
      ramp = Math.fround(ramp + seconds * 15); if (ramp >= 8) die = -1; else color = ramp2[Math.trunc(ramp)] ?? color;
      velocity = scale(-seconds, true); velocity = { ...velocity, z: Math.fround(velocity.z - grav) }; break;
    case "blob": velocity = scale(dvel, true); velocity = { ...velocity, z: Math.fround(velocity.z - grav) }; break;
    case "blob2": velocity = scale(-dvel, false); velocity = { ...velocity, z: Math.fround(velocity.z - grav) }; break;
    case "gravity": case "slow-gravity": velocity = { ...velocity, z: Math.fround(velocity.z - grav) }; break;
  }
  return { ...particle, origin, velocity, ramp, die, color };
}

export interface Q2ParticleState {
  readonly spawnMilliseconds: number; readonly origin: Vec3; readonly velocity: Vec3; readonly acceleration: Vec3;
  readonly color: number; readonly alpha: number; readonly alphaVelocity: number;
}

/** INSTANT_PARTICLE survives one submission; its owner retires it afterwards. */
export function sampleQ2Particle(particle: Q2ParticleState, milliseconds: number): Extract<SceneParticle, { readonly kind: "indexed" }> | null {
  const seconds = particle.alphaVelocity === -10000 ? 0 : (milliseconds - particle.spawnMilliseconds) * 0.001;
  const alpha = particle.alpha + seconds * particle.alphaVelocity;
  if (alpha <= 0) return null;
  const square = seconds * seconds;
  return { kind: "indexed", paletteIndex: particle.color, alpha: Math.min(1, alpha), size: 1, origin: {
    x: Math.fround(particle.origin.x + particle.velocity.x * seconds + particle.acceleration.x * square),
    y: Math.fround(particle.origin.y + particle.velocity.y * seconds + particle.acceleration.y * square),
    z: Math.fround(particle.origin.z + particle.velocity.z * seconds + particle.acceleration.z * square),
  } };
}
