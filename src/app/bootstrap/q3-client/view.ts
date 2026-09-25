import type { Q3AdmittedRefEntity } from "../../../content/q3/presentation/ref-entity.ts";
import type { SceneEntity } from "../../../contracts/scene.ts";
import type { Vec3, Mat4 } from "../../../contracts/math.ts";
import type { SceneCamera } from "../../../contracts/render.ts";

/** Keep the original weapon's vertical framing inside a wide split-screen seat. */
export function q3WeaponCamera(camera: SceneCamera, splitScreen: boolean): SceneCamera {
  const aspect = camera.viewport.width / camera.viewport.height;
  if (!splitScreen || aspect <= 4 / 3 || camera.clip.kind === "portal") return camera;
  const scale = (4 / 3) / aspect, source = camera.projection;
  const projection: Mat4 = [Math.fround(source[0] * scale), source[1], source[2], source[3],
    source[4], Math.fround(source[5] * scale), source[6], source[7],
    source[8], source[9], source[10], source[11], source[12], source[13], source[14], source[15]];
  return { ...camera, projection };
}

/** Keep the original first-person mesh attached to its translated camera. */
export function offsetQ3ViewEntity(entity: SceneEntity, delta: Vec3 | undefined): SceneEntity {
  if (delta === undefined) return entity;
  const offset = (value: Vec3): Vec3 => ({ x: value.x + delta.x, y: value.y + delta.y, z: value.z + delta.z });
  return { ...entity, transform: { ...entity.transform, origin: offset(entity.transform.origin) },
    previousOrigin: offset(entity.previousOrigin), lightingOrigin: offset(entity.lightingOrigin), shadowPlane: entity.shadowPlane + delta.z,
    attachments: entity.attachments.map(part => ({ ...part, entity: offsetQ3ViewEntity(part.entity, delta) })) };
}

export function offsetQ3ViewReference(entity: Q3AdmittedRefEntity, delta: Vec3 | undefined): Q3AdmittedRefEntity {
  if (delta === undefined || entity.kind === "poly" || entity.kind === "portal-surface") return entity;
  const offset = (value: Vec3): Vec3 => ({ x: value.x + delta.x, y: value.y + delta.y, z: value.z + delta.z });
  if (entity.kind === "model") return { ...entity, origin: offset(entity.origin), oldOrigin: offset(entity.oldOrigin),
    lightingOrigin: offset(entity.lightingOrigin), shadowPlane: entity.shadowPlane + delta.z };
  return entity.kind === "sprite" ? { ...entity, origin: offset(entity.origin) }
    : { ...entity, origin: offset(entity.origin), oldOrigin: offset(entity.oldOrigin) };
}
