// Cgame submissions translated into the shared scene model. GPL-2.0-or-later.
import type { ActorId, SeatId } from "../../../contracts/identity.ts";
import type { Rect, SceneCamera } from "../../../contracts/render.ts";
import type { SceneEntity, SceneLight } from "../../../contracts/scene.ts";
import type { ModelSourceOptions } from "../../../render/scene/models/types.ts";
import { polyGeometry, railGeometry, spriteGeometry } from "../../../render/scene/particles/primitives.ts";
import type { EntityGeometry, RailSettings } from "../../../render/scene/particles/primitives.ts";
import { perspectiveProjection } from "../../../render/scene/view.ts";
import { copyRefEntity, copyRefPoly } from "./ref-entity.ts";
import type { RefEntity, RefModelEntity, RefPoly, RefPortalEntity, SceneShader } from "./ref-entity.ts";
import { copyRefdef } from "./refdef.ts";
import type { Refdef } from "./refdef.ts";
import type { DynamicLight } from "./scene-host.ts";

export interface PresentedModel {
  readonly entity: SceneEntity;
  readonly options: ModelSourceOptions;
  /** Source material fields, including entityTranslate coordinates, stay available to stage evaluation. */
  readonly source: RefModelEntity;
}
export interface PresentedGeometry {
  readonly geometry: EntityGeometry; readonly shader: SceneShader | null;
  readonly source: Exclude<RefEntity, RefModelEntity | RefPortalEntity> | RefPoly;
}
export interface Q3PresentedScene {
  readonly seat: SeatId;
  readonly viewport: Rect;
  readonly camera: SceneCamera;
  readonly source: Refdef;
  readonly models: readonly PresentedModel[];
  readonly effects: readonly PresentedGeometry[];
  /** The shared renderer preserves its source beam/default-model drawing paths. */
  readonly specialEntities: readonly (Extract<RefEntity, { readonly kind: "beam" }> | RefModelEntity)[];
  readonly portals: readonly RefPortalEntity[];
  readonly lights: readonly SceneLight[];
}
export interface Q3SceneTarget {
  readonly seat: SeatId;
  readonly viewport: Rect;
  readonly farClip: number;
  readonly nearClip: number;
  readonly rail: RailSettings;
  actor(entity: RefModelEntity): ActorId | null;
  publish(scene: Q3PresentedScene): void;
}

/** Per-seat scene admission copies source records, retaining resource identities. */
export class Q3SceneRecorder {
  private readonly entities: RefEntity[] = [];
  private readonly polygons: RefPoly[] = [];
  private readonly lights: SceneLight[] = [];
  constructor(readonly target: Q3SceneTarget) {}
  clearScene(): void { this.entities.length = 0; this.polygons.length = 0; this.lights.length = 0; }
  addRefEntity(entity: RefEntity): void { this.entities.push(copyRefEntity(entity)); }
  addPoly(poly: RefPoly): void { this.polygons.push(copyRefPoly(poly)); }
  addLight(light: DynamicLight): void { this.lights.push({ ...light, origin: { ...light.origin }, color: { ...light.color }, additive: light.additive ?? false, profile: { kind: "q3" } }); }
  renderScene(input: Refdef): void {
    const source = copyRefdef(input), models: PresentedModel[] = [], effects: PresentedGeometry[] = [], portals: RefPortalEntity[] = [];
    const specialEntities: (Extract<RefEntity, { readonly kind: "beam" }> | RefModelEntity)[] = [];
    for (const entity of this.entities) {
      if (entity.kind === "portal-surface") { portals.push(entity); continue; }
      if (entity.kind === "beam") { specialEntities.push(entity); continue; }
      if (entity.kind === "model") {
        const model = entity.model;
        if (model.kind === "default") { specialEntities.push(entity); continue; }
        models.push({ entity: {
          actor: this.target.actor(entity), resource: model.resource, model: model.kind === "inline" ? { kind: "brush-model", world: model.geometry, model: model.index } : model.model,
          transform: { origin: entity.origin, axis: entity.axis, scale: { x: 1, y: 1, z: 1 } }, previousOrigin: entity.oldOrigin,
          pose: { kind: "frame", frame: entity.frame, previousFrame: entity.oldFrame, backLerp: entity.backLerp }, skin: entity.skinNum,
          color: { x: entity.shaderRGBA.x / 255, y: entity.shaderRGBA.y / 255, z: entity.shaderRGBA.z / 255, w: entity.shaderRGBA.w / 255 },
          shaderTime: { kind: "seconds", value: entity.shaderTime }, flags: { kind: "q3", bits: entity.renderFlags },
          lightingOrigin: entity.lightingOrigin, shadowPlane: entity.shadowPlane, attachments: [],
        }, source: entity, options: { customShader: entity.customShader?.name ?? null, customSkin: entity.customSkin?.surfaces ?? null, nonNormalizedAxes: entity.nonNormalizedAxes } });
        continue;
      }
      const geometry = entity.kind === "sprite" ? spriteGeometry(entity, source.viewAxis, false)
        : railGeometry(entity, source.viewOrigin, this.target.rail);
      effects.push({ geometry, shader: entity.customShader, source: entity });
    }
    for (const poly of this.polygons) effects.push({ geometry: polyGeometry(poly), shader: poly.shader, source: poly });
    const camera: SceneCamera = { viewport: { x: this.target.viewport.x + source.x, y: this.target.viewport.y + source.y, width: source.width, height: source.height }, origin: source.viewOrigin, axis: source.viewAxis,
      projection: perspectiveProjection(source.fovX, source.fovY, this.target.farClip, this.target.nearClip), clip: { kind: "none" } };
    this.target.publish({ seat: this.target.seat, viewport: { x: this.target.viewport.x + source.x, y: this.target.viewport.y + source.y,
      width: source.width, height: source.height }, camera, source, models, effects, portals, specialEntities, lights: this.lights.slice() });
  }
}
