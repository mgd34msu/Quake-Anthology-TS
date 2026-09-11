import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openArchive } from "../../../src/content/archive/index.ts";
import { decodeQ2Map, decompressQ2Visibility, lookupQ2Lightgrid, readQ2Bsp } from "../../../src/formats/q2-map/index.ts";

const root = process.env["Q2_DATA_PATH"] ?? resolve(import.meta.dir, "../../../../qfiles/q2");
const fixtures = [
  { archive: "baseq2/pak0.pak", member: "maps/base1.bsp", format: "ibsp38", faces: 7905, leaves: 5238, extendedLighting: false },
  { archive: "rerelease/baseq2/pak0.pak", member: "maps/base1.bsp", format: "ibsp38", faces: 16787, leaves: 10336, extendedLighting: true },
  { archive: "rerelease/baseq2/pak0.pak", member: "maps/mgu1m1.bsp", format: "qbsp", faces: 48898, leaves: 28622, extendedLighting: true },
] satisfies readonly { archive: string; member: string; format: "ibsp38" | "qbsp";
  faces: number; leaves: number; extendedLighting: boolean }[];

for (const fixture of fixtures) {
  const path = resolve(root, fixture.archive);
  test.skipIf(!existsSync(path))(`${fixture.archive}:${fixture.member} preserves Q2 geometry and lighting`, async () => {
    const archive = await openArchive(path);
    try {
      const entry = archive.findEntries(fixture.member)[0];
      if (entry === undefined) throw new Error(`Missing ${fixture.member}`);
      const bytes = await archive.readEntry(entry);
      const map = decodeQ2Map(bytes, `${fixture.archive}:${fixture.member}`);
      expect(map.format).toBe(fixture.format);
      expect(map.faces).toHaveLength(fixture.faces);
      expect(map.leaves).toHaveLength(fixture.leaves);
      expect(map.entities).toContain('"classname" "worldspawn"');
      expect(map.brushes.length).toBeGreaterThan(0);
      expect(map.models.length).toBeGreaterThan(1);
      expect(map.areaPortals.length).toBeGreaterThan(0);
      expect(map.lighting.kind).toBe("rgb8");
      expect(map.lighting.samples.length).toBeGreaterThan(0);
      expect(map.diagnostics).toEqual([]);
      const visible = map.visibility;
      if (visible === null) throw new Error("Retail fixture is missing visibility");
      for (const kind of ["pvs", "phs"] satisfies readonly ("pvs" | "phs")[]) {
        const row = decompressQ2Visibility(visible, 0, kind);
        expect(row).toHaveLength(Math.ceil(visible.clusters.length / 8));
        expect((row[0] ?? 0) & 1).toBe(1);
      }
      const rawModel = map.source.models[0];
      const worldModel = map.models[0];
      if (rawModel === undefined || worldModel === undefined) throw new Error("Missing world model");
      expect(worldModel.bounds.min.x).toBe(rawModel.bounds.min.x - 1);
      expect(worldModel.bounds.max.z).toBe(rawModel.bounds.max.z + 1);
      expect(map.leaves[0]?.mergedContents).toBe(map.leaves[0]?.contents);
      expect(() => readQ2Bsp(bytes.subarray(0, 160), "truncated fixture")).toThrow();
      if (fixture.extendedLighting) {
        expect(map.leaves.some(leaf => leaf.contents !== leaf.mergedContents)).toBe(true);
        expect(map.decoupledLightmaps).toHaveLength(fixture.faces);
        expect(map.faces.some((face, index) => face.lightingOffset !== null && map.source.faces[index]?.lightingOffset === -1)).toBe(true);
        expect(map.extensions.map(lump => lump.name)).toContain("FACENORMALS");
        expect(map.faceNormals?.normals.length).toBeGreaterThan(0);
        expect(map.faceNormals?.cornerIndices).toHaveLength(map.faces.reduce((total, face) => total + face.edges.count, 0));
        const grid = map.lightgrid;
        if (grid === null) throw new Error("Missing retail lightgrid");
        expect(grid.samples.length).toBeGreaterThan(0);
        expect(grid.leaves.some(leaf => lookupQ2Lightgrid(grid, leaf.min)?.some(sample => sample.style !== 255))).toBe(true);
      } else {
        expect(map.decoupledLightmaps).toBeNull();
        expect(map.lightgrid).toBeNull();
      }
    } finally {
      archive.close();
    }
  });
}

test("visibility keeps all-visible missing rows and rejects invalid zero runs", () => {
  const visibility = { clusters: [{ pvsOffset: 0, phsOffset: -1 }], compressed: new Uint8Array([0, 0]) };
  expect(() => decompressQ2Visibility(visibility, 0, "pvs")).toThrow("invalid visibility zero run");
  expect(decompressQ2Visibility(visibility, 0, "phs")).toEqual(new Uint8Array([255]));
  expect(decompressQ2Visibility(visibility, -1, "pvs")).toEqual(new Uint8Array([0]));
  expect(decompressQ2Visibility(null, 0, "pvs", 9)).toEqual(new Uint8Array([255, 255]));
});
