import type { Bounds, Vec3 } from "../../../contracts/math.ts";
import type { TraceResult } from "./collision-host.ts";
import type { SourcePlayerState, UserCommand } from "../base/shared/player-state.ts";
export interface MovementTrace extends TraceResult { readonly entityNum: number; }
export interface PresentationMovementOptions {
  readonly originalServerTime?: number;
  trace(start: Vec3, end: Vec3, bounds: Bounds, skipNumber: number, mask: number): MovementTrace;
  pointContents(point: Vec3, passEntity: number): number;
  readonly traceMask: number; readonly fixedMsec: number | null; readonly noFootsteps: boolean; readonly gauntletHit: boolean;
}
/** Prediction invokes the recipe's selected movement, arsenal and character owners together. */
export interface PresentationMovementHost {
  readonly commandTiming: "q3" | "provider";
  movePlayer(state: SourcePlayerState, command: UserCommand, options: PresentationMovementOptions): { readonly bounds: Bounds };
  updateViewAngles(state: SourcePlayerState, command: UserCommand): void;
}
