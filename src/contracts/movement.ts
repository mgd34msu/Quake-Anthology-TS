/* Movement state and command fields derive from Q1 sv_user.c/QW pmove.h,
 * Q2 q_shared.h and rerelease game.h, and Q3 bg_pmove.c/playerState_t.
 * Copyright (C) 1996-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { InventoryEntry, ItemId } from "./gameplay.ts";
import type { ActorId, OwnedActor, ProviderId } from "./identity.ts";
import type { Bounds, Vec3, Vec4 } from "./math.ts";
import type { NumericOperations, NumericProfile } from "./numeric.ts";
import type { Q1UserCommand, QwUserCommand, Q2UserCommand, Q2RereleaseUserCommand,
  Q3UserCommand, Q2MovementState, Q2RereleaseMovementState, Q3PlayerState, UserCommand } from "./protocol.ts";
import type { SceneQueries, TraceHit, TraceResult, TraceShape } from "./scene.ts";
import type { ClockProfile, FrameContext, SourceTime } from "./time.ts";
import type { TouchContact } from "./world.ts";

/** These are source command shapes; the selected wire codec does not choose movement. */
export type MovementCommand = UserCommand;

/** Shared equipment contributes movement at the original player's Pmove boundary. */
export interface EquipmentMovement {
  readonly velocity?: Vec3;
  readonly gravityScale: number;
  readonly predictionSuppressed: boolean;
}
export type { Q2MovementState, Q2RereleaseMovementState } from "./protocol.ts";

export interface Q1MovementState {
  readonly kind: "q1-netquake";
  readonly origin: Vec3; readonly velocity: Vec3; readonly angles: Vec3;
  readonly oldOrigin: Vec3; readonly angularVelocity: Vec3;
  readonly viewAngles: Vec3; readonly punchAngles: Vec3;
  readonly moveType: number; readonly flags: number;
  readonly ground: TraceHit;
  readonly waterLevel: number; readonly waterType: number;
  readonly teleportTimeSeconds: number;
  readonly waterJumpDirection: Vec3;
  readonly idealPitch: number;
  readonly fixAngle: boolean;
  readonly health: number;
}
export interface QwMovementState {
  readonly kind: "q1-quakeworld";
  readonly origin: Vec3; readonly velocity: Vec3; readonly angles: Vec3;
  readonly oldButtons: number;
  readonly waterJumpTimeSeconds: number;
  readonly dead: boolean;
  readonly spectator: number;
  readonly ground: TraceHit;
}
/** Weapon, ammo and animation state have independent owners below. */
export interface Q3MovementState extends Pick<Q3PlayerState,
  "commandTimeMilliseconds" | "movementType" | "bobCycle" | "movementFlags" | "movementTimeMilliseconds"
  | "origin" | "velocity" | "gravity" | "speed" | "deltaAngleWords" | "movementDirection"
  | "grapplePoint" | "flags" | "viewAngles" | "viewHeight"> {
  readonly kind: "q3";
  readonly ground: TraceHit;
  readonly predictableEventSequence: number;
  readonly jumpPad: ActorId | null;
  readonly movementFrame: number;
  readonly jumpPadFrame: number;
}
export type MovementState = Q1MovementState | QwMovementState | Q2MovementState | Q2RereleaseMovementState | Q3MovementState;

interface MovementProfileFields {
  readonly id: ProviderId;
  readonly clock: ClockProfile;
  readonly numeric: NumericProfile;
}
export interface Q1MovementParameters {
  readonly gravity: number; readonly stopSpeed: number; readonly maxSpeed: number;
  readonly spectatorMaxSpeed: number; readonly accelerate: number; readonly airAccelerate: number;
  readonly waterAccelerate: number; readonly friction: number; readonly waterFriction: number;
  readonly entityGravity: number;
}
export interface Q1MovementProfile extends MovementProfileFields {
  readonly kind: "q1-netquake";
  readonly edition: "classic" | "rerelease" | "quake64";
  readonly parameters: Q1MovementParameters;
  readonly edgeFriction: number;
  readonly noClipAngleHack: boolean;
}
export interface QwMovementProfile extends MovementProfileFields {
  readonly kind: "q1-quakeworld";
  readonly parameters: Q1MovementParameters;
}
export interface Q2MovementProfile extends MovementProfileFields {
  readonly strafejumpHack?: boolean;
  readonly kind: "q2-classic";
  readonly airAccelerate: number;
  readonly snapInitial: boolean;
}
export interface Q2RereleaseMovementProfile extends MovementProfileFields {
  readonly kind: "q2-rerelease";
  readonly airAccelerate: number;
  readonly n64Physics: boolean;
}
export interface Q3MovementProfile extends MovementProfileFields {
  readonly kind: "q3";
  readonly product: "baseq3" | "missionpack";
  readonly fixedMilliseconds: number | null;
  readonly noFootsteps: boolean;
}
export type MovementProfile = Q1MovementProfile | QwMovementProfile | Q2MovementProfile | Q2RereleaseMovementProfile | Q3MovementProfile;

