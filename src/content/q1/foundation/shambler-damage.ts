import type { DamageRequest } from "../../../contracts/gameplay.ts";
import type { Q1MonsterSpecies } from "./entity.ts";

/** Q1's rocket impact and radius routines already halve their own shambler damage. */
export function foreignShamblerDamage(species: Q1MonsterSpecies | undefined, request: DamageRequest): Pick<DamageRequest, "amount" | "knockback"> | null {
  const cause = request.attack.cause;
  if (species !== "shambler" || cause.kind === "q1" || cause.kind === "environment") return null;
  const rocket = cause.kind === "q2" ? cause.meansOfDeath === 8 : cause.meansOfDeath === 6;
  if (request.delivery !== "radius" && !rocket) return null;
  return { amount: Math.fround(request.amount * 0.5), knockback: Math.fround(request.knockback * 0.5) };
}
