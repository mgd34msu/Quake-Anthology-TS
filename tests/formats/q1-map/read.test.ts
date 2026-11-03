import { expect, test } from "bun:test";
import { testCorpusRoot } from "../../support/corpus.ts";

import { existsSync } from "node:fs";
import { openArchive } from "../../../src/content/archive/index.ts";
import { decompressQ1Pvs, findQ1Leaf, parseQ1Entities, q1EntityValue, q1FaceVertices, q1LeafPvs, q1TextureRgba, readQ1Bsp } from "../../../src/formats/q1-map/index.ts";
import type { Q1WorldGeometry } from "../../../src/contracts/scene.ts";
import type { Q1BspFormat } from "../../../src/formats/q1-map/index.ts";

test("rejects truncated headers, invalid lump bounds and partial records", () => {
  expect(() => readQ1Bsp(new Uint8Array(4))).toThrow();
  const bytes = new Uint8Array(124);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, 29, true);
  view.setInt32(4, 125, true);
  view.setInt32(8, 1, true);
  expect(() => readQ1Bsp(bytes)).toThrow();
  view.setInt32(4, 0, true);
  view.setInt32(8, 0, true);
  const partial = new Uint8Array(125);
  partial.set(bytes);
  const malformed = new DataView(partial.buffer);
  malformed.setInt32(12, 124, true);
  malformed.setInt32(16, 1, true);
  expect(() => readQ1Bsp(partial)).toThrow("multiple of 20");
});

test("preserves entity pairs and validates visibility runs", () => {
  const entities = parseQ1Entities('// comment\n{ "classname" "worldspawn" "message" "one\\ntwo" "message" "last" }');
  const entity = entities[0];
  if (entity === undefined) throw new Error("Missing parsed entity");
  expect(entity.properties).toHaveLength(3);
  expect(q1EntityValue(entity, "message")).toBe("last");
  expect(parseQ1Entities('{"key" "}"}')[0]?.properties[0]?.value).toBe("}");
  expect(decompressQ1Pvs(new Uint8Array([255, 0, 2, 1]), 0, 32)).toEqual(new Uint8Array([255, 0, 0, 1]));
  expect(() => decompressQ1Pvs(new Uint8Array([0, 0]), 0, 8)).toThrow();
  expect(() => decompressQ1Pvs(new Uint8Array([0, 2]), 0, 8)).toThrow();
});

const qfiles = testCorpusRoot();
const cases: readonly { readonly pak: string; readonly map: string; readonly format: Q1BspFormat }[] = [
  { pak: "q1/id1/PAK0.PAK", map: "maps/start.bsp", format: "bsp29" },
  { pak: "q1/id1/PAK0.PAK", map: "maps/e1m1.bsp", format: "bsp29" },
  { pak: "q1/rerelease/dopa/pak0.pak", map: "maps/e5dm.bsp", format: "bsp2" },
  { pak: "q1/rerelease/dopa/pak0.pak", map: "maps/e5m1.bsp", format: "bsp2" },
  { pak: "q1/rerelease/mg3/pak0.pak", map: "maps/boss2.bsp", format: "bsp2" },
];

