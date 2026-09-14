import { compiledDrawGroup, sequenceDrawGroup, sourceDrawGroup } from "../submissions.ts";
import type { SceneModelGroup } from "../submissions.ts";
import type { GameFamily } from "../../../contracts/content.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { DrawBatch, Palette } from "../../../contracts/render.ts";
import type { SceneEntity, TimedFrames } from "../../../contracts/scene.ts";
import { add3, dot3, normalize3, radiusFromBounds, scale3, sub3 } from "../../../core/math.ts";
import { q1PlayerTranslation } from "../../../formats/images/index.ts";
import { ALIAS_NORMALS, sampleTimedFrame } from "../../../formats/q12-model/index.ts";
import type { RegisteredSceneMaterial } from "../material-registrations.ts";
import { diffuseColor } from "../../../materials/color.ts";
import type { EntityLighting } from "../../../materials/q3-lighting.ts";
import { prepareMaterialBatches } from "../../../materials/evaluate.ts";
import { createQ1Material, createQ2Material, prepareLegacyMaterialBatches } from "../../../materials/legacy.ts";
import type { SceneShaderRegistry } from "../shaders.ts";
import type { SceneTexture, SceneTextureLoader } from "../textures.ts";
import { floodSkin } from "../skin.ts";
import { cameraFrustum, createViewProjector } from "../view.ts";
import type { WorldScene, WorldViewInput } from "../world.ts";
import { entityCastsShadow, shadowMaterialGeometry } from "../shadow-geometry.ts";
import { shadowCaster, shadowMesh } from "../shadows.ts";
import type { ShadowCaster, ShadowMesh, ShadowSphere } from "../shadows.ts";
import { ModelLightSampler } from "./light-sampler.ts";
import { Q2_SHELL_MASK, aliasShadeDivisor, aliasShadowLightFractions, q2AliasLight, q2ShellColor } from "./lighting.ts";
import { prepareSceneEntity, preparedModelGroups } from "./prepare.ts";
import { replacementEntity } from "./replacements.ts";
import type { ModelReplacementPolicy } from "./replacements.ts";
import { r_avertexnormal_dots } from "./shadedots.ts";
import { attachSceneEntity, modelAttachmentTag, modelWorldPoint, q3ModelViewOrigin } from "./transform.ts";
import { byteColor, modelImage } from "./types.ts";
import type { ModelImageSelection, ModelSkinningFrame, ModelSourceOptions, PreparedModelSurface } from "./types.ts";

export interface ModelRenderProvider {
  readonly modelPolicy?: ModelReplacementPolicy;
  readonly family: GameFamily;
  readonly palette: Palette | null;
  readonly textures: SceneTextureLoader;
  readonly shaders: SceneShaderRegistry;
}
type SourceOptions = (entity: SceneEntity) => ModelSourceOptions;
type ModelResource = Pick<SceneEntity, "resource" | "model">;
type Material = { readonly kind: "q3"; readonly name: string; readonly original: RegisteredSceneMaterial; readonly compiled: RegisteredSceneMaterial; readonly timeOffset: number }
  | { readonly kind: "legacy"; readonly texture: SceneTexture };
const unit: Vec3 = { x: 1, y: 1, z: 1 };
const normalIndices = new Map<number, Map<number, Map<number, number>>>();
for (const [index, normal] of ALIAS_NORMALS.entries()) {
  let ys = normalIndices.get(normal.x);
  if (ys === undefined) { ys = new Map<number, Map<number, number>>(); normalIndices.set(normal.x, ys); }
  let zs = ys.get(normal.y);
  if (zs === undefined) { zs = new Map<number, number>(); ys.set(normal.y, zs); }
  zs.set(normal.z, index);
}

