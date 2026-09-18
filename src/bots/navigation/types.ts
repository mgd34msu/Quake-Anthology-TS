// SPDX-License-Identifier: GPL-2.0-or-later
import type { ContentDigest } from "../../contracts/content.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { Bounds, Vec3 } from "../../contracts/math.ts";
import type { MovementProfile } from "../../contracts/movement.ts";
import type { DecodedWorld, SceneQueries, TracePolicy, TraceShape } from "../../contracts/scene.ts";
import type { AasAsset } from "./aas.ts";
import type { KexNavigationAsset } from "./nav.ts";

export type TravelMode = "walk" | "crouch" | "jump" | "drop" | "swim" | "water-jump" | "ladder"
  | "teleport" | "mover" | "jump-pad" | "rocket-jump" | "bfg-jump" | "grapple" | "double-jump"
  | "ramp-jump" | "strafe-jump" | "unknown";
export interface NavigationMapIdentity { readonly name: string; readonly format: DecodedWorld["kind"]; readonly digest: ContentDigest; }
export interface NavigationProfile {
  readonly movement: MovementProfile;
  readonly shape: Exclude<TraceShape, { readonly kind: "point" }>;
  readonly crouchedShape?: Exclude<TraceShape, { readonly kind: "point" }>;
  readonly policy: TracePolicy;
  readonly capabilities: ReadonlySet<TravelMode>;
  readonly maximumStep: number;
  readonly minimumFloorNormal: number;
  readonly maximumDrop: number;
  readonly team: "red" | "blue" | null;
  readonly monster: boolean;
}
export type NavigationSource = { readonly kind: "aas"; readonly area: number; readonly reachability: number | null }
  | { readonly kind: "nav2" | "nav3"; readonly node: number; readonly link: number | null }
  | { readonly kind: "constructed"; readonly surface: number | null; readonly leaf: number | null };
export interface NavigationNode {
  readonly id: number; readonly origin: Vec3; readonly bounds: Bounds; readonly radius: number;
  readonly contents: number; readonly flags: number; readonly presence: number;
  readonly sourceCluster: number | null; readonly source: NavigationSource;
}
export interface TraversalHint { readonly funnel: Vec3; readonly start: Vec3; readonly end: Vec3; readonly ladderPlane: Vec3 | null; }
export interface NavigationEntityBinding {
  readonly model: number | null; readonly bounds: Bounds; readonly raw: readonly number[];
}
export interface NavigationEdge {
  readonly id: number; readonly from: number; readonly to: number; readonly mode: TravelMode;
  readonly start: Vec3; readonly end: Vec3; readonly travelSeconds: number;
  readonly sourceTravelType: number; readonly sourceFlags: number;
  readonly hint: TraversalHint | null; readonly entity: NavigationEntityBinding | null;
  readonly source: NavigationSource;
}
export interface NavigationGraph {
  readonly map: NavigationMapIdentity; readonly profile: NavigationProfile;
  readonly asset: AasAsset | KexNavigationAsset | null;
  readonly nodes: readonly NavigationNode[]; readonly edges: readonly NavigationEdge[];
  /** Structural directed components. Route publication separately requires movement admission. */
  readonly clusters: readonly (readonly number[])[];
  readonly rejected: readonly { readonly source: NavigationSource; readonly reason: string }[];
}
export interface TraversalRequest {
  readonly from: Vec3; readonly to: Vec3; readonly mode: TravelMode;
  readonly hint: TraversalHint | null; readonly entity: NavigationEntityBinding | null;
}
export type TraversalAdmission = { readonly admitted: true; readonly seconds: number; readonly trajectory: readonly Vec3[] }
  | { readonly admitted: false; readonly reason: string };
export interface NavigationRoutePrediction {
  /** Carries detached movement state between successful segments; discard the session after failure. */
  admit(request: TraversalRequest): TraversalAdmission;
}
export interface NavigationEntityState {
  readonly actor: ActorId; readonly enabled: boolean; readonly locked: boolean; readonly bounds: Bounds;
  readonly velocity: Vec3; readonly destination: Vec3 | null;
  readonly elevator?: { readonly origin: Vec3; readonly bottom: Vec3; readonly top: Vec3;
    readonly phase: "bottom" | "up" | "top" | "down" };
  readonly train?: { readonly origin: Vec3; readonly running: boolean;
    readonly stops: readonly { readonly id: number; readonly origin: Vec3; readonly next: number | null;
      readonly wait: number; readonly teleport: boolean }[] };
}
/** Reads shared world state. Prediction must use the selected movement provider without committing actors. */
export interface NavigationWorld {
  readonly scene: SceneQueries;
  readonly passActor: ActorId | null;
  /** Changes whenever collision, movers, hazards, or traversal availability change. */
  readonly revision: number;
  admit(request: TraversalRequest, profile: NavigationProfile): TraversalAdmission;
  beginRoute(profile: NavigationProfile): NavigationRoutePrediction;
  entity(binding: NavigationEntityBinding): NavigationEntityState | null;
  hazard(bounds: Bounds): boolean;
}
export interface NavigationRoute {
  readonly map: NavigationMapIdentity; readonly nodes: readonly number[]; readonly edges: readonly NavigationEdge[];
  /** Movement probes supply walking points; authored elevator endpoints are executed against the live mover. */
  readonly points: readonly Vec3[]; readonly travelSeconds: number; readonly generation: number;
}
export type NavigationRouteResult = { readonly kind: "route"; readonly route: NavigationRoute }
  | { readonly kind: "unreachable"; readonly reason: string };

/** Metadata cost query; a null origin excludes the approach within the first area. */
export interface NavigationEstimateQuery {
  readonly startNode: number;
  readonly goalNode: number;
  readonly origin: Vec3 | null;
  readonly travelFlags?: number;
}
/** Source centiseconds are estimates, never a movement-admitted trajectory or duration. */
export type NavigationEstimateResult = { readonly kind: "estimate"; readonly travelTime: number; readonly firstEdge: NavigationEdge | null }
  | { readonly kind: "unreachable" };
