import { createSceneQueries } from "../../../../src/world/collision/index.ts";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { describe, expect, spyOn, test } from "bun:test";
import { deepStrictEqual } from "node:assert";
import * as clipspace from "../../../../src/world/geometry/q1-solid/clipspace.ts";
import type { Bounds, Vec3 } from "../../../../src/contracts/math.ts";
import type { BspChild, BspNode, BspPlane, Q1ClipChild, Q1ClipNode, Q1WorldGeometry, TraceQuery, TraceShape } from "../../../../src/contracts/scene.ts";
import { Q1_DONOR_PROFILE, Q2_DONOR_PROFILE, Q3_BINARY32_PROFILE } from "../../../../src/core/numeric.ts";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { readQ1Bsp, q1EntityValue } from "../../../../src/formats/q1-map/index.ts";
import { q1FaceVertices } from "../../../../src/formats/q1-map/queries.ts";
import { adaptTraceResult } from "../../../../src/world/collision/contents.ts";
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
  test("drawing hits bound clip reconstruction without losing earlier clips or solid exits", () => {
    const map = clipOnlyCube(), model = map.models[0];
    if (model === undefined) throw new Error("Missing fixture model");
    const geometry: Q1WorldGeometry = { ...map,
      planes: map.planes.map((plane, index) => index < 6 ? plane : { ...plane, distance: plane.distance + plane.normal.x * 4 }),
      models: [{ ...model, headnodes: [0, 0, 6, -1] }] };
    const derive = spyOn(clipspace, "deriveQ1ClipSolids");
    try {
      for (const kind of ["box", "capsule"] satisfies readonly TraceShape["kind"][]) {
        const collision = createQ1Collision(geometry);
        const shape: TraceShape = { kind, bounds: { min: { x: -2, y: -2, z: -2 }, max: { x: 2, y: 2, z: 2 } } };
        const before = derive.mock.calls.length;
        const hit = collision.trace(query({ x: 10, y: 0, z: 0 }, { x: -10000, y: 0, z: 0 }, shape));
        expect(hit.end.x).toBeCloseTo(7 + 1 / 32, 5);
        expect(hit.startSolid).toBe(false);
        expect(derive.mock.calls[before]?.[1].min.x).toBeGreaterThan(-1);
        const exiting = collision.trace(query({ x: 5, y: 0, z: 0 }, { x: -10, y: 0, z: 0 }, shape));
        expect(exiting.startSolid).toBe(true);
        expect(exiting.allSolid).toBe(false);
        expect(exiting.fraction).toBe(1);
        const trapped = collision.trace(query({ x: 5, y: 0, z: 0 }, zero, shape));
        expect(trapped.startSolid).toBe(true);
        expect(trapped.allSolid).toBe(true);
      }
    } finally { derive.mockRestore(); }
  });
  test("exact derived cells retain policy checks and separate hull and collision owners", () => {
    const derive = spyOn(clipspace, "deriveQ1ClipSolids");
    try {
      const map = clipOnlyCube(), first = map.models[0];
      if (first === undefined) throw new Error("Missing fixture model");
      const geometry: Q1WorldGeometry = { ...map, models: [first, { ...first, headnodes: [-2, -1, -1, -1] }] };
      let enabled = true;
      const collision = createQ1Collision(geometry, { blocksContents: contents => enabled && contents === -2 });
      const input = query({ x: 5, y: 0, z: 0 }, zero, { kind: "box", bounds: { min: { x: -2, y: -2, z: -2 }, max: { x: 2, y: 2, z: 2 } } });
      const firstHit = collision.trace(input);
      expect(firstHit.fraction).toBeLessThan(1);
      deepStrictEqual(collision.trace(input), firstHit);
      expect(derive).toHaveBeenCalledTimes(1);
      enabled = false;
      expect(collision.trace(input).fraction).toBe(1);
      expect(derive).toHaveBeenCalledTimes(1);
      enabled = true;
      deepStrictEqual(collision.trace(input), firstHit);
      expect(derive).toHaveBeenCalledTimes(1);
      expect(collision.trace({ ...input, target: { kind: "model", model: 1, origin: zero, angles: zero } }).fraction).toBe(1);
      expect(derive).toHaveBeenCalledTimes(2);
      deepStrictEqual(createQ1Collision(geometry).trace(input), firstHit);
      expect(derive).toHaveBeenCalledTimes(3);
    } finally { derive.mockRestore(); }
  });
  test("exact derived-cell entries evict without changing rederived results", () => {
    const derive = spyOn(clipspace, "deriveQ1ClipSolids");
    try {
      const collision = createQ1Collision(clipOnlyCube());
      const input = query({ x: 5, y: 0, z: 0 }, zero, { kind: "box", bounds: { min: { x: -2, y: -2, z: -2 }, max: { x: 2, y: 2, z: 2 } } });
      const firstHit = collision.trace(input);
      for (let index = 1; index <= 128; index++) collision.trace({ ...input, start: { ...input.start, y: index * 10 }, end: { ...input.end, y: index * 10 } });
      const before = derive.mock.calls.length;
      deepStrictEqual(collision.trace(input), firstHit);
      expect(derive.mock.calls.length).toBe(before + 1);
      deepStrictEqual(collision.trace(input), firstHit);
      expect(derive.mock.calls.length).toBe(before + 1);
    } finally { derive.mockRestore(); }
  });
  test("nonfinite derived envelopes retain the uncached behavior", () => {
    const derive = spyOn(clipspace, "deriveQ1ClipSolids");
    try {
      const collision = createQ1Collision(cube());
      const shape: TraceShape = { kind: "box", bounds: { min: { x: -2, y: -2, z: -2 }, max: { x: 2, y: 2, z: 2 } } };
      for (const x of [NaN, Infinity, -Infinity]) {
        const input = query({ x, y: 0, z: 0 }, zero, shape);
        const before = derive.mock.calls.length;
        const result = collision.trace(input);
        deepStrictEqual(collision.trace(input), result);
        expect(derive.mock.calls.length).toBe(before + 2);
      }
    } finally { derive.mockRestore(); }
  });
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
  test("zero-size boxes retain point geometry across policies, numeric profiles and rotated models", () => {
    const solid = cube();
    const water = { ...solid, leaves: solid.leaves.map(leaf => ({ ...leaf, contents: leaf.contents === -2 ? -3 : leaf.contents })) };
    for (const world of [solid, water, clipOnlyCube()]) {
      const scene = createSceneQueries(world);
      for (const policy of [
        { kind: "q1", move: "normal", hull: null },
        { kind: "q2", contentsMask: 0x46000003, leafContents: "merged" },
        { kind: "q2", contentsMask: 56, leafContents: "merged" },
        { kind: "q3", contentsMask: 0x06000039, curves: true, playerCurveClip: true },
      ] satisfies readonly TraceQuery["policy"][]) for (const numeric of [Q1_DONOR_PROFILE, Q2_DONOR_PROFILE, Q3_BINARY32_PROFILE]) {
        for (const target of [{ kind: "world" }, { kind: "model", model: 0, origin: { x: 10, y: 20, z: 0 }, angles: { x: 0, y: 45, z: 0 } }] satisfies readonly TraceQuery["target"][]) {
          const request = { ...query({ x: 30, y: 20, z: 0 }, zero), target, policy, numeric };
          expect(scene.trace({ ...request, shape: { kind: "box", bounds: { min: zero, max: zero } } })).toEqual(scene.trace(request));
        }
      }
    }
    const scene = createSceneQueries(solid), request = query({ x: 5, y: 0, z: 0 }, zero);
    const shifted = { x: 2, y: 0, z: 0 };
    expect(scene.trace({ ...request, shape: { kind: "box", bounds: { min: shifted, max: shifted } } }).fraction).not.toBe(scene.trace(request).fraction);
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

const pakPath = resolve(import.meta.dir, "../../../../../qfiles/q1/id1/PAK0.PAK");
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

test.skipIf(!existsSync(pakPath))("real e1m1 point contacts retain sky and ordinary faces through inline transforms", async () => {
  const archive = await openArchive(pakPath);
  try {
    const entry = archive.findEntries("maps/e1m1.bsp")[0];
    if (entry === undefined) throw new Error("Missing retail e1m1");
    const map = readQ1Bsp(await archive.readEntry(entry)), collision = createQ1Collision(map);
    expect(map.leaves.filter(leaf => leaf.contents === -6)).toHaveLength(0);
    let sky = false, ordinary = false, inline = false;
    for (const [modelIndex, model] of map.models.entries()) {
      for (let i = model.faces.first; i < model.faces.first + model.faces.count; i++) {
        const face = map.faces[i], plane = face === undefined ? undefined : map.planes[face.plane];
        if (face === undefined || plane === undefined) throw new Error("Missing retail face");
        const info = map.textureInfo[face.textureInfo], texture = info === undefined ? undefined : map.textures[info.texture];
        if (texture === undefined || texture === null) continue;
        const isSky = texture.name.startsWith("sky");
        if (modelIndex === 0 && (isSky ? sky : ordinary) || modelIndex > 0 && inline) continue;
        const vertices = q1FaceVertices(map, i), center = { x: 0, y: 0, z: 0 };
        for (const vertex of vertices) { center.x += vertex.x / vertices.length; center.y += vertex.y / vertices.length; center.z += vertex.z / vertices.length; }
        const side = face.back ? -1 : 1;
        const start = { x: center.x + plane.normal.x * side * 8, y: center.y + plane.normal.y * side * 8, z: center.z + plane.normal.z * side * 8 };
        const end = { x: center.x - plane.normal.x * side * 8, y: center.y - plane.normal.y * side * 8, z: center.z - plane.normal.z * side * 8 };
        const base = collision.trace({ ...query(start, end), target: { kind: "model", model: modelIndex, origin: zero, angles: zero } });
        if (base.startSolid || base.fraction >= 1 || base.surfaceFlags === undefined) continue;
        expect(base.surfaceFlags).toBe(isSky ? 4 : 0);
        const q2 = adaptTraceResult(base, { kind: "q2", contentsMask: 3, leafContents: "merged" });
        const q3 = adaptTraceResult(base, { kind: "q3", contentsMask: 1, curves: true, playerCurveClip: true });
        if (q2.kind !== "q2" || q3.kind !== "q3") throw new Error("Unexpected collision dialect");
        expect(q2.surface?.flags ?? 0).toBe(isSky ? 4 : 0);
        expect(q3.surfaceFlags).toBe(isSky ? 20 : 0);
        if (modelIndex === 0) {
          if (isSky) {
            const footprint = collision.trace({ ...query(start, end, { kind: "box", bounds: { min: { x: -16, y: -16, z: 0 }, max: { x: 16, y: 16, z: 0 } } }), policy: { kind: "q2", contentsMask: 3, leafContents: "merged" } });
            expect(footprint.surfaceFlags).toBeUndefined();
            sky = true;
          } else ordinary = true;
        }
        else {
          const origin = { x: 103, y: -71, z: 29 }, transform = (p: Vec3): Vec3 => ({ x: origin.x - p.y, y: origin.y + p.x, z: origin.z + p.z });
          const moved = collision.trace({ ...query(transform(start), transform(end)), target: { kind: "model", model: modelIndex, origin, angles: { x: 0, y: 90, z: 0 } } });
          expect(moved.startSolid).toBe(false);
          expect(moved.fraction).toBeCloseTo(base.fraction, 5);
          expect(moved.surfaceFlags).toBe(base.surfaceFlags);
          inline = true;
        }
      }
      if (sky && ordinary && inline) break;
    }
    expect({ sky, ordinary, inline }).toEqual({ sky: true, ordinary: true, inline: true });
  } finally { archive.close(); }
});