function frames<T>(value: TimedFrames<T>): readonly T[] { return value.kind === "single" ? [value.frame] : value.frames.map(item => item.frame); }
function materialKey(entity: ModelResource, image: ModelImageSelection, options: ModelSourceOptions): string {
  const translated = image.kind === "indexed" || entity.model.kind === "md5" && entity.model.skinSelection.kind === "q1-mdl-replacement";
  const translation = translated && options.playerColors !== undefined ? `${options.playerColors.top}:${options.playerColors.bottom}` : "";
  return `${entity.resource.id}\0${image.kind}\0${"name" in image ? image.name : image.kind === "default" ? image.reason : ""}\0${translation}`;
}

/** One cache per selected content provider. No asset IO occurs during prepare. */
export class SceneModelRenderer {
  readonly lighting: ModelLightSampler;
  private readonly materials = new Map<string, Material>();
  private readonly pending = new Map<string, Promise<void>>();
  private textures: SceneTextureLoader;

  constructor(readonly provider: ModelRenderProvider, readonly world: WorldScene) {
    this.textures = provider.textures;
    this.lighting = new ModelLightSampler(world);
  }

  async refreshShaderRemaps(): Promise<void> {
    await Promise.all([...this.materials].map(async ([key, material]) => {
      if (material.kind !== "q3") return;
      const remap = this.provider.shaders.resolveRemap(material.name);
      this.materials.set(key, { ...material, compiled: await this.provider.shaders.register(remap.name), timeOffset: remap.timeOffset });
    }));
  }

  async preload(entities: readonly SceneEntity[], options: SourceOptions = () => ({})): Promise<void> {
    if (this.textures !== this.provider.textures) {
      this.materials.clear(); this.pending.clear(); this.textures = this.provider.textures;
    }
    const work: Promise<void>[] = [];
    const visit = (entity: SceneEntity): void => {
      const source = options(entity), selections = this.selections(entity, source);
      for (const selection of selections) work.push(this.load(entity, selection, source));
      const replacement = entity.model.kind === "q1-mdl" && source.indexedSkin !== undefined ? null : replacementEntity(entity);
      if (replacement !== null) for (const selection of this.selections(replacement, source)) work.push(this.load(replacement, selection, source));
      for (const attachment of entity.attachments) visit(attachment.entity);
    };
    for (const entity of entities) visit(entity);
    await Promise.all(work);
  }

  async preloadModel(resource: ModelResource, options: ModelSourceOptions = {}, allowCinematics = true): Promise<void> {
    if (this.textures !== this.provider.textures) {
      this.materials.clear(); this.pending.clear(); this.textures = this.provider.textures;
    }
    const work = this.selections(resource, options).map(selection => this.load(resource, selection, options, allowCinematics));
    const model = resource.model;
    if ((model.kind === "q1-mdl" || model.kind === "q2-md2") && !(model.kind === "q1-mdl" && options.indexedSkin !== undefined)) {
      const replacement = model.replacement;
      if (replacement != null) for (const selection of this.selections(replacement, options)) work.push(this.load(replacement, selection, options, allowCinematics));
    }
    await Promise.all(work);
  }

