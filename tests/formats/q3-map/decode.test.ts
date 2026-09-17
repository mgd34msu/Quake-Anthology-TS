import { expect, test } from "bun:test";
import { BinaryError } from "../../../src/core/binary/index.ts";
import { adaptQ3Bsp, decodeQ3World, parseEntities, parseQ3Bsp } from "../../../src/formats/q3-map/index.ts";
import { q3Fixture, q3TestFixture } from "./fixture.ts";
import { classifyBsp } from "../../../src/formats/bsp-kind.ts";

test("IBSP44 preserves surface and collision flags and derives model ownership from leaves", () => {
  expect(classifyBsp(q3TestFixture())).toBe("q3");
  expect(classifyBsp(q3Fixture())).toBe("q3");
  const map = parseQ3Bsp(q3TestFixture());
  expect(map.surfaces.map(surface => surface.type)).toEqual(["planar", "patch", "triangles"]);
  expect(map.models[0]).toMatchObject({ firstSurface: 0, surfaceCount: 3, firstBrush: 0, brushCount: 1 });
  expect(map.indices).toEqual([0, 1, 2, 0, 1, 2]);
  expect(map.shaders[map.brushes[0]?.shader ?? -1]?.contentFlags).toBe(1);
  expect(map.shaders[map.brushSides[0]?.shader ?? -1]?.surfaceFlags).toBe(128);
  expect(map.fogs[0]?.visibleSide).toBe(-1);
  expect(adaptQ3Bsp(map).surfaces).toHaveLength(3);
  const malformed = q3TestFixture();
  new DataView(malformed.buffer).setInt32(12 + 12 * 8, 1, true);
  expect(() => parseQ3Bsp(malformed)).toThrow("invalid IBSP44 record size");
});

test("IBSP46 decodes stored values across all 17 lumps", () => {
  const map = parseQ3Bsp(q3Fixture());
  expect(map.entityRecords[0]?.get("classname")).toBe("worldspawn");
  expect(map.entities).toContain('"message" "BSP test"');
  expect(map.shaders).toEqual([{ name: "textures/test/wall", surfaceFlags: 128, contentFlags: 1 }]);
  expect(map.planes).toEqual([{ normal: { x: 1, y: 0, z: 0 }, distance: 16 }]);
  expect(map.nodes[0]?.children).toEqual([-1, -1]);
  expect(map.leaves[0]).toEqual({ cluster: 0, area: 0,
    bounds: { min: { x: -32, y: -32, z: -32 }, max: { x: 32, y: 32, z: 32 } },
    firstSurface: 0, surfaceCount: 4, firstBrush: 0, brushCount: 1 });
  expect(map.leafSurfaces).toEqual([0, 1, 2, 3]);
  expect(map.leafBrushes).toEqual([0]);
  expect(map.models[0]?.brushCount).toBe(1);
  expect(map.brushes).toEqual([{ firstSide: 0, sideCount: 6, shader: 0 }]);
  expect(map.brushSides).toHaveLength(6);
  expect(map.vertices[1]).toEqual({ position: { x: 1, y: 1.5, z: -1 }, texCoord: { x: 0.25, y: 0.75 },
    lightmapCoord: { x: 0.125, y: 0.875 }, normal: { x: 0, y: 0, z: 1 }, color: { x: 12, y: 34, z: 56, w: 255 } });
  expect(map.indices).toEqual([0, 1, 2]);
  expect(map.fogs).toEqual([{ shader: "fog", brush: 0, visibleSide: -1 }]);
  expect(map.surfaces.map(surface => surface.type)).toEqual(["planar", "patch", "triangles", "flare"]);
  expect(map.surfaces[1]?.lightmapVectors).toEqual([
    { x: 3.5, y: 4.5, z: 5.5 }, { x: 6.5, y: 7.5, z: 8.5 }, { x: 9.5, y: 10.5, z: 11.5 },
  ]);
  expect(map.lightmaps[0]?.length).toBe(49152);
  expect(map.lightmaps[0]?.[49151]).toBe(127);
  expect(map.lightGrid).toEqual([{ ambient: { x: 1, y: 2, z: 3 }, directed: { x: 4, y: 5, z: 6 }, latLong: { x: 7, y: 8 } }]);
  expect(map.visibility).toEqual({ clusterCount: 1, bytesPerCluster: 1, bits: new Uint8Array([1]) });
});

