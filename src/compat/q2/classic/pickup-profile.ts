import type { ContentDigest } from "../../../contracts/content.ts";
import type { NativePickupProfile } from "../native-pickups.ts";
import { classicSignature, q2Int, q2Pointer } from "./layout.ts";
import { xatrixCombatProfile } from "./combat-profile.ts";

/** Original Xatrix PE: recipient regions contain no map effects; joins retain respawn tails. */
const xatrix: NativePickupProfile = {
  digest: xatrixCombatProfile.digest, touch: 0xab00, grantReturn: 0xab38, targetsReturn: 0xac90,
  touchSignature: classicSignature([q2Pointer, q2Pointer, q2Pointer, q2Pointer]), grantSignature: classicSignature([q2Pointer, q2Pointer], q2Int),
  grants: [
    { entry: 0xa780, recipient: { entry: 0xa795, join: 0xa8cb }, resource: "regular" },
    { entry: 0xa3e0, recipient: { entry: 0xa3e4, join: 0xa4b8 }, resource: "inventory" },
  ],
  items: { table: 0x4b828, stride: 76, count: 48, classname: 0, pickup: 4 },
  entity: { item: 0x288, count: 0x214, spawnflags: 0x11c, inuse: 88, inuseBytes: 4, generation: null },
  time: { address: 0x76804, storage: "float32-seconds" },
};
export function classicPickupProfile(digest: ContentDigest): NativePickupProfile | null { return digest === xatrix.digest ? xatrix : null; }
