import type { ActorId } from "../../contracts/identity.ts";
import type { Bounds, Vec3 } from "../../contracts/math.ts";
import type { ActorAnimationState, AnimationStepResult, ArsenalState, MovementServices,
  Q3MovementInput, Q3MovementState, WeaponStepResult, FixedMovementPose } from "../../contracts/movement.ts";
import type { TraceHit, TraceResult } from "../../contracts/scene.ts";
import type { FrameContext } from "../../contracts/time.ts";

export interface Q3Command {
  serverTime: number; angles: Vec3; buttons: number; weapon: number;
  forwardmove: number; rightmove: number; upmove: number;
}

/** Only locomotion-owned words from playerState_t live in this mutable work state. */
export interface Q3Motion {
  commandTime: number; pmType: number; bobCycle: number; pmFlags: number; pmTime: number;
  origin: Vec3; velocity: Vec3; gravity: number; speed: number; deltaAngles: Vec3;
  ground: TraceHit; movementDir: number; grapplePoint: Vec3; eFlags: number;
  viewangles: Vec3; viewheight: number; pmoveFramecount: number; eventSequence: number;
  readonly actor: ActorId; readonly health: number; readonly flight: boolean;
  readonly invulnerable: boolean; readonly product: "baseq3" | "missionpack";
}

export type Q3AnimationRequest =
  | { readonly kind: "legs"; readonly animation: number; readonly force: boolean }
  | { readonly kind: "legs-timer"; readonly milliseconds: number }
  | { readonly kind: "drop-timers" }
  | { readonly kind: "gesture" };

export interface Q3HookContext {
  readonly input: Q3MovementInput;
  readonly motion: Readonly<Q3Motion>;
  readonly state: Q3MovementState;
  readonly command: Readonly<Q3Command>;
  readonly frame: FrameContext;
  readonly arsenal: ArsenalState;
  readonly animation: ActorAnimationState;
  readonly services: MovementServices;
}

export interface Q3WeaponPhaseResult extends WeaponStepResult {
  readonly movementFlags: number;
}

/** Selected arsenal and character adapters run at the original PM_* call sites. */
export interface Q3MovementHooks {
  firing(context: Q3HookContext): boolean;
  animation(request: Q3AnimationRequest, context: Q3HookContext): AnimationStepResult;
  weapon(context: Q3HookContext): Q3WeaponPhaseResult;
  torso(context: Q3HookContext): AnimationStepResult;
}

export type Q3MovementTraceFunction = (
  start: Vec3, end: Vec3, bounds: Bounds, passActor: ActorId, mask: number,
) => TraceResult;

export interface Q3MotionOptions {
  readonly pose?: FixedMovementPose;
  readonly trace: Q3MovementTraceFunction;
  readonly pointContents: (point: Vec3, passActor: ActorId) => number;
  readonly standingBounds: Bounds;
  readonly postures: Q3Postures;
  readonly traceMask: number;
  readonly fixedMsec: number | null;
  readonly noFootsteps: boolean;
  beginStep(state: Q3Motion, command: Q3Command, msec: number, substep: number): void | boolean;
  endStep?(state: Q3Motion): void | boolean;
  event(event: number): void;
  animation(request: Q3AnimationRequest): void;
  weapon(): void | boolean;
  torso(): void;
  firing(): boolean;
  contact(trace: TraceResult): void;
  readonly diagnostics?: { count: number; readonly level: number; print(message: string): void };
}

export interface Q3MotionResult {
  readonly contacts: readonly TraceResult[];
  readonly bounds: Bounds;
  readonly waterlevel: number;
  readonly watertype: number;
  readonly xyspeed: number;
}

export interface Q3Postures {
  readonly standingViewHeight: number;
  readonly crouched: { readonly bounds: Bounds; readonly viewHeight: number };
  readonly dead: { readonly bounds: Bounds; readonly viewHeight: number };
  readonly invulnerabilityExpanded: Bounds;
}
