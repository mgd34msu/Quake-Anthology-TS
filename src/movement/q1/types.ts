/* Quake movement interfaces derived from WinQuake/sv_phys.c and QW/pmove.h.
 * Copyright (C) 1996-1997 Id Software, Inc. GPL-2.0-or-later. */
import type { ActorId, OwnedActor } from "../../contracts/identity.ts";
import type { Bounds, Vec3 } from "../../contracts/math.ts";
import type { MovementContinuation, MovementInput, MovementServices, MovementState, Q1MovementInput, Q1MovementState, QwMovementInput } from "../../contracts/movement.ts";
import type { TraceHit, TraceResult } from "../../contracts/scene.ts";

export const Q1_MOVE_NONE = 0;
export const Q1_MOVE_WALK = 3;
export const Q1_MOVE_STEP = 4;
export const Q1_MOVE_FLY = 5;
export const Q1_MOVE_TOSS = 6;
export const Q1_MOVE_PUSH = 7;
export const Q1_MOVE_NOCLIP = 8;
export const Q1_MOVE_FLYMISSILE = 9;
export const Q1_MOVE_BOUNCE = 10;
export const Q1_MOVE_GIB = 11;
export const Q1_FLAG_FLY = 1;
export const Q1_FLAG_SWIM = 2;
export const Q1_FLAG_ONGROUND = 512;
export const Q1_FLAG_WATERJUMP = 2048;
export const Q1_FLAG_JUMPRELEASED = 4096;
export const Q1_CONTENTS_EMPTY = -1;
export const Q1_CONTENTS_SOLID = -2;
export const Q1_CONTENTS_WATER = -3;
export const Q1_CONTENTS_SLIME = -4;
export const Q1_CONTENTS_LAVA = -5;
export const Q1_STEP_HEIGHT = 18;

/** Source callbacks publish state before invoking game code and return its changes. */
export interface Q1MovementHooks {
  link(actor: OwnedActor, state: MovementState, touchTriggers: boolean): MovementContinuation;
  isBsp(hit: TraceHit): boolean;
  /** PlayerPreThink runs after SV_ClientThink and before SV_Physics_Client. */
  beforePhysics(input: Q1MovementInput | QwMovementInput, state: MovementState): MovementContinuation;
  afterPhysics(input: Q1MovementInput | QwMovementInput, state: MovementState): MovementContinuation;
  sound?(actor: OwnedActor, path: "misc/h2ohit1.wav" | "demon/dland2.wav", state: Q1MovementState): undefined;
  playerAction?(actor: OwnedActor, action: "jump" | "swim", state: Q1MovementState): undefined;
}

export interface Q1MovementOptions {
  readonly sourcePunchAngles?: Vec3;
  readonly viewHeight?: number;
  readonly maxVelocity?: number;
  readonly noStep?: boolean;
  readonly idealPitchScale?: number;
  readonly rollSpeed?: number;
  readonly rollAngle?: number;
  readonly solid?: Q1PhysicsEntity["solid"];
  /** Official movement owns initiation; an identified QC binding may take it over. */
  readonly jumpAuthority?: "selected-movement" | "source-gamecode";
  /** Original C writes roll during fixangle; the donor fixes the stuck-roll bug. */
  readonly fixAngleRoll?: "source" | "preserve";
  readonly hooks?: Q1MovementHooks;
}

export interface Q1PhysicsEntity {
  readonly actor: OwnedActor;
  readonly state: Q1MovementState;
  readonly bounds: Bounds;
  /** Captured by the last source link, including source item/epsilon expansion. */
  readonly absoluteBounds: Bounds;
  readonly solid: "not" | "trigger" | "box" | "slidebox" | "bsp" | "corpse";
  readonly localTimeSeconds: number;
  readonly nextThinkSeconds: number;
}

/** Source slot order comes from the shared actor registry, not another frame loop. */
export interface Q1PusherServices {
  readonly movement: MovementServices;
  read(actor: ActorId): Q1PhysicsEntity | null;
  candidates(): readonly ActorId[];
  write(entity: Q1PhysicsEntity): undefined;
  link(actor: OwnedActor, touchTriggers: boolean): undefined;
  /** Temporarily unlinks only this pusher from traces during SV_PushEntity. */
  collisionEnabled(actor: OwnedActor, enabled: boolean): undefined;
  testPosition(entity: Q1PhysicsEntity): TraceHit;
  push(entity: Q1PhysicsEntity, displacement: Vec3): { readonly entity: Q1PhysicsEntity | null; readonly trace: TraceResult };
  blocked(pusher: OwnedActor, obstacle: ActorId): undefined;
  think(pusher: OwnedActor): undefined;
}

export interface Q1PusherResult {
  readonly actor: ActorId;
  readonly status: "moved" | "blocked" | "actor-removed";
  readonly moved: readonly ActorId[];
}

export type Q1PlayerInput = Extract<MovementInput, { readonly kind: "q1-netquake" | "q1-quakeworld" }>;
