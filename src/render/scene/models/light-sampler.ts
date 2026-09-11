/* R_LightPoint/RecursiveLightPoint from Q1/Q2 and entity grids from Q3.
 * Copyright (C) 1996-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { Plane, Vec3 } from "../../../contracts/math.ts";
import type { BspChild, SceneEntity } from "../../../contracts/scene.ts";
import { add3, dot3, length3, normalize3, scale3, sub3 } from "../../../core/math.ts";
import { parseEntities } from "../../../formats/q3-map/index.ts";
import { lightmapCoordinates } from "../../../materials/lighting.ts";
import type { LightmapFace } from "../../../materials/lighting.ts";
import { q2LightGridPoint } from "../../../materials/q2-lightgrid.ts";
import { lightForPoint, prepareLightGrid, setupEntityLighting } from "../../../materials/q3-lighting.ts";
import type { EntityLighting, LightGrid } from "../../../materials/q3-lighting.ts";
import type { WorldScene, WorldViewInput } from "../world.ts";
import { prepareBrushFace } from "../geometry.ts";

export interface ModelLightSample {
  /** Normalized, unclamped RGB. Fullbright maps return one in every channel. */
  readonly color: Vec3;
  readonly floor: { readonly point: Vec3; readonly plane: Plane } | null;
}

const black: Vec3 = { x: 0, y: 0, z: 0 }, white: Vec3 = { x: 1, y: 1, z: 1 };
const q2DefaultStyles = Array.from({ length: 256 }, () => ({ rgb: white, white: 3 }));

export class ModelLightSampler {
  readonly grid: LightGrid | null;
  private readonly unlitFaces = new Map<number, LightmapFace>();

  constructor(readonly world: WorldScene) {
    const map = world.map;
    this.grid = map.kind === "q3-bsp" ? prepareLightGrid({ lightGrid: map.lightGrid, models: map.models, entityRecords: parseEntities(map.entities) },
      { mapOverbrightBits: world.options.q3LightmapOverbright ?? 2, overbrightBits: 0 }).grid : null;
    if (map.kind !== "q3-bsp") for (const surface of world.surfaces) {
      if (surface.kind !== "legacy" || surface.lightmap !== null) continue;
      const ordinary = surface.material.kind === "q1" ? ["ordinary", "fence"].includes(surface.material.surface) : (surface.material.surfaceFlags & (4 | 8)) === 0;
      const face = map.faces[surface.index];
      if (ordinary && face !== undefined) this.unlitFaces.set(surface.index, prepareBrushFace(map, face, surface.index, { x: 1, y: 1 }, false).lightmap);
    }
  }

