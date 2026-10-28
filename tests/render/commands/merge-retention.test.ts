import { expect, test } from "bun:test";
import type { DrawBatch } from "../../../src/contracts/render.ts";
import { CPU_OPAQUE_STATE } from "../../../src/render/cpu/index.ts";
import { mergeDrawOperations } from "../../../src/render/scene/submissions.ts";
import { GeometryBuffer, packGeometry } from "../../../src/render/gl/buffers.ts";

function quadBatch(count: number, mark: number): Extract<DrawBatch, { readonly texturing: "single" }> {
  return { lighting: { kind: "vertex" }, primitive: "triangles", texturing: "single",
    texture: { kind: "retain-current-texture" }, state: CPU_OPAQUE_STATE, indices: [0, 1, 2],
    vertices: Array.from({ length: count }, (_, index) => ({ position: { x: mark + index / 7, y: 0, z: index / 9, w: 1 },
      color: { x: 1, y: index / 13, z: 0, w: 1 }, texCoord: { x: index / 3, y: 0 } })) };
}
function merged(batches: readonly DrawBatch[]): DrawBatch {
  const operations = mergeDrawOperations([{ kind: "draw", batches }]);
  const batch = operations.flatMap(operation => operation.kind === "draw" ? operation.batches : [])[0];
  if (batch === undefined) throw new Error("Missing merged batch");
  return batch;
}

test("repeated mergeable runs retain their merged batch and reach the pack cache", () => {
  const first = quadBatch(40, 0), second = quadBatch(40, 10);
  const a = merged([first, second]);
  expect(a.vertices).toHaveLength(80);
  expect(a.indices).toEqual([0, 1, 2, 40, 41, 42]);
  // Same constituent arrays next frame: identical merged batch object.
  const b = merged([first, second]);
  expect(b).toBe(a);
  // A changed constituent rebuilds with the new geometry.
  const changed = quadBatch(40, 20), c = merged([first, changed]);
  expect(c).not.toBe(a);
  expect(c.vertices[40]?.position.x).toBe(20);
  // The retained batch promotes into the identity-keyed pack cache.
  const buffer = new GeometryBuffer();
  buffer.pack(a);
  const promoted = buffer.pack(merged([first, second]));
  expect(buffer.pack(merged([first, second]))).toBe(promoted);
  const fresh = packGeometry(a);
  expect(new Uint8Array(promoted.positions.buffer, promoted.positions.byteOffset, promoted.positions.byteLength))
    .toEqual(new Uint8Array(fresh.positions.buffer, fresh.positions.byteOffset, fresh.positions.byteLength));
  // Small runs still merge by content without retention.
  const small = merged([quadBatch(3, 0), quadBatch(3, 1)]);
  expect(small.vertices).toHaveLength(6);
  expect(small.indices).toEqual([0, 1, 2, 3, 4, 5]);
});
