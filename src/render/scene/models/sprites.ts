/* Q1 r_sprite.c and Q2 gl_rmain.c sprite placement. GPL-2.0-or-later. */
import type { Axis, Vec3, Vec4 } from "../../../contracts/math.ts";
import type { SceneCamera } from "../../../contracts/render.ts";
import type { ModelTransform, Q1SpriteModel, SpriteFrame } from "../../../contracts/scene.ts";
import { add3, dot3, normalize3, scale3, sub3 } from "../../../core/math.ts";
import type { MaterialGeometry, MaterialVertex } from "../../../materials/geometry.ts";

export function q1SpriteAxes(model: Q1SpriteModel, transform: ModelTransform, camera: SceneCamera, roll = 0): Axis | null {
  const right = scale3(camera.axis[1], -1), up = camera.axis[2];
  switch (model.orientation) {
    case 0: {
      const direction = normalize3(sub3(transform.origin, camera.origin));
      if (Math.abs(direction.z) > 0.999848) return null;
      const r = normalize3({ x: direction.y, y: -direction.x, z: 0 });
      return [{ x: -r.y, y: r.x, z: 0 }, scale3(r, -1), { x: 0, y: 0, z: 1 }];
    }
    case 1: {
      const direction = camera.axis[0];
      if (Math.abs(direction.z) > 0.999848) return null;
      const r = normalize3({ x: direction.y, y: -direction.x, z: 0 });
      return [{ x: -r.y, y: r.x, z: 0 }, scale3(r, -1), { x: 0, y: 0, z: 1 }];
    }
    case 2: return camera.axis;
    case 3: return transform.axis;
    case 4: {
      const radians = roll * Math.PI / 180, sine = Math.sin(radians), cosine = Math.cos(radians);
      return [camera.axis[0], scale3(add3(scale3(right, cosine), scale3(up, sine)), -1),
        add3(scale3(right, -sine), scale3(up, cosine))];
    }
  }
}

export function spriteQuad(origin: Vec3, axis: Axis, extents: { readonly left: number; readonly right: number;
  readonly top: number; readonly bottom: number }, color: Vec4, mirror = false): MaterialGeometry {
  const right = scale3(axis[1], mirror ? 1 : -1), up = axis[2], normal = scale3(axis[0], -1);
  const vertex = (x: number, y: number, s: number, t: number): MaterialVertex => ({
    position: add3(add3(origin, scale3(right, x)), scale3(up, y)), normal,
    texCoord: { x: s, y: t }, lightmapCoord: { x: s, y: t }, color,
  });
  return { vertices: [vertex(extents.left, extents.top, 0, 0), vertex(extents.right, extents.top, 1, 0),
    vertex(extents.right, extents.bottom, 1, 1), vertex(extents.left, extents.bottom, 0, 1)], indices: [0, 1, 3, 3, 1, 2] };
}

export function q1SpriteGeometry(model: Q1SpriteModel, frame: SpriteFrame, transform: ModelTransform,
  camera: SceneCamera, color: Vec4, roll = 0): MaterialGeometry {
  const axis = q1SpriteAxes(model, transform, camera, roll);
  if (axis === null) return { vertices: [], indices: [] };
  // R_RotateSprite displaces the poster along its forward axis by beamlength.
  const origin = add3(transform.origin, scale3(axis[0], -model.beamLength));
  if (dot3(axis[0], sub3(camera.origin, origin)) >= 0) return { vertices: [], indices: [] };
  return spriteQuad(origin, axis, { left: frame.originX * transform.scale.x, right: (frame.originX + frame.width) * transform.scale.x,
    top: frame.originY * transform.scale.z, bottom: (frame.originY - frame.height) * transform.scale.z }, color,
  camera.clip.kind === "portal" && camera.clip.mirror);
}
