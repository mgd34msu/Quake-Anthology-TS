import { CommonError } from "../../../core/common-error.ts";
import type { RenderState } from "../../../contracts/render.ts";
import { q3ProceduralFog } from "../../../content/q3/presentation/scene.ts";
import type { PresentedModel, Q3SceneContent } from "../../../content/q3/presentation/scene.ts";
import type { Q3RendererResources } from "../../../content/q3/presentation/resources.ts";
import { SceneModelRenderer } from "../../../render/scene/models/renderer.ts";
import { sourceDrawGroup, type SceneOperation } from "../../../render/scene/submissions.ts";
import { prepareMaterialBatches } from "../../../materials/evaluate.ts";
import { DEFAULT_RAIL_SETTINGS, beamBatch, defaultModelBatch, polyGeometry, railGeometry, spriteGeometry } from "../../../render/scene/particles/primitives.ts";
import { createViewProjector } from "../../../render/scene/view.ts";
import type { WorldViewInput } from "../../../render/scene/world.ts";
import type { ProviderSceneAssets } from "../assets.ts";
import type { ApplicationQ3Assets } from "./assets.ts";
import { q3WeaponCamera } from "./view.ts";
import { currentRemap } from "../../../render/scene/material-registrations.ts";

export interface Q3SceneRenderOptions {
  readonly noWorldModel: boolean;
  readonly splitScreen: boolean;
  readonly supplementalViewWeapon: boolean;
}
const state: RenderState = { blend: { source: "one", destination: "zero" }, depthTest: "less-equal", depthWrite: true,
  alphaTest: "none", cull: "back", depthRange: [0, 1], polygonOffset: null };

