/* q2repro calc_dynamic_lights, ported through the reference port gl_shader.ts.
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
  const out = vec3(0, 0, 0);
  calcDynamicLightContributionInto(out, light, position, normal);
  return out;
}

/** Allocation-free form for per-fragment loops; identical arithmetic. */
export function calcDynamicLightContributionInto(out: { x: number; y: number; z: number }, light: DynamicLightSample, position: Vec3, normal: Vec3): void {
  const lightX = light.cone !== null ? light.origin.x : light.origin.x + normal.x * 16;
  const lightY = light.cone !== null ? light.origin.y : light.origin.y + normal.y * 16;
  const lightZ = light.cone !== null ? light.origin.z : light.origin.z + normal.z * 16;
  const deltaX = lightX - position.x, deltaY = lightY - position.y, deltaZ = lightZ - position.z;
  // Exact zero skips: falloff is zero beyond the radius, and the Lambert term
  // is zero when the unnormalized dot is negative beyond any rounding the
  // normalized dot could add. The 2^-40 relative margins dwarf that rounding
  // (a few ulp), so skipped fragments are exactly the full path's zeros.
  if (Number.isFinite(light.scale)) {
    const radius = light.radius;
    if (radius >= 0 && deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ > radius * radius * (1 + 2 ** -40)) {
      out.x = 0; out.y = 0; out.z = 0;
      return;
    }
    if (light.color.x >= 0) {
      const termX = deltaX * normal.x, termY = deltaY * normal.y, termZ = deltaZ * normal.z;
      const dot = termX + termY + termZ;
      if (dot < -(Math.abs(termX) + Math.abs(termY) + Math.abs(termZ)) * 2 ** -40) {
        out.x = 0; out.y = 0; out.z = 0;
        return;
      }
    }
  }
  const distance = Math.hypot(deltaX, deltaY, deltaZ), falloff = pointLightFalloff(distance, light.radius), inverseDistance = 1 / Math.max(distance, 1);
  const directionX = deltaX * inverseDistance, directionY = deltaY * inverseDistance, directionZ = deltaZ * inverseDistance;
  const lambert = light.color.x < 0 ? 1 : Math.max(directionX * normal.x + directionY * normal.y + directionZ * normal.z, 0);
  let scale = falloff * lambert * light.scale;
  if (light.cone !== null) scale *= spotConeAttenuation({ x: directionX, y: directionY, z: directionZ }, light.cone.direction, light.cone.cosHalfAngle);
  out.x = light.color.x * scale; out.y = light.color.y * scale; out.z = light.color.z * scale;
}
