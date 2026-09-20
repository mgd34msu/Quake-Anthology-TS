import type { QvmModuleOptions } from "../../../compat/qvm/module.ts";
import { readQvmGrappleProfile, type QvmGrappleProfile } from "../../../compat/qvm/grapple-profile.ts";

export const LRCTF_GRAPPLE_DIGEST = "sha256:b9e396cf5ed2b913548cd92e2b0886ad5992653c8903fa3f9ed0b1f4167ca43e";

/** LRCTF 1.2 pak02 vm/qagame.qvm. Entries and offsets come from its own bytecode. */
export function lrctfGrappleProfile(artifact: QvmModuleOptions["artifact"]): QvmGrappleProfile | null {
  if (artifact.module.digest !== LRCTF_GRAPPLE_DIGEST) return null;
  return readQvmGrappleProfile({ version: 1, id: "lrctf-1.2", title: "LRCTF (Quake 3)", artifactDigest: artifact.module.digest,
    artifactPath: artifact.module.artifactPath, abiProfile: "q3-modern", entityStride: 856, clientStride: 872,
    fields: { inuse: 520, client: 516, parent: 600, target: 784, mover: 836, health: 748, takedamage: 752, eventTime: 552, freeAfterEvent: 556, hook: 840 },
    globals: { time: 998864, frame: 998860, movement: 1008980, forward: 1008836, groundPlane: 1008884 },
    callbacks: { allocate: 178797, free: 179014, fire: 183076, release: 183171, forceRelease: 183171, missile: 151164, follow: 183577, think: 5362, pull: 15874, moveMoverHooks: 184569, damage: 140358, sameTeam: 169306, playerMove: 22369 },
    pullingFlag: 2048, fireArguments: [], movement: { byteLength: 16, words: [] }, initialCvars: {},
    eventLifetimeMilliseconds: 300, grappleDamageMethod: 23,
    presentation: { projectileModel: "models/weapons3/hook/hook1.md3", viewModel: "models/weapons3/hook/bit1.md3", weaponIndex: 10,
      viewAnchor: { path: "models/weapons2/shotgun/shotgun_hand.md3", tag: "tag_weapon", offset: { x: 0, y: 0, z: 0 }, fovOffset: { above: 90, scale: -0.2 } }, viewAttachments: [],
      cable: { kind: "shader", path: "grapplerope", width: 16 }, fireSound: "sound/grapple/midevil/grfire.wav", attachSound: "sound/grapple/midevil/grhit.wav", releaseSound: null, pullSound: null, hangSound: null } }, artifact);
}
