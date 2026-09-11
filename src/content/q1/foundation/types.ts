/* Q1 gameplay adapted from id Software Quake / Quake rerelease QuakeC.
 * Copyright (C) 1996-2022 id Software LLC. GPL-2.0-or-later. */
import type { ActorId, OwnedActor, ProviderId } from "../../../contracts/identity.ts";
import type { Bounds, Vec3 } from "../../../contracts/math.ts";
import type { ItemId, TransitionIntent } from "../../../contracts/gameplay.ts";
import type { SessionActorRegistry, SharedBodyTable, ActorCallbackTable } from "../../../world/actors/index.ts";
import type { GameplayAuthority } from "../../../world/gameplay/authority.ts";
import type { SharedInventoryTable } from "../../../world/gameplay/inventory.ts";

export type Q1Weapon = "axe" | "shotgun" | "supershotgun" | "nailgun" | "supernailgun" | "grenadelauncher" | "rocketlauncher" | "lightning";
export type Q1Powerup = "quad" | "invulnerability" | "invisibility" | "suit";
export type Q1Solid = "none" | "trigger" | "bbox" | "slidebox" | "bsp";
export type Q1MoveType = "none" | "push" | "step" | "toss" | "bounce" | "flymissile" | "noclip";
export interface Q1Trace {
  readonly fraction: number;
  readonly end: Vec3;
  readonly normal: Vec3;
  readonly actor: ActorId | null;
  readonly startSolid: boolean;
  readonly allSolid: boolean;
  readonly sky: boolean;
  readonly inOpen: boolean;
  readonly inWater: boolean;
}
export interface Q1TraceRequest {
  readonly start: Vec3;
  readonly end: Vec3;
  readonly bounds: Bounds;
  readonly ignore: ActorId | null;
  readonly monsters: boolean;
  readonly missile?: boolean;
}
export type Q1Event =
  | { readonly kind: "sound"; readonly actor: ActorId; readonly path: string; readonly channel: "auto" | "weapon" | "voice" | "item" | "body"; readonly attenuation: number; readonly volume: number }
  | { readonly kind: "ambient"; readonly origin: Vec3; readonly path: string; readonly volume: number; readonly attenuation: number }
  | { readonly kind: "message"; readonly player: ActorId; readonly text: string; readonly center: boolean }
  | { readonly kind: "effect"; readonly effect: "blood" | "gunshot" | "spike" | "superspike" | "explosion" | "teleport" | "muzzleflash" | "pickup" | "lava-splash" | "tar-explosion" | "meat-spray"; readonly actor: ActorId | null; readonly origin: Vec3; readonly amount: number }
  | { readonly kind: "beam"; readonly actor: ActorId; readonly start: Vec3; readonly end: Vec3 }
  | { readonly kind: "lightstyle"; readonly style: number; readonly pattern: string }
  | { readonly kind: "secret" | "monster-killed"; readonly actor: ActorId; readonly total: number; readonly found: number }
  | { readonly kind: "weapon"; readonly player: ActorId; readonly weapon: Q1Weapon; readonly viewModel: string; readonly frame: number; readonly punch: number }
  | { readonly kind: "teleport-player"; readonly player: ActorId; readonly angles: Vec3; readonly lockUntil: number }
  | { readonly kind: "powerup"; readonly player: ActorId; readonly powerup: Q1Powerup; readonly expires: number }
  | { readonly kind: "intermission"; readonly origin: Vec3; readonly angles: Vec3; readonly map: string; readonly exitAfter: number; readonly track: number }
  | { readonly kind: "finale"; readonly text: string; readonly stage: 1 | 2 | 3 | 4 | 5 | 6 }
  | { readonly kind: "achievement"; readonly player: ActorId | null; readonly id: string };