  private selections(entity: ModelResource, options: ModelSourceOptions): readonly ModelImageSelection[] {
    const result: ModelImageSelection[] = [{ kind: "white" }, { kind: "default", reason: "missing-skin-surface" }, { kind: "default", reason: "no-skin" }];
    const external = (name: string): void => { result.push({ kind: "external", name }); };
    if (options.customShader != null) external(options.customShader);
    for (const skin of options.customSkin ?? []) external(skin.shader);
    const model = entity.model;
    switch (model.kind) {
      case "q1-mdl":
        if (options.indexedSkin !== undefined) {
          result.push({ kind: "indexed", ...options.indexedSkin, transparentIndex: null, fullbright: true });
          break;
        }
        for (const [skin, group] of model.skins.entries()) for (const [frame, pixels] of frames(group).entries()) result.push({ kind: "indexed",
          name: `${entity.resource.id}:skin:${skin}:${frame}`, width: model.skinWidth, height: model.skinHeight, pixels, transparentIndex: null, fullbright: true });
        break;
      case "q1-spr":
        for (const [frame, group] of model.frames.entries()) for (const [subframe, sprite] of frames(group).entries()) result.push({ kind: "indexed",
          name: `${entity.resource.id}:frame:${frame}:${subframe}`, width: sprite.width, height: sprite.height, pixels: sprite.pixels, transparentIndex: 255, fullbright: true });
        break;
      case "q2-md2": for (const skin of model.skins) external(skin); break;
      case "q2-sp2": for (const frame of model.frames) external(frame.image); break;
      case "q3-md3": for (const lod of options.q3Lods ?? [model]) if (lod !== null) for (const surface of lod.surfaces) for (const shader of surface.shaders) external(shader); break;
      case "q3-md4": for (const lod of model.lods) for (const surface of lod.surfaces) external(surface.shader); break;
      case "md5":
        if (model.skinSelection.kind === "q1-mdl-replacement") for (const mesh of model.skinSelection.meshSkinGroups) for (const group of mesh) for (const name of frames(group)) external(`${name}.lmp`);
        else if (model.skinSelection.kind === "q2-md2-replacement") for (const name of model.skinSelection.skins) external(name);
        else for (const mesh of model.meshes) external(mesh.shader);
        break;
      case "brush-model": break;
    }
    return result;
  }

  private load(entity: ModelResource, selection: ModelImageSelection, options: ModelSourceOptions, allowCinematics = true): Promise<void> {
    if (!allowCinematics && this.provider.family === "q3" && (selection.kind === "external" || selection.kind === "default")) {
      const name = selection.kind === "external" ? selection.name : "*default", remap = this.provider.shaders.resolveRemap(name);
      if (this.provider.shaders.hasCinematic(remap.name)) return Promise.reject(new Error(`Model cinematic deferred until use: ${remap.name}`));
    }
    const key = materialKey(entity, selection, options), old = this.pending.get(key);
    if (old !== undefined) return old;
    const pending = (async (): Promise<void> => {
      if (this.provider.family === "q3" && (selection.kind === "external" || selection.kind === "default")) {
        const name = selection.kind === "external" ? selection.name : "*default", remap = this.provider.shaders.resolveRemap(name);
        const original = await this.provider.shaders.register(name);
        this.materials.set(key, { kind: "q3", name, original, compiled: remap.name === name ? original : await this.provider.shaders.register(remap.name), timeOffset: remap.timeOffset }); return;
      }
      const texture = selection.kind === "white" ? this.provider.textures.white : selection.kind === "default" ? this.provider.textures.missing
        : selection.kind === "indexed" ? this.indexedTexture(entity, selection, options) : await this.externalTexture(entity, selection.name, options);
      this.materials.set(key, { kind: "legacy", texture });
    })();
    this.pending.set(key, pending);
    return pending;
  }

  private indexedTexture(entity: ModelResource, selection: Extract<ModelImageSelection, { readonly kind: "indexed" }>, options: ModelSourceOptions): SceneTexture {
    if (this.provider.palette === null) throw new Error(`Indexed model ${selection.name} has no content palette`);
    const colors = options.playerColors, translation = colors === undefined ? null : q1PlayerTranslation(colors.top, colors.bottom);
    const image = entity.model.kind === "q1-mdl" ? { ...selection, pixels: floodSkin(selection.pixels, selection.width, selection.height, this.provider.palette) } : selection;
    return this.provider.textures.register(colors === undefined ? selection.name : `${selection.name}:${colors.top}:${colors.bottom}`, modelImage(image, this.provider.palette, translation),
      { wrap: "repeat", filter: "linear" });
  }

