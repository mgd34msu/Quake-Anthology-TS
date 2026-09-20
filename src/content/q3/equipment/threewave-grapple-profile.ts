import type { QvmModuleOptions } from "../../../compat/qvm/module.ts";
import { readQvmGrappleProfile, type QvmGrappleProfile } from "../../../compat/qvm/grapple-profile.ts";

export const THREEWAVE_GRAPPLE_DIGEST = "sha256:9751bad99a2d138f96a9b0436d2ea2d965b86214175dc33e4cea95e059419337";

/** Threewave 1.7 qagame: private layout and callbacks verified against these executable bytes. */
export function threewaveGrappleProfile(artifact: QvmModuleOptions["artifact"]): QvmGrappleProfile | null {
  if (artifact.module.digest !== THREEWAVE_GRAPPLE_DIGEST) return null;
  return readQvmGrappleProfile({ version: 1, id: "threewave-1.7", title: "Threewave CTF (Quake 3)", artifactDigest: artifact.module.digest,
    artifactPath: artifact.module.artifactPath, abiProfile: "q3-modern", entityStride: 876, clientStride: 944,
    fields: { inuse: 520, client: 516, parent: 600, target: 768, mover: null, health: 732, takedamage: 736, hook: 816,
      eventTime: 552, freeAfterEvent: 556 },
    globals: { time: 1077712, frame: 1077708, movement: 1091860, forward: 1091720, groundPlane: 1091768 },
    callbacks: { allocate: 210993, free: 211210, fire: 217563, release: 215035, forceRelease: 215169, missile: 177663,
      follow: null, think: 16897, pull: 29990, moveMoverHooks: null, damage: 162405, sameTeam: 197341, playerMove: 35535 },
    fireArguments: [0], movement: { byteLength: 240, words: [{ offset: 232, value: 10 }, { offset: 236, value: 0 }] },
    initialCvars: { g_gametype: "10", g_lithium: "0", p_enablePortal: "0" }, pullingFlag: 2048, eventLifetimeMilliseconds: 100, grappleDamageMethod: 29,
    presentation: { projectileModel: "models/weapons2/grapple/grapple_hook.md3", viewModel: "models/weapons2/grapple/grap.md3", weaponIndex: 11,
      viewAnchor: { path: "models/weapons2/shotgun/shotgun_hand.md3", tag: "tag_weapon", offset: { x: 5, y: 0, z: -1 }, fovOffset: { above: 90, scale: -0.2 } },
      viewAttachments: [{ path: "models/weapons2/grapple/grapple_hand.md3", tag: "tag_hook" }],
      cable: { kind: "model", flight: "models/weapons2/grapple/grapple1_cord_s.md3", pull: "models/weapons2/grapple/grapple1_cord_p.md3",
        hold: "models/weapons2/grapple/grapple1_cord_f.md3", segmentLength: 14 },
      fireSound: "sound/cctf/grapple/grapple_fire.wav", attachSound: "sound/cctf/grapple/grapple_hit.wav", releaseSound: null,
      pullSound: "sound/cctf/grapple/grapple_pull.wav", hangSound: "sound/cctf/grapple/grapple_hang.wav" } }, artifact);
}
