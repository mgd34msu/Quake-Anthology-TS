import type { QvmModuleOptions } from "../../../compat/qvm/module.ts";
import { lrctfGrappleProfile } from "./lrctf-grapple-profile.ts";
import { threewaveGrappleProfile } from "./threewave-grapple-profile.ts";

export function q3GrappleProfile(artifact: QvmModuleOptions["artifact"]) {
  return lrctfGrappleProfile(artifact) ?? threewaveGrappleProfile(artifact);
}
