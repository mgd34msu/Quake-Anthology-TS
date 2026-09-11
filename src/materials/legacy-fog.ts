/* Q1 fog fades and Q2 global/height fog translated from Quakespasm gl_fog.c
 * and q2repro shader.c. Copyright (C) Id Software and contributors.
 * SPDX-License-Identifier: GPL-2.0-or-later */
import type { SceneFog } from "../contracts/render.ts";
import type { Vec3 } from "../contracts/math.ts";

export interface Q1Fog { readonly density: number; readonly color: Vec3; }
const clamp = (value: number): number => Math.min(1, Math.max(0, value));
function mix(a: Vec3, b: Vec3, fraction: number): Vec3 {
  return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction, z: a.z + (b.z - a.z) * fraction };
}

export class Q1FogState {
  private previous: Q1Fog = { density: 0, color: { x: 0.3, y: 0.3, z: 0.3 } };
  private target: Q1Fog = this.previous;
  private start = 0;
  private duration = 0;

  update(value: Q1Fog, time: number, duration = 0): void {
    this.previous = this.sample(time);
    this.target = { density: Math.max(0, value.density), color: { x: clamp(value.color.x), y: clamp(value.color.y), z: clamp(value.color.z) } };
    this.start = time; this.duration = Math.max(0, duration);
  }
  sample(time: number): Q1Fog {
    const fraction = this.duration === 0 ? 1 : clamp((time - this.start) / this.duration);
    return { density: this.previous.density + (this.target.density - this.previous.density) * fraction,
      color: mix(this.previous.color, this.target.color, fraction) };
  }
}

export function globalFogAmount(densityScaled: number, fragDepth: number): number {
  const d = densityScaled * fragDepth;
  return 1 - Math.exp(-(d * d));
}

/** Preserve q2repro's second subtraction of start in its authored height ramp. */
export function heightFogFraction(worldZ: number, start: number, end: number): number {
  if (end === start) return 0;
  return clamp((worldZ - start - start) / (end - start));
}

export function heightFogDirZ(directionZ: number): number {
  const sign = Math.sign(directionZ);
  return directionZ + 0.00001 * (1 - sign * sign);
}

export function heightFogExtinction(viewZ: number, worldZ: number, start: number, falloff: number, directionZ: number): number {
  const density = (Math.exp(-falloff * (viewZ - start)) - Math.exp(-falloff * (worldZ - start))) / (falloff * directionZ);
  return 1 - clamp(Math.exp(-density));
}

export function heightFogAmount(density: number, depth: number, extinction: number): number {
  return (1 - Math.exp(-(density * depth))) * extinction;
}

/** CPU fragment and GL shader implementations can consume the same source terms. */
export function q2FogColor(color: Vec3, fog: Extract<SceneFog, { readonly kind: "q2" }>, point: Vec3, view: Vec3, depth: number, sky: boolean): Vec3 {
  let result = mix(color, fog.color, globalFogAmount(fog.density / 64, depth));
  if (fog.height.density > 0) {
    const distance = Math.hypot(point.x - view.x, point.y - view.y, point.z - view.z);
    const directionZ = heightFogDirZ(distance === 0 ? 0 : (point.z - view.z) / distance);
    const extinction = heightFogExtinction(view.z, point.z, fog.height.start.distance, fog.height.falloff, directionZ);
    const amount = heightFogAmount(fog.height.density, depth, extinction);
    const heightColor = mix(fog.height.start.color, fog.height.end.color, heightFogFraction(point.z, fog.height.start.distance, fog.height.end.distance));
    result = mix(result, { x: heightColor.x * extinction, y: heightColor.y * extinction, z: heightColor.z * extinction }, amount);
  }
  if (sky) result = mix(result, fog.color, fog.skyFactor);
  return result;
}

/** Quakespasm divides its wire density by 64 before the fixed-function EXP2 curve. */
export function q1FogColor(color: Vec3, fog: Q1Fog, depth: number): Vec3 {
  return mix(color, fog.color, globalFogAmount(fog.density / 64, depth));
}
