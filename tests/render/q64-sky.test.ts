import { expect, test } from "bun:test";
import { splitQ64SkyTexture } from "../../src/materials/legacy.ts";
import { createContentId, createMountId, createMountIdentity, createMountPlanId, createResourceId } from "../../src/contracts/content.ts";
import type { ResolvedResourceReference } from "../../src/contracts/content.ts";
import { digestBytes } from "../../src/content/mounts/index.ts";

test("Quake64 sky keeps vertical layers and index-zero foreground at half alpha", () => {
  const colors = new Uint8Array(768); colors.set([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
  const record: Omit<ResolvedResourceReference, "id"> = { requestedPath: "palette", byteLength: colors.length, digest: digestBytes(colors),
    provenance: { kind: "loose", memberPath: "palette", mount: { kind: "loose", rootPath: "/", identity: createMountIdentity(createMountId("q64", "palette"), createContentId({ family: "q1", edition: "classic", package: "base", revision: "test" }), 0) } },
    resolution: { kind: "default-order", plan: createMountPlanId("q64", "test"), rank: 0 } };
  const result = splitQ64SkyTexture({ kind: "indexed8", levels: [{ width: 2, height: 2, pixels: new Uint8Array([0, 1, 2, 3]) }],
    palette: { colors, source: { ...record, id: createResourceId(record) } }, transparency: { kind: "opaque" }, fullbright: null, translation: null });
  expect(result.solid).toEqual({ width: 2, height: 1, pixels: new Uint8Array([70, 80, 90, 255, 100, 110, 120, 255]) });
  expect(result.overlay).toEqual({ width: 2, height: 1, pixels: new Uint8Array([10, 20, 30, 128, 40, 50, 60, 128]) });
});
