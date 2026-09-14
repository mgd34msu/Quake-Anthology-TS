// Cgame submissions translated into the shared scene model. GPL-2.0-or-later.
import type { ActorId, SeatId } from "../../../contracts/identity.ts";
import type { Rect, SceneCamera } from "../../../contracts/render.ts";
import type { SceneEntity, SceneLight } from "../../../contracts/scene.ts";
import type { ModelSourceOptions } from "../../../render/scene/models/types.ts";
import { polyGeometry, railGeometry, spriteGeometry } from "../../../render/scene/particles/primitives.ts";
import type { EntityGeometry, RailSettings } from "../../../render/scene/particles/primitives.ts";
import { perspectiveProjection } from "../../../render/scene/view.ts";
import { copyRefEntity, copyRefPoly } from "./ref-entity.ts";
import type { Q3AdmittedRefEntity, RefEntity, RefModelEntity, RefPoly, RefPortalEntity, SceneShader } from "./ref-entity.ts";
import { copyRefdef } from "./refdef.ts";
import type { Refdef } from "./refdef.ts";
import type { DynamicLight } from "./scene-host.ts";

class SceneAdmissionIdentity {
  readonly #token = Symbol("q3-scene-admission");
  constructor(readonly origin: "native" | "mixed") { Object.freeze(this); }
  equals(other: SceneAdmissionIdentity): boolean { return this.#token === other.#token; }
}
export type Q3SceneAdmissionId = SceneAdmissionIdentity;
export interface Q3SceneAdmission {
  readonly id: Q3SceneAdmissionId;
  readonly entities: readonly Q3AdmittedRefEntity[];
  readonly polygons: readonly RefPoly[];
}
export function snapshotQ3SceneAdmission(origin: Q3SceneAdmissionId["origin"], entities: readonly Q3AdmittedRefEntity[], polygons: readonly RefPoly[]): Q3SceneAdmission {
  return Object.freeze({ id: new SceneAdmissionIdentity(origin), entities: Object.freeze([...entities]), polygons: Object.freeze([...polygons]) });
}
export type Q3GeometryAdmission = { readonly kind: "refentity"; readonly index: number } | { readonly kind: "polygon"; readonly index: number };
export interface PresentedSpecialEntity {
  readonly entityIndex: number;
  readonly source: Extract<RefEntity, { readonly kind: "beam" }> | RefModelEntity;
}
export interface PresentedPortal {
  readonly entityIndex: number;
  readonly source: RefPortalEntity;
}

export interface PresentedModel {
  readonly entityIndex: number;
  readonly entity: SceneEntity;
  readonly options: ModelSourceOptions;
  /** Source material fields, including entityTranslate coordinates, stay available to stage evaluation. */
  readonly source: RefModelEntity;
}
export interface PresentedGeometry {
  readonly admission: Q3GeometryAdmission;
  readonly geometry: EntityGeometry; readonly shader: SceneShader | null;
  readonly source: Exclude<RefEntity, RefModelEntity | RefPortalEntity> | RefPoly;
}
export interface Q3PresentedScene {
  readonly admission: Q3SceneAdmission;
  readonly seat: SeatId;
  readonly viewport: Rect;
  readonly camera: SceneCamera;
  readonly source: Refdef;
  readonly models: readonly PresentedModel[];
  readonly effects: readonly PresentedGeometry[];
  /** The shared renderer preserves its source beam/default-model drawing paths. */
  readonly specialEntities: readonly PresentedSpecialEntity[];
  readonly portals: readonly PresentedPortal[];
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
  private readonly entities: Q3AdmittedRefEntity[] = [];
  private readonly polygons: RefPoly[] = [];
  private readonly lights: SceneLight[] = [];
  constructor(readonly target: Q3SceneTarget) {}
  clearScene(): void { this.entities.length = 0; this.polygons.length = 0; this.lights.length = 0; }
  addRefEntity(entity: Q3AdmittedRefEntity): void { this.entities.push(copyRefEntity(entity)); }
  addPoly(poly: RefPoly): void { this.polygons.push(copyRefPoly(poly)); }
  addLight(light: DynamicLight): void { this.lights.push({ ...light, origin: { ...light.origin }, color: { ...light.color }, additive: light.additive ?? false, profile: { kind: "q3" } }); }
  renderScene(input: Refdef): void {
    const admission = snapshotQ3SceneAdmission("native", this.entities, this.polygons);
    const source = copyRefdef(input), models: PresentedModel[] = [], effects: PresentedGeometry[] = [], portals: PresentedPortal[] = [];
    const specialEntities: PresentedSpecialEntity[] = [];
    for (const [entityIndex, entity] of admission.entities.entries()) {
      if (entity.kind === "poly") continue;
      if (entity.kind === "portal-surface") { portals.push({ entityIndex, source: entity }); continue; }
      if (entity.kind === "beam") { specialEntities.push({ entityIndex, source: entity }); continue; }
      if (entity.kind === "model") {
        const model = entity.model;
        if (model.kind === "default") { specialEntities.push({ entityIndex, source: entity }); continue; }
        models.push({ entityIndex, entity: {
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
      effects.push({ admission: { kind: "refentity", index: entityIndex }, geometry, shader: entity.customShader, source: entity });
    }
    for (const [index, poly] of admission.polygons.entries()) effects.push({ admission: { kind: "polygon", index }, geometry: polyGeometry(poly), shader: poly.shader, source: poly });
    const camera: SceneCamera = { viewport: { x: this.target.viewport.x + source.x, y: this.target.viewport.y + source.y, width: source.width, height: source.height }, origin: source.viewOrigin, axis: source.viewAxis,
      projection: perspectiveProjection(source.fovX, source.fovY, this.target.farClip, this.target.nearClip), clip: { kind: "none" } };
    this.target.publish({ admission, seat: this.target.seat, viewport: { x: this.target.viewport.x + source.x, y: this.target.viewport.y + source.y,
      width: source.width, height: source.height }, camera, source, models, effects, portals, specialEntities, lights: this.lights.slice() });
  }
}
