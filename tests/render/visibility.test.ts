import { expect, test } from "bun:test";
import type { BspChild, BspNode, Q3BspSurface, Q3WorldGeometry } from "../../src/contracts/scene.ts";
import type { SceneCamera } from "../../src/contracts/render.ts";
import { anglesToAxis } from "../../src/core/math.ts";
import { perspectiveProjection } from "../../src/render/scene/index.ts";
import { visibleWorld } from "../../src/render/scene/visibility.ts";

const bounds = { min: { x: -16, y: -16, z: -16 }, max: { x: 16, y: 16, z: 16 } };
const surface: Q3BspSurface = { kind: "triangles", shader: 0, fog: -1, vertices: { first: 0, count: 0 }, indices: { first: 0, count: 3 },
  lightmap: { image: -1, x: 0, y: 0, width: 0, height: 0, origin: { x: 0, y: 0, z: 0 }, vectors: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }] } };
const camera: SceneCamera = { origin: { x: 0, y: 0, z: 0 }, axis: anglesToAxis({ x: 0, y: 0, z: 0 }),
  viewport: { x: 0, y: 0, width: 32, height: 32 }, projection: perspectiveProjection(90, 90, 4096), clip: { kind: "none" } };

/** Balanced heap-ordered Q3 BSP. The camera descent (plane x=0, origin 0)
 * always takes child 1, landing in the last leaf, which holds cluster 0.
 * Leaf 0 holds cluster 1; every other leaf holds cluster 2. */
function balancedMap(depth: number, row: number, counts?: { reads: number }): Q3WorldGeometry {
  const leafCount = 2 ** depth, nodeCount = leafCount - 1;
  const child = (heap: number): BspChild => heap < nodeCount ? { kind: "node", index: heap } : { kind: "leaf", index: heap - nodeCount };
  const plain: Omit<BspNode, "faces">[] = Array.from({ length: nodeCount }, (_, index) => ({ plane: 0, bounds, children: [child(2 * index + 1), child(2 * index + 2)] }));
  const counting: ProxyHandler<Omit<BspNode, "faces">[]> = { get(target, property, receiver) {
    const value: unknown = Reflect.get(target, property, receiver);
    if (typeof property === "string" && /^\d+$/.test(property) && counts !== undefined) counts.reads++;
    return value;
  } };
  const nodes = counts === undefined ? plain : new Proxy(plain, counting);
  return { kind: "q3-bsp", format: "ibsp46", entities: "", shaders: [{ name: "test", surfaceFlags: 0, contentFlags: 0 }],
    planes: [{ normal: { x: 1, y: 0, z: 0 }, distance: 0, type: 0, signbits: 0 }], nodes,
    leaves: Array.from({ length: leafCount }, (_, index) => ({ cluster: index === leafCount - 1 ? 0 : index === 0 ? 1 : 2,
      area: index === 0 ? 1 : 0, bounds, surfaces: { first: index, count: 1 }, brushes: { first: 0, count: 0 } })),
    leafSurfaces: Array.from({ length: leafCount }, (_, index) => index), leafBrushes: [],
    models: [{ bounds, surfaces: { first: 0, count: leafCount }, brushes: { first: 0, count: 0 } }],
    brushes: [], brushSides: [], vertices: [], indices: [], fogs: [],
    surfaces: Array.from({ length: leafCount }, () => surface), lightmaps: [], lightGrid: [],
    visibility: { clusterCount: 8, bytesPerCluster: 1, bits: Uint8Array.from([row, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]) } };
}

test("sparse PVS skips whole BSP subtrees instead of visiting every internal node", () => {
  const counts = { reads: 0 };
  const map = balancedMap(14, 0b00000010, counts);
  const warm = visibleWorld(map, camera, { noCull: true });
  expect(warm.leaves).toEqual([0]);
  expect(warm.surfaces).toEqual([0]);
  counts.reads = 0;
  const result = visibleWorld(map, camera, { noCull: true });
  expect(result.leaves).toEqual([0]);
  expect(result.surfaces).toEqual([0]);
  // Camera descent (14) + marked ancestors (14); 16,383 would mean no pruning.
  expect(counts.reads).toBeGreaterThan(0);
  expect(counts.reads).toBeLessThan(100);
  // Visible-area changes invalidate the cached marks.
  expect(visibleWorld(map, camera, { noCull: true, visibleAreas: new Set([0]) }).leaves).toEqual([]);
  expect(visibleWorld(map, camera, { noCull: true, visibleAreas: new Set([1]) }).leaves).toEqual([0]);
  expect(visibleWorld(map, camera, { noCull: true }).leaves).toEqual([0]);
});

test("dense PVS still visits every leaf", () => {
  const map = balancedMap(4, 0b00000111);
  const result = visibleWorld(map, camera, { noCull: true });
  expect([...result.leaves].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, index) => index));
  expect([...result.surfaces].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, index) => index));
});
