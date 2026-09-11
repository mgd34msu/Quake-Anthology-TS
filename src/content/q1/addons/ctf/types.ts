/* ThreeWave rerelease CTF source boundary. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { ItemId } from "../../../../contracts/gameplay.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q1Actor } from "../../foundation/entity.ts";

export type CtfTeam = "red" | "blue";
export type CtfRune = "resistance" | "strength" | "haste" | "regeneration";
export const CTF_RUNES: readonly CtfRune[] = ["resistance", "strength", "haste", "regeneration"];
export const CTF_FLAGS = { healthProtect: 1, armorProtect: 2, reflectDamage: 4, fragPenalty: 8, deathPenalty: 16,
  staticTeams: 64, dropItems: 128, selectTeam: 1024, disableGrapple: 2048 };
export const CTF_FLAG_BOUNDS = { min: { x: -16, y: -16, z: 0 }, max: { x: 16, y: 16, z: 74 } };
export interface CtfInput {
  readonly attack: boolean;
  readonly jump: boolean;
  readonly impulse: number;
  readonly grappleSelected: boolean;
  readonly viewAngles: Vec3;
  readonly teleportUntil: number;
  /** Source pose of the selected character, used to attach the carried flag. */
  readonly frame: number;
}
export interface CtfStatus { readonly red: number; readonly blue: number; readonly flags: number; readonly runeItems: number; }

/** The selected session, character and arsenal retain admission, score and command ownership. */
export interface Q1CtfServices {
  name(actor: ActorId): string;
  isBot(actor: ActorId): boolean;
  score(actor: ActorId): number;
  addScore(actor: ActorId, delta: number): undefined;
  captures(team: CtfTeam): number;
  addCapture(team: CtfTeam): undefined;
  input(actor: ActorId): CtfInput;
  consumeImpulse(actor: ActorId): undefined;
  observer(actor: ActorId): boolean;
  setObserver(actor: ActorId, observer: boolean): undefined;
  respawn(actor: ActorId, spot: Q1Actor | null): undefined;
  disconnect(actor: ActorId): undefined;
  colors(actor: ActorId, shirt: number, pants: number): undefined;
  promptSupported(actor: ActorId): boolean;
  prompt(actor: ActorId, title: string, choices: readonly { readonly label: string; readonly impulse: number }[]): undefined;
  clearPrompt(actor: ActorId): undefined;
  teleport(actor: ActorId, origin: Vec3, angles: Vec3, velocity: Vec3, until: number): undefined;
  selectGrapple(actor: ActorId): undefined;
  selectedWeapon(actor: ActorId): ItemId | null;
  selectedAmmo(actor: ActorId): ItemId | null;
  weaponChanged(actor: ActorId, acquired: ItemId | null): undefined;
  /** Apply the source-specific haste intervals and doubled nail velocity exported by runes.ts. */
  haste(actor: ActorId, enabled: boolean): undefined;
  status(actor: ActorId, status: CtfStatus): undefined;
  log(actor: ActorId, action: string): undefined;
}
