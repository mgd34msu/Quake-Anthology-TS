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
  private currentOriginView: { origin: Vec3 } | null = null;
  get currentOrigin(): Vec3 { return this.currentOriginView?.origin ?? this.body.read().origin; }
  set currentOrigin(value: Vec3) {
    this.body.write({ ...this.body.read(), origin: value });
    if (this.currentOriginView !== null) this.currentOriginView.origin = value;
  }
  /** ClientThink links a snapped source origin while ps.origin retains movement precision. */
  withCurrentOrigin(origin: Vec3, call: () => undefined): undefined {
    const previous = this.currentOriginView;
    this.currentOriginView = { origin: { ...origin } };
    try { return call(); } finally { this.currentOriginView = previous; }
  }
  get currentAngles(): Vec3 { return this.body.read().angles; }
  set currentAngles(value: Vec3) { this.body.write({ ...this.body.read(), angles: value }); }
  private absMinOverride: Vec3 | null = null;
  private absMaxOverride: Vec3 | null = null;
  capturePrivateState() {
    if (this.currentOriginView !== null) throw new Error("Cannot save inside a Q3 temporary origin view");
    return { previousLink: this.previousLink, absMinOverride: this.absMinOverride, absMaxOverride: this.absMaxOverride };
  }
  restorePrivateState(state: { readonly previousLink: LinkedBody | null; readonly absMinOverride: Vec3 | null; readonly absMaxOverride: Vec3 | null }): void {
    if (this.currentOriginView !== null) throw new Error("Cannot restore inside a Q3 temporary origin view");
    this.previousLink = state.previousLink;
    this.absMinOverride = state.absMinOverride === null ? null : { ...state.absMinOverride };
    this.absMaxOverride = state.absMaxOverride === null ? null : { ...state.absMaxOverride };
  }
  clearBoundsOverrides(): void { this.absMinOverride = null; this.absMaxOverride = null; }
  set absmin(value: Vec3) { this.absMinOverride = value; }
  set absmax(value: Vec3) { this.absMaxOverride = value; }
  get absmin(): Vec3 { return this.absMinOverride ?? this.body.linked()?.absoluteBounds.min ?? this.previousLink?.absoluteBounds.min ?? { x: 0, y: 0, z: 0 }; }
  get absmax(): Vec3 { return this.absMaxOverride ?? this.body.linked()?.absoluteBounds.max ?? this.previousLink?.absoluteBounds.max ?? { x: 0, y: 0, z: 0 }; }
}
export type SharedEntityState = Omit<Readonly<EntityStateFields>, "number" | "solid" | "modelindex"> & Pick<EntityStateFields, "number" | "solid" | "modelindex">;
export interface SharedEntity { readonly s: SharedEntityState; readonly r: EntityShared; }
