import type { DamageRequest } from "../../contracts/gameplay.ts";
import type { ArmorDamageFlags } from "../../contracts/gameplay.ts";
import { attackDamageFlags } from "../../world/gameplay/armor.ts";
import { nativeCauseFromCanonical } from "../../content/q2/missionpacks/damage.ts";
import type { Q2NativeCauseProfile } from "../../content/q2/missionpacks/damage.ts";

export class RemovedNativeDamage extends Error {
  constructor(readonly request: DamageRequest) { super("Native damage target was removed during powered protection"); }
}

/** Flags at the original armor callsite, after the source has applied its damage gates. */
export function q2NativeArmorFlags(flags: number): ArmorDamageFlags {
  return { noArmor: (flags & 2) !== 0, noPowerArmor: (flags & 0x100) !== 0,
    noRegularArmor: (flags & 0x80) !== 0, energy: (flags & 4) !== 0 };
}

/** Foreign attacks keep their provenance; only the arguments entering Q2 are lowered. */
export function q2NativeDamageArguments(request: DamageRequest, profile: Q2NativeCauseProfile) {
  const cause = request.attack.cause, flags = attackDamageFlags(request);
  const damageFlags = cause.kind === "q2" ? cause.damageFlags : (request.delivery === "radius" ? 1 : 0)
    | (flags.noArmor ? 2 : 0) | (flags.energy ? 4 : 0) | (flags.noKnockback ? 8 : 0) | (flags.noProtection ? 32 : 0);
  const native = cause.kind === "q2" ? nativeCauseFromCanonical(profile, cause.meansOfDeath) : null;
  // MOD_UNKNOWN is the authored fallback for attacks absent from this module's obituary roster.
  return { damageFlags, native: native ?? nativeCauseFromCanonical(profile, 0) };
}
