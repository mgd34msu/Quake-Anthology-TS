import { existsSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import type { Bounds, Vec3 } from "../../../../src/contracts/math.ts";
import type { BspChild, BspNode, BspPlane, Q1ClipChild, Q1ClipNode, Q1WorldGeometry, TraceQuery, TraceShape } from "../../../../src/contracts/scene.ts";
import { Q1_DONOR_PROFILE } from "../../../../src/core/numeric.ts";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { readQ1Bsp, q1EntityValue } from "../../../../src/formats/q1-map/index.ts";
import { createQ1Collision, Q1_HULL_BOUNDS } from "../../../../src/world/collision/q1/index.ts";

const zero: Vec3 = { x: 0, y: 0, z: 0 };
const bounds: Bounds = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } };
function cube(): Q1WorldGeometry {
  const normals: readonly Vec3[] = [{ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }];
  const planes: BspPlane[] = normals.map(normal => ({ normal, distance: 1, type: 3, signbits: 0 }));
  const nodes: BspNode[] = normals.map((_normal, i) => {
    const children: readonly [BspChild, BspChild] = [{ kind: "leaf", index: 1 }, i === 5 ? { kind: "leaf", index: 0 } : { kind: "node", index: i + 1 }];
    return { plane: i, children, bounds, faces: { first: 0, count: 0 } };
  });
  return { kind: "q1-bsp", format: "bsp29", entities: "", planes, nodes, vertices: [], edges: [], surfaceEdges: [],
    leaves: [-2, -1].map(contents => ({ contents, bounds, faces: { first: 0, count: 0 }, visibilityOffset: null, ambientSound: [0, 0, 0, 0] })),
    leafFaces: [], textures: [], textureInfo: [], faces: [], models: [{ bounds, origin: zero, headnodes: [0, -1, -1, -1], visibleLeaves: 1, faces: { first: 0, count: 0 } }],
    clipnodes: [], visibility: new Uint8Array(), lighting: { kind: "luminance8", samples: new Uint8Array() }, decoupledLightmaps: null, brushList: null, extensions: [] };
}
function query(start: Vec3, end: Vec3, shape: TraceShape = { kind: "point" }): TraceQuery {
  return { start, end, shape, target: { kind: "world" }, policy: { kind: "q1", move: "normal", hull: null }, numeric: Q1_DONOR_PROFILE, passActor: null };
}
function clipOnlyCube(): Q1WorldGeometry {
  const map = cube(), planes = [...map.planes], clipnodes: Q1ClipNode[] = [];
  for (let hullIndex = 1; hullIndex <= 2; hullIndex++) {
    const hull = Q1_HULL_BOUNDS[hullIndex];
    if (hull === undefined) throw new Error("Missing stock hull bounds");
    const first = clipnodes.length;
    for (let i = 0; i < map.planes.length; i++) {
      const plane = map.planes[i];
      if (plane === undefined) continue;
      const n = plane.normal;
      const offset = -(n.x * (n.x >= 0 ? hull.min.x : hull.max.x) + n.y * (n.y >= 0 ? hull.min.y : hull.max.y) + n.z * (n.z >= 0 ? hull.min.z : hull.max.z));
      const index = planes.length;
      planes.push({ ...plane, distance: plane.distance + offset });
      const children: readonly [Q1ClipChild, Q1ClipChild] = [{ kind: "contents", value: -1 }, i === 5 ? { kind: "contents", value: -2 } : { kind: "clipnode", index: first + i + 1 }];
      clipnodes.push({ plane: index, children });
    }
  }
  return { ...map, planes, clipnodes, models: [{ bounds, origin: zero, headnodes: [-2, 0, 6, -1], visibleLeaves: 1, faces: { first: 0, count: 0 } }] };
}

