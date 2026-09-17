// Source be_ai_move.c decisions borrow shared navigation and selected movement prediction.
// SPDX-License-Identifier: GPL-2.0-or-later
import type { Bounds, Vec3 } from "../../../../contracts/math.ts";
import type { ServerTraceResult } from "../../../../content/q3/base/world.ts";
import type { NavigationRuntime } from "../../../navigation/runtime.ts";
import type { NavigationEdge } from "../../../navigation/types.ts";
import type { AasAsset } from "../../../navigation/aas.ts";
import type { BotActionBuffer } from "../../library/actions.ts";
import type { BotRandom } from "../../library/weights.ts";
import type { BotMovementPrediction, BotNavigation } from "../navigation-types.ts";
import type { BotMoveResult, BotMoveState, BotMoveStateStore, BotMoveVariable } from "../movement-state.ts";

export interface BotTravelPredictionResult {
  readonly end: Vec3; readonly velocity: Vec3; readonly frames: number; readonly stopEvent: number;
  /** Explicit crossing area wins over classifying an endpoint exactly on a BSP plane. */
  readonly endArea: number | null;
  readonly trajectory: readonly Vec3[]; readonly seconds: number; readonly grounded: boolean; readonly waterLevel: number;
}
export interface BotTravelModel {
  readonly entity: number; readonly origin: Vec3; readonly bounds: Bounds;
  readonly kind: "elevator" | "bobbing" | "door" | "train" | "static";
}
export interface SourceBotTravelHost {
  readonly actions: BotActionBuffer; readonly moveStates: BotMoveStateStore; readonly random: BotRandom;
  readonly navigation: Pick<BotNavigation, "area" | "pointArea" | "traceAreas" | "presenceBounds" | "swimming">
    & { fuzzyPointReachabilityArea(origin: Vec3): number; reachabilityArea(origin: Vec3, client: number): number };
  runtime(client: number): NavigationRuntime;
  time(): number;
  pointContents(point: Vec3): number;
  trace(start: Vec3, end: Vec3, bounds: Bounds | null, passEntity: number, mask: number): ServerTraceResult;
  entityModelIndex(entity: number): number;
  modelInfo(model: number): BotTravelModel | null;
  nextEntity(after: number): number;
  entityType(entity: number): number;
  entityWeapon(entity: number): number;
  travelWeapon(client: number, mode: "rocket-jump" | "bfg-jump" | "grapple"): number | null;
  /** Convert the requested world-space action to the selected provider; retain detached state only. */
  predict(query: BotMovementPrediction): BotTravelPredictionResult;
}
export type TravelReachability = AasAsset["reachability"][number] & { readonly graphEdge: NavigationEdge };
export type BotMovementVariableName = "svMaxStep" | "svMaxBarrier" | "svGravity" | "rocketLauncherIndex"
  | "bfgIndex" | "grappleIndex" | "missileEntityType" | "offhandGrapple" | "grappleOnCommand" | "grappleOffCommand";
export interface BotTravelContext {
  readonly host: SourceBotTravelHost; readonly actions: BotActionBuffer;
  variable(name: BotMovementVariableName): BotMoveVariable;
  time(): number;
  print(severity: 1 | 3 | 4, text: string): void;
  areaPresence(area: number): number;
  pointArea(point: Vec3): number;
  pointContents(point: Vec3): number;
  reachability(number: number): TravelReachability | null;
  modelInfo(model: number): BotTravelModel | null;
  onMover(state: BotMoveState, reach: TravelReachability): boolean;
  moverDown(reach: TravelReachability): boolean;
  weapon(client: number, mode: "rocket-jump" | "bfg-jump" | "grapple"): number;
  vectorToAngles(direction: Vec3): Vec3;
  gapDistance(origin: Vec3, direction: Vec3, entity: number): number;
  checkBarrierJump(state: BotMoveState, direction: Vec3, speed: number): boolean;
  checkBlocked(state: BotMoveState, direction: Vec3, bottom: boolean, result: BotMoveResult): void;
  jumpRunStart(state: BotMoveState, reach: TravelReachability): Vec3;
  jumpSpeed(state: BotMoveState, start: Vec3, end: Vec3, initialVerticalVelocity: number): { readonly success: boolean; readonly velocity: number };
  airControl(state: BotMoveState, goal: Vec3): { readonly controlled: boolean; readonly direction: Vec3; readonly speed: number };
}
