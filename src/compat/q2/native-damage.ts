import type { DamageRequest } from "../../contracts/gameplay.ts";
import { attackDamageFlags } from "../../world/gameplay/armor.ts";
import { nativeCauseFromCanonical } from "../../content/q2/missionpacks/damage.ts";
import type { Q2NativeCauseProfile } from "../../content/q2/missionpacks/damage.ts";

/** Foreign attacks keep their provenance; only the arguments entering Q2 are lowered. */
export function q2NativeDamageArguments(request: DamageRequest, profile: Q2NativeCauseProfile) {
  const cause = request.attack.cause, flags = attackDamageFlags(request);
  const damageFlags = cause.kind === "q2" ? cause.damageFlags : (request.delivery === "radius" ? 1 : 0)
    | (flags.noArmor ? 2 : 0) | (flags.energy ? 4 : 0) | (flags.noKnockback ? 8 : 0) | (flags.noProtection ? 32 : 0);
  const native = cause.kind === "q2" ? nativeCauseFromCanonical(profile, cause.meansOfDeath) : null;
  // MOD_UNKNOWN is the authored fallback for attacks absent from this module's obituary roster.
  return { damageFlags, native: native ?? nativeCauseFromCanonical(profile, 0) };
}
