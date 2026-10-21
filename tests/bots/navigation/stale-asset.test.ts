import { expect, test } from "bun:test";
import { preloadNavigation } from "../../../src/bots/navigation/load.ts";
import { createContentId, createMountId, createMountIdentity, createMountPlanId, createResourceId } from "../../../src/contracts/content.ts";
import type { ResolvedResourceReference } from "../../../src/contracts/content.ts";
import { digestBytes } from "../../../src/content/mounts/index.ts";

// A supplied navigation file that does not describe this map (stale AAS
// checksum, foreign or corrupt bytes) must count as absent — botlib refuses
// such files without taking the game down — not abort the load.
function reference(path: string, bytes: Uint8Array): ResolvedResourceReference {
  const record: Omit<ResolvedResourceReference, "id"> = { requestedPath: path, byteLength: bytes.length, digest: digestBytes(bytes),
    provenance: { kind: "loose", memberPath: path, mount: { kind: "loose", rootPath: "/",
      identity: createMountIdentity(createMountId("nav", "test"), createContentId({ family: "q3", edition: "retail", package: "baseq3", revision: "test" }), 0) } },
    resolution: { kind: "default-order", plan: createMountPlanId("nav", "test"), rank: 0 } };
  return { ...record, id: createResourceId(record) };
}

test("stale or corrupt navigation assets preload as absent", async () => {
  const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const resources = { open: async (path: string) => ({ reference: reference(path, garbage), bytes: garbage }) };
  const mapBytes = new Uint8Array([9, 9, 9, 9]);
  const prepared = await preloadNavigation({ resources, mapBytes,
    map: { name: "maps/q3dm1.bsp", format: "q3-bsp", digest: digestBytes(mapBytes) } });
  expect(prepared.asset).toBeNull();
  expect(prepared.resource).toBeNull();
});
