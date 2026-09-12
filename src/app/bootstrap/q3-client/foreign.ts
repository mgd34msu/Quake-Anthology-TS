import { weaponViewOrigin } from "../weapon-view.ts";
import type { ActorId } from "../../../contracts/identity.ts";
import type { SceneEntity } from "../../../contracts/scene.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import { anglesToAxis } from "../../../core/math.ts";
import type { ModelSourceOptions } from "../../../render/scene/models/types.ts";
import { SceneModelRenderer } from "../../../render/scene/models/renderer.ts";
import type { WorldViewInput } from "../../../render/scene/world.ts";
import type { DrawBatch, SceneCamera } from "../../../contracts/render.ts";
import type { ClientEntity } from "../../../content/q3/presentation/state.ts";
import type { ApplicationAssets, ProviderSceneAssets } from "../assets.ts";
import type { SimulationPresentation } from "../simulation/types.ts";

interface Model {
  readonly actor: ActorId; readonly source: SimulationPresentation; readonly entity: SceneEntity;
  readonly options: ModelSourceOptions;
}
interface Group { readonly renderer: SceneModelRenderer; readonly models: Model[]; }

/** Selected foreign models use their own assets and animation with cgame's interpolated player pose. */
export class ApplicationQ3ForeignModels {
  private readonly groups = new Map<ProviderSceneAssets, Group>();
  private readonly poses = new Map<ActorId, { readonly origin: Vec3; readonly angles: Vec3 }>();
  constructor(readonly assets: ApplicationAssets, readonly actor: ActorId, readonly sourceActor: (number: number) => ActorId) {}
  character(entity: ClientEntity): void {
    this.poses.set(this.sourceActor(entity.currentState.number), { origin: entity.lerpOrigin, angles: entity.lerpAngles });
  }
  async prepare(presentations: readonly SimulationPresentation[]): Promise<void> {
    this.poses.clear();
    for (const group of this.groups.values()) group.models.length = 0;
    for (const source of presentations) {
      if (source.family === "q3" || !source.visible || source.path === "" || source.viewWeapon && !source.actor.equals(this.actor)) continue;
      const asset = await this.assets.model(source.content, source.path);
      if (asset.model.kind === "brush-model") continue;
      let group = this.groups.get(asset.provider);
      if (group === undefined) { group = { renderer: new SceneModelRenderer(asset.provider, this.assets.world), models: [] }; this.groups.set(asset.provider, group); }
      const entity: SceneEntity = { actor: source.actor, resource: asset.resource, model: asset.model,
        transform: { origin: weaponViewOrigin(source), axis: anglesToAxis(source.angles), scale: { x: source.scale, y: source.scale, z: source.scale } },
        previousOrigin: source.origin, pose: { kind: "frame", frame: source.frame, previousFrame: source.oldFrame, backLerp: source.backLerp ?? 0 },
        skin: source.skin, color: { x: 1, y: 1, z: 1, w: source.alpha ?? 1 }, shaderTime: { kind: "seconds", value: 0 }, flags: { kind: source.family, bits: source.renderFlags },
        lightingOrigin: source.origin, shadowPlane: 0, attachments: [] };
      group.models.push({ actor: source.actor, source, entity, options: { viewModel: source.viewWeapon,
        player: source.family === "q2" && source.path.startsWith("players/"), customShader: source.skinPath ?? null } });
    }
    for (const group of this.groups.values()) await group.renderer.preload(group.models.map(model => model.entity), entity => group.models.find(model => model.entity === entity)?.options ?? {});
  }
  draw(input: WorldViewInput, thirdPerson: boolean, drawWeapon: boolean, weaponCamera: SceneCamera): readonly DrawBatch[] {
    const batches: DrawBatch[] = [];
    for (const group of this.groups.values()) for (const model of group.models) {
      const personal = model.actor.equals(this.actor);
      if (model.source.viewWeapon ? !drawWeapon || thirdPerson || input.camera.clip.kind === "portal" : personal && !thirdPerson && input.camera.clip.kind === "none") continue;
      const pose = this.poses.get(model.actor);
      const entity = pose === undefined || model.source.viewWeapon ? model.entity : { ...model.entity,
        transform: { ...model.entity.transform, origin: pose.origin, axis: anglesToAxis(pose.angles) }, lightingOrigin: pose.origin };
      batches.push(...group.renderer.prepare([entity], model.source.viewWeapon ? { ...input, camera: weaponCamera } : input, () => model.options));
    }
    return batches;
  }
  close(): void { this.groups.clear(); this.poses.clear(); }
}
