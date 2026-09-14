import type { FogVolume } from "../../../materials/fog.ts";
import type { Vec3 } from "../../../contracts/math.ts";
// Cgame submissions translated into the shared scene model. GPL-2.0-or-later.
import type { ActorId, SeatId } from "../../../contracts/identity.ts";
import type { Rect, SceneCamera } from "../../../contracts/render.ts";
import type { SceneEntity, SceneLight } from "../../../contracts/scene.ts";
import type { ModelSourceOptions } from "../../../render/scene/models/types.ts";
import type { RailSettings } from "../../../render/scene/particles/primitives.ts";
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
  readonly polygons: readonly Q3AdmittedPoly[];
}
export function snapshotQ3SceneAdmission(origin: Q3SceneAdmissionId["origin"], entities: readonly Q3AdmittedRefEntity[], polygons: readonly Q3AdmittedPoly[]): Q3SceneAdmission {
  return Object.freeze({ id: new SceneAdmissionIdentity(origin), entities: Object.freeze([...entities]), polygons: Object.freeze([...polygons]) });
}
export interface Q3FogSelection { readonly index: number; readonly volume: FogVolume; }
export interface Q3AdmittedPoly extends RefPoly { readonly fog: Q3FogSelection | null; }
export function admitQ3Poly(poly: RefPoly, fogs: readonly Q3FogSelection[]): Q3AdmittedPoly {
  const copied = copyRefPoly(poly), first = copied.vertices[0];
  if (fogs.length === 0) return { ...copied, fog: null };
  if (first === undefined) throw new RangeError("Source polygon fog requires its first admitted vertex");
  const min = { ...first.position }, max = { ...first.position };
  for (const { position } of copied.vertices) {
    min.x = Math.min(min.x, position.x); min.y = Math.min(min.y, position.y); min.z = Math.min(min.z, position.z);
    max.x = Math.max(max.x, position.x); max.y = Math.max(max.y, position.y); max.z = Math.max(max.z, position.z);
  }
  const fog = fogs.find(({ volume: { bounds } }) => max.x >= bounds.min.x && max.y >= bounds.min.y && max.z >= bounds.min.z
    && min.x <= bounds.max.x && min.y <= bounds.max.y && min.z <= bounds.max.z) ?? null;
  return { ...copied, fog };
}
export function q3ProceduralFog(origin: Vec3, radius: number, fogs: readonly Q3FogSelection[]): Q3FogSelection | null {
  return fogs.find(({ volume: { bounds } }) => origin.x - radius < bounds.max.x && origin.x + radius > bounds.min.x
    && origin.y - radius < bounds.max.y && origin.y + radius > bounds.min.y
    && origin.z - radius < bounds.max.z && origin.z + radius > bounds.min.z) ?? null;
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
  readonly shader: SceneShader | null;
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
  fogSelections(): readonly Q3FogSelection[];
  print(text: string): void;
  actor(entity: RefModelEntity): ActorId | null;
  publish(scene: Q3PresentedScene): void;
}

/** Per-seat scene admission copies source records, retaining resource identities. */
export class Q3SceneRecorder {
  private readonly entities: Q3AdmittedRefEntity[] = [];
  private readonly polygons: Q3AdmittedPoly[] = [];
  private readonly lights: SceneLight[] = [];
  constructor(readonly target: Q3SceneTarget) {}
  clearScene(): void { this.entities.length = 0; this.polygons.length = 0; this.lights.length = 0; }
  addRefEntity(entity: Q3AdmittedRefEntity): void { this.entities.push(copyRefEntity(entity)); }
  addPoly(poly: RefPoly): void {
    if (poly.shader === null) { this.target.print("^3WARNING: RE_AddPolyToScene: NULL poly shader\n"); return; }
    this.polygons.push(admitQ3Poly(poly, this.target.fogSelections()));
  }
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
      effects.push({ admission: { kind: "refentity", index: entityIndex }, shader: entity.customShader, source: entity });
    }
    for (const [index, poly] of admission.polygons.entries()) effects.push({ admission: { kind: "polygon", index }, shader: poly.shader, source: poly });
    const camera: SceneCamera = { viewport: { x: this.target.viewport.x + source.x, y: this.target.viewport.y + source.y, width: source.width, height: source.height }, origin: source.viewOrigin, axis: source.viewAxis,
      projection: perspectiveProjection(source.fovX, source.fovY, this.target.farClip, this.target.nearClip), clip: { kind: "none" } };
    this.target.publish({ admission, seat: this.target.seat, viewport: { x: this.target.viewport.x + source.x, y: this.target.viewport.y + source.y,
      width: source.width, height: source.height }, camera, source, models, effects, portals, specialEntities, lights: this.lights.slice() });
  }
}