  private async externalTexture(entity: ModelResource, name: string, options: ModelSourceOptions): Promise<SceneTexture> {
    const sprite = entity.model.kind === "q2-sp2";
    const texture = await this.provider.textures.load(name, { family: this.provider.family, usage: sprite ? "sprite" : "skin", mipmap: !sprite }) ?? this.provider.textures.missing;
    const colors = options.playerColors;
    if (entity.model.kind === "md5" && entity.model.skinSelection.kind === "q1-mdl-replacement" && colors !== undefined && texture.content.kind === "indexed8") {
      return this.provider.textures.register(`${name}:${colors.top}:${colors.bottom}`,
        { ...texture.content, translation: q1PlayerTranslation(colors.top, colors.bottom) },
        { wrap: "repeat", filter: "linear-mipmap-nearest" }, texture.image.source);
    }
    return texture;
  }

  prepare(entities: readonly SceneEntity[], input: WorldViewInput, sourceOptions: SourceOptions = () => ({}), skinningFrame?: ModelSkinningFrame): readonly SceneModelGroup[] {
    const time = input.time.kind === "seconds" ? input.time.value : input.time.value / 1000;
    const lightCache = new Map<SceneEntity, Vec3>();
    const entityLights = new Map<SceneEntity, EntityLighting>();
    const optionCache = new Map<SceneEntity, ModelSourceOptions>();
    const vertexLights = new Map<SceneEntity, Map<Vec3, Vec3>>();
    const shadeBases = new Map<SceneEntity, { readonly yaw: number; readonly row: number; direction: Vec3 | null }>();
    const options: SourceOptions = entity => {
      let value = optionCache.get(entity);
      if (value === undefined) { value = sourceOptions(entity); optionCache.set(entity, value); }
      return value;
    };
    const q2Lighting = this.provider.family === "q2" || this.provider.family === "q1" && this.world.map.kind === "q2-bsp";
    const lightingInput = q2Lighting && input.q2FragmentLighting !== undefined
      ? { ...input, lights: input.lights === undefined
        ? input.q2FragmentLighting.lights.map(light => ({ origin: light.origin, color: light.color, radius: light.radius, minimum: 0 }))
        : [...input.lights, ...input.q2FragmentLighting.lights.filter(light => light.shadow.kind !== "none")
          .map(light => ({ origin: light.origin, color: light.color, radius: light.radius, minimum: 0 }))] } : input;
    const finalVertexLight = (entity: SceneEntity, normal: Vec3, _position: Vec3, corner: number, source: ModelSourceOptions): Vec3 => {
      if (this.provider.family === "q3") return unit;
      let previousNormalIndex: number | undefined;
      if (this.provider.family === "q1" && entity.model.kind === "q1-mdl" && entity.pose.kind === "frame") {
        const triangle = entity.model.triangles[Math.trunc(corner / 3)], vertex = triangle?.vertices[corner % 3];
        const oldFrames = entity.model.frames[entity.pose.previousFrame];
        if (vertex !== undefined && oldFrames !== undefined) previousNormalIndex = sampleTimedFrame(oldFrames, time, source.syncBase ?? 0).compressedVertices[vertex]?.normalIndex;
      }
      if (this.provider.family === "q1" && this.world.map.kind === "q3-bsp") {
        let lighting = entityLights.get(entity);
        if (lighting === undefined) { lighting = this.lighting.entityLighting(entity, input); entityLights.set(entity, lighting); }
        const current = diffuseColor(normal, lighting), previous = previousNormalIndex === undefined ? undefined : ALIAS_NORMALS[previousNormalIndex];
        const color = previous === undefined || entity.pose.kind !== "frame" ? current
          : add3(scale3(current, 1 - entity.pose.backLerp), scale3(diffuseColor(previous, lighting), entity.pose.backLerp));
        return scale3(color, 1 / 255);
      }
      const cached = vertexLights.get(entity)?.get(normal);
      if (cached !== undefined) return cached;
      let light = lightCache.get(entity);
      if (light === undefined) {
        const sampled = this.lighting.sample(entity.transform.origin, lightingInput, q2Lighting).color;
        if (this.provider.family === "q2") light = q2AliasLight(entity.flags.kind === "q2" ? entity.flags.bits : 0, sampled, time, false, source.infrared);
        else if (this.world.map.kind === "q2-bsp" && source.viewModel !== true) light = sampled;
        else {
          const staticLight = this.world.map.kind === "q2-bsp" ? this.lighting.sample(entity.transform.origin, lightingInput, false).color : sampled;
          const channel = (value: number, total: number): number => {
            let ambient = value * 255, shade = ambient;
            if (source.viewModel === true && ambient < 24) ambient = shade = 24;
            if (this.world.map.kind === "q2-bsp") {
              const amount = (total - value) * 255;
              ambient += amount; shade += amount;
            }
            for (const dynamic of this.world.map.kind === "q2-bsp" ? [] : input.lights ?? []) {
              const difference = sub3(entity.transform.origin, dynamic.origin), amount = dynamic.radius - Math.hypot(difference.x, difference.y, difference.z);
              if (amount > 0) { ambient += amount; shade += amount; }
            }
            ambient = Math.min(128, ambient); shade = Math.min(shade, 192 - ambient);
            if ((source.player === true || entity.resource.requestedPath === "progs/player.mdl") && ambient < 8) shade = 8;
            if (["progs/flame.mdl", "progs/flame2.mdl"].includes(entity.resource.requestedPath)) shade = 256;
            return shade / 200 * (source.overbrightModels === false ? 1 : 2);
          };
          light = { x: channel(staticLight.x, sampled.x), y: channel(staticLight.y, sampled.y), z: channel(staticLight.z, sampled.z) };
        }
        lightCache.set(entity, light);
      }
      if (entity.flags.kind === "q2" && q2ShellColor(entity.flags.bits) !== null) return light;
      let basis = shadeBases.get(entity);
      if (basis === undefined) {
        const yaw = Math.atan2(entity.transform.axis[0].y, entity.transform.axis[0].x), row = Math.trunc(yaw * 16 / (2 * Math.PI)) & 15;
        basis = { yaw, row, direction: null }; shadeBases.set(entity, basis);
      }
      const { row } = basis;
      const index = normalIndices.get(normal.x)?.get(normal.y)?.get(normal.z);
      let shade = index === undefined ? null : r_avertexnormal_dots[row * 256 + index] ?? null;
      if (previousNormalIndex !== undefined && entity.pose.kind === "frame" && shade !== null) {
        const oldShade = r_avertexnormal_dots[row * 256 + previousNormalIndex] ?? shade;
        shade = shade * (1 - entity.pose.backLerp) + oldShade * entity.pose.backLerp;
      }
      if (shade === null) {
        if (basis.direction === null) basis.direction = normalize3({ x: Math.cos(-basis.yaw), y: Math.sin(-basis.yaw), z: 1 });
        const d = dot3(normal, basis.direction);
        shade = 1 + (d < 0 ? d * 0.3 : d);
      }
      const result = scale3(light, shade);
      // Q1 old-pose normals vary by triangle corner. Q2 uses only the current normal.
      if (this.provider.family === "q2") {
        let normals = vertexLights.get(entity);
        if (normals === undefined) { normals = new Map<Vec3, Vec3>(); vertexLights.set(entity, normals); }
        normals.set(normal, result);
      }
      return result;
    };
    return entities.flatMap(entity => preparedModelGroups(prepareSceneEntity(entity, { camera: input.camera, timeSeconds: time,
      ...(skinningFrame === undefined ? {} : { skinningFrame }),
      ...(this.provider.modelPolicy === undefined ? {} : { modelPolicy: this.provider.modelPolicy }),
      frustum: cameraFrustum(input.camera), options, finalVertexLight, paletteColor: (_entity, index) => this.paletteColor(index) }),
    { draw: surface => this.draw(surface, input, surface.options, lightCache.get(surface.entity)) }));
  }