for (const fixture of cases) {
  const path = `${qfiles}/${fixture.pak}`;
  test.skipIf(!existsSync(path))(`reads real ${fixture.map} from ${fixture.pak}`, async () => {
    const archive = await openArchive(path);
    try {
      const entry = archive.findEntries(fixture.map)[0];
      if (entry === undefined) throw new Error(`Missing ${fixture.map}`);
      const bytes = await archive.readEntry(entry);
      const map = readQ1Bsp(bytes, { source: `${fixture.pak}:${fixture.map}` });
      expect(map.format).toBe(fixture.format);
      expect(map.lumps).toHaveLength(15);
      expect(map.faces.length).toBeGreaterThan(100);
      expect(map.nodes.length).toBeGreaterThan(100);
      expect(map.clipnodes.length).toBeGreaterThan(100);
      const world = map.entityList[0];
      if (world === undefined) throw new Error("Missing worldspawn");
      expect(q1EntityValue(world, "classname")).toBe("worldspawn");
      expect(q1FaceVertices(map, 0).length).toBeGreaterThanOrEqual(3);
      const leaf = findQ1Leaf(map, { x: 0, y: 0, z: 0 });
      expect(leaf).toBeLessThan(map.leaves.length);
      expect(q1LeafPvs(map, leaf).length).toBe(Math.ceil((map.models[0]?.visibleLeaves ?? 0) / 8));
      const visibleLeaf = map.leaves.findIndex((item, i) => i > 0 && item.visibilityOffset !== null);
      if (visibleLeaf > 0) expect(q1LeafPvs(map, visibleLeaf).length).toBe(Math.ceil((map.models[0]?.visibleLeaves ?? 0) / 8));
      if (fixture.map === "maps/boss2.bsp") expect(map.bspxMetadata.faceNormals?.indices.length).toBe(map.faces.reduce((sum, face) => sum + face.edges.count, 0));
      const paletteEntry = archive.findEntries("gfx/palette.lmp")[0];
      const texture = map.textures.find((item) => item?.kind === "embedded");
      if (paletteEntry !== undefined && texture?.kind === "embedded") {
        const palette = await archive.readEntry(paletteEntry);
        expect(q1TextureRgba(texture.levels[0], palette).length).toBe(texture.width * texture.height * 4);
      }
    } finally {
      archive.close();
    }
  });
}

test.skipIf(!existsSync(`${qfiles}/q1/id1/PAK0.PAK`))("rejects a drawing node whose child points back at itself", async () => {
  const archive = await openArchive(`${qfiles}/q1/id1/PAK0.PAK`);
  try {
    const entry = archive.findEntries("maps/start.bsp")[0];
    if (entry === undefined) throw new Error("Missing maps/start.bsp");
    const bytes = (await archive.readEntry(entry)).slice();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const nodes = view.getInt32(4 + 5 * 8, true);
    view.setInt16(nodes + 4, 0, true);
    expect(() => readQ1Bsp(bytes, { source: "cycle" })).toThrow("cycle in BSP nodes");
  } finally { archive.close(); }
});

const startPak = `${qfiles}/q1/id1/PAK0.PAK`;
test.skipIf(!existsSync(startPak))("rejects a clipnode tree that cycles back to its own root at load", async () => {
  const archive = await openArchive(startPak);
  try {
    const entry = archive.findEntries("maps/start.bsp")[0];
    if (entry === undefined) throw new Error("Missing start.bsp");
    const bytes = new Uint8Array(await archive.readEntry(entry));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const lump = (number: number): number => view.getInt32(4 + number * 8, true);
    const headnode = view.getInt32(lump(14) + 36 + 4, true);
    expect(headnode).toBeGreaterThanOrEqual(0);
    expect(() => readQ1Bsp(bytes)).not.toThrow();
    view.setInt16(lump(9) + headnode * 8 + 4, headnode, true);
    expect(() => readQ1Bsp(bytes)).toThrow("cycle");
  } finally { archive.close(); }
});

test("a corrupt PVS row degrades to all-visible instead of throwing", () => {
  const zero = { x: 0, y: 0, z: 0 }, bounds = { min: zero, max: zero };
  const leaf: Q1WorldGeometry["leaves"][number] = { contents: -1, bounds, faces: { first: 0, count: 0 }, visibilityOffset: 0, ambientSound: [0, 0, 0, 0] };
  const map: Q1WorldGeometry = { kind: "q1-bsp", format: "bsp29", entities: "", planes: [], vertices: [], edges: [], surfaceEdges: [], nodes: [], leaves: [leaf, leaf],
    leafFaces: [], textures: [], textureInfo: [], faces: [], models: [{ bounds, origin: zero, headnodes: [0, 0, 0, 0], visibleLeaves: 16, faces: { first: 0, count: 0 } }],
    clipnodes: [], visibility: new Uint8Array([0, 0]), lighting: { kind: "luminance8", samples: new Uint8Array() }, decoupledLightmaps: null, brushList: null, extensions: [] };
  expect(q1LeafPvs(map, 1)).toEqual(new Uint8Array([255, 255]));
});
