/* p_weapon.c/p_weapon.cpp weapon presentation rules. GPL-2.0-or-later. */
import type { Q2GenericFrameState } from "./generic-frame.ts";
export function q2AttackFrames(ducked: boolean, offset = 1) { return { first: (ducked ? 160 : 46) - offset, last: ducked ? 168 : 53 }; }
export function q2ReverseFrames(ducked: boolean) { return { first: ducked ? 173 : 66, last: ducked ? 169 : 62 }; }
export function q2WeaponAnimationRate(input: { readonly quickSwitch: boolean; readonly frameSeconds: number; readonly phase: Q2GenericFrameState["phase"]; readonly frame: number; readonly quadFireUntil: number; readonly haste: boolean; readonly now: number }): number {
  let rate = input.quickSwitch && input.frameSeconds <= 0.05 && (input.phase === "activating" || input.phase === "dropping") ? 20 : 10;
  if (input.frame !== 0) { if (input.quadFireUntil > input.now) rate *= 2; if (input.haste) rate *= 2; }
  return rate;
}
export function q2PowerupSound(input: { readonly quadUntil: number; readonly doubleUntil: number; readonly rerelease: boolean; readonly now: number }): string | null {
  if (input.quadUntil > input.now && input.doubleUntil > input.now && input.rerelease) return "ctf/tech2x.wav";
  if (input.quadUntil > input.now) return "items/damage3.wav";
  if (input.doubleUntil > input.now) return "misc/ddamage3.wav";
  return null;
}
