/* Q2 rerelease P_ForceFogTransition and q2repro V_FogParamsChanged. GPL-2.0-or-later. */
import { SvcFogDataBitsT, type SvcFogDataT } from "../../../network/q2/fog.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { SceneFog } from "../../../contracts/render.ts";
import { createQ2Fog } from "../../../content/q2/rerelease/types.ts";
import type { Q2FogState } from "../../../content/q2/rerelease/types.ts";

function fraction(value: number): number { return Math.fround((Math.trunc(Math.fround(value * 255)) & 255) / 255); }
function color(value: Vec3): Vec3 { return { x: fraction(value.x), y: fraction(value.y), z: fraction(value.z) }; }
/** The local event carries game floats; the native message carries bytes and unscaled signed height coordinates. */
export function q2FogFromSource(value: Q2FogState): Q2FogState {
  return { fog: { density: Math.fround(value.fog.density), color: color(value.fog.color), skyFactor: fraction(value.fog.skyFactor) },
    heightFog: { startColor: color(value.heightFog.startColor), startDistance: value.heightFog.startDistance | 0,
      endColor: color(value.heightFog.endColor), endDistance: value.heightFog.endDistance | 0,
      falloff: Math.fround(value.heightFog.falloff), density: Math.fround(value.heightFog.density) } };
}
export class RereleaseFog {
  private start = createQ2Fog();
  private target = createQ2Fog();
  private starts = 0;
  private duration = 0;
  receive(value: Q2FogState, durationMilliseconds: number, seconds: number): void {
    if (durationMilliseconds !== 0) { this.start = this.target; this.starts = seconds * 1000; }
    this.duration = durationMilliseconds; this.target = q2FogFromSource(value);
  }
  current(seconds: number): Extract<SceneFog, { readonly kind: "q2" }> {
    const elapsed = seconds * 1000 - this.starts, front = this.duration === 0 || elapsed > this.duration ? 1 : elapsed / this.duration, back = 1 - front;
    const mix = (a: number, b: number): number => a * back + b * front;
    const mixColor = (a: Vec3, b: Vec3): Vec3 => ({ x: Math.fround(mix(a.x, b.x)), y: Math.fround(mix(a.y, b.y)), z: Math.fround(mix(a.z, b.z)) });
    const a = this.start, b = this.target;
    return { kind: "q2", color: mixColor(a.fog.color, b.fog.color), density: mix(a.fog.density, b.fog.density), skyFactor: mix(a.fog.skyFactor, b.fog.skyFactor),
      height: { start: { color: mixColor(a.heightFog.startColor, b.heightFog.startColor), distance: mix(a.heightFog.startDistance, b.heightFog.startDistance) },
        end: { color: mixColor(a.heightFog.endColor, b.heightFog.endColor), distance: mix(a.heightFog.endDistance, b.heightFog.endDistance) },
        density: mix(a.heightFog.density, b.heightFog.density), falloff: mix(a.heightFog.falloff, b.heightFog.falloff) } };
  }
}

/** svc_fog updates only flagged components of the prior target, including byte-valued colors. */
export function q2FogFromWire(previous: Q2FogState, value: SvcFogDataT): Q2FogState {
  const has = (bit: number): boolean => (value.bits & bit) !== 0;
  const bits = SvcFogDataBitsT;
  return {
    fog: { density: has(bits.BIT_DENSITY) ? value.density : previous.fog.density,
      skyFactor: has(bits.BIT_DENSITY) ? value.skyfactor / 255 : previous.fog.skyFactor,
      color: { x: has(bits.BIT_R) ? value.red / 255 : previous.fog.color.x,
        y: has(bits.BIT_G) ? value.green / 255 : previous.fog.color.y, z: has(bits.BIT_B) ? value.blue / 255 : previous.fog.color.z } },
    heightFog: { falloff: has(bits.BIT_HEIGHTFOG_FALLOFF) ? value.hf_falloff : previous.heightFog.falloff,
      density: has(bits.BIT_HEIGHTFOG_DENSITY) ? value.hf_density : previous.heightFog.density,
      startDistance: has(bits.BIT_HEIGHTFOG_START_DIST) ? value.hf_start_dist : previous.heightFog.startDistance,
      endDistance: has(bits.BIT_HEIGHTFOG_END_DIST) ? value.hf_end_dist : previous.heightFog.endDistance,
      startColor: { x: has(bits.BIT_HEIGHTFOG_START_R) ? value.hf_start_r / 255 : previous.heightFog.startColor.x,
        y: has(bits.BIT_HEIGHTFOG_START_G) ? value.hf_start_g / 255 : previous.heightFog.startColor.y,
        z: has(bits.BIT_HEIGHTFOG_START_B) ? value.hf_start_b / 255 : previous.heightFog.startColor.z },
      endColor: { x: has(bits.BIT_HEIGHTFOG_END_R) ? value.hf_end_r / 255 : previous.heightFog.endColor.x,
        y: has(bits.BIT_HEIGHTFOG_END_G) ? value.hf_end_g / 255 : previous.heightFog.endColor.y,
        z: has(bits.BIT_HEIGHTFOG_END_B) ? value.hf_end_b / 255 : previous.heightFog.endColor.z } },
  };
}
