import type { WeaponBehaviorProjectilePort } from "../../../contracts/weapon-behavior.ts";
/* Q1 gameplay adapted from id Software Quake / Quake rerelease QuakeC.
 * Copyright (C) 1996-2022 id Software LLC. GPL-2.0-or-later. */
import type { ActorId, OwnedActor, ProviderId } from "../../../contracts/identity.ts";
import type { Bounds, Vec3 } from "../../../contracts/math.ts";
import type { ItemId, TransitionIntent } from "../../../contracts/gameplay.ts";
import type { SessionActorRegistry, SharedBodyTable, ActorCallbackTable } from "../../../world/actors/index.ts";
import type { GameplayAuthority } from "../../../world/gameplay/authority.ts";
import type { SharedInventoryTable } from "../../../world/gameplay/inventory.ts";
import type { Q1Actor } from "./entity.ts";
import type { Q1EntityServices } from "./entity-services.ts";

export type Q1BaseWeapon = "axe" | "shotgun" | "supershotgun" | "nailgun" | "supernailgun" | "grenadelauncher" | "rocketlauncher" | "lightning";
export function q1WeaponBit(weapon: Q1BaseWeapon): number {
  switch (weapon) {
    case "axe": return 4096;
    case "shotgun": return 1;
    case "supershotgun": return 2;
    case "nailgun": return 4;
    case "supernailgun": return 8;
    case "grenadelauncher": return 16;
    case "rocketlauncher": return 32;
    case "lightning": return 64;
  }
}
export type Q1Weapon = Q1BaseWeapon | "hipnotic:laser" | "hipnotic:mjolnir" | "hipnotic:proximity" | "rogue:lava-nailgun" | "rogue:lava-supernailgun" | "rogue:multi-grenade" | "rogue:multi-rocket" | "rogue:plasma" | "rogue:grapple" | "mg3:laser" | "mg3:mjolnir" | "ctf:grapple";
export type Q1Powerup = "quad" | "invulnerability" | "invisibility" | "suit" | "hipnotic:wetsuit" | "hipnotic:empathy" | "rogue:shield" | "rogue:antigrav" | "mg3:lavasuit";
export const Q1_POWERUP_IDS: readonly Q1Powerup[] = ["quad", "invulnerability", "invisibility", "suit", "hipnotic:wetsuit", "hipnotic:empathy", "rogue:shield", "rogue:antigrav", "mg3:lavasuit"];
export type Q1SoundChannel = "auto" | "weapon" | "voice" | "item" | "body" | 5 | 6 | 7;
export type Q1BeamStyle = "lightning1" | "lightning2" | "lightning3" | "grapple";
export type Q1Solid = "none" | "trigger" | "bbox" | "slidebox" | "bsp" | "corpse";
export type Q1MoveType = "none" | "push" | "step" | "toss" | "bounce" | "fly" | "flymissile" | "noclip" | "gib";
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
export interface Q1Basis { readonly forward: Vec3; readonly right: Vec3; readonly up: Vec3; }
export type Q1CharacterAttack = { readonly kind: "axe"; readonly variant: 0 | 1 | 2 | 3 } | { readonly kind: "shotgun" | "rocket" | "nail" | "lightning" };

