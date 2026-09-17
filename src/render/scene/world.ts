import type { RegisteredSceneMaterial, ShaderWorldIdentity } from "./material-registrations.ts";
import { compiledDrawGroup, createSourceSceneOrder, sourceDrawGroup, sequenceDrawGroup, finishSceneOperations } from "./submissions.ts";
import type { SceneOperation, SourceEntityOrder, SourceSceneOrder, SourceSurfaceOrder } from "./submissions.ts";
/* Unified world preparation uses Q1/Q2 brush surfaces and Q3 tr_bsp/tr_world.
 * Copyright (C) 1996-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { Bounds, Plane, Vec3 } from "../../contracts/math.ts";
import type { DecodedWorld, Q3WorldGeometry, SceneLight } from "../../contracts/scene.ts";
import type { DrawBatch, ImageResourceOperation, Q2FragmentLight, Q2ShadowAtlas, RenderOperation, RendererImage, RenderView, SceneCamera, SceneFog, SurfaceLighting } from "../../contracts/render.ts";
import type { CompiledMaterial } from "../../materials/compile.ts";
import { prepareMaterialBatches, evaluateMaterialPasses } from "../../materials/evaluate.ts";
import type { MaterialDrawContext } from "../../materials/evaluate.ts";
import type { MaterialGeometry } from "../../materials/geometry.ts";
import { RendererNoise } from "../../materials/deform.ts";
import { createQ1Material, createQ2Material, prepareLegacyMaterialBatches, q1AnimatedTexture, q1SkyTexCoords, q1SurfaceKind, q1TextureAnimations, splitQ1SkyTexture, splitQ64SkyTexture } from "../../materials/legacy.ts";
import type { Q1Material, Q2Material } from "../../materials/legacy.ts";
import { buildQ1Lightmap, buildQ2Lightmap, directLightmapPixels } from "../../materials/lighting.ts";
import type { LightmapFace, Q1LightmapEncoding, Q2LightStyle, SurfaceDynamicLight } from "../../materials/lighting.ts";
import { fogSceneOperations } from "./q1-fog.ts";
import { createFogTexture, fogCoordinates, prepareFogVolume } from "../../materials/fog.ts";
import type { FogVolume } from "../../materials/fog.ts";
import { SKY_FACE_SUFFIXES } from "../../materials/sky.ts";
import { add3, cross3, dot3, length3, normalize3, scale3, sub3 } from "../../core/math.ts";
import { geometryBounds, prepareBrushFace } from "./geometry.ts";
import { tessellatePatch } from "./patch.ts";
import { createPatchGrid, preparePatchGrids, selectPatchLod } from "./patch-lod.ts";
import type { PatchGrid } from "./patch-lod.ts";
import { rgbaImage } from "./resources.ts";
import { SceneShaderRegistry } from "./shaders.ts";
import type { SceneTexture } from "./textures.ts";
import { boundsInFrustum, cameraFrustum, createViewProjector, farClip, portalClipPlane, worldPoint, localPoint, modelScale, worldVector } from "./view.ts";
import type { ModelTransform } from "./view.ts";
import { visibleWorld } from "./visibility.ts";
import type { VisibleWorld, WorldVisibilityOptions } from "./visibility.ts";
import { portalCamera, portalSurfaceOffscreen } from "./portal.ts";
import type { PortalEntity } from "./portal.ts";
import { bmodelDlightMask, faceDlightMask, gridDlightMask, transformDlights, projectDlightTexture, receivesProjectedDlights } from "../../materials/dlight.ts";
import type { DynamicLight } from "../../materials/q3-lighting.ts";
import { Q2ShadowScene, StaticShadowWorld, shadowCaster, shadowMesh } from "./shadows.ts";
import type { PreparedShadows, ShadowAtlasOptions, ShadowCaster, ShadowMesh } from "./shadows.ts";
import { shadowMaterialGeometry } from "./shadow-geometry.ts";
import { q2SkySides } from "./q2-sky.ts";
import type { Q2SkyView } from "./q2-sky.ts";

interface SurfaceBase {
  readonly index: number;
  readonly bounds: Bounds;
  readonly plane: Plane | null;
  readonly geometry: MaterialGeometry;
}
export type WorldSurface = SurfaceBase & (
  { readonly kind: "q3"; readonly shader: RegisteredSceneMaterial; readonly lightmap: RendererImage | null;
      readonly grid: PatchGrid | null; readonly fog: FogVolume | null; readonly fogIndex: number; readonly flare: boolean; readonly skip: boolean }
  | { readonly kind: "legacy"; readonly shader: RegisteredSceneMaterial | null; readonly material: Q1Material | Q2Material; readonly fullbright: RendererImage | null;
      readonly lightmap: { readonly face: LightmapFace; readonly image: RendererImage; readonly direct: RendererImage; readonly encoding: Q1LightmapEncoding } | null;
      readonly q1Sky: { readonly solid: RendererImage; readonly overlay: RendererImage } | null }
);

export interface WorldSceneOptions {
  readonly subdivisions?: number;
  readonly q3LightmapOverbright?: number;
  readonly q1LightmapEncoding?: Q1LightmapEncoding;
  readonly q1WaterAlpha?: number;
  readonly q2SkyName?: string;
  readonly q2LightModulate?: number;
}
export interface WorldSurfaceAdmission {
  readonly view: SourceSceneOrder;
  readonly submittedSurfaces: Map<WorldScene, Set<number>>;
  readonly worldOperations: Map<WorldScene, readonly SceneOperation[]>;
}
/** One context owns one accepted view after its camera and lights are finalized. */
export function createWorldSurfaceAdmission(view: SourceSceneOrder): WorldSurfaceAdmission {
  return { view, submittedSurfaces: new Map<WorldScene, Set<number>>(), worldOperations: new Map<WorldScene, readonly SceneOperation[]>() };
}
export interface WorldViewInput extends WorldVisibilityOptions {
  readonly source?: WorldSurfaceAdmission;
  readonly camera: SceneCamera;
  readonly target: RenderView["target"];
  readonly time: RenderView["time"];
  readonly clear?: RenderView["clear"];
  readonly q1Styles?: readonly number[];
  readonly q2Styles?: readonly Q2LightStyle[];
  readonly lights?: readonly SurfaceDynamicLight[];
  readonly q2FragmentLighting?: { readonly lights: readonly Q2FragmentLight[]; readonly atlas: Q2ShadowAtlas | null };
  readonly q1Fog?: Extract<SceneFog, { readonly kind: "q1" }>;
  readonly q2Fog?: Extract<SceneFog, { readonly kind: "q2" }>;
  readonly q2Sky?: Q2SkyView;
  readonly q3Lights?: readonly DynamicLight[];
  readonly animationFrame?: number;
  readonly alternateAnimation?: boolean;
  readonly curveError?: number;
  readonly identityLight?: number;
  readonly renderText?: readonly string[];
  readonly operations?: readonly SceneOperation[];
  readonly beforeView?: readonly RenderOperation[];
  /** Entity lighting, video upload, shadows and private game overlays join here. */
  readonly materialContext?: Partial<Pick<MaterialDrawContext, "lighting" | "entityRGBA" | "projectionShadow">>;
  readonly inlineModels?: readonly { readonly model: number; readonly transform: ModelTransform; readonly animationFrame?: number; readonly alternateAnimation?: boolean; readonly castsShadow?: boolean; readonly entityRGBA?: MaterialDrawContext["entityRGBA"] }[];
  readonly prepareFlare?: (surface: WorldSurface, context: MaterialDrawContext) => readonly RenderOperation[];
}
export interface PreparedWorldView {
  readonly view: RenderView;
  readonly visibility: VisibleWorld;
  readonly imageOperations: readonly ImageResourceOperation[];
}

