/* p_weapon.c/p_weapon.cpp weapon presentation rules. GPL-2.0-or-later. */
import type { Q2GenericFrameState } from "./generic-frame.ts";
import type { Q2WeaponState } from "./types.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import { scale } from "../fields.ts";
import { millisecondSum } from "./generic-frame.ts";

export function setQ2WeaponRecoil(state: Q2WeaponState, edition: "classic" | "rerelease", now: number,
  origin: Vec3, angles: Vec3, duration = edition === "rerelease" ? 0.2 : 0): undefined {
  state.kickOrigin = origin; state.kickAngles = angles; state.kickTime = now; state.kickDuration = duration;
  state.kickUntil = edition === "rerelease" ? millisecondSum(now, duration) : now + duration;
}

/** Classic kick vectors last one source frame; damage pitch and rerelease kicks decay with source time. */
export function q2WeaponRecoil(state: Pick<Q2WeaponState, "kickOrigin" | "kickAngles" | "kickTime" | "kickUntil" | "kickDuration">,
  edition: "classic" | "rerelease", now: number) {
  const impulse = now === state.kickTime ? 1 : 0;
  const factor = state.kickDuration === 0 ? impulse : Math.max(0, Math.min(1, (state.kickUntil - now) / state.kickDuration));
  return { kickOrigin: scale(state.kickOrigin, edition === "classic" ? impulse : factor), kickAngles: scale(state.kickAngles, factor) };
}
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
