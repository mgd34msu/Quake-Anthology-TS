/* Q2 rerelease flare fan, adapted from q2repro tess.c. GPL-2.0-or-later. */
import type { SceneFlare } from "../../contracts/flare.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { DrawBatch, RendererImage, SceneCamera } from "../../contracts/render.ts";
import { add3, cross3, dot3, length3, normalize3, scale3, sub3 } from "../../core/math.ts";
import type { MaterialGeometry, MaterialVertex } from "../../materials/geometry.ts";
import { createViewProjector } from "./view.ts";

export function defaultFlareImage(path: string): boolean {
  const name = path.toLowerCase().replaceAll("\\", "/");
  return name === "misc/flare.tga" || name.startsWith("sprites/psx_flare");
}

export function flareGeometry(flare: SceneFlare, origin: Vec3, camera: SceneCamera, imagePath: string): MaterialGeometry {
  const delta = sub3(origin, camera.origin), distance = length3(delta);
  if (distance < flare.fadeStart) return { vertices: [], indices: [] };
  const fraction = distance >= flare.fadeEnd ? 1 : (distance - flare.fadeStart) / (flare.fadeEnd - flare.fadeStart);
  const standard = defaultFlareImage(imagePath), size = (standard ? 50 : 25) * flare.scale;
  const direction = normalize3(delta);
  const rotated = { x: direction.z, y: -direction.x, z: direction.y };
  const right = flare.lockAngle ? scale3(camera.axis[1], -1) : normalize3(sub3(rotated, scale3(direction, dot3(rotated, direction))));
  const up = flare.lockAngle ? camera.axis[2] : cross3(right, direction);
  const alpha = Math.trunc((standard ? 160 : 128) * fraction);
  const vertex = (horizontal: number, vertical: number, s: number, t: number, color: Vec3): MaterialVertex => ({
    position: add3(origin, add3(scale3(right, horizontal * size), scale3(up, vertical * size))), normal: scale3(direction, -1),
    texCoord: { x: s, y: t }, lightmapCoord: { x: 0, y: 0 }, color: { ...color, w: alpha },
  });
  const rim = flare.rimColor ?? flare.color;
  return { vertices: [vertex(0, 0, 0.5, 0.5, flare.color), vertex(-1, -1, 0, 1, rim), vertex(-1, 1, 0, 0, rim),
    vertex(1, 1, 1, 0, rim), vertex(1, -1, 1, 1, rim)], indices: [0, 2, 3, 0, 3, 4, 0, 4, 1, 0, 1, 2] };
}

export function prepareFlare(flare: SceneFlare, origin: Vec3, camera: SceneCamera, image: RendererImage, imagePath: string): DrawBatch {
  const geometry = flareGeometry(flare, origin, camera, imagePath), project = createViewProjector(camera);
  return { primitive: "triangles", texturing: "single", lighting: { kind: "vertex" }, indices: geometry.indices,
    ...(defaultFlareImage(imagePath) ? { textureEffect: "luminance-alpha" } : {}),
    vertices: geometry.vertices.map(vertex => ({ ...vertex, position: project(vertex.position), color: {
      x: vertex.color.x / 255, y: vertex.color.y / 255, z: vertex.color.z / 255, w: vertex.color.w / 255,
    } })), texture: { kind: "bind-image", image }, state: {
      blend: { source: "src-alpha", destination: "one" }, depthTest: "less-equal", depthWrite: false,
      alphaTest: "none", cull: "none", depthRange: [0, 1], polygonOffset: null,
    } };
}
