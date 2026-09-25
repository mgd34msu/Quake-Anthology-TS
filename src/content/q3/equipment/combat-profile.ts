import type { QvmModuleOptions } from "../../../compat/qvm/module.ts";
import type { QvmPrimaryCombatProfile } from "../../../compat/qvm/game-combat-binding.ts";
import type { QvmGameArmorDefinition } from "../../../compat/qvm/game-combat.ts";
import { q3GrappleProfile } from "./grapple-profiles.ts";
import { LRCTF_GRAPPLE_DIGEST } from "./lrctf-grapple-profile.ts";
import { THREEWAVE_GRAPPLE_DIGEST } from "./threewave-grapple-profile.ts";

const lrctfArmor: QvmGameArmorDefinition = { checkArmor: 139839, pointsStat: 3, protection: Math.fround(0.66), tiers: null };
const threewaveArmor: QvmGameArmorDefinition = { checkArmor: 161690, pointsStat: 6, protection: Math.fround(0.66), tiers: {
  stat: 3, whenAny: [{ offset: 107944, comparison: "equal", value: 10 }, { offset: 1089728, comparison: "not-equal", value: 0 }],
  values: [{ tier: 0, protection: Math.fround(0.3) }, { tier: 1, protection: Math.fround(0.6) }, { tier: 2, protection: Math.fround(0.8) }],
  fallback: Math.fround(0.3),
} };

/** G_Damage's actual flags, pain and die fields in each admitted qagame. */
export function q3NativeCombatProfile(artifact: QvmModuleOptions["artifact"]): QvmPrimaryCombatProfile | null {
  const source = q3GrappleProfile(artifact);
  if (source === null) return null;
  const semantics = { damageCall: "q3-g-damage-8-check-armor-3", state: { healthStat: 0,
    team: { persistentStat: 3, values: [{ value: 1, team: "q3:1" }, { value: 2, team: "q3:2" }] },
    flags: { notarget: 32, invulnerable: 16, noKnockback: 2048 }, mass: { kind: "constant", value: 200 } },
    damageFlags: { radius: 1, noArmor: 2, noKnockback: 4, noProtection: 8, noTeamProtection: 16 } } satisfies Pick<QvmPrimaryCombatProfile, "damageCall" | "state" | "damageFlags">;
  switch (artifact.module.digest) {
    case LRCTF_GRAPPLE_DIGEST: return { ...source, ...semantics, armor: lrctfArmor, reactions: { flags: 536, pain: 728, die: 732 } };
    case THREEWAVE_GRAPPLE_DIGEST: return { ...source, ...semantics, armor: threewaveArmor, reactions: { flags: 536, pain: 712, die: 716 } };
    default: return null;
  }
}
