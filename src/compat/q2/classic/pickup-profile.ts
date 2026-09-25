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
    { entry: 0xa3e0, recipient: { entry: 0xa3e4, join: 0xa4b8 }, resource: "inventory", supply: { kind: "ammo", entry: 0xa41c, amount: "rbx" } },
    { entry: 0x35ff0, recipient: { entry: 0x36064, join: 0x36077 }, resource: "inventory",
      supply: { kind: "weapon", ammoReturn: 0x360dc, settle: 0x360e5, autoswitch: { entry: 0x3614a, join: 0x3619b } } },
    { entry: 0x9960, recipient: { entry: 0x996b, join: 0x9a72 }, resource: "inventory" },
    { entry: 0x9ac0, recipient: { entry: 0x9acb, join: 0x9d98 }, resource: "inventory" },
  ],
  items: { table: 0x4b828, stride: 76, count: 48, classname: 0, pickup: 4 },
  entity: { item: 0x288, count: 0x214, spawnflags: 0x11c, inuse: 88, inuseBytes: 4, generation: null },
  time: { address: 0x76804, storage: "float32-seconds" },
  supply: { client: 0x54, inventory: 0x2e4, flags: 0x38, weaponFlag: 1,
    ammo: { entry: 0xa310, signature: classicSignature([q2Pointer, q2Pointer, q2Int], q2Int), stop: null,
      tag: 0x44, capacities: [0x6e4, 0x6e8, 0x6ec, 0x6f0, 0x6f4, 0x6f8, 0x6fc, 0x700], capacityBytes: 4 } },
};
export function classicPickupProfile(digest: ContentDigest): NativePickupProfile | null { return digest === xatrix.digest ? xatrix : null; }