test("world adapter retains patch inputs, source lighting and collision references", () => {
  const map = parseQ3Bsp(q3Fixture());
  const world = adaptQ3Bsp(map);
  expect(world.kind).toBe("q3-bsp");
  expect(world.planes[0]).toEqual({ normal: { x: 1, y: 0, z: 0 }, distance: 16, type: 0, signbits: 0 });
  expect(world.nodes[0]?.children).toEqual([{ kind: "leaf", index: 0 }, { kind: "leaf", index: 0 }]);
  expect(world.models[0]?.surfaces).toEqual({ first: 0, count: 4 });
  expect(world.models[0]?.brushes).toEqual({ first: 0, count: 1 });
  expect(world.brushes[0]?.sides).toEqual({ first: 0, count: 6 });
  expect(world.surfaces[1]).toEqual({ kind: "patch", width: 3, height: 3, shader: 0, fog: 0,
    vertices: { first: 3, count: 9 }, indices: { first: 0, count: 0 },
    lightmap: { image: 0, x: 8, y: 16, width: 32, height: 64, origin: { x: 0.5, y: 1.5, z: 2.5 },
      vectors: [{ x: 3.5, y: 4.5, z: 5.5 }, { x: 6.5, y: 7.5, z: 8.5 }, { x: 9.5, y: 10.5, z: 11.5 }] } });
  expect(world.vertices).toBe(map.vertices);
  expect(world.lightGrid).toBe(map.lightGrid);
  expect(world.visibility).toBe(map.visibility);
  expect(decodeQ3World(q3Fixture())).toEqual(world);
});

test("byte-offset inputs and empty PVS retain owned payloads", () => {
  const data = q3Fixture();
  new DataView(data.buffer).setInt32(12 + 16 * 8, 0, true);
  const wrapped = new Uint8Array(data.length + 10);
  wrapped.set(data, 3);
  const world = decodeQ3World(wrapped.subarray(3, 3 + data.length));
  wrapped.fill(0);
  expect(world.visibility).toBeNull();
  expect(world.lightmaps[0]?.[0]).toBe(127);
  expect(world.vertices[0]?.color.w).toBe(255);
});

test("rejects truncated payloads, unsupported versions and invalid references", () => {
  const data = q3Fixture();
  expect(() => parseQ3Bsp(data.subarray(0, 100))).toThrow(BinaryError);
  expect(() => parseQ3Bsp(data.subarray(0, data.length - 1))).toThrow(BinaryError);
  const version = data.slice();
  new DataView(version.buffer).setInt32(4, 45, true);
  expect(() => parseQ3Bsp(version)).toThrow("version 46");
  const invalidLump = data.slice();
  new DataView(invalidLump.buffer).setInt32(8, -1, true);
  expect(() => parseQ3Bsp(invalidLump)).toThrow("lump 0 range");
  const invalidIndex = data.slice();
  const view = new DataView(invalidIndex.buffer);
  view.setInt32(view.getInt32(8 + 11 * 8, true), 12, true);
  expect(() => parseQ3Bsp(invalidIndex)).toThrow("surface local vertex");
});

test("entity parsing keeps byte text, literal escapes and source duplicate precedence", () => {
  const entities = parseEntities('// header\n{ "classname" "worldspawn" /* comment */ "key" "old" "key" "new" "message" "caf\u00e9\\nnext" }');
  expect(entities[0]?.get("key")).toBe("new");
  expect(entities[0]?.get("message")).toBe("caf\u00e9\\nnext");
  expect(() => parseEntities('{ "key" }')).toThrow("missing value");
});
