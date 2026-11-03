// SPDX-License-Identifier: GPL-2.0-or-later
/* Collision query and trace contracts, split from scene.ts. */
import type { ActorId } from "./identity.ts";
import type { Bounds, Plane, Vec3 } from "./math.ts";
import type { NumericProfile } from "./numeric.ts";
import type { BspPlane, Q2SurfaceInfo } from "./scene.ts";

export type TraceShape = { readonly kind: "point" } | { readonly kind: "box"; readonly bounds: Bounds } | { readonly kind: "capsule"; readonly bounds: Bounds };
export type TracePolicy =
  | {
      readonly kind: "q1";
      readonly move: "normal" | "no-monsters" | "missile";
      readonly hull: number | null /** Skips the width-based hull choice so box extents are traced exactly. */;
      readonly derived?: true;
    }
  | { readonly kind: "q2"; readonly contentsMask: number; readonly leafContents: "stored" | "merged" }
  | { readonly kind: "q3"; readonly contentsMask: number; readonly curves: boolean; readonly playerCurveClip: boolean };
export type QueryTarget = { readonly kind: "world" } | { readonly kind: "model"; readonly model: number; readonly origin: Vec3; readonly angles: Vec3 };
export interface TraceQuery {
  readonly start: Vec3;
  readonly end: Vec3;
  readonly shape: TraceShape;
  readonly target: QueryTarget;
  readonly policy: TracePolicy;
  readonly numeric: NumericProfile;
  readonly passActor: ActorId | null;
}
export type TraceContact = { readonly kind: "none" } | { readonly kind: "plane"; readonly plane: Plane };
export type TraceHit = { readonly kind: "none" } | { readonly kind: "world"; readonly model: number } | { readonly kind: "actor"; readonly actor: ActorId };
interface TraceFields {
  readonly fraction: number;
  readonly end: Vec3;
  readonly startSolid: boolean;
  readonly allSolid: boolean;
  readonly contact: TraceContact;
  readonly hit: TraceHit;
}
export type TraceResult = TraceFields &
  /** Source ABI fields retain the stored plane even when contact is none. */
  (
    | {
        readonly kind: "q1";
        readonly inOpen: boolean;
        readonly inWater: boolean;
        readonly sourcePlane: Plane;
        readonly surfaceFlags?: number /** Native contents of the hit, when the geometry provider reports them. */;
        readonly contents?: number;
      }
    | {
        readonly kind: "q2";
        readonly contents: number;
        readonly surface: Q2SurfaceInfo | null;
        readonly sourcePlane: BspPlane;
        readonly secondary: { readonly plane: BspPlane; readonly surface: Q2SurfaceInfo | null } | null;
      }
    | { readonly kind: "q3"; readonly contents: number; readonly surfaceFlags: number; readonly sourcePlane: BspPlane }
  );
export interface PointContentsQuery {
  readonly point: Vec3;
  readonly target: QueryTarget;
  readonly policy: TracePolicy;
  readonly numeric: NumericProfile;
  readonly passActor: ActorId | null;
}
export type PointContentsResult =
  | { readonly kind: "q1"; readonly contents: number }
  | { readonly kind: "q2"; readonly stored: number; readonly merged: number }
  | { readonly kind: "q3"; readonly contents: number };
export interface LeafQueryResult {
  readonly leaves: readonly number[];
  readonly topnode: number | null;
  readonly overflow: boolean;
}
export interface SceneQueries {
  trace(query: TraceQuery): TraceResult;
  pointContents(query: PointContentsQuery): PointContentsResult;
  boxLeaves(bounds: Bounds, limit: number): LeafQueryResult;
  areasConnected(first: number, second: number): boolean;
  clusterVisible(from: number, to: number, kind: "pvs" | "phs"): boolean;
}