function at<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) throw new RangeError(`Scene world index ${index} outside ${items.length}`);
  return value;
}

function q3Lightmap(bytes: Uint8Array, shift: number) {
  if (bytes.length !== 128 * 128 * 3) throw new RangeError("Q3 lightmap must contain 128x128 RGB samples");
  const pixels = new Uint8Array(128 * 128 * 4);
  for (let pixel = 0; pixel < 128 * 128; pixel++) {
    let r = (bytes[pixel * 3] ?? 0) << shift, g = (bytes[pixel * 3 + 1] ?? 0) << shift, b = (bytes[pixel * 3 + 2] ?? 0) << shift;
    const maximum = Math.max(r, g, b);
    if (maximum > 255) { r = Math.trunc(r * 255 / maximum); g = Math.trunc(g * 255 / maximum); b = Math.trunc(b * 255 / maximum); }
    pixels.set([r, g, b, 255], pixel * 4);
  }
  return { width: 128, height: 128, pixels };
}

const q1DefaultStyles: readonly number[] = Array.from({ length: 256 }, () => 256);
const q2DefaultStyles: readonly Q2LightStyle[] = Array.from({ length: 256 }, () => ({ rgb: { x: 1, y: 1, z: 1 }, white: 3 }));

export class WorldScene {
  surfaces: readonly WorldSurface[];
  readonly bounds: Bounds;
  fogImage: RendererImage;
  dlightImage: RendererImage;
  readonly noise = new RendererNoise();
  fogSelections: readonly { readonly index: number; readonly volume: FogVolume }[] = [];
  readonly materialWorld: ShaderWorldIdentity;
  private shadowScene: Q2ShadowScene;
  private readonly owned: RendererImage[] = [];
  private q2Sky: readonly RendererImage[] = [];
  private fullbrightByTexture = new Map<RendererImage, RendererImage | null>();
  private readonly remapped = new Map<RegisteredSceneMaterial, { readonly shader: RegisteredSceneMaterial; readonly timeOffset: number }>();
  private readonly staticLightStyles = new Map<WorldSurface, readonly number[]>();
  private staticShadowWorld: { readonly surfaces: readonly WorldSurface[]; readonly first: number; readonly count: number; readonly world: StaticShadowWorld } | null = null;

