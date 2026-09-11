/* Source entityShared_t metadata. Body fields forward to the shared authority. GPL-2.0-or-later. */
import type { BodyState, LinkedBody } from "../../../../contracts/world.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { EntityStateFields } from "./entity-state.ts";
export type EntityCollisionModel = { readonly kind: "inline"; readonly index: number } | { readonly kind: "box" | "capsule" };
export enum ServerEntityFlags { NOCLIENT = 1, CLIENTMASK = 2, BOT = 8, BROADCAST = 32, PORTAL = 64,
  USE_CURRENT_ORIGIN = 128, SINGLECLIENT = 256, NOSERVERINFO = 512, NOTSINGLECLIENT = 2048 }
export interface EntityBodyBinding { read(): BodyState; write(value: BodyState): void; linked(): LinkedBody | null; }
export class EntityShared {
  svFlags = 0; singleClient = 0; model: EntityCollisionModel = { kind: "box" }; contents = 0; ownerNum = 0;
  constructor(private readonly body: EntityBodyBinding) {}
  get linked(): boolean { return this.body.linked() !== null; }
  private previousLink: LinkedBody | null = null;
  captureLink(): void { const linked = this.body.linked(); if (linked !== null) this.previousLink = linked; }
  get linkcount(): number { return this.body.linked()?.linkCount ?? this.previousLink?.linkCount ?? 0; }
  get mins(): Vec3 { return this.body.read().bounds.min; }
  set mins(value: Vec3) { const state = this.body.read(); this.body.write({ ...state, bounds: { ...state.bounds, min: value } }); }
  get maxs(): Vec3 { return this.body.read().bounds.max; }
  set maxs(value: Vec3) { const state = this.body.read(); this.body.write({ ...state, bounds: { ...state.bounds, max: value } }); }
  get currentOrigin(): Vec3 { return this.body.read().origin; }
  set currentOrigin(value: Vec3) { this.body.write({ ...this.body.read(), origin: value }); }
  get currentAngles(): Vec3 { return this.body.read().angles; }
  set currentAngles(value: Vec3) { this.body.write({ ...this.body.read(), angles: value }); }
  private absMinOverride: Vec3 | null = null;
  private absMaxOverride: Vec3 | null = null;
  clearBoundsOverrides(): void { this.absMinOverride = null; this.absMaxOverride = null; }
  set absmin(value: Vec3) { this.absMinOverride = value; }
  set absmax(value: Vec3) { this.absMaxOverride = value; }
  get absmin(): Vec3 { return this.absMinOverride ?? this.body.linked()?.absoluteBounds.min ?? this.previousLink?.absoluteBounds.min ?? { x: 0, y: 0, z: 0 }; }
  get absmax(): Vec3 { return this.absMaxOverride ?? this.body.linked()?.absoluteBounds.max ?? this.previousLink?.absoluteBounds.max ?? { x: 0, y: 0, z: 0 }; }
}
export type SharedEntityState = Omit<Readonly<EntityStateFields>, "number" | "solid" | "modelindex"> & Pick<EntityStateFields, "number" | "solid" | "modelindex">;
export interface SharedEntity { readonly s: SharedEntityState; readonly r: EntityShared; }
