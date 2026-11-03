// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import type { BspChild, BspNode, Q1Leaf, Q1WorldGeometry, Q3BspSurface, Q3WorldGeometry } from "../../src/contracts/scene.ts";
import type { SceneCamera } from "../../src/contracts/render.ts";
import { anglesToAxis } from "../../src/core/math.ts";
import { perspectiveProjection } from "../../src/render/scene/index.ts";
import { visibleWorld } from "../../src/render/scene/visibility.ts";

const bounds = { min: { x: -16, y: -16, z: -16 }, max: { x: 16, y: 16, z: 16 } };
const surface: Q3BspSurface = {
  kind: "triangles",
  shader: 0,
  fog: -1,
  vertices: { first: 0, count: 0 },
  indices: { first: 0, count: 3 },
  lightmap: {
    image: -1,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    origin: { x: 0, y: 0, z: 0 },
    vectors: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    ],
  },
};
const camera: SceneCamera = {
  origin: { x: 0, y: 0, z: 0 },
  axis: anglesToAxis({ x: 0, y: 0, z: 0 }),
  viewport: { x: 0, y: 0, width: 32, height: 32 },
  projection: perspectiveProjection(90, 90, 4096),
  clip: { kind: "none" },
};

/** Balanced heap-ordered Q3 BSP. The camera descent (plane x=0, origin 0)
 * always takes child 1, landing in the last leaf, which holds cluster 0.
 * Leaf 0 holds cluster 1; every other leaf holds cluster 2. */
function balancedMap(depth: number, row: number, counts?: { reads: number }): Q3WorldGeometry {
  const leafCount = 2 ** depth,
    nodeCount = leafCount - 1;
  const child = (heap: number): BspChild => (heap < nodeCount ? { kind: "node", index: heap } : { kind: "leaf", index: heap - nodeCount });
  const plain: Omit<BspNode, "faces">[] = Array.from({ length: nodeCount }, (_, index) => ({
    plane: 0,
    bounds,
    children: [child(2 * index + 1), child(2 * index + 2)],
  }));
  const counting: ProxyHandler<Omit<BspNode, "faces">[]> = {
    get(target, property) {
      if (property === "length") return target.length;
      if (typeof property === "string" && /^\d+$/.test(property)) {
        if (counts !== undefined) counts.reads++;
        return target[Number(property)];
      }
      return undefined;
    },
  };
  const nodes = counts === undefined ? plain : new Proxy(plain, counting);
  return {
    kind: "q3-bsp",
    format: "ibsp46",
    entities: "",
    shaders: [{ name: "test", surfaceFlags: 0, contentFlags: 0 }],
    planes: [{ normal: { x: 1, y: 0, z: 0 }, distance: 0, type: 0, signbits: 0 }],
    nodes,
    leaves: Array.from({ length: leafCount }, (_, index) => ({
      cluster: index === leafCount - 1 ? 0 : index === 0 ? 1 : 2,
      area: index === 0 ? 1 : 0,
      bounds,
      surfaces: { first: index, count: 1 },
      brushes: { first: 0, count: 0 },
    })),
    leafSurfaces: Array.from({ length: leafCount }, (_, index) => index),
    leafBrushes: [],
    models: [{ bounds, surfaces: { first: 0, count: leafCount }, brushes: { first: 0, count: 0 } }],
    brushes: [],
    brushSides: [],
    vertices: [],
    indices: [],
    fogs: [],
    surfaces: Array.from({ length: leafCount }, () => surface),
    lightmaps: [],
    lightGrid: [],
    visibility: { clusterCount: 8, bytesPerCluster: 1, bits: Uint8Array.from([row, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]) },
  };
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

test("Q1 solid children sharing leaf zero do not disable ancestor pruning", () => {
  const depth = 12,
    leafSlots = 2 ** depth,
    nodeCount = leafSlots - 1,
    counts = { reads: 0 };
  // Every solid slot is leaf 0; the slot on the camera path is leaf 1, and one far slot is leaf 2 (not in the PVS row).
  const child = (heap: number): BspChild =>
    heap < nodeCount ? { kind: "node", index: heap } : { kind: "leaf", index: heap - nodeCount === leafSlots - 1 ? 1 : heap - nodeCount === 0 ? 2 : 0 };
  const plain = Array.from(
    { length: nodeCount },
    (_, index): BspNode => ({ plane: 0, bounds, faces: { first: 0, count: 0 }, children: [child(2 * index + 1), child(2 * index + 2)] }),
  );
  const nodes = new Proxy(plain, {
    get(target, property) {
      if (property === "length") return target.length;
      if (typeof property === "string" && /^\d+$/.test(property)) {
        counts.reads++;
        return target[Number(property)];
      }
      return undefined;
    },
  });
  const leaf = (offset: number | null): Q1Leaf => ({
    contents: offset === null ? -2 : -1,
    bounds,
    faces: { first: 0, count: 0 },
    visibilityOffset: offset,
    ambientSound: [0, 0, 0, 0],
  });
  const map: Q1WorldGeometry = {
    kind: "q1-bsp",
    format: "bsp29",
    entities: "",
    planes: [{ normal: { x: 1, y: 0, z: 0 }, distance: 0, type: 0, signbits: 0 }],
    vertices: [],
    edges: [],
    surfaceEdges: [],
    nodes,
    leaves: [leaf(null), leaf(0), leaf(0)],
    leafFaces: [],
    textures: [],
    textureInfo: [],
    faces: [],
    models: [{ bounds, origin: { x: 0, y: 0, z: 0 }, headnodes: [0, 0, 0, 0], visibleLeaves: 2, faces: { first: 0, count: 0 } }],
    clipnodes: [],
    visibility: Uint8Array.from([0b01]),
    lighting: { kind: "rgb8", source: "bsp", samples: new Uint8Array() },
    decoupledLightmaps: null,
    brushList: null,
    extensions: [],
  };
  visibleWorld(map, camera, { noCull: true });
  counts.reads = 0;
  const result = visibleWorld(map, camera, { noCull: true });
  expect(result.leaves).toEqual([1]);
  expect(counts.reads).toBeGreaterThan(0);
  expect(counts.reads).toBeLessThan(100);
});
