import { expect, test } from "bun:test";
import { parseAas } from "../../../src/bots/navigation/aas.ts";
import { clusterAas, optimizeAas, writeAas } from "../../../src/bots/navigation/index.ts";
import { aasEstimateFixture } from "./estimate-fixture.ts";

test("AAS authoring rebuilds source clusters and round-trips routing records", () => {
  const asset = parseAas(aasEstimateFixture([{}, {}, {}], [{ from: 1, to: 2 }, { from: 2, to: 1 }]));
  const original = structuredClone(asset);
  const clustered = clusterAas(asset);
  expect(clustered.settings[1]?.cluster).toBe(1);
  expect(clustered.settings[2]?.cluster).toBe(1);
  expect(clustered.settings[3]?.cluster).toBe(0);
  expect(clustered.clusters[1]?.reachabilityAreaCount).toBe(2);
  const bytes = writeAas(clustered), decoded = parseAas(bytes, "written", asset.bspChecksum);
  expect(decoded.settings).toEqual(clustered.settings);
  expect(decoded.reachability).toEqual(asset.reachability);
  expect(decoded.clusters).toEqual(clustered.clusters);
  expect(decoded.portals).toEqual(clustered.portals);
  expect(writeAas(decoded)).toEqual(bytes);
  expect(asset).toEqual(original);
});

test("AAS optimization preserves source ladder geometry and special mover payloads", () => {
  const base = parseAas(aasEstimateFixture([{}, {}], [{ from: 1, to: 2 }, { from: 2, to: 1, type: 11 }]));
  const asset = { ...base, vertices: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 32 }],
    edges: [{ vertices: [0, 0] }, { vertices: [0, 1] }], edgeIndexes: [1, -1],
    faces: [{ plane: 0, flags: 0, edgeCount: 0, firstEdge: 0, frontArea: 0, backArea: 0 },
      { plane: 0, flags: 2, edgeCount: 1, firstEdge: 0, frontArea: 1, backArea: 2 },
      { plane: 0, flags: 0, edgeCount: 1, firstEdge: 1, frontArea: 1, backArea: 2 }],
    faceIndexes: [1, 2, -1],
    areas: base.areas.map((area, index) => ({ ...area, firstFace: index === 2 ? 2 : 0, faceCount: index === 1 ? 2 : index === 2 ? 1 : 0 })),
    reachability: base.reachability.map((reach, index) => ({ ...reach, face: index === 2 ? 543 : -1, edge: index === 2 ? 123 : -1 })),
  } satisfies import("../../../src/bots/navigation/aas.ts").AasAsset;
  const optimized = optimizeAas(asset);
  expect(optimized.faces).toHaveLength(2);
  expect(optimized.areas[0]).toEqual({ number: 0, faceCount: 0, firstFace: 0,
    bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }, center: { x: 0, y: 0, z: 0 } });
  expect(optimized.faceIndexes).toEqual([1, -1]);
  expect(optimized.reachability[1]?.face).toBe(-1);
  expect(optimized.reachability[2]?.face).toBe(543);
  expect(optimized.reachability[2]?.edge).toBe(123);
  const decoded = parseAas(writeAas(optimized));
  expect(decoded.faces).toEqual(optimized.faces);
  expect(decoded.reachability).toEqual(optimized.reachability);
  expect(asset.faces).toHaveLength(3);
});
