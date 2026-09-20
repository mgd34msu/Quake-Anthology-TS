import { expect, test } from "bun:test";
import type { Q2WorldGeometry } from "../../../src/contracts/scene.ts";
import { createSceneQueries } from "../../../src/world/collision/index.ts";
import { Q3GuestWorld } from "../../../src/app/bootstrap/simulation/q3/guest-world.ts";

test("component portal references survive another owner closing, save restore, and primary state changes", () => {
  const bounds = { min: { x: -16, y: -16, z: -16 }, max: { x: 16, y: 16, z: 16 } }, empty = { first: 0, count: 0 };
  const world: Q2WorldGeometry = {
    kind: 'q2-bsp', format: 'ibsp38', entities: '', planes: [{ normal: { x: 1, y: 0, z: 0 }, distance: 0, type: 0, signbits: 0 }],
    vertices: [], edges: [], surfaceEdges: [], nodes: [{ plane: 0, children: [{ kind: 'leaf', index: 0 }, { kind: 'leaf', index: 1 }], bounds, faces: empty }],
    leaves: [0, 1].map(index => ({ contents: 0, mergedContents: 0, cluster: index, area: index + 1, bounds, faces: empty, brushes: empty })),
    leafFaces: [], leafBrushes: [], textureInfo: [], faces: [], brushes: [], brushSides: [],
    models: [{ bounds, origin: { x: 0, y: 0, z: 0 }, headnode: 0, faces: empty }, { bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 8, y: 12, z: 16 } }, origin: { x: 0, y: 0, z: 0 }, headnode: 0, faces: empty }],
    areas: [{ portals: empty }, { portals: { first: 0, count: 1 } }, { portals: { first: 1, count: 1 } }],
    areaPortals: [{ portal: 0, otherArea: 2 }, { portal: 0, otherArea: 1 }],
    visibility: { clusters: [{ pvsOffset: 0, phsOffset: 1 }, { pvsOffset: 2, phsOffset: 3 }], compressed: Uint8Array.of(1, 3, 2, 3) },
    lighting: { kind: 'luminance8', samples: new Uint8Array() }, lightgrid: null, decoupledLightmaps: null, extensions: [],
  };
  const scene = createSceneQueries(world), first = new Q3GuestWorld(scene), second = new Q3GuestWorld(scene);
  expect(scene.areasConnected(1, 2)).toBe(false);
  first.adjustAreaPortalState(1, 2, true);
  second.adjustAreaPortalState(2, 1, true);
  const saved = second.capturePortalCheckpoint();
  first.close();
  expect(scene.areasConnected(1, 2)).toBe(true);
  second.restorePortalCheckpoint(saved);
  expect(scene.areasConnected(1, 2)).toBe(true);
  second.close();
  expect(scene.areasConnected(1, 2)).toBe(false);
  scene.setAreaPortalState(0, true);
  first.adjustAreaPortalState(1, 2, true);
  second.adjustAreaPortalState(1, 2, true);
  first.close(); second.close();
  expect(scene.areasConnected(1, 2)).toBe(true);
  first.adjustAreaPortalState(1, 2, true);
  scene.setAreaPortalState(0, false);
  expect(scene.areasConnected(1, 2)).toBe(true);
  first.close();
  expect(scene.areasConnected(1, 2)).toBe(false);
  second.restorePortalCheckpoint(saved);
  expect(scene.areasConnected(1, 2)).toBe(true);
  second.close();
  expect(scene.areasConnected(1, 2)).toBe(false);
});
