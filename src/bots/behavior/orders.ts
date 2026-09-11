import type { Vec3 } from "../../contracts/math.ts";

/** Entity numbers belong to the observation boundary; generations prevent following a replacement. */
export interface BotOrderEntity { readonly number: number; readonly generation: number; }
export type BotOrder = { readonly kind: "point"; readonly point: Vec3 }
  | { readonly kind: "follow"; readonly entity: BotOrderEntity };
export type BotOrderProgress = "in-progress" | "success" | "error";
export interface BotOrderState { readonly order: BotOrder; readonly progress: BotOrderProgress; }
/** Values match the shipped QuakeC BOT_GOAL_* contract. */
export type BotGoalStatus = 0 | 1 | 2;
export function botOrderStatus(state: BotOrderState | null): BotGoalStatus {
  return state === null || state.progress === "error" ? 0 : state.progress === "success" ? 1 : 2;
}
export function botOrderActive(state: BotOrderState | null): boolean {
  return state !== null && state.progress !== "error" && (state.progress === "in-progress" || state.order.kind === "follow");
}
export function sameBotOrder(left: BotOrder, right: BotOrder): boolean {
  if (left.kind === "point" && right.kind === "point") return Math.hypot(left.point.x - right.point.x,
    left.point.y - right.point.y, left.point.z - right.point.z) < 8;
  return left.kind === "follow" && right.kind === "follow" && left.entity.number === right.entity.number
    && left.entity.generation === right.entity.generation;
}
