import type { Vec3 } from "../../../contracts/math.ts";
import { numberField, vectorField } from "../foundation/fields.ts";
import type { Q2SpawnFields } from "../foundation/host.ts";
import type { Q2FogState } from "./types.ts";

export function q2RereleaseFogFields(fields: Q2SpawnFields, off = false): Q2FogState {
  const suffix = off ? "_off" : "";
  return { fog: { density: numberField(fields, `fog_density${suffix}`), color: vectorField(fields, `fog_color${suffix}`), skyFactor: numberField(fields, `fog_sky_factor${suffix}`) },
    heightFog: { startColor: vectorField(fields, `heightfog_start_color${suffix}`), startDistance: numberField(fields, `heightfog_start_dist${suffix}`),
      endColor: vectorField(fields, `heightfog_end_color${suffix}`), endDistance: numberField(fields, `heightfog_end_dist${suffix}`),
      density: numberField(fields, `heightfog_density${suffix}`), falloff: numberField(fields, `heightfog_falloff${suffix}`) } };
}
export function interpolateQ2Fog(off: Q2FogState, on: Q2FogState, fraction: number): Q2FogState {
  const scalar = (first: number, last: number): number => first + (last - first) * fraction;
  const vector = (first: Vec3, last: Vec3): Vec3 => ({ x: scalar(first.x, last.x), y: scalar(first.y, last.y), z: scalar(first.z, last.z) });
  return { fog: { density: scalar(off.fog.density, on.fog.density), color: vector(off.fog.color, on.fog.color), skyFactor: scalar(off.fog.skyFactor, on.fog.skyFactor) },
    heightFog: { startColor: vector(off.heightFog.startColor, on.heightFog.startColor), startDistance: scalar(off.heightFog.startDistance, on.heightFog.startDistance),
      endColor: vector(off.heightFog.endColor, on.heightFog.endColor), endDistance: scalar(off.heightFog.endDistance, on.heightFog.endDistance),
      falloff: scalar(off.heightFog.falloff, on.heightFog.falloff), density: scalar(off.heightFog.density, on.heightFog.density) } };
}
export function equalQ2Fog(first: Q2FogState, second: Q2FogState): boolean {
  const vector = (a: Vec3, b: Vec3): boolean => a.x === b.x && a.y === b.y && a.z === b.z;
  return first.fog.density === second.fog.density && first.fog.skyFactor === second.fog.skyFactor && vector(first.fog.color, second.fog.color)
    && first.heightFog.density === second.heightFog.density && first.heightFog.falloff === second.heightFog.falloff
    && first.heightFog.startDistance === second.heightFog.startDistance && first.heightFog.endDistance === second.heightFog.endDistance
    && vector(first.heightFog.startColor, second.heightFog.startColor) && vector(first.heightFog.endColor, second.heightFog.endColor);
}
