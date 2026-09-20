import type { QvmModuleOptions } from "../../../compat/qvm/module.ts";
import { q3GrappleProfile } from "./grapple-profiles.ts";
import { LRCTF_GRAPPLE_DIGEST } from "./lrctf-grapple-profile.ts";
import { THREEWAVE_GRAPPLE_DIGEST } from "./threewave-grapple-profile.ts";

/** G_Damage's actual flags, pain and die fields in each admitted qagame. */
export function q3NativeCombatProfile(artifact: QvmModuleOptions["artifact"]) {
  const source = q3GrappleProfile(artifact);
  if (source === null) return null;
  switch (artifact.module.digest) {
    case LRCTF_GRAPPLE_DIGEST: return { ...source, reactions: { flags: 536, pain: 728, die: 732 } };
    case THREEWAVE_GRAPPLE_DIGEST: return { ...source, reactions: { flags: 536, pain: 712, die: 716 } };
    default: return null;
  }
}