export type WeaponState = {
  readonly kind: "q1"; readonly frame: number; readonly attackFinishedSeconds: number;
  readonly sourceWeapon: number;
} | {
  readonly kind: "q2"; readonly gunFrame: number; readonly state: number;
  readonly pendingWeapon: ItemId | null; readonly machinegunShots: number;
  readonly grenadeTime: SourceTime; readonly grenadeBlewUp: boolean;
} | {
  readonly kind: "q3"; readonly sourceWeapon: number; readonly state: number;
  readonly timeMilliseconds: number;
};
export interface ArsenalState {
  readonly provider: ProviderId;
  readonly activeWeapon: ItemId | null;
  readonly state: WeaponState;
  readonly ammo: readonly InventoryEntry[];
}
export type AnimationState = {
  readonly kind: "q1"; readonly frame: number; readonly nextFrameSeconds: number;
} | {
  readonly kind: "q2"; readonly frame: number; readonly endFrame: number;
  readonly priority: number; readonly duck: boolean; readonly run: boolean;
} | {
  readonly kind: "q3"; readonly legs: number; readonly torso: number;
  readonly legsTimerMilliseconds: number; readonly torsoTimerMilliseconds: number;
};
export interface ActorAnimationState { readonly provider: ProviderId; readonly state: AnimationState; }
export interface FixedMovementPose {
  readonly kind: "fixed";
  readonly crouched: boolean;
  readonly bounds: Bounds;
  readonly viewHeight: number;
}
export interface MovementEnvironment {
  readonly pose?: FixedMovementPose;
  readonly health: number;
  readonly flight: boolean;
  readonly haste: boolean;
  readonly invulnerable: boolean;
  readonly gravityMultiplier: number;
}
interface MovementInputFields {
  readonly actor: OwnedActor;
  readonly commandSequence: number;
  readonly frame: FrameContext;
  /** Bounds come from the chosen character's collision body. */
  readonly shape: TraceShape;
  readonly environment: MovementEnvironment;
  readonly arsenal: ArsenalState;
  readonly animation: ActorAnimationState;
  readonly execution: "authoritative" | "prediction";
}
export interface Q1MovementInput extends MovementInputFields {
  readonly kind: "q1-netquake"; readonly command: Q1UserCommand;
  readonly state: Q1MovementState; readonly profile: Q1MovementProfile;
}
export interface QwMovementInput extends MovementInputFields {
  readonly kind: "q1-quakeworld"; readonly command: QwUserCommand;
  readonly state: QwMovementState; readonly profile: QwMovementProfile;
}
export interface Q2MovementInput extends MovementInputFields {
  readonly kind: "q2-classic"; readonly command: Q2UserCommand;
  readonly state: Q2MovementState; readonly profile: Q2MovementProfile;
}
export interface Q2RereleaseMovementInput extends MovementInputFields {
  readonly kind: "q2-rerelease"; readonly command: Q2RereleaseUserCommand;
  readonly state: Q2RereleaseMovementState; readonly profile: Q2RereleaseMovementProfile;
  /** Game/cgame snapshots supply the same previous camera offset and external-state snap flag. */
  readonly viewOffset: Vec3;
  readonly snapInitial: boolean;
}
export interface Q3MovementInput extends MovementInputFields {
  readonly kind: "q3"; readonly command: Q3UserCommand;
  readonly state: Q3MovementState; readonly profile: Q3MovementProfile;
}
export type MovementInput = Q1MovementInput | QwMovementInput | Q2MovementInput | Q2RereleaseMovementInput | Q3MovementInput;

export interface MovementContact {
  readonly target: TraceHit;
  readonly trace: TraceResult;
  readonly substep: number;
}
export interface PredictableMovementEvent {
  readonly provider: ProviderId;
  readonly sequence: number;
  readonly event: number;
  readonly parameter: number;
}
/** This order records source execution, including repeated effects within one command. */
export type MovementEffect = { readonly kind: "event"; readonly value: PredictableMovementEvent }
  | { readonly kind: "weapon"; readonly provider: ProviderId; readonly before: WeaponState; readonly after: WeaponState }
  | { readonly kind: "weapon-selection"; readonly provider: ProviderId; readonly before: ItemId | null; readonly after: ItemId | null }
  | { readonly kind: "ammo"; readonly item: ItemId; readonly before: number; readonly after: number }
  | { readonly kind: "animation"; readonly provider: ProviderId; readonly before: AnimationState; readonly after: AnimationState }
  | { readonly kind: "touch"; readonly target: Exclude<TraceHit, { readonly kind: "none" }>; readonly substep: number };
