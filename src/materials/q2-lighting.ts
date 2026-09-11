/* q2repro calc_dynamic_lights, ported through quake-2-re-ts gl_shader.ts.
 * Copyright (C) Id Software and contributors. GPL-2.0-or-later. */
import type { Vec3 } from "../contracts/math.ts";
import { vec3 } from "../core/math.ts";

import type { Q2FragmentLight } from "../contracts/render.ts";
export type DynamicLightSample = Omit<Q2FragmentLight, "shadow">;

export function pointLightFalloff(distance: number, radius: number): number {
  const effectiveRadius = radius + 64;
  return Math.max(effectiveRadius - distance - 64, 0) / effectiveRadius;
}

export function spotConeAttenuation(direction: Vec3, coneDirection: Vec3, coneCos: number): number {
  const magnitude = -(direction.x * coneDirection.x + direction.y * coneDirection.y + direction.z * coneDirection.z);
  if (coneCos >= 1) return 0;
  return Math.max(1 - (1 - magnitude) * (1 / (1 - coneCos)), 0);
}

/** Point lights shift 16 units along the normal; negative red bypasses Lambert. */
export function calcDynamicLightContribution(light: DynamicLightSample, position: Vec3, normal: Vec3): Vec3 {
  const lightPosition = light.cone !== null ? light.origin
    : vec3(light.origin.x + normal.x * 16, light.origin.y + normal.y * 16, light.origin.z + normal.z * 16);
  const delta = vec3(lightPosition.x - position.x, lightPosition.y - position.y, lightPosition.z - position.z);
  const distance = Math.hypot(delta.x, delta.y, delta.z), falloff = pointLightFalloff(distance, light.radius), inverseDistance = 1 / Math.max(distance, 1);
  const direction = vec3(delta.x * inverseDistance, delta.y * inverseDistance, delta.z * inverseDistance);
  const lambert = light.color.x < 0 ? 1 : Math.max(direction.x * normal.x + direction.y * normal.y + direction.z * normal.z, 0);
  let scale = falloff * lambert * light.scale;
  if (light.cone !== null) scale *= spotConeAttenuation(direction, light.cone.direction, light.cone.cosHalfAngle);
  return vec3(light.color.x * scale, light.color.y * scale, light.color.z * scale);
}