/** Renders captured source geometry inside the destination's admitted view. */
export class ApplicationQ3SceneRenderer {
  private readonly renderers = new Map<ProviderSceneAssets, SceneModelRenderer>();
  private closed = false;
  constructor(private readonly media: ApplicationQ3Assets, private readonly resources: Pick<Q3RendererResources, "picture">) {}
  private assertCurrent(): void { if (this.closed) throw new Error("Q3 scene renderer is closed"); }
  async preload(contents: readonly Q3SceneContent[]): Promise<void> {
    this.assertCurrent();
    for (const content of contents) for (const [provider, models] of this.models(content)) {
      await this.renderer(provider).preload(models.map(model => model.entity), entity => models.find(model => model.entity === entity)?.options ?? {});
      this.assertCurrent();
    }
  }
  private renderer(provider: ProviderSceneAssets): SceneModelRenderer { this.assertCurrent(); let renderer = this.renderers.get(provider); if (renderer === undefined) { renderer = new SceneModelRenderer(provider, this.media.assets.world); this.renderers.set(provider, renderer); } return renderer; }
  private models(scene: Q3SceneContent): ReadonlyMap<ProviderSceneAssets, readonly PresentedModel[]> {
    const groups = new Map<ProviderSceneAssets, PresentedModel[]>();
    for (const model of scene.models) {
      if (model.entity.model.kind === "brush-model") continue;
      const provider = this.media.modelProviders.get(model.source.model);
      if (provider === undefined) throw new Error("Cgame model lost its selected asset provider");
      const group = groups.get(provider); if (group === undefined) groups.set(provider, [model]); else group.push(model);
    }
    return groups;
  }
  operations(scene: Q3SceneContent, input: WorldViewInput, firstEntity: number, options: Q3SceneRenderOptions, additions: readonly SceneOperation[] = []): readonly SceneOperation[] {
    this.assertCurrent();
    const source = input.source;
    if (source === undefined) throw new Error("Q3 view has no source admission");
    const operations: SceneOperation[] = [], world = this.media.assets.world;
    const { noWorldModel } = options;
    const weaponInput = { ...input, camera: q3WeaponCamera(input.camera, options.splitScreen && !noWorldModel) };
    for (const [index, poly] of scene.admission.polygons.entries()) {
      const compiled = this.media.assets.materialRegistrations.requireMaterial(this.resources.picture(poly.shader).material.compiled);
      const remap = currentRemap(compiled), context = world.materialContext(input, undefined, poly.fog?.volume ?? null);
      operations.push(sourceDrawGroup(compiled, { view: source.view, entity: { kind: "world" }, surface: index, fog: poly.fog === null ? 0 : poly.fog.index + 1, dlight: 0 },
        prepareMaterialBatches(remap?.material ?? compiled, polyGeometry(poly), { ...context, timeOffset: context.timeOffset + (remap?.timeOffset ?? 0) })));
    }
    const polygon = (operation: SceneOperation): boolean => operation.kind === "scene-group" && operation.order.kind === "source" && operation.order.source.entity.kind === "world";
    operations.push(...additions.filter(polygon));
    const models = new Map(scene.models.map(model => [model.entityIndex, model]));
    const project = createViewProjector(input.camera), white = this.media.provider.textures.white.image;
    for (const [index, entity] of scene.admission.entities.entries()) {
      const entityOrder = { kind: "refentity", index: firstEntity + index } satisfies import("../../../render/scene/submissions.ts").SourceEntityOrder;
      if (options.supplementalViewWeapon && !noWorldModel && (entity.renderFlags & 4) !== 0) continue;
      if (input.camera.clip.kind === "portal" && (entity.renderFlags & 4) !== 0) continue;
      if (entity.kind === "poly") throw new CommonError("drop", "R_AddEntitySurfaces: Bad reType");
      if (entity.kind === "portal-surface") continue;
      if (entity.kind === "model") {
        if (entity.model.kind === "default") {
          if (input.camera.clip.kind === "none" && (entity.renderFlags & 2) !== 0) continue;
          operations.push(sourceDrawGroup(this.media.provider.shaders.sourceMaterials.default,
            { view: source.view, entity: entityOrder, surface: 0, fog: 0, dlight: 0 },
            [defaultModelBatch({ origin: entity.origin, axis: entity.axis, scale: { x: 1, y: 1, z: 1 } }, project, state, white)]));
          continue;
        }
        const model = models.get(index);
        if (model === undefined) throw new Error("Admitted Q3 model lost its prepared descriptor");
        const selected = (entity.renderFlags & 4) !== 0 ? weaponInput : input;
        if (model.entity.model.kind === "brush-model") {
          operations.push(...world.prepareModel(model.entity.model.model, { origin: entity.origin, axis: entity.axis },
            { ...selected, animationFrame: entity.frame, materialContext: { ...selected.materialContext, entityRGBA: entity.shaderRGBA } }, entityOrder));
        } else {
          const provider = this.media.modelProviders.get(entity.model);
          if (provider === undefined) throw new Error("Cgame model lost its selected asset provider");
          operations.push(...this.renderer(provider).prepare([model.entity], selected,
            () => ({ ...model.options, noWorldModel, shaderTexCoord: entity.shaderTexCoord, source: { view: source.view, entity: entityOrder } })));
        }
        continue;
      }
      if (input.camera.clip.kind === "none" && (entity.renderFlags & 2) !== 0) continue;
      const compiled = entity.customShader === null ? this.media.provider.shaders.sourceMaterials.default
        : this.media.assets.materialRegistrations.requireMaterial(this.resources.picture(entity.customShader).material.compiled);
      const remap = currentRemap(compiled);
      const fog = noWorldModel ? null : q3ProceduralFog(entity.origin, entity.radius, world.fogSelections);
      const order = { view: source.view, entity: entityOrder, surface: 0, fog: fog === null ? 0 : fog.index + 1, dlight: 0 };
      if (entity.kind === "beam") operations.push(sourceDrawGroup(compiled, order, [beamBatch(entity, project, state, white)]));
      else {
        const geometry = entity.kind === "sprite" ? spriteGeometry(entity, input.camera.axis, input.camera.clip.kind === "portal" && input.camera.clip.mirror)
          : railGeometry(entity, input.camera.origin, DEFAULT_RAIL_SETTINGS);
        operations.push(sourceDrawGroup(compiled, order, prepareMaterialBatches(remap?.material ?? compiled, geometry,
          { ...world.materialContext(input, undefined, fog?.volume ?? null), entityRGBA: entity.shaderRGBA, shaderTexCoord: entity.shaderTexCoord, timeOffset: entity.shaderTime + (remap?.timeOffset ?? 0) })));
      }
    }
    operations.push(...additions.filter(operation => !polygon(operation)));
    return operations;
  }
  close(): void { this.closed = true; this.renderers.clear(); }
}