  private constructor(readonly map: DecodedWorld, readonly shaders: SceneShaderRegistry,
    surfaces: readonly WorldSurface[], readonly options: WorldSceneOptions) {
    this.surfaces = surfaces;
    this.materialWorld = shaders.registrations.owner.world(map);
    this.shadowScene = new Q2ShadowScene(shaders.textures.images);
    this.bounds = map.models[0]?.bounds ?? geometryBounds(map.kind === "q3-bsp" ? map.vertices : map.vertices.map(position => ({ position })));
    this.fogImage = shaders.textures.images.register("*fog", rgbaImage(createFogTexture()), { wrap: "clamp", filter: "linear" });
    this.owned.push(this.fogImage);
    const dlight = new Uint8Array(16 * 16 * 4);
    for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) {
      const distance = (7.5 - x) * (7.5 - x) + (7.5 - y) * (7.5 - y);
      let brightness = Math.trunc(Math.fround(4000 / distance));
      if (brightness > 255) brightness = 255; else if (brightness < 75) brightness = 0;
      dlight.set([brightness, brightness, brightness, 255], (y * 16 + x) * 4);
    }
    this.dlightImage = shaders.textures.images.register("*dlight", rgbaImage({ width: 16, height: 16, pixels: dlight }), { wrap: "clamp", filter: "linear" });
    this.owned.push(this.dlightImage);
  }

  static async load(map: DecodedWorld, shaders: SceneShaderRegistry, options: WorldSceneOptions = {}): Promise<WorldScene> {
    const owned: RendererImage[] = [], surfaces: WorldSurface[] = [];
    const fullbrightByTexture = new Map<RendererImage, RendererImage | null>();
    const fogSelections: { readonly index: number; readonly volume: FogVolume }[] = [];
    const images = shaders.textures.images, materialWorld = shaders.registrations.owner.world(map);
    let result: WorldScene | null = null;
    try {
    const generated = (name: string, level: Parameters<typeof rgbaImage>[0], wrap: "clamp" | "repeat" = "clamp"): RendererImage => {
      const image = images.register(name, rgbaImage(level), { wrap, filter: "linear" }); owned.push(image); return image;
    };
    if (map.kind === "q3-bsp") {
      const lightmaps = map.lightmaps.map((bytes, index) => generated(`*q3-lightmap-${index}`, q3Lightmap(bytes, options.q3LightmapOverbright ?? 2)));
      const fogs: (FogVolume | null)[] = [];
      for (const [index, fog] of map.fogs.entries()) {
        const material = await shaders.register(fog.shader);
        fogs.push(fog.brush < 0 || material.material.fog === null ? null : prepareFogVolume({ ...map,
          brushes: map.brushes.map(brush => ({ firstSide: brush.sides.first, sideCount: brush.sides.count })) }, index, material.material.fog));
      }
      for (const [index, volume] of fogs.entries()) if (volume !== null) fogSelections.push({ index, volume });
      const patchOrdinals: number[] = [], patches: PatchGrid[] = [];
      for (const [index, surface] of map.surfaces.entries()) {
        const shader = at(map.shaders, surface.shader);
        const vertices = map.vertices.slice(surface.vertices.first, surface.vertices.first + surface.vertices.count).map(vertex => {
          const shift = options.q3LightmapOverbright ?? 2;
          const r = vertex.color.x << shift, g = vertex.color.y << shift, b = vertex.color.z << shift, maximum = Math.max(r, g, b);
          return { ...vertex, color: maximum > 255 ? { x: Math.trunc(r * 255 / maximum), y: Math.trunc(g * 255 / maximum), z: Math.trunc(b * 255 / maximum), w: vertex.color.w }
            : { x: r, y: g, z: b, w: vertex.color.w } };
        });
        const geometry: MaterialGeometry = { vertices, indices: map.indices.slice(surface.indices.first, surface.indices.first + surface.indices.count) };
        let plane: Plane | null = null, grid: PatchGrid | null = null;
        if (surface.kind === "patch" && (shader.surfaceFlags & 0x80) === 0) {
          grid = createPatchGrid(tessellatePatch(vertices, surface.width, surface.height, options.subdivisions ?? 4), [surface.lightmap.vectors[0], surface.lightmap.vectors[1]]);
          patchOrdinals.push(index); patches.push(grid);
        } else if (surface.kind === "planar") plane = { normal: surface.lightmap.vectors[2], distance: vertices[0] === undefined ? 0 : dot3(vertices[0].position, surface.lightmap.vectors[2]) };
        else if (vertices.length >= 3) {
          const a = at(vertices, 0).position, normal = normalize3(cross3(sub3(at(vertices, 1).position, a), sub3(at(vertices, 2).position, a)));
          plane = { normal, distance: dot3(a, normal) };
        }
        const lightmapIndex = surface.kind === "planar" || surface.kind === "patch" ? surface.lightmap.image : -3;
        const material = shaders.sourceWorldMaterial(await shaders.register(shader.name, { kind: "world", world: materialWorld,
          lightmap: lightmaps[lightmapIndex] ?? null, lightmapIndex, baseTexture: null }));
        const actual = grid?.mesh ?? geometry;
        surfaces.push({ kind: "q3", index, bounds: geometryBounds(actual.vertices), plane, geometry: actual, shader: material, lightmap: lightmaps[lightmapIndex] ?? null,
          grid, fog: surface.fog < 0 ? null : fogs[surface.fog] ?? null, fogIndex: surface.fog, flare: surface.kind === "flare",
          skip: surface.kind === "patch" && (shader.surfaceFlags & 0x80) !== 0 });
      }
      const stitched = preparePatchGrids(patches);
      for (const [index, ordinal] of patchOrdinals.entries()) {
        const surface = at(surfaces, ordinal), grid = at(stitched, index);
        if (surface.kind !== "q3") throw new Error("Q3 patch lost its material");
        surfaces[ordinal] = { ...surface, grid, geometry: grid.mesh, bounds: geometryBounds(grid.mesh.vertices) };
      }
    } else {
      const textures: SceneTexture[] = [];
      if (map.kind === "q1-bsp") {
        for (const texture of map.textures) {
          if (texture === null) textures.push(shaders.textures.missing);
          else textures.push(await shaders.textures.load(`textures/${texture.name}`, { family: "q1" })
            ?? shaders.textures.q1Embedded(texture) ?? shaders.textures.missing);
        }
      } else for (const info of map.textureInfo) textures.push(await shaders.textures.load(`textures/${info.name}`, { family: "q2", usage: "wall" }) ?? shaders.textures.missing);
      for (const texture of textures) fullbrightByTexture.set(texture.image, texture.fullbright);
      const skyLayers = new Map<RendererImage, { readonly solid: RendererImage; readonly overlay: RendererImage }>();
      for (const [index, face] of map.faces.entries()) {
        const info = at<Exclude<DecodedWorld, { readonly kind: "q3-bsp" }>["textureInfo"][number]>(map.textureInfo, face.textureInfo);
        const texture = at(textures, "texture" in info ? info.texture : face.textureInfo);
        const name = "name" in info ? info.name : map.kind === "q1-bsp" ? map.textures[info.texture]?.name ?? texture.name : texture.name;
        const warp = map.kind === "q1-bsp" ? name.startsWith("*") : (info.flags & 8) !== 0;
        const sky = map.kind === "q1-bsp" ? name.startsWith("sky") : (info.flags & 4) !== 0;
        const original = map.kind === "q1-bsp" && "texture" in info ? map.textures[info.texture] : null;
        const textureScale = original?.quake64Shift !== undefined && original.quake64Shift > 0 ? 2 * original.quake64Shift : 1;
        let prepared = prepareBrushFace(map, face, index, { x: original?.width ?? texture.width, y: original?.height ?? texture.height }, warp, map.kind === "q1-bsp" ? 128 : 64);
        if (!warp && !sky && textureScale !== 1) prepared = { ...prepared, geometry: { ...prepared.geometry,
          vertices: prepared.geometry.vertices.map(vertex => ({ ...vertex, texCoord: { x: vertex.texCoord.x / textureScale, y: vertex.texCoord.y / textureScale } })) } };
        let lightmap: Extract<WorldSurface, { readonly kind: "legacy" }>["lightmap"] = null;
        let lighting: SurfaceLighting = { kind: "unlit" };
        if (!sky && !warp && prepared.lightmap.lighting !== null) {
          const built = map.kind === "q1-bsp" ? buildQ1Lightmap(prepared.lightmap, q1DefaultStyles, { encoding: options.q1LightmapEncoding ?? "rgb" })
            : buildQ2Lightmap(prepared.lightmap, q2DefaultStyles, { modulate: options.q2LightModulate ?? 1 });
          const image = generated(`*${map.kind}-lightmap-${index}`, built.image), direct = generated(`*${map.kind}-direct-lightmap-${index}`, directLightmapPixels(built));
          lightmap = { face: prepared.lightmap, image, direct, encoding: map.kind === "q1-bsp" ? options.q1LightmapEncoding ?? "rgb" : "rgb" };
          const mapping = map.decoupledLightmaps?.[index];
          lighting = mapping === undefined ? { kind: "lightmap", image, styles: face.styles } : { kind: "decoupled-lightmap", image, styles: face.styles, mapping };
        }
        let material: Q1Material | Q2Material, q1Sky: Extract<WorldSurface, { readonly kind: "legacy" }>["q1Sky"] = null;
        if (map.kind === "q1-bsp") {
          material = createQ1Material(name, texture.image, lighting, { ...q1TextureAnimations(name, textures), alpha: warp ? options.q1WaterAlpha ?? 1 : 1 });
          if (q1SurfaceKind(name) === "sky" && texture.content.kind === "indexed8") {
            q1Sky = skyLayers.get(texture.image) ?? null;
            if (q1Sky === null) {
              const split = original?.quake64Shift === undefined ? splitQ1SkyTexture(texture.content) : splitQ64SkyTexture(texture.content);
              q1Sky = { solid: generated(`${name}:solid`, split.solid, "repeat"), overlay: generated(`${name}:overlay`, split.overlay, "repeat") };
              skyLayers.set(texture.image, q1Sky);
            }
          }
        } else {
          const frames: RendererImage[] = [], visited = new Set<number>();
          let next: number | null = face.textureInfo;
          while (next !== null && !visited.has(next)) { visited.add(next); frames.push(at(textures, next).image); next = at(map.textureInfo, next).next; }
          material = createQ2Material(name, frames, lighting, info.flags, "material" in info ? info.material : "");
        }
        const shaderName = `textures/${name}`;
        const shader = shaders.hasAuthored(shaderName) ? await shaders.register(shaderName, { kind: "world", world: materialWorld, lightmap: lightmap?.image ?? null, lightmapIndex: lightmap === null ? -1 : index, baseTexture: texture }) : null;
        surfaces.push({ kind: "legacy", shader, index, bounds: geometryBounds(prepared.geometry.vertices), plane: prepared.plane, geometry: prepared.geometry,
          material, fullbright: texture.fullbright, lightmap, q1Sky });
      }
    }
    result = new WorldScene(map, shaders, surfaces, options);
    result.fullbrightByTexture = fullbrightByTexture;
    result.fogSelections = fogSelections;
    result.owned.push(...owned);
    if (map.kind === "q2-bsp" && options.q2SkyName !== undefined) {
      const sides: RendererImage[] = [];
      for (const suffix of SKY_FACE_SUFFIXES) sides.push((await shaders.textures.load(`env/${options.q2SkyName}${suffix}`, { family: "q2", usage: "sky", wrap: "clamp", mipmap: false }) ?? shaders.textures.missing).image);
      result.q2Sky = sides;
    }
    return result;
    } catch (error) {
      if (result !== null) result.close();
      else for (const image of owned) images.release(image);
      throw error;
    }
  }

  materialContext(input: WorldViewInput, model?: ModelTransform, fog: FogVolume | null = null): MaterialDrawContext {
    const time = input.time.kind === "seconds" ? input.time.value : input.time.value / 1000;
    const localViewOrigin = model === undefined ? input.camera.origin : localPoint(input.camera.origin, model);
    const coordinate = fog === null ? null : fogCoordinates(fog, input.camera.origin, input.camera.axis[0]);
    return { ...(input.q1Fog === undefined ? {} : { q1Fog: { density: input.q1Fog.density, color: input.q1Fog.color, texture: { kind: "bind-image", image: this.shaders.textures.white.image } } }), time, timeOffset: 0, refdefTime: Math.trunc(time * 1000), identityLight: input.identityLight ?? 1,
      entityRGBA: input.materialContext?.entityRGBA ?? { x: 255, y: 255, z: 255, w: 255 }, lighting: input.materialContext?.lighting ??
        { ambientLight: { x: 0, y: 0, z: 0 }, directedLight: { x: 0, y: 0, z: 0 }, lightDir: { x: 0, y: 0, z: 0 }, ambientLightInt: 0 },
      viewOrigin: input.camera.origin, localViewOrigin, noise: this.noise, shaderTexCoord: { x: 0, y: 0 },
      deformView: { axis: input.camera.axis, mirror: input.camera.clip.kind === "portal" && input.camera.clip.mirror, entityAxis: model?.axis ?? null, nonNormalizedAxis: null },
      projectionShadow: input.materialContext?.projectionShadow ?? null, renderText: input.renderText ?? [], depthRange: [0, 1], polygonOffset: { factor: -1, units: -2 },
      fog: fog === null || coordinate === null ? null : { coordinates: model === undefined ? coordinate : point => coordinate(worldPoint(point, model)),
        texture: { kind: "bind-image", image: this.fogImage }, color: fog.color }, project: createViewProjector(input.camera, model) };
  }

  /** Inline and external BSP models share surface preparation and upload ownership. */
  prepareModel(modelIndex: number, transform: ModelTransform, input: WorldViewInput, entity?: SourceEntityOrder): readonly SceneOperation[] {
    const source = at<DecodedWorld["models"][number]>(this.map.models, modelIndex);
    const range = "surfaces" in source ? source.surfaces : source.faces;
    const context = this.materialContext(input, transform), operations: SceneOperation[] = [];
    const lights = input.q3Lights ?? [];
    if (lights.length > 32) throw new RangeError("Q3 world lighting supports the source 32-light mask");
    const scale = modelScale(transform), sourceInline = this.map.kind === "q3-bsp" && scale === 1 && input.source !== undefined && entity !== undefined;
    const transformed = sourceInline ? transformDlights(lights, transform.origin, transform.axis)
      : lights.map(light => ({ ...light, origin: localPoint(light.origin, transform), radius: light.radius / Math.abs(scale) }));
    const incoming = sourceInline ? Number(bmodelDlightMask(transformed, source.bounds) !== 0)
      : lights.length === 32 ? -1 : (1 << lights.length) - 1;
    if (this.map.kind === "q3-bsp" && input.noCull !== true && this.localBoxCulled(source.bounds, input.camera, transform)) return [];
    for (let offset = 0; offset < range.count; offset++) {
      const surface = at(this.surfaces, range.first + offset);
      if (input.source !== undefined && entity !== undefined) {
        if (!this.admitSurface(input.source, surface.index)) continue;
      }
      if (surface.kind === "q3" && this.surfaceCulled(surface, input, context, transform)) continue;
      const mask = this.frontendLightMask(surface, incoming, sourceInline ? lights : transformed);
      const order = input.source === undefined || entity === undefined ? undefined : this.sourceSurfaceOrder(surface, input.source, entity, mask);
      operations.push(...this.surfaceOperations(surface, input, context, transform, { mask, lights: transformed }, order));
    }
    return operations;
  }

  private localBoxCulled(bounds: Bounds, camera: SceneCamera, model?: ModelTransform): boolean {
    const corners: Vec3[] = [];
    for (let index = 0; index < 8; index++) {
      const x = (index & 1) === 0 ? bounds.min.x : bounds.max.x;
      const y = (index & 2) === 0 ? bounds.min.y : bounds.max.y;
      const z = (index & 4) === 0 ? bounds.min.z : bounds.max.z;
      const scale = model === undefined ? 1 : modelScale(model);
      corners.push(model === undefined ? { x, y, z } : add3(add3(add3(model.origin,
        scale3(model.axis[0], Math.fround(x * scale))), scale3(model.axis[1], Math.fround(y * scale))), scale3(model.axis[2], Math.fround(z * scale))));
    }
    return cameraFrustum(camera).slice(0, 4).some(plane => !corners.some(corner => dot3(corner, plane.normal) > plane.distance));
  }

  private surfaceCulled(surface: Extract<WorldSurface, { readonly kind: "q3" }>, input: WorldViewInput, context: MaterialDrawContext, model?: ModelTransform): boolean {
    if (input.noCull === true || surface.flare || surface.skip) return false;
    if (this.map.kind !== "q3-bsp") throw new Error("Q3 surface requires its BSP source");
    const source = at(this.map.surfaces, surface.index);
    if (source.kind === "triangles") return this.localBoxCulled(surface.bounds, input.camera, model);
    if (source.kind === "patch") {
      const center = scale3(add3(surface.bounds.min, surface.bounds.max), 0.5);
      const radius = Math.fround(length3(sub3(surface.bounds.min, center)) * (model === undefined ? 1 : Math.abs(modelScale(model))));
      const origin = model === undefined ? center : worldPoint(center, model);
      let clipped = false;
      for (const plane of cameraFrustum(input.camera).slice(0, 4)) {
        const distance = Math.fround(dot3(origin, plane.normal) - plane.distance);
        if (distance < -radius) return true;
        if (distance <= radius) clipped = true;
      }
      return clipped && this.localBoxCulled(surface.bounds, input.camera, model);
    }
    const shader = this.remapped.get(surface.shader)?.shader ?? surface.shader;
    if (source.kind !== "planar" || surface.plane === null || shader.material.cull === "none") return false;
    const viewer = dot3(context.localViewOrigin, surface.plane.normal), distance = surface.plane.distance;
    return shader.material.cull === "front" ? viewer < Math.fround(distance - 8) : viewer > Math.fround(distance + 8);
  }

  private frontendLightMask(surface: WorldSurface, incoming: number, lights: readonly DynamicLight[]): number {
    if (incoming === 0) return 0;
    if (surface.kind === "q3") {
      if (this.map.kind !== "q3-bsp") throw new Error("Q3 surface requires its BSP source");
      const source = at(this.map.surfaces, surface.index);
      if (source.kind === "flare" || surface.skip) return 0;
      if (source.kind === "triangles") return incoming;
      if (source.kind === "patch") return gridDlightMask(lights, incoming, surface.bounds);
    }
    return surface.plane === null ? gridDlightMask(lights, incoming, surface.bounds) : faceDlightMask(lights, incoming, surface.plane);
  }

  private admitSurface(source: WorldSurfaceAdmission, index: number): boolean {
    let submitted = source.submittedSurfaces.get(this);
    if (submitted === undefined) { submitted = new Set(); source.submittedSurfaces.set(this, submitted); }
    if (submitted.has(index)) return false;
    submitted.add(index);
    return true;
  }

  private sourceSurfaceOrder(surface: WorldSurface, source: WorldSurfaceAdmission, entity: SourceEntityOrder, mask: number): SourceSurfaceOrder {
    return { view: source.view, entity, surface: surface.index, fog: surface.kind === "q3" ? surface.fogIndex + 1 : 0, dlight: Number(mask !== 0) };
  }

  /** External and inline brush models use their real transformed, deformed surfaces. */
  shadowModel(modelIndex: number, transform: ModelTransform, input: WorldViewInput): ShadowCaster {
    const source = at<DecodedWorld["models"][number]>(this.map.models, modelIndex), range = "surfaces" in source ? source.surfaces : source.faces;
    const context = this.materialContext(input, transform), meshes: ShadowMesh[] = [];
    for (let index = range.first; index < range.first + range.count; index++) {
      const geometry = this.shadowGeometry(at(this.surfaces, index), context, true);
      if (geometry !== null) meshes.push({ positions: geometry.vertices.map(vertex => worldPoint(vertex.position, transform)), indices: geometry.indices });
    }
    return shadowCaster(transform.origin, meshes);
  }

  /** Prepare once before color/model submission; beforeView executes atlas work first. */
  prepareShadows(lights: readonly SceneLight[], input: WorldViewInput, casters: readonly ShadowCaster[] = [], options: ShadowAtlasOptions = {}): PreparedShadows {
    const source = this.map.models[0], range = source === undefined ? { first: 0, count: this.surfaces.length } : "surfaces" in source ? source.surfaces : source.faces;
    let world: readonly ShadowMesh[] | StaticShadowWorld = [];
    if (options.enabled !== false && lights.some(light => light.profile.kind === "q2" && light.radius > 0 && (light.profile.cone !== null || light.profile.shadow.kind === "cast"))) {
      const cached = this.staticShadowWorld;
      if (cached !== null && cached.surfaces === this.surfaces && cached.first === range.first && cached.count === range.count) world = cached.world;
      else {
        this.staticShadowWorld = null;
        const context = this.materialContext(input), meshes: ShadowMesh[] = [];
        let staticWorld = true;
        for (let index = range.first; index < range.first + range.count; index++) {
          const surface = at(this.surfaces, index);
          const shader = surface.shader === null ? null : this.remapped.get(surface.shader)?.shader ?? surface.shader;
          if (shader !== null && shader.registered.definition.deforms.length !== 0) staticWorld = false;
          const geometry = this.shadowGeometry(surface, context, false);
          if (geometry !== null) meshes.push(shadowMesh(geometry));
        }
        world = staticWorld ? new StaticShadowWorld(meshes) : meshes;
        if (world instanceof StaticShadowWorld) this.staticShadowWorld = { surfaces: this.surfaces, first: range.first, count: range.count, world };
      }
    }
    return this.shadowScene.prepare(lights, world, [...casters, ...(input.inlineModels ?? []).filter(model => model.castsShadow !== false)
      .map(model => this.shadowModel(model.model, model.transform, input))], options);
  }

  private shadowGeometry(surface: WorldSurface, context: MaterialDrawContext, entity: boolean): MaterialGeometry | null {
    if (surface.shader !== null) {
      if (surface.kind === "q3" && surface.flare) return null;
      const remap = this.remapped.get(surface.shader);
      return shadowMaterialGeometry(remap?.shader ?? surface.shader, surface.geometry, { ...context, timeOffset: remap?.timeOffset ?? 0 });
    }
    if (surface.kind !== "legacy") throw new Error("Compiled surface lost its shader");
    const material = surface.material;
    if (material.kind === "q1") return material.surface !== "ordinary" && material.surface !== "fence" || material.alpha < 1 ? null : surface.geometry;
    if ((material.surfaceFlags & (4 | 8 | 128)) !== 0 || entity && (material.surfaceFlags & (16 | 32)) !== 0) return null;
    return surface.geometry;
  }

  /** Admit world surfaces before preparing polygons and refentities in this view. */
  prepareWorldOperations(input: WorldViewInput, visibility = visibleWorld(this.map, input.camera, input)): readonly SceneOperation[] {
    const cached = input.source?.worldOperations.get(this);
    if (cached !== undefined) return cached;
    const operations: SceneOperation[] = [];
    const context = this.materialContext(input), worldModel = this.map.models[0];
    const worldRange = worldModel === undefined ? { first: 0, count: this.surfaces.length } : "surfaces" in worldModel ? worldModel.surfaces : worldModel.faces;
    const surfaces = visibility.surfaces.map(index => at(this.surfaces, index)).filter(surface => this.map.kind === "q3-bsp" || surface.index >= worldRange.first && surface.index < worldRange.first + worldRange.count);
    const order = (surface: WorldSurface): number => {
      if (surface.shader !== null) return (this.remapped.get(surface.shader)?.shader ?? surface.shader).finished.sort;
      if (surface.kind !== "legacy") throw new Error("Compiled surface lost its shader");
      return surface.q1Sky !== null || surface.material.kind === "q2" && (surface.material.surfaceFlags & 4) !== 0 ? 2 : surface.material.alpha < 1 ? 9 : 3;
    };
    if (surfaces.some(surface => surface.shader === null)) surfaces.sort((a, b) => order(a) - order(b));
    const frustum = cameraFrustum(input.camera);
    const lights = input.q3Lights ?? [];
    for (const surface of surfaces) {
      if (input.source !== undefined) {
        if (!this.admitSurface(input.source, surface.index)) continue;
      }
      if (surface.kind === "q3" ? this.surfaceCulled(surface, input, context) : input.noCull !== true && !boundsInFrustum(surface.bounds, frustum)) continue;
      const incoming = visibility.surfaceDlightMasks.get(surface.index);
      if (incoming === undefined) throw new Error("Visible surface lost its first-encounter light mask");
      const mask = this.frontendLightMask(surface, incoming, lights);
      const order = input.source === undefined ? undefined : this.sourceSurfaceOrder(surface, input.source, { kind: "world" }, mask);
      operations.push(...this.surfaceOperations(surface, input, context, undefined, { mask, lights }, order));
    }
    input.source?.worldOperations.set(this, operations);
    return operations;
  }


  prepareView(input: WorldViewInput): PreparedWorldView {
    const visibility = visibleWorld(this.map, input.camera, input), operations: SceneOperation[] = [];
    const surfaces = visibility.surfaces.map(index => at(this.surfaces, index));
    operations.push(...this.prepareWorldOperations(input, visibility));
    for (const model of input.inlineModels ?? []) {
      const childInput = { ...input, animationFrame: model.animationFrame ?? input.animationFrame ?? 0,
        materialContext: { ...input.materialContext, ...(model.entityRGBA === undefined ? {} : { entityRGBA: model.entityRGBA }) },
        alternateAnimation: model.alternateAnimation ?? input.alternateAnimation ?? false };
      operations.push(...this.prepareModel(model.model, model.transform, childInput));
    }
    operations.push(...input.operations ?? []);
    if (input.q2Fog !== undefined) operations.push({ kind: "q2-fog", camera: input.camera, fog: input.q2Fog, farDepth: 1 - 1e-6,
      skyDrawn: surfaces.some(surface => surface.shader !== null
        ? (this.remapped.get(surface.shader)?.shader ?? surface.shader).finished.iterator.kind === "sky"
        : surface.kind === "legacy" && surface.material.kind === "q2" && (surface.material.surfaceFlags & 4) !== 0) });
    return { visibility, imageOperations: this.shaders.textures.images.drainOperations(), view: { target: input.target, time: input.time,
      viewport: input.camera.viewport, clear: input.clear === undefined ? { color: null, depth: 1, stencil: false } : input.clear,
      clipPlane: portalClipPlane(input.camera), beforeView: input.beforeView ?? [], operations: fogSceneOperations(finishSceneOperations(operations), input.q1Fog) } };
  }

  private surfaceOperations(surface: WorldSurface, input: WorldViewInput, context: MaterialDrawContext, model?: ModelTransform, lighting?: { readonly mask: number; readonly lights: readonly DynamicLight[] }, order?: SourceSurfaceOrder): readonly SceneOperation[] {
    if (surface.kind === "q3") return this.shaderOperations(surface, surface.shader, input, context, model, lighting, order);
    const material = surface.material;
    if (surface.shader === null) {
      if (material.kind === "q2" && (material.surfaceFlags & 128) !== 0 && (material.surfaceFlags & 4) === 0) return [];
      if (surface.plane !== null && dot3(context.localViewOrigin, surface.plane.normal) - surface.plane.distance < -0.01) return [];
      if (surface.q1Sky !== null) return [sequenceDrawGroup("sky", this.q1SkyBatches(surface, surface.q1Sky, input, context))];
      if (material.kind === "q2" && (material.surfaceFlags & 4) !== 0) return [{ kind: "scene-group", order: { kind: "sequence", phase: "sky" }, operations: this.q2SkyOperations(surface.geometry, input, context) }];
    }
    if (surface.lightmap !== null) {
      const lightmap = surface.lightmap;
      const lights = (material.kind === "q2" && input.q2FragmentLighting !== undefined ? [] : input.lights ?? []).map(light => {
        if (model === undefined) return light;
        const scale = Math.abs(modelScale(model));
        return { ...light, origin: localPoint(light.origin, model), radius: light.radius / scale, minimum: light.minimum / scale,
          color: { x: light.color.x * scale, y: light.color.y * scale, z: light.color.z * scale } };
      });
      const styles: number[] = [this.options.q2LightModulate ?? 1];
      for (const index of lightmap.face.styles) {
        if (index === 255) break;
        if (material.kind === "q1") styles.push(at(input.q1Styles ?? q1DefaultStyles, index));
        else {
          const rgb = at(input.q2Styles ?? q2DefaultStyles, index).rgb;
          styles.push(rgb.x, rgb.y, rgb.z);
        }
      }
      const cached = this.staticLightStyles.get(surface);
      const reusable = lights.length === 0;
      if (!reusable || cached === undefined || cached.length !== styles.length || styles.some((value, index) => value !== cached[index])) {
        this.staticLightStyles.delete(surface);
        const built = material.kind === "q1" ? buildQ1Lightmap(lightmap.face, input.q1Styles ?? q1DefaultStyles, { encoding: lightmap.encoding, dynamicLights: lights })
          : buildQ2Lightmap(lightmap.face, input.q2Styles ?? q2DefaultStyles, { dynamicLights: lights, modulate: this.options.q2LightModulate ?? 1 });
        this.shaders.textures.images.update(lightmap.image, 0, built.image);
        this.shaders.textures.images.update(lightmap.direct, 0, directLightmapPixels(built));
        if (reusable) this.staticLightStyles.set(surface, styles);
      } else {
        this.shaders.textures.images.require(lightmap.image);
        this.shaders.textures.images.require(lightmap.direct);
      }
    }
    if (surface.shader !== null) return this.shaderOperations(surface, surface.shader, input, context, model, lighting, order);
    const fragmentLighting = input.q2FragmentLighting;
    const rotateNormal = (normal: Vec3): Vec3 => normalize3(model === undefined ? normal : worldVector(normal, model));
    const batches = prepareLegacyMaterialBatches(material, surface.geometry, { time: context.time, entityRGBA: context.entityRGBA, animationFrame: input.animationFrame ?? Math.trunc(context.time * 2),
      alternateAnimation: input.alternateAnimation ?? false,
      fullbright: material.kind === "q1" ? this.fullbrightByTexture.get(q1AnimatedTexture(material, context.time, input.alternateAnimation ?? false)) ?? null : surface.fullbright,
      q1FogActive: (input.q1Fog?.density ?? 0) > 0,
      q1LightmapEncoding: surface.lightmap?.encoding ?? "rgb",
      ...(fragmentLighting === undefined ? {} : { fragmentLighting: { kind: "q2-world",
        worldPositions: surface.geometry.vertices.map(vertex => model === undefined ? vertex.position : worldPoint(vertex.position, model)),
        normals: surface.geometry.vertices.map(vertex => rotateNormal(vertex.normal)), pass: "texture", lights: fragmentLighting.lights.filter(light => material.kind !== "q1" || light.cone !== null || light.shadow.kind !== "none").map(light => ({ ...light, scale: light.scale * (this.options.q2LightModulate ?? 1) })), atlas: fragmentLighting.atlas } }),
      ...(surface.lightmap === null ? {} : { translucentLightmap: surface.lightmap.direct }), cull: context.deformView.mirror !== (model !== undefined && modelScale(model) < 0) ? "back" : "front", depthRange: context.depthRange, project: context.project });
    return [sequenceDrawGroup(material.alpha * context.entityRGBA.w / 255 < 1 ? "translucent" : "opaque", batches)];
  }

  private shaderOperations(surface: WorldSurface, sourceShader: RegisteredSceneMaterial, input: WorldViewInput, context: MaterialDrawContext, model?: ModelTransform, lighting?: { readonly mask: number; readonly lights: readonly DynamicLight[] }, order?: SourceSurfaceOrder): readonly SceneOperation[] {
    const remap = this.remapped.get(sourceShader), shader = remap?.shader ?? sourceShader;
    const grid = surface.kind === "q3" ? surface.grid : null, fog = surface.kind === "q3" ? surface.fog : null;
    if (surface.kind === "q3" && (surface.flare || surface.skip)) {
      const operations = surface.flare ? input.prepareFlare?.(surface, context) ?? [] : [];
      return order === undefined ? operations : [{ ...sourceDrawGroup(sourceShader, order, []), operations }];
    }
    if (shader.material.surfaceParameters.includes("nodraw")) return order === undefined ? [] : [sourceDrawGroup(sourceShader, order, [])];
    const geometry = grid === null ? surface.geometry : selectPatchLod(grid,
      model === undefined ? grid.lodOrigin : worldPoint(grid.lodOrigin, model), input.camera.origin, input.camera.axis[0], input.curveError ?? 250);
    const sourceLights = input.q3Lights ?? [];
    if (sourceLights.length > 32) throw new RangeError("Q3 projected lighting supports the source 32-light mask");
    const lights = lighting?.lights ?? (model === undefined ? sourceLights : sourceLights.map(light => ({ ...light,
      origin: localPoint(light.origin, model), radius: light.radius / Math.abs(modelScale(model)) })));
    const incoming = lights.length === 32 ? -1 : (1 << lights.length) - 1;
    const mask = lighting?.mask ?? this.frontendLightMask(surface, incoming, lights);
    const dynamicLightBatches = (deformed: MaterialGeometry): readonly DrawBatch[] => {
      if (!receivesProjectedDlights(shader) || mask === 0) return [];
      return projectDlightTexture(deformed, mask, lights, this.dlightImage, context.project, shader.material.cull);
    };
    const fragmentLighting = input.q2FragmentLighting;
    const lightmapLighting: MaterialDrawContext["lightmapLighting"] = fragmentLighting === undefined ? undefined : geometry => ({
      kind: "q2-world", pass: "material-lightmap",
      worldPositions: geometry.vertices.map(vertex => model === undefined ? vertex.position : worldPoint(vertex.position, model)),
      normals: geometry.vertices.map(vertex => normalize3(model === undefined ? vertex.normal : worldVector(vertex.normal, model))),
      lights: fragmentLighting.lights.map(light => ({ ...light, scale: light.scale * (this.options.q2LightModulate ?? 1) })), atlas: fragmentLighting.atlas,
    });
    const drawContext = { ...(fog === null ? context : this.materialContext(input, model, fog)), timeOffset: remap?.timeOffset ?? 0,
      dynamicLightBatches, ...(lightmapLighting === undefined ? {} : { lightmapLighting }) };
    if (shader.finished.iterator.kind === "sky") return [{ kind: "scene-group",
      order: order === undefined ? { kind: "compiled", material: shader } : sourceDrawGroup(sourceShader, order, []).order,
      operations: this.skyOperations(shader, geometry, input, drawContext) }];
    const batches = prepareMaterialBatches(shader, geometry, drawContext);
    const group = order === undefined ? (batches: readonly DrawBatch[]) => compiledDrawGroup(shader, batches)
      : (batches: readonly DrawBatch[]) => sourceDrawGroup(sourceShader, order, batches);
    return [group((context.deformView.mirror !== (model !== undefined && modelScale(model) < 0)) ? batches.map(batch => ({ ...batch, state: { ...batch.state,
      cull: batch.state.cull === "none" ? "none" : batch.state.cull === "front" ? "back" : "front" } })) : batches)];
  }

  private q1SkyBatches(surface: WorldSurface, sky: { readonly solid: RendererImage; readonly overlay: RendererImage }, input: WorldViewInput, context: MaterialDrawContext): readonly DrawBatch[] {
    return (["solid", "overlay"] satisfies readonly ("solid" | "overlay")[]).map(layer => ({ ...(input.q1Fog === undefined || input.q1Fog.density <= 0 ? {} : { fog: { kind: "constant", color: input.q1Fog.color, amount: input.q1Fog.skyFactor } satisfies import("../../contracts/render.ts").BatchFog }), primitive: "triangles", texturing: "single", lighting: { kind: "vertex" },
      indices: surface.geometry.indices, texture: { kind: "bind-image", image: sky[layer] },
      vertices: surface.geometry.vertices.map(vertex => ({ position: context.project(vertex.position), texCoord: q1SkyTexCoords(vertex.position, input.camera.origin, context.time, layer), color: { x: 1, y: 1, z: 1, w: 1 } })),
      state: { blend: layer === "solid" ? { source: "one", destination: "zero" } : { source: "src-alpha", destination: "one-minus-src-alpha" },
        depthTest: "less-equal", depthWrite: true, alphaTest: "none", cull: "none", depthRange: [0, 1], polygonOffset: null } }));
  }

  private skyOperations(shader: CompiledMaterial, geometry: MaterialGeometry, input: WorldViewInput, context: MaterialDrawContext): readonly RenderOperation[] {
    this.shaders.sky.clip([geometry], input.camera.origin);
    const built = this.shaders.sky.build(input.camera.origin, Math.max(2048, farClip(input.camera.origin, this.bounds)));
    const operations: RenderOperation[] = [{ kind: "depth-range", range: [1, 1] }];
    const outer = shader.registered.sky?.outer;
    if (outer !== undefined && outer !== null) for (const face of built.box) {
      const suffix = (['rt', 'lf', 'bk', 'ft', 'up', 'dn'] satisfies readonly ('rt' | 'lf' | 'bk' | 'ft' | 'up' | 'dn')[])[face.face];
      if (suffix === undefined) throw new Error("Sky face is outside the cube");
      operations.push({ kind: "sky-side", image: outer.image(suffix).image, color: { x: context.identityLight, y: context.identityLight, z: context.identityLight, w: 1 },
        strips: face.strips.map(strip => strip.map(index => { const vertex = at(face.geometry.vertices, index); return { position: context.project(vertex.position), texCoord: vertex.texCoord }; })) });
    }
    if (built.clouds.indices.length !== 0) operations.push({ kind: "draw", batches: evaluateMaterialPasses(shader, built.clouds, { ...context, depthRange: [1, 1] }) });
    operations.push({ kind: "depth-range", range: context.depthRange });
    return operations;
  }

  private q2SkyOperations(geometry: MaterialGeometry, input: WorldViewInput, context: MaterialDrawContext): readonly RenderOperation[] {
    const sky = input.q2Sky ?? { images: this.q2Sky, rotation: 0, autoRotate: false, axis: { x: 0, y: 0, z: 1 } };
    const seconds = input.time.kind === "seconds" ? input.time.value : input.time.value / 1000;
    return [{ kind: "depth-range", range: [1, 1] }, ...q2SkySides(geometry, input.camera.origin, sky, seconds, context.project), { kind: "depth-range", range: context.depthRange }];
  }

  close(): void { this.staticShadowWorld = null; this.staticLightStyles.clear(); this.shadowScene.close(); for (const image of this.owned) this.shaders.textures.images.release(image); this.owned.length = 0; }

  /** Replace only renderer data; BSP identity and source light/style owners remain live. */
  async prepareImages(shaders: SceneShaderRegistry): Promise<WorldScene> {
    const replacement = await WorldScene.load(this.map, shaders, this.options);
    try {
      for (const [material, remap] of this.remapped)
        await replacement.remapShader(material.material.name, remap.shader.material.name, remap.timeOffset);
      return replacement;
    } catch (error) { replacement.close(); throw error; }
  }

  commitImages(replacement: WorldScene): void {
    this.close();
    this.surfaces = replacement.surfaces.map(surface => surface.shader === null ? surface : { ...surface, shader: this.shaders.registrations.owner.retained(surface.shader.registration) });
    this.fogSelections = replacement.fogSelections;
    this.fogImage = replacement.fogImage; this.dlightImage = replacement.dlightImage;
    this.shadowScene = replacement.shadowScene;
    this.q2Sky = replacement.q2Sky;
    this.fullbrightByTexture = replacement.fullbrightByTexture;
    this.owned.push(...replacement.owned); replacement.owned.length = 0;
    this.remapped.clear();
    for (const [material, remap] of replacement.remapped) this.remapped.set(this.shaders.registrations.owner.retained(material.registration),
      { ...remap, shader: this.shaders.registrations.owner.retained(remap.shader.registration) });
  }

  async remapShader(original: string, replacement: string, timeOffset = 0): Promise<void> {
    this.shaders.remap(original, replacement, timeOffset);
    for (const surface of this.surfaces) {
      if (surface.shader === null || surface.shader.material.name.toLowerCase() !== original.toLowerCase()) continue;
      if (original.toLowerCase() === replacement.toLowerCase()) this.remapped.delete(surface.shader);
      else this.remapped.set(surface.shader, { shader: await this.shaders.register(replacement, { kind: "world", world: this.materialWorld, lightmap: surface.kind === "q3" ? surface.lightmap : surface.lightmap?.image ?? null, lightmapIndex: surface.shader.finished.lightmapIndex, baseTexture: null }), timeOffset });
      this.staticShadowWorld = null;
    }
  }

  /** Source Q3 allows a single portal child. Every split seat starts its own search. */
  prepareViews(input: WorldViewInput, portals: readonly PortalEntity[] = []): readonly PreparedWorldView[] {
    const result: PreparedWorldView[] = [];
    if (input.camera.clip.kind === "none" && portals.length !== 0) {
      const visible = visibleWorld(this.map, input.camera, input);
      for (const index of visible.surfaces) {
        const surface = at(this.surfaces, index);
        const shader = surface.shader === null ? null : this.remapped.get(surface.shader)?.shader ?? surface.shader;
        if (shader === null || shader.finished.sort !== 1 || surface.plane === null) continue;
        const milliseconds = input.time.kind === "seconds" ? input.time.value * 1000 : input.time.value;
        const child = portalCamera(surface.plane, portals, input.camera, milliseconds);
        if (child === null || portalSurfaceOffscreen(surface.geometry, input.camera, shader.material.portalRange, child.mirror)) continue;
        result.push(this.prepareView({ ...input, camera: child.camera, pvsOrigin: child.pvsOrigin, operations: [], beforeView: [],
          ...(input.source === undefined ? {} : { source: createWorldSurfaceAdmission(createSourceSceneOrder(input.source.view.registrations)) }) }));
        break;
      }
    }
    result.push(this.prepareView(input));
    return result;
  }
}

export type Q3SceneWorld = Q3WorldGeometry;