/** Engine builtins operate on the same actor/body/combat tables used by every game. */
export interface Q1FoundationHost {
  readonly actors: SessionActorRegistry;
  readonly bodies: SharedBodyTable;
  readonly callbacks: ActorCallbackTable;
  readonly combat: GameplayAuthority;
  readonly inventory: SharedInventoryTable;
  random(): number;
  trace(request: Q1TraceRequest): Q1Trace;
  contents(point: Vec3): "empty" | "solid" | "water" | "slime" | "lava" | "sky";
  /** Performs source step-up / bottom checks and links the resulting body. */
  walkMove(actor: OwnedActor, yaw: number, distance: number): boolean;
  moveToGoal(actor: OwnedActor, goal: ActorId, distance: number): undefined;
  checkBottom(actor: ActorId): boolean;
  /** Calls the source blocked callback before rolling riders back, then returns the blocking actor. */
  pushMove(actor: OwnedActor, displacement: Vec3): ActorId | null;
  scheduleThink(actor: OwnedActor, dueSeconds: number): undefined;
  cancelThink(actor: OwnedActor): undefined;
  emit(event: Q1Event): undefined;
  transition(intent: TransitionIntent): undefined;
  /** Player admission is independent of the chosen character/model provider. */
  players(): readonly ActorId[];
  checkClient(observer: OwnedActor): ActorId | null;
  /** The selected actor provider exposes its actual gameplay class for source exceptions. */
  classname(actor: ActorId): string;
  /** Apply a timed effect to the shared player state, including combat invulnerability. */
  powerup(actor: OwnedActor, powerup: Q1Powerup, expiresSeconds: number): undefined;
}
export interface Q1FoundationOptions {
  readonly edition: "classic" | "rerelease";
  readonly skill: 0 | 1 | 2 | 3;
  readonly deathmatch: number;
  readonly coop: boolean;
  readonly campaign: ProviderId;
  readonly combatProvider: ProviderId;
  readonly movementProvider: ProviderId;
  readonly inventoryProvider: ProviderId;
  readonly gravity: number;
  readonly maxClients?: number;
  readonly noExit?: 0 | 1 | 2;
  readonly teamplay?: number;
  readonly aimThreshold?: number;
}
export interface Q1Presentation {
  readonly actor: ActorId;
  readonly classname: string;
  readonly model: string;
  readonly frame: number;
  readonly skin: number;
  readonly effects: number;
  readonly solid: Q1Solid;
  readonly movement: Q1MoveType;
  readonly targetname: string;
  readonly sourceOrdinal: number | null;
}
export interface Q1PlayerState {
  readonly actor: OwnedActor;
  weapon: Q1Weapon;
  attackFinished: number;
  weaponFrame: number;
  weaponAnimationAt: number;
  weaponAnimationBase: number;
  continuousFiring: boolean;
  nextWeaponFrame: number;
  lightningSoundAt: number;
  nailSide: number;
  maxHealth: number;
  megaRotAt: number;
  hostileUntil: number;
  viewAngles: Vec3;
  waterLevel: number;
  airFinished: number;
  drownDamage: number;
  drownAt: number;
  hazardAt: number;
  autoSwitch: "always" | "new" | "never";
  readonly powerups: Map<Q1Powerup, number>;
}
export const Q1_PROVIDER: ProviderId = "q1:official";
export const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
export const POINT: Bounds = { min: ZERO, max: ZERO };
export const PLAYER_BOUNDS: Bounds = { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } };
export const WEAPONS: readonly Q1Weapon[] = ["axe", "shotgun", "supershotgun", "nailgun", "supernailgun", "grenadelauncher", "rocketlauncher", "lightning"];
export function weaponItem(weapon: Q1Weapon): ItemId { return `q1:weapon/${weapon}`; }
export function vadd(a: Vec3, b: Vec3): Vec3 { return { x: Math.fround(a.x + b.x), y: Math.fround(a.y + b.y), z: Math.fround(a.z + b.z) }; }
export function vsub(a: Vec3, b: Vec3): Vec3 { return { x: Math.fround(a.x - b.x), y: Math.fround(a.y - b.y), z: Math.fround(a.z - b.z) }; }
export function vscale(a: Vec3, scale: number): Vec3 { return { x: Math.fround(a.x * scale), y: Math.fround(a.y * scale), z: Math.fround(a.z * scale) }; }
export function dot(a: Vec3, b: Vec3): number { return Math.fround(Math.fround(Math.fround(a.x * b.x) + Math.fround(a.y * b.y)) + Math.fround(a.z * b.z)); }
export function length(a: Vec3): number { return Math.fround(Math.sqrt(dot(a, a))); }
export function normalize(a: Vec3): Vec3 { const magnitude = length(a); return magnitude === 0 ? ZERO : vscale(a, 1 / magnitude); }
export function vectors(angles: Vec3): { readonly forward: Vec3; readonly right: Vec3; readonly up: Vec3 } {
  const yaw = angles.y * Math.PI / 180, pitch = angles.x * Math.PI / 180, roll = angles.z * Math.PI / 180;
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch), sr = Math.sin(roll), cr = Math.cos(roll);
  return { forward: { x: Math.fround(cp * cy), y: Math.fround(cp * sy), z: Math.fround(-sp) },
    right: { x: Math.fround(-sr * sp * cy + cr * sy), y: Math.fround(-sr * sp * sy - cr * cy), z: Math.fround(-sr * cp) },
    up: { x: Math.fround(cr * sp * cy + sr * sy), y: Math.fround(cr * sp * sy - sr * cy), z: Math.fround(cr * cp) } };
}
export function yawFor(direction: Vec3): number { const yaw = Math.atan2(direction.y, direction.x) * 180 / Math.PI; return yaw < 0 ? yaw + 360 : yaw; }
export function overlaps(a: Bounds, b: Bounds): boolean { return a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.y <= b.max.y && a.max.y >= b.min.y && a.min.z <= b.max.z && a.max.z >= b.min.z; }
