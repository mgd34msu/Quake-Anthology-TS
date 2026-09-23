import type { ContentDigest } from "../../../contracts/content.ts";
import type { NativePickupProfile } from "../native-pickups.ts";
import { signature } from "./api.ts";
import { fieldOffset, edictLayout, privateEdictPrefixLayout } from "./layouts.ts";
import { retailRereleaseClientProfile } from "./client-profile.ts";

const pointer = { kind: "scalar", storage: "pointer" } satisfies import("../../../contracts/execution.ts").GuestValueLayout;
const bool = { kind: "scalar", storage: "uint8" } satisfies import("../../../contracts/execution.ts").GuestValueLayout;
/** Retail PE regions retain the native register saves, dropped checks and respawn calls. */
export function rereleasePickupProfile(digest: ContentDigest): NativePickupProfile | null {
  const authority = retailRereleaseClientProfile.authority;
  if (authority.kind !== "artifact" || authority.digest !== digest) return null;
  return {
    digest, touch: 0x67be0, grantReturn: 0x67c95, targetsReturn: 0x67f27,
    touchSignature: signature([pointer, pointer, pointer, bool]), grantSignature: signature([pointer, pointer], bool),
    grants: [
      { entry: 0x67740, recipient: { entry: 0x677d4, join: 0x678e8 }, resource: "regular" },
      { entry: 0x671e0, recipient: { entry: 0x67209, join: 0x67357 }, resource: "inventory" },
    ],
    items: { table: 0x195320, stride: 192, count: 84, classname: 8, pickup: 16 },
    entity: { item: 0x860, count: 0x7b8, spawnflags: 0x5f0, inuse: fieldOffset(edictLayout, "inuse"), inuseBytes: 1, generation: fieldOffset(privateEdictPrefixLayout, "spawn_count") },
    time: { address: 0x241b28, storage: "int64-milliseconds" },
  };
}
