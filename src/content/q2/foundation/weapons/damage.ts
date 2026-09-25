import type { ActorId } from "../../../../contracts/identity.ts";
import type { Q2WeaponHooks, Q2WeaponInput } from "./types.ts";

export function q2WeaponDamageMultiplier(actor: ActorId, input: Pick<Q2WeaponInput, "quadUntil" | "doubleUntil" | "noStackDouble">,
  now: number, hooks: Pick<Q2WeaponHooks, "quadMultiplier" | "sourceDamageMultiplier">): number {
  const quad = input.quadUntil > now;
  return (quad ? hooks.quadMultiplier?.(actor) ?? 4 : 1)
    * (input.doubleUntil > now && !(quad && input.noStackDouble) ? 2 : 1)
    * (hooks.sourceDamageMultiplier?.(actor) ?? 1);
}
