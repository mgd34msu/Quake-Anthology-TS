import type { Rect, SceneCamera } from "../../contracts/render.ts";
import type { ModelTransform } from "../../contracts/scene.ts";
import type { Axis, Vec3 } from "../../contracts/math.ts";
import { add3, dot3, scale3, sub3 } from "../../core/math.ts";
import type { SimulationPresentation } from "./simulation/types.ts";

export interface ViewWeaponEntity {
  readonly transform: ModelTransform;
  readonly previousOrigin: Vec3;
  readonly lightingOrigin: Vec3;
  readonly shadowPlane: number;
}

/** Translate a tick-authored first-person weapon to the eye actually being rendered. */
export function anchoredViewWeapon<T extends ViewWeaponEntity>(entity: T, anchor: Vec3, camera: Vec3): T {
  const delta = sub3(camera, anchor);
  if (delta.x === 0 && delta.y === 0 && delta.z === 0) return entity;
  const offset = (value: Vec3): Vec3 => add3(value, delta);
  return { ...entity, transform: { ...entity.transform, origin: offset(entity.transform.origin) },
    previousOrigin: offset(entity.previousOrigin), lightingOrigin: offset(entity.lightingOrigin),
    shadowPlane: entity.shadowPlane + delta.z };
}

/** Re-express a gun axis authored against `anchor` eye axes in the final camera axes. */
export function anchoredViewWeaponAxis(axis: Axis, anchor: Axis, camera: Axis): Axis {
  const rotate = (vector: Vec3): Vec3 => add3(add3(scale3(camera[0], dot3(vector, anchor[0])),
    scale3(camera[1], dot3(vector, anchor[1]))), scale3(camera[2], dot3(vector, anchor[2])));
  return [rotate(axis[0]), rotate(axis[1]), rotate(axis[2])];
}

/** Q1 V_CalcRefdef's default viewsize 100 gun calibration precedes camera punch. */
export function weaponViewOrigin(source: SimulationPresentation): Vec3 {
  return source.viewWeapon && source.family === "q1" ? { ...source.origin, z: source.origin.z + 2 } : source.origin;
}

/** Keep horizontal scale and the world viewport; move the weapon projection above the active HUD. */
export function weaponViewCamera(camera: SceneCamera, occupied: readonly Rect[]): SceneCamera {
  const area = camera.viewport;
  let bottom = area.y + area.height;
  for (const rect of occupied) if (rect.width > 0 && rect.height > 0 && rect.x < area.x + area.width && rect.x + rect.width > area.x
    && rect.y + rect.height > area.y + area.height / 2) bottom = Math.min(bottom, Math.max(area.y, rect.y));
  if (bottom === area.y + area.height || bottom <= area.y) return camera;
  const offset = (area.y + area.height - bottom) / area.height;
  // Equivalent to a shorter viewport with the same horizontal FOV, expressed in the full seat viewport.
  const p = camera.projection;
  return { ...camera, projection: [p[0], p[1] + offset * p[3], p[2], p[3], p[4], p[5] + offset * p[7], p[6], p[7],
    p[8], p[9] + offset * p[11], p[10], p[11], p[12], p[13] + offset * p[15], p[14], p[15]] };
}
