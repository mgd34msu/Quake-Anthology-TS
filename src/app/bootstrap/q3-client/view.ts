import type { Mat4 } from "../../../contracts/math.ts";
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
