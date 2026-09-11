/* Quake II p_weapon.c / rerelease p_weapon.cpp. Copyright id Software.
 * GPL-2.0-or-later. Shared hand grenade calculation, independent of weapon selection. */
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q2Edition } from "../host.ts";

export interface HandGrenadeTempo {
  readonly edition: Q2Edition;
  readonly haste: boolean;
  readonly quadFire: boolean;
}

export function handRecoverySeconds(tempo: HandGrenadeTempo): number {
  return tempo.edition === "classic" ? 1 : (tempo.haste ? 0.5 : 1) * (tempo.quadFire ? 0.5 : 1);
}

export function handFrameSeconds(tempo: HandGrenadeTempo): number {
  return Math.trunc(100 * handRecoverySeconds(tempo)) / 1000;
}

export function handDeadline(now: number, seconds: number, edition: Q2Edition): number {
  return edition === "classic" ? now + seconds : (Math.round(now * 1000) + Math.round(seconds * 1000)) / 1000;
}

export function handFuseDeadline(now: number, edition: Q2Edition): number {
  return handDeadline(now, 3.2, edition);
}

export interface HandThrowInput {
  readonly edition: Q2Edition;
  readonly angles: Vec3;
  readonly alive: boolean;
  readonly now: number;
  readonly fuseDeadline: number;
  readonly damageMultiplier: number;
  readonly gravity: number;
  readonly held: boolean;
  project(angles: Vec3, offset: Vec3): { readonly start: Vec3; readonly direction: Vec3 };
}

export interface HandProjectileSpec {
  readonly start: Vec3;
  readonly direction: Vec3;
  readonly damage: number;
  readonly speed: number;
  readonly fuse: number;
  readonly radius: number;
  readonly held: boolean;
  readonly gravity: number;
}

export function calculateHandThrow(input: HandThrowInput): HandProjectileSpec {
  const rerelease = input.edition === "rerelease";
  const angles = rerelease ? { ...input.angles, x: Math.max(-62.5, input.angles.x) } : input.angles;
  const projection = input.project(angles, rerelease ? { x: 2, y: 0, z: -14 } : { x: 8, y: 8, z: -8 });
  const fuse = input.fuseDeadline - input.now;
  const chargedSpeed = 400 + (3 - fuse) * (400 / 3);
  const speed = Math.trunc(rerelease ? input.alive ? Math.min(800, chargedSpeed) : 400 : chargedSpeed);
  return { ...projection, damage: 125 * input.damageMultiplier, speed, fuse, radius: 165, held: input.held, gravity: input.gravity };
}
