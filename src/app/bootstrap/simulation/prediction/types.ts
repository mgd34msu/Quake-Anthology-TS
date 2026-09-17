import type { ExecutableRecipe } from "../../../../contracts/content.ts";
import type { ArsenalIntent } from "../../../../contracts/gameplay.ts";
import type { OwnedActor, SeatId } from "../../../../contracts/identity.ts";
import type { Bounds, Vec3 } from "../../../../contracts/math.ts";
import type { ActorAnimationState, ArsenalState, MovementEnvironment, MovementProfile, MovementState, OrderedMovementEffect } from "../../../../contracts/movement.ts";
import type { UserCommand } from "../../../../contracts/protocol.ts";
import type { SceneQueries, TraceHit } from "../../../../contracts/scene.ts";
import type { Q3ArsenalRuntimeState } from "../../../../content/q3/foundation/arsenal.ts";
import type { Q2RereleaseMovementContext } from "../../../../movement/q2/index.ts";

/** Captured with the authoritative snapshot, then copied into one seat's replay state. */
export interface MovementPredictionSnapshot {
  readonly sequence: number;
  readonly commandTimeMilliseconds: number;
  readonly state: MovementState;
  readonly arsenal: ArsenalState;
  readonly animation: ActorAnimationState;
  readonly environment: MovementEnvironment;
  readonly bounds: Bounds;
  readonly viewAngles: Vec3;
  readonly viewHeight: number;
  readonly viewOffset: Vec3;
  readonly contact: { readonly ground: TraceHit; readonly waterLevel: number; readonly waterType: number } | null;
  readonly q3Arsenal: Q3ArsenalRuntimeState | null;
}

export interface MovementPredictionOptions {
  readonly movementOnly?: boolean;
  readonly actor: OwnedActor;
  readonly seat: SeatId;
  readonly recipe: ExecutableRecipe;
  readonly profile: MovementProfile;
  readonly standingBounds: Bounds;
  readonly standingViewHeight: number;
  readonly scene: SceneQueries;
  readonly isBrush: (hit: TraceHit) => boolean;
}
/** Navigation probes use the same genuine actor reference without manufacturing a local seat. */
export type MovementProbeOptions = Omit<MovementPredictionOptions, "seat">;

export interface PredictionCommand {
  readonly angleSpace?: "absolute" | "source-relative";
  readonly sequence: number;
  readonly timeMilliseconds: number;
  readonly command: UserCommand;
  readonly arsenal?: ArsenalIntent;
}

export interface MovementPredictionResult {
  readonly status: "predicted" | "unchanged" | "disabled" | "history-exhausted";
  readonly player: MovementPredictionSnapshot;
  readonly effects: readonly OrderedMovementEffect[];
}

export interface PredictionStepOptions {
  readonly scene: SceneQueries;
  readonly rereleaseMovement: Q2RereleaseMovementContext;
  readonly fixedMilliseconds: number | null;
  readonly noFootsteps: boolean;
  readonly gauntletHit: boolean;
  readonly traceMask: number | null;
  readonly firstCommand: boolean;
}