  sample(point: Vec3, input: WorldViewInput, includeDynamic = true): ModelLightSample {
    const map = this.world.map;
    if (map.kind === "q3-bsp") {
      const light = lightForPoint(this.grid, point, { ambientScale: 1, directedScale: 1 });
      const color = light === null ? white : scale3(add3(light.ambientLight, light.directedLight), 1 / 255);
      return { color: includeDynamic ? this.dynamic(color, point, input) : color, floor: null };
    }
    if (map.lighting.samples.length === 0) return { color: white, floor: null };
    const trace = (child: BspChild, start: Vec3, end: Vec3): ModelLightSample | null => {
      if (child.kind === "leaf") return null;
      const node = map.nodes[child.index];
      if (node === undefined) throw new RangeError(`Missing light-trace BSP node ${child.index}`);
      const plane = map.planes[node.plane];
      if (plane === undefined) throw new RangeError(`Missing light-trace BSP plane ${node.plane}`);
      const front = dot3(start, plane.normal) - plane.distance, back = dot3(end, plane.normal) - plane.distance;
      const side = front < 0 ? 1 : 0;
      if ((back < 0 ? 1 : 0) === side) return trace(node.children[side], start, end);
      const fraction = front / (front - back), middle = add3(start, scale3(sub3(end, start), fraction));
      const near = trace(node.children[side], start, middle);
      if (near !== null) return near;
      for (let i = 0; i < node.faces.count; i++) {
        const surface = this.world.surfaces[node.faces.first + i];
        if (surface === undefined || surface.kind !== "legacy") continue;
        const face = surface.lightmap?.face ?? this.unlitFaces.get(surface.index);
        if (face === undefined) continue;
        const coordinates = lightmapCoordinates(middle, face.projection);
        // Classic R_LightPoint truncates world texture coordinates before subtracting texturemins.
        const uv = face.projection.kind === "classic" ? {
          x: (Math.trunc(dot3(middle, face.projection.texture.s) + face.projection.texture.s.w) - face.projection.textureMins.x) / 16,
          y: (Math.trunc(dot3(middle, face.projection.texture.t) + face.projection.texture.t.w) - face.projection.textureMins.y) / 16,
        } : coordinates;
        if (uv.x < 0 || uv.y < 0 || uv.x > face.width - 1 || uv.y > face.height - 1) continue;
        const lighting = face.lighting;
        if (lighting === null) return { color: black, floor: { point: middle, plane } };
        const pixel = Math.trunc(uv.y) * face.width + Math.trunc(uv.x), channels = lighting.kind === "rgb8" ? 3 : 1;
        let r = 0, g = 0, b = 0;
        for (const [layer, style] of face.styles.entries()) {
          if (style === 255) break;
          const offset = face.offset + (layer * face.width * face.height + pixel) * channels;
          const red = lighting.samples[offset] ?? 0, green = lighting.samples[offset + (channels === 3 ? 1 : 0)] ?? 0,
            blue = lighting.samples[offset + (channels === 3 ? 2 : 0)] ?? 0;
          if (map.kind === "q1-bsp") { const value = input.q1Styles?.[style] ?? 256; r += red * value; g += green * value; b += blue * value; }
          else { const value = input.q2Styles?.[style]?.rgb ?? white; r += red * value.x; g += green * value.y; b += blue * value.z; }
        }
        const color = map.kind === "q1-bsp" ? { x: (r >> 8) / 255, y: (g >> 8) / 255, z: (b >> 8) / 255 }
          : { x: r / 255, y: g / 255, z: b / 255 };
        return { color, floor: { point: middle, plane } };
      }
      return trace(node.children[side === 0 ? 1 : 0], middle, end);
    };
    const hit = map.nodes.length === 0 ? null : trace({ kind: "node", index: 0 }, point, { ...point, z: point.z - 2048 });
    const grid = map.kind === "q2-bsp" && map.lightgrid !== null ? q2LightGridPoint(map.lightgrid, point, input.q2Styles ?? q2DefaultStyles) : null;
    const color = grid ?? hit?.color ?? black;
    return { color: includeDynamic ? this.dynamic(color, point, input) : color, floor: hit?.floor ?? null };
  }

  private dynamic(color: Vec3, point: Vec3, input: WorldViewInput): Vec3 {
    let result = color;
    for (const light of input.lights ?? []) {
      const amount = (light.radius - length3(sub3(point, light.origin))) / 256;
      if (amount > 0) result = add3(result, scale3(light.color, amount));
    }
    return result;
  }

  entityLighting(entity: SceneEntity, input: WorldViewInput, noWorldModel = false): EntityLighting {
    const identityLight = input.identityLight ?? 1;
    const axis = entity.transform.axis.map((value, index) => scale3(value,
      index === 0 ? entity.transform.scale.x : index === 1 ? entity.transform.scale.y : entity.transform.scale.z));
    const [forward, left, up] = axis;
    if (forward === undefined || left === undefined || up === undefined) throw new Error("Model lost its three axes");
    if (this.world.map.kind === "q3-bsp" || noWorldModel) return setupEntityLighting({ origin: entity.transform.origin,
      lightingOrigin: entity.lightingOrigin, axis: [forward, left, up], renderFlags: entity.flags.kind === "q3" ? entity.flags.bits : 0 },
    { grid: this.grid, ambientScale: 1, directedScale: 1, noWorldModel, identityLight, identityLightByte: Math.trunc(identityLight * 255),
      sunDirection: this.world.shaders.sun?.direction ?? normalize3({ x: 0.45, y: 0.3, z: 0.9 }), dynamicLights: input.q3Lights ?? [] });
    const point = entity.flags.kind === "q3" && (entity.flags.bits & 128) !== 0 ? entity.lightingOrigin : entity.transform.origin;
    // Foreign lightmaps carry RGB irradiance, without Q3's separate directional lobe.
    const color = this.sample(point, input).color;
    const ambientLight = { x: Math.min(identityLight * 255, color.x * 255 + identityLight * 32),
      y: Math.min(identityLight * 255, color.y * 255 + identityLight * 32), z: Math.min(identityLight * 255, color.z * 255 + identityLight * 32) };
    return { ambientLight, directedLight: black, lightDir: { x: 0, y: 0, z: 1 },
      ambientLightInt: ((Math.trunc(ambientLight.x) & 255) | ((Math.trunc(ambientLight.y) & 255) << 8) | ((Math.trunc(ambientLight.z) & 255) << 16) | 0xff000000) >>> 0 };
  }
}