  /** Light views retain player bodies and off-camera geometry, without inflated powerup shells. */
  prepareShadowCasters(entities: readonly SceneEntity[], input: WorldViewInput, options: SourceOptions = () => ({}), skinningFrame?: ModelSkinningFrame,
    retainBody?: (sphere: ShadowSphere) => boolean): readonly ShadowCaster[] {
    const result: ShadowCaster[] = [], time = input.time.kind === "seconds" ? input.time.value : input.time.value / 1000;
    const visit = (entity: SceneEntity, original: SceneEntity): void => {
      const source = options(original);
      if (!entityCastsShadow(entity, source.viewModel)) return;
      const body: SceneEntity = { ...entity, attachments: [],
        flags: entity.flags.kind === "q2" ? { kind: "q2", bits: entity.flags.bits & ~Q2_SHELL_MASK } : entity.flags,
        pose: entity.pose.kind === "frame" ? { ...entity.pose, backLerp: Math.min(1, Math.max(0, entity.pose.backLerp)) } : entity.pose };
      const prepared = prepareSceneEntity(body, { camera: input.camera, timeSeconds: time, noCull: true, purpose: "shadow",
        ...(retainBody === undefined ? {} : { retainShadowBody: (selected: SceneEntity, sphere: ShadowSphere, images: readonly ModelImageSelection[], selectedOptions: ModelSourceOptions): boolean => {
          if (images.some(image => {
            const material = this.materials.get(materialKey(selected, image, selectedOptions));
            return material === undefined || material.kind === "q3" && material.compiled.registered.definition.deforms.length !== 0;
          })) return true;
          return retainBody(sphere);
        } }),
        ...(skinningFrame === undefined ? {} : { skinningFrame }),
        ...(this.provider.modelPolicy === undefined ? {} : { modelPolicy: this.provider.modelPolicy }), options: () => source });
      const meshes: ShadowMesh[] = [];
      for (const surface of prepared.surfaces) {
        const material = this.materials.get(materialKey(surface.entity, surface.image, source));
        if (material === undefined) throw new Error(`Shadow material was not preloaded: ${entity.resource.requestedPath}/${surface.name}`);
        if (material.kind === "legacy") { meshes.push(shadowMesh(surface.geometry)); continue; }
        const axis = surface.transform.axis;
        const transform = { origin: surface.transform.origin, axis: [scale3(axis[0], surface.transform.scale.x), scale3(axis[1], surface.transform.scale.y), scale3(axis[2], surface.transform.scale.z)] } satisfies Parameters<WorldScene["materialContext"]>[1];
        const base = this.world.materialContext(input, transform);
        const context = { ...base, entityRGBA: byteColor(entity.color),
          localViewOrigin: q3ModelViewOrigin(transform, input.camera.origin, source.nonNormalizedAxes === true),
          timeOffset: (entity.shaderTime.kind === "seconds" ? entity.shaderTime.value : entity.shaderTime.value / 1000) + material.timeOffset,
          deformView: { ...base.deformView, nonNormalizedAxis: source.nonNormalizedAxes === true ? transform.axis[0] : null } };
        const geometry = shadowMaterialGeometry(material.compiled, surface.localGeometry, context);
        if (geometry !== null) meshes.push({ positions: geometry.vertices.map(vertex => modelWorldPoint(surface.transform, vertex.position)), indices: geometry.indices });
      }
      if (meshes.length !== 0) result.push(shadowCaster(entity.transform.origin, meshes));
      const parent = { ...prepared.entity, pose: body.pose.kind === "frame" ? { ...body.pose, frame: prepared.frame, previousFrame: prepared.previousFrame } : body.pose };
      for (const attachment of entity.attachments) {
        const tag = modelAttachmentTag(parent, attachment.tag);
        if (tag !== null) visit(attachSceneEntity(parent, attachment.entity, tag), attachment.entity);
      }
    };
    for (const entity of entities) visit(entity, entity);
    return result;
  }

