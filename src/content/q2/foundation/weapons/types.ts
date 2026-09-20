/* Quake II p_weapon.c / rerelease p_weapon.cpp. Copyright id Software.
 * GPL-2.0-or-later. Weapon animation state is separate from actor and inventory ownership. */
import type { ItemId } from "../../../../contracts/gameplay.ts";
import type { ActorId, OwnedActor } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { TraceResult } from "../../../../contracts/scene.ts";

export interface Q2WeaponOwner { readonly actor: OwnedActor; readonly viewHeight: number }

export type Q2BaseWeaponName = "blaster" | "shotgun" | "supershotgun" | "machinegun" | "chaingun" | "grenades" | "grenadelauncher" | "rocketlauncher" | "hyperblaster" | "railgun" | "bfg";
/** Names resolve through the selected session's source weapon registry. */
export type Q2WeaponName = string;
export type Q2WeaponPhase = "activating" | "ready" | "firing" | "dropping";
export interface Q2WeaponDefinition {
  readonly name: Q2WeaponName;
  readonly item: ItemId;
  readonly classname: string;
  readonly ammo: ItemId | null;
  readonly quantity: number;
  readonly warning: number;
  readonly viewModel: string;
  readonly worldModel: string;
  readonly playerModel: number;
  readonly activateLast: number;
  readonly fireLast: number;
  readonly idleLast: number;
  readonly deactivateLast: number;
  readonly pauses: readonly number[];
  readonly fires: readonly number[];
  readonly repeating: boolean;
}
export interface Q2BaseWeaponDefinition extends Q2WeaponDefinition { readonly name: Q2BaseWeaponName; }

export type Q2WeaponEvent =
  | { readonly kind: "muzzleflash"; readonly actor: ActorId; readonly flash: number; readonly silenced: boolean }
  | { readonly kind: "beam"; readonly effect: "rail" | "rail-water" | "bfg-laser" | "bfg-zap" | "bubble-trail" | "bfg-lightning" | "heatbeam" | "monster-heatbeam"; readonly actor: ActorId; readonly start: Vec3; readonly end: Vec3; readonly duration: number }
  | { readonly kind: "view-weapon"; readonly actor: ActorId; readonly weapon: Q2WeaponName | null; readonly model: string; readonly playerModel: number; readonly frame: number; readonly skin: number; readonly rate: number; readonly kickOrigin: Vec3; readonly kickAngles: Vec3 }
  | { readonly kind: "player-animation"; readonly actor: ActorId; readonly priority: "attack" | "pain" | "reverse"; readonly first: number; readonly last: number; readonly resetTime: boolean }
  | { readonly kind: "invisibility-reveal"; readonly actor: ActorId; readonly until: number };

/** Hooks cross into session lag history and the selected monster/character providers. */
export interface Q2WeaponHooks {
  quadMultiplier?(actor: ActorId): number;
  emit(event: Q2WeaponEvent): undefined;
  noise(actor: ActorId, origin: Vec3, secondary: boolean): undefined;
  dodge(monster: ActorId, attacker: ActorId, etaSeconds: number, trace: TraceResult): undefined;
  readonly lagCompensation: { readonly kind: "current-world" }
    | { readonly kind: "history"; begin(actor: ActorId, start: Vec3, direction: Vec3): () => undefined };
  ammoChanged(actor: ActorId, ammo: ItemId): undefined;
  /** CTF team eligibility for BFG acquisition, independent of damage acceptance. */
  canTarget(attacker: ActorId | null, target: ActorId): boolean;
}

export interface Q2WeaponInput {
  readonly attack: boolean;
  readonly latchedAttack: boolean;
  readonly holster: boolean;
  readonly angles: Vec3;
  readonly ducked: boolean;
  readonly spectator: boolean;
  readonly notarget: boolean;
  readonly hand: "right" | "left" | "center";
  /** The character provider decides whether it has the Q2 player animation set. */
  readonly animatePlayer: boolean;
  readonly quadUntil: number;
  readonly doubleUntil: number;
  readonly quadFireUntil: number;
  readonly haste: boolean;
  readonly noStackDouble: boolean;
  readonly instantSwitch: boolean;
  readonly quickSwitch: boolean;
  /** Rerelease g_infinite_ammo or the active instagib rule. Classic uses DF_INFINITE_AMMO. */
  readonly infiniteAmmo: boolean;
  readonly playersCollide: boolean;
  readonly gravity: number;
  readonly weaponThunk: boolean;
}

export type Q2HandReservation = { readonly kind: "none" } | { readonly kind: "finite" } | { readonly kind: "infinite" };

export class Q2WeaponState {
  primaryHandoff: "active" | "holstering" | "holstered" = "active";
  weapon: Q2WeaponName | null;
  lastWeapon: Q2WeaponName | null = null;
  pending: Q2WeaponName | null = null;
  phase: Q2WeaponPhase = "activating";
  frame = 0;
  thinkTime = 0;
  fireFinished = 0;
  fireBuffered = false;
  latchedAttack = false;
  machinegunShots = 0;
  emptySoundTime = 0;
  handReservation: Q2HandReservation = { kind: "none" };
  grenadeTime = 0;
  grenadeFinished = 0;
  grenadeBlewUp = false;
  kickOrigin: Vec3 = { x: 0, y: 0, z: 0 };
  kickAngles: Vec3 = { x: 0, y: 0, z: 0 };
  kickTime = 0;
  kickUntil = 0;
  kickDuration = 0.2;
  loopSound = "";
  viewModel: string | null = null;
  viewSkin = 0;
  lastFiringTime = 0;
  sourceFiring = false;
  gunRate = 10;
  constructor(weapon: Q2WeaponName | null = "blaster") { this.weapon = weapon; }
}

export interface Q2NoiseRecord { readonly actor: ActorId; readonly origin: Vec3; readonly time: number; readonly secondary: boolean; }
export interface Q2GrenadeAdjustment { readonly right: number; readonly up: number; readonly gravity: number; }

export const MOD = {
  blaster: 1, shotgun: 2, supershotgun: 3, machinegun: 4, chaingun: 5,
  grenade: 6, grenadeSplash: 7, rocket: 8, rocketSplash: 9, hyperblaster: 10,
  railgun: 11, bfgLaser: 12, bfgBlast: 13, bfgEffect: 14, handGrenade: 15,
  handGrenadeSplash: 16, heldGrenade: 24, hit: 32,
};
export const SHOT_MASK = 1 | 2 | 0x2000000 | 0x4000000;
export const PLAYER_CONTENTS = 0x40000000;
export const PROJECTILE_MASK = SHOT_MASK | PLAYER_CONTENTS | 0x4000;
export const WATER_MASK = 8 | 16 | 32;