export interface Q1MessagePart { readonly text: string; readonly args?: readonly (string | number)[]; }
export type Q1Event =
  | { readonly kind: "stop-sound"; readonly actor: ActorId; readonly channel: number }
  | { readonly kind: "sound"; readonly origin?: Vec3; readonly actor: ActorId; readonly path: string; readonly channel: Q1SoundChannel; readonly attenuation: number; readonly volume: number }
  | { readonly kind: "ambient"; readonly origin: Vec3; readonly path: string; readonly volume: number; readonly attenuation: number }
  | { readonly kind: "message"; readonly player: ActorId; readonly text: string; readonly center: boolean; readonly args?: readonly (string | number)[]; readonly parts?: readonly Q1MessagePart[] }
  | { readonly kind: "effect"; readonly effect: "blood" | "gunshot" | "spike" | "superspike" | "explosion" | "teleport" | "muzzleflash" | "pickup" | "lava-splash" | "tar-explosion" | "meat-spray" | "wizard-spike" | "knight-spike"; readonly actor: ActorId | null; readonly origin: Vec3; readonly amount: number }
  | { readonly kind: "colored-explosion"; readonly origin: Vec3; readonly colorStart: number; readonly colorLength: number }
  | { readonly kind: "static-model"; readonly path: string; readonly frame: number; readonly colorMap: number; readonly skin: number; readonly origin: Vec3; readonly angles: Vec3 }
  | { readonly kind: "particles"; readonly origin: Vec3; readonly direction: Vec3; readonly color: number; readonly count: number }
  | { readonly kind: "server-command"; readonly text: string }
  | { readonly kind: "camera"; readonly player: ActorId; readonly origin: Vec3; readonly angles: Vec3; readonly viewOffset?: Vec3 }
  | { readonly kind: "beam"; readonly style: Q1BeamStyle; readonly actor: ActorId; readonly start: Vec3; readonly end: Vec3 }
  | { readonly kind: "lightstyle"; readonly style: number; readonly pattern: string }
  | { readonly kind: "monster-total"; readonly total: number }
  | { readonly kind: "secret" | "monster-killed"; readonly actor: ActorId; readonly total: number; readonly found: number }
  | { readonly kind: "weapon"; readonly player: ActorId; readonly weapon: Q1Weapon; readonly viewModel: string; readonly frame: number; readonly punch: number; readonly attack?: Q1CharacterAttack }
  | { readonly kind: "teleport-player"; readonly player: ActorId; readonly angles: Vec3; readonly lockUntil: number }
  | { readonly kind: "powerup"; readonly player: ActorId; readonly powerup: Q1Powerup; readonly expires: number }
  | { readonly kind: "intermission"; readonly origin: Vec3; readonly angles: Vec3; readonly map: string; readonly exitAfter: number; readonly track: number }
  | { readonly kind: "finale"; readonly text: string; readonly stage: 1 | 2 | 3 | 4 | 5 | 6 }
  | { readonly kind: "achievement"; readonly player: ActorId | null; readonly id: string };

export interface Q1PrecacheTables {
  readonly phase: "loading" | "frozen";
  /** Slot zero is the source empty string; world and inline models precede game declarations. */
  readonly models: readonly string[];
  readonly sounds: readonly string[];
}