  private paletteColor(index: number): Vec3 {
    const palette = this.provider.palette;
    if (palette === null) throw new Error("Indexed model effects require a source palette");
    return { x: palette.colors[index * 3] ?? 0, y: palette.colors[index * 3 + 1] ?? 0, z: palette.colors[index * 3 + 2] ?? 0 };
  }

  private fogFor(surface: PreparedModelSurface): WorldScene["fogSelections"][number] | null {
    const entity = surface.entity, model = entity.model, frame = entity.pose.kind === "frame" ? entity.pose.frame : 0;
    if (surface.options.noWorldModel === true) return null;
    let center = entity.transform.origin, radius = 0;
    if (surface.fogSphere !== null) {
      const sphere = surface.fogSphere;
      center = { x: Math.fround(center.x + sphere.localOrigin.x), y: Math.fround(center.y + sphere.localOrigin.y),
        z: Math.fround(center.z + sphere.localOrigin.z) };
      radius = sphere.radius;
      return this.world.fogSelections.find(({ volume }) => Math.fround(center.x - radius) < volume.bounds.max.x
        && Math.fround(center.x + radius) > volume.bounds.min.x && Math.fround(center.y - radius) < volume.bounds.max.y
        && Math.fround(center.y + radius) > volume.bounds.min.y && Math.fround(center.z - radius) < volume.bounds.max.z
        && Math.fround(center.z + radius) > volume.bounds.min.z) ?? null;
    }
    if (model.kind === "q3-md3") throw new Error("Prepared MD3 surface lost its selected-frame fog sphere");
    if (surface.options.source !== undefined && model.kind === "q3-md4") return null;
    if (model.kind === "q3-md4") {
      const pose = model.frames[frame] ?? model.frames[0];
      if (pose !== undefined) { center = add3(center, pose.localOrigin); radius = pose.radius; }
    } else if (model.kind === "md5") {
      const pose = model.frames[frame] ?? model.frames[0];
      if (pose !== undefined) radius = radiusFromBounds(pose.bounds);
    } else if (model.kind !== "brush-model") radius = radiusFromBounds(model.bounds);
    return this.world.fogSelections.find(({ volume }) => center.x - radius < volume.bounds.max.x && center.x + radius > volume.bounds.min.x
      && center.y - radius < volume.bounds.max.y && center.y + radius > volume.bounds.min.y
      && center.z - radius < volume.bounds.max.z && center.z + radius > volume.bounds.min.z) ?? null;
  }