describe("Quake hulls and derived solid cells", () => {
  test("native hull zero preserves the source impact epsilon and start-solid exit", () => {
    const collision = createQ1Collision(cube());
    const hit = collision.trace(query({ x: 5, y: 0, z: 0 }, zero));
    expect(hit.fraction).toBe((5 - 1 - 1 / 32) / 5);
    expect(hit.end.x).toBe(1 + 1 / 32);
    expect(hit.contents).toBe(-2);
    const exiting = collision.trace(query(zero, { x: 5, y: 0, z: 0 }));
    expect(exiting.startSolid).toBe(true);
    expect(exiting.allSolid).toBe(false);
    expect(exiting.fraction).toBe(1);
  });
  test("foreign boxes use their actual extents and capsules round the corner", () => {
    const collision = createQ1Collision(cube());
    const shapeBounds: Bounds = { min: { x: -2, y: -2, z: -2 }, max: { x: 2, y: 2, z: 2 } };
    const box = collision.trace(query({ x: 5, y: 5, z: 0 }, zero, { kind: "box", bounds: shapeBounds }));
    expect(box.startSolid).toBe(false);
    expect(box.end.x).toBeCloseTo(3 + 1 / 32, 7);
    const capsule = collision.trace(query({ x: 5, y: 5, z: 0 }, zero, { kind: "capsule", bounds: shapeBounds }));
    expect(capsule.end.x).toBeCloseTo(1 + (2 + 1 / 32) / Math.sqrt(2), 5);
    expect(capsule.end.x).toBeLessThan(box.end.x);
    const embedded = collision.trace(query(zero, zero, { kind: "box", bounds: shapeBounds }));
    expect(embedded.startSolid).toBe(true);
    expect(embedded.allSolid).toBe(true);
    expect(collision.geometryCoverage()).toEqual({ arbitraryShapes: "drawing-bsp-cells", clipOnly: "derived-native-clipspace" });
  });
  test("model translation and rotation return world-space contact planes", () => {
    const collision = createQ1Collision(cube());
    const request = query({ x: 15, y: 20, z: 0 }, { x: 10, y: 20, z: 0 });
    const result = collision.trace({ ...request, target: { kind: "model", model: 0, origin: { x: 10, y: 20, z: 0 }, angles: { x: 0, y: 45, z: 0 } } });
    expect(result.fraction).toBeLessThan(1);
    expect(result.end.x).toBeCloseTo(10 + Math.sqrt(2) + Math.sqrt(2) / 32, 5);
    expect(result.contact.kind).toBe("plane");
  });
  test("compiler-removed clip solids remain collidable for two foreign sizes", () => {
    const collision = createQ1Collision(clipOnlyCube());
    expect(collision.trace(query({ x: 30, y: 0, z: 0 }, zero)).fraction).toBe(1);
    for (const radius of [3, 8]) {
      const foreign = collision.trace(query({ x: 30, y: 0, z: 0 }, zero,
        { kind: "box", bounds: { min: { x: -radius, y: -radius, z: -radius }, max: { x: radius, y: radius, z: radius } } }));
      expect(foreign.startSolid).toBe(false);
      expect(foreign.end.x).toBeCloseTo(1 + radius + 1 / 32, 5);
    }
  });
});

const pakPath = "/home/buzzkill/Projects/qfiles/q1/id1/PAK0.PAK";
test.skipIf(!existsSync(pakPath))("real Quake start.bsp supports native and foreign-size floor traces", async () => {
  const archive = await openArchive(pakPath);
  try {
    const entry = archive.findEntries("maps/start.bsp")[0];
    if (entry === undefined) throw new Error("Quake pak lacks maps/start.bsp");
    const map = readQ1Bsp(await archive.readEntry(entry), { source: "pak0:maps/start.bsp" });
    const player = map.entityList.find(entity => q1EntityValue(entity, "classname") === "info_player_start");
    if (player === undefined) throw new Error("Quake start lacks player start");
    const coordinates = q1EntityValue(player, "origin")?.trim().split(/\s+/).map(Number);
    const x = coordinates?.[0], y = coordinates?.[1], z = coordinates?.[2];
    if (x === undefined || y === undefined || z === undefined) throw new Error("Invalid player origin");
    const collision = createQ1Collision(map);
    const start = { x, y, z: z + 96 }, end = { x, y, z: z - 256 };
    const point = collision.trace(query(start, end));
    const foreign = collision.trace(query(start, end, { kind: "box", bounds: { min: { x: -10, y: -10, z: -20 }, max: { x: 10, y: 10, z: 40 } } }));
    expect(point.startSolid).toBe(false);
    expect(point.fraction).toBeLessThan(1);
    expect(foreign.startSolid).toBe(false);
    expect(foreign.fraction).toBeLessThan(point.fraction);
    expect(foreign.end.z - point.end.z).toBeCloseTo(20, 4);
    const leaf = collision.leafAt(start);
    expect(leaf).toBeGreaterThan(0);
    expect(collision.clusterVisible(collision.leafCluster(leaf), collision.leafCluster(leaf))).toBe(true);
  } finally { archive.close(); }
});