/** Engine builtins operate on the same actor/body/combat tables used by every game. */
export interface Q1FoundationHost {
  readonly weaponBehavior?: WeaponBehaviorProjectilePort;
  weaponImpact?(owner: ActorId, origin: Vec3): undefined;
  weaponVolume?(actor: ActorId): number;
  monsterTarget?(actor: ActorId): import("../../monsters/target.ts").MonsterTargetObservation | null;
  registerEntity?(entity: Q1Actor, services: Q1EntityServices): undefined;
  readonly actors: SessionActorRegistry;
  readonly bodies: SharedBodyTable;
  readonly callbacks: ActorCallbackTable;
  readonly combat: GameplayAuthority;
  readonly inventory: SharedInventoryTable;
  random(): number;
  /** Required by source modules that change gravity; the selected movement provider owns the value. */
  setGravity?(actor: ActorId, scale: number): undefined;
  controlPlayer?(actor: ActorId, control: { readonly kind: "cutscene"; readonly origin: Vec3; readonly angles: Vec3; readonly viewOffset: Vec3 }): undefined;
  trace(request: Q1TraceRequest): Q1Trace;
  contents(point: Vec3): "empty" | "solid" | "water" | "slime" | "lava" | "sky";
  /** Performs source step-up / bottom checks and links the resulting body. */
  walkMove(actor: OwnedActor, yaw: number, distance: number): boolean;
  changeYaw(actor: OwnedActor): undefined;
  moveToGoal(actor: OwnedActor, goal: ActorId, distance: number, mode?: "range" | "contact"): undefined;
  checkBottom(actor: ActorId): boolean;
  pusherServices(game: Q1EntityServices): import("../../../movement/q1/types.ts").Q1PusherServices;
  scheduleThink(actor: OwnedActor, dueSeconds: number): undefined;
  cancelThink(actor: OwnedActor): undefined;
  emit(event: Q1Event): undefined;
  transition(intent: TransitionIntent): undefined;
  /** Player admission is independent of the chosen character/model provider. */
  players(): readonly ActorId[];
  checkClient(observer: OwnedActor): ActorId | null;
  /** The selected actor provider exposes its actual gameplay class for source exceptions. */
  classname(actor: ActorId): string;
  sourceTarget?(actor: ActorId): { readonly aimedDamage: boolean; readonly push: boolean; readonly player: boolean };
  /** Apply a timed effect to the shared player state, including combat invulnerability. */
  powerup(actor: OwnedActor, powerup: Q1Powerup, expiresSeconds: number): undefined;
  powerupExpires?(actor: ActorId, powerup: Q1Powerup): number;
  sourceDamageMultiplier?(attacker: ActorId): number;
}
export interface Q1FoundationOptions {
  readonly provider?: ProviderId;
  /** Only the declared source program can opt into its covered native precache calls. */
  readonly precacheProgram?: "id1";
  readonly edition: "classic" | "rerelease";
  /** Selected engine behavior; source content edition remains independent. */
  readonly physicsEdition?: "classic" | "rerelease";
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
  alpha: number;
  scale: number;
  readonly actor: OwnedActor;
  weapon: Q1Weapon;
  primaryHolstered: boolean;
  attackFinished: number;
  attackHeld: boolean;
  jumpHeld: boolean;
  teleportUntil: number;
  weaponFrame: number;
  weaponAnimationAt: number;
  weaponAnimationBase: number;
  continuousFiring: boolean;
  nextWeaponFrame: number;
  lightningSoundAt: number;
  punchAngles: Vec3;
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
export const WEAPONS: readonly Q1BaseWeapon[] = ["axe", "shotgun", "supershotgun", "nailgun", "supernailgun", "grenadelauncher", "rocketlauncher", "lightning"];
export const Q1_WEAPON_IDS: readonly Q1Weapon[] = [...WEAPONS, "hipnotic:laser", "hipnotic:mjolnir", "hipnotic:proximity", "rogue:lava-nailgun", "rogue:lava-supernailgun", "rogue:multi-grenade", "rogue:multi-rocket", "rogue:plasma", "rogue:grapple", "mg3:laser", "mg3:mjolnir", "ctf:grapple"];
export function isQ1BaseWeapon(weapon: Q1Weapon): weapon is Q1BaseWeapon { return WEAPONS.some(candidate => candidate === weapon); }
export function weaponItem(weapon: Q1Weapon): ItemId { return `q1:weapon/${weapon}`; }
export function vadd(a: Vec3, b: Vec3): Vec3 { return { x: Math.fround(a.x + b.x), y: Math.fround(a.y + b.y), z: Math.fround(a.z + b.z) }; }
export function vsub(a: Vec3, b: Vec3): Vec3 { return { x: Math.fround(a.x - b.x), y: Math.fround(a.y - b.y), z: Math.fround(a.z - b.z) }; }
export function vscale(a: Vec3, scale: number): Vec3 { return { x: Math.fround(a.x * scale), y: Math.fround(a.y * scale), z: Math.fround(a.z * scale) }; }
export function dot(a: Vec3, b: Vec3): number { return Math.fround(Math.fround(Math.fround(a.x * b.x) + Math.fround(a.y * b.y)) + Math.fround(a.z * b.z)); }
export function length(a: Vec3): number { return Math.fround(Math.sqrt(dot(a, a))); }
export function normalize(a: Vec3): Vec3 { const magnitude = length(a); return magnitude === 0 ? ZERO : vscale(a, 1 / magnitude); }
export function vectors(angles: Vec3): Q1Basis {
  const yaw = angles.y * Math.PI / 180, pitch = angles.x * Math.PI / 180, roll = angles.z * Math.PI / 180;
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch), sr = Math.sin(roll), cr = Math.cos(roll);
  return { forward: { x: Math.fround(cp * cy), y: Math.fround(cp * sy), z: Math.fround(-sp) },
    right: { x: Math.fround(-sr * sp * cy + cr * sy), y: Math.fround(-sr * sp * sy - cr * cy), z: Math.fround(-sr * cp) },
    up: { x: Math.fround(cr * sp * cy + sr * sy), y: Math.fround(cr * sp * sy - sr * cy), z: Math.fround(cr * cp) } };
}
export function yawFor(direction: Vec3): number { const yaw = Math.atan2(direction.y, direction.x) * 180 / Math.PI; return yaw < 0 ? yaw + 360 : yaw; }
export function overlaps(a: Bounds, b: Bounds): boolean { return a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.y <= b.max.y && a.max.y >= b.min.y && a.min.z <= b.max.z && a.max.z >= b.min.z; }