  private draw(surface: PreparedModelSurface, input: WorldViewInput, options: ModelSourceOptions, shade?: Vec3): readonly SceneModelGroup[] {
    const material = this.materials.get(materialKey(surface.entity, surface.image, options));
    if (material === undefined) throw new Error(`Model material was not preloaded: ${surface.entity.resource.requestedPath}/${surface.name}`);
    const time = input.time.kind === "seconds" ? input.time.value : input.time.value / 1000;
    if (material.kind === "q3") {
      const axis = surface.transform.axis;
      const transform = { origin: surface.transform.origin, axis: [scale3(axis[0], surface.transform.scale.x), scale3(axis[1], surface.transform.scale.y), scale3(axis[2], surface.transform.scale.z)] } satisfies Parameters<WorldScene["materialContext"]>[1];
      const fog = this.fogFor(surface);
      const base = this.world.materialContext(input, transform, fog?.volume ?? null);
      const project = createViewProjector(input.camera);
      const context = { ...base, entityRGBA: byteColor(surface.entity.color), lighting: this.lighting.entityLighting(surface.entity, input, options.noWorldModel),
        shaderTexCoord: options.shaderTexCoord ?? base.shaderTexCoord,
        localViewOrigin: q3ModelViewOrigin(transform, input.camera.origin, options.nonNormalizedAxes === true), depthRange: surface.depthRange,
        timeOffset: (surface.entity.shaderTime.kind === "seconds" ? surface.entity.shaderTime.value : surface.entity.shaderTime.value / 1000) + material.timeOffset,
        deformView: { ...base.deformView, nonNormalizedAxis: options.nonNormalizedAxes === true ? transform.axis[0] : null },
        project: (point: Vec3) => project(modelWorldPoint(surface.transform, point)) };
      const batches = prepareMaterialBatches(material.compiled, surface.localGeometry, context);
      // R_AddMD3Surfaces and R_AddAnimSurfaces submit no frontend dlight bits.
      return [options.source === undefined ? compiledDrawGroup(material.compiled, batches)
        : sourceDrawGroup(material.original, { ...options.source, surface: surface.surfaceIndex, fog: fog === null ? 0 : fog.index + 1, dlight: 0 }, batches)];
    }
    const texture = material.texture, alpha = surface.translucent ? surface.entity.color.w : 1;
    const lighting = { kind: "vertex" } satisfies Parameters<typeof createQ1Material>[2];
    const definition = this.provider.family === "q1" ? createQ1Material(texture.name, texture.image, lighting, { alpha })
      : { ...createQ2Material(texture.name, [texture.image], lighting), alpha };
    const project = createViewProjector(input.camera);
    const batches = prepareLegacyMaterialBatches(definition, surface.geometry, { time, animationFrame: 0, alternateAnimation: false,
      fullbright: surface.unlit ? null : texture.fullbright, q1LightmapEncoding: "rgb", cull: surface.cull, depthRange: surface.depthRange,
      project: point => { const projected = project(point); return surface.mirrorWeapon ? { ...projected, x: -projected.x } : projected; } });
    const flags = surface.entity.flags.kind === "q2" ? surface.entity.flags.bits : 0, shadows = input.q2FragmentLighting;
    const receives = this.provider.family === "q2" && shade !== undefined && shadows !== undefined && shadows.atlas !== null
      && !surface.unlit && options.viewModel !== true && (flags & (Q2_SHELL_MASK | 8 | 4 | 16)) === 0
      && !(options.infrared === true && (flags & 32768) !== 0);
    const affecting = receives ? aliasShadowLightFractions(surface.entity.transform.origin, shade, shadows.lights) : [];
    const shadeScale = receives && affecting.length !== 0 ? aliasShadeDivisor(shade) : 1;
    return [sequenceDrawGroup(alpha < 1 ? "translucent" : "opaque", batches.map((batch, index): DrawBatch => {
      const state = { ...batch.state, alphaTest: surface.alphaTest === "none" ? batch.state.alphaTest : surface.alphaTest,
        cull: surface.mirrorWeapon ? batch.state.cull === "front" ? "back" : batch.state.cull === "back" ? "front" : "none" : batch.state.cull } satisfies DrawBatch["state"];
      if (index !== 0 || affecting.length === 0 || shadows === undefined || shadows.atlas === null) return { ...batch, state };
      const lighting = { kind: "q2-model-shadow", worldPositions: surface.geometry.vertices.map(vertex => vertex.position),
        lights: affecting, shadeScale, atlas: shadows.atlas } satisfies DrawBatch["lighting"];
      const color = (value: DrawBatch["vertices"][number]["color"]): DrawBatch["vertices"][number]["color"] =>
        ({ x: value.x / shadeScale, y: value.y / shadeScale, z: value.z / shadeScale, w: value.w });
      return batch.texturing === "single" ? { ...batch, state, lighting, vertices: batch.vertices.map(vertex => ({ ...vertex, color: color(vertex.color) })) }
        : { ...batch, state, lighting, vertices: batch.vertices.map(vertex => ({ ...vertex, color: color(vertex.color) })) };
    }))];
  }
}