export interface OrderedMovementEffect { readonly substep: number; readonly sequence: number; readonly time: SourceTime; readonly effect: MovementEffect; }
interface MovementResultFields {
  readonly actor: ActorId;
  readonly commandSequence: number;
  readonly bounds: Bounds;
  readonly viewAngles: Vec3;
  readonly viewHeight: number;
  readonly ground: TraceHit;
  readonly waterLevel: number;
  readonly waterType: number;
  readonly horizontalSpeed: number;
  /** Q3 returns contacts from the final substep; effects retain every substep. */
  readonly contacts: readonly MovementContact[];
  readonly effects: readonly OrderedMovementEffect[];
  readonly arsenal: ArsenalState;
  readonly animation: ActorAnimationState;
}
/** A synchronous callback can remove the actor; that outcome carries no state to write back. */
export type MovementOutcome<TState extends MovementState> = { readonly kind: TState["kind"] } & (
  MovementResultFields & { readonly status: "active"; readonly state: TState }
  | { readonly status: "actor-removed"; readonly actor: ActorId; readonly commandSequence: number;
      readonly effects: readonly OrderedMovementEffect[] }
);
export type Q1MovementResult = MovementOutcome<Q1MovementState>;
export type QwMovementResult = MovementOutcome<QwMovementState>;
export type Q2MovementResult = MovementOutcome<Q2MovementState>;
export interface Q2RereleaseMovementPresentation {
  readonly screenBlend: Vec4; readonly renderFlags: number; readonly jumpSound: boolean;
  readonly stepClip: boolean; readonly impactDelta: number;
}
export type Q2RereleaseMovementResult =
  (Extract<MovementOutcome<Q2RereleaseMovementState>, { readonly status: "active" }> & Q2RereleaseMovementPresentation)
  | Extract<MovementOutcome<Q2RereleaseMovementState>, { readonly status: "actor-removed" }>;
export type Q3MovementResult = MovementOutcome<Q3MovementState>;
export type MovementResult = Q1MovementResult | QwMovementResult | Q2MovementResult | Q2RereleaseMovementResult | Q3MovementResult;

export interface WeaponStepInput {
  readonly actor: OwnedActor;
  readonly command: MovementCommand;
  readonly frame: FrameContext;
  readonly arsenal: ArsenalState;
  readonly animation: ActorAnimationState;
  readonly environment: MovementEnvironment;
  readonly gauntletHit: boolean;
}
export interface WeaponStepResult {
  readonly continuation?: MovementContinuation;
  readonly arsenal: ArsenalState;
  readonly animation: ActorAnimationState;
  readonly effects: readonly MovementEffect[];
}
export type LocomotionAnimation = "idle" | "walk" | "run" | "backward" | "crouch" | "jump" | "land" | "swim";
export interface AnimationStepInput {
  readonly actor: OwnedActor; readonly frame: FrameContext; readonly animation: ActorAnimationState;
  readonly locomotion: LocomotionAnimation; readonly backwards: boolean; readonly force: boolean;
}
export interface AnimationStepResult { readonly animation: ActorAnimationState; readonly effects: readonly MovementEffect[]; }
export type MovementContinuation = { readonly kind: "continue"; readonly state: MovementState }
  | { readonly kind: "actor-removed" };
export type MovementInputContinuation = { readonly kind: "continue"; readonly state: MovementState; readonly command: UserCommand }
  | { readonly kind: "actor-removed" };
export interface MovementInputApplication {
  begin(command: UserCommand, frame: FrameContext, state: MovementState): MovementInputContinuation;
  end(state: MovementState, failed?: boolean, posture?: { readonly bounds: Bounds; readonly viewHeight: number }): MovementContinuation;
}
export type MovementTouchContact = Omit<TouchContact, "other" | "sourceTrace"> & {
  readonly other: Exclude<TraceHit, { readonly kind: "none" }>;
  readonly sourceTrace?: Omit<NonNullable<TouchContact["sourceTrace"]>, "ent">;
};
export interface MovementServices {
  readonly inputApplication?: MovementInputApplication | undefined;
  readonly scene: SceneQueries;
  readonly numeric: NumericOperations;
  /** Nested source touches finish here; the returned state includes teleports and velocity changes. */
  touch(contact: MovementTouchContact, state: MovementState): MovementContinuation;
  weaponStep(input: WeaponStepInput, state: MovementState): WeaponStepResult;
  animationStep(input: AnimationStepInput): AnimationStepResult;
}
export type MovementProvider = {
  readonly kind: "q1-netquake"; readonly id: ProviderId;
  move(input: Q1MovementInput, services: MovementServices): Q1MovementResult;
} | {
  readonly kind: "q1-quakeworld"; readonly id: ProviderId;
  move(input: QwMovementInput, services: MovementServices): QwMovementResult;
} | {
  readonly kind: "q2-classic"; readonly id: ProviderId;
  move(input: Q2MovementInput, services: MovementServices): Q2MovementResult;
} | {
  readonly kind: "q2-rerelease"; readonly id: ProviderId;
  move(input: Q2RereleaseMovementInput, services: MovementServices): Q2RereleaseMovementResult;
} | {
  readonly kind: "q3"; readonly id: ProviderId;
  move(input: Q3MovementInput, services: MovementServices): Q3MovementResult;
};
