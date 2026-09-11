import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openArchive } from "../../../src/content/archive/index.ts";
import { adaptQ3Bsp, parseQ3Bsp } from "../../../src/formats/q3-map/index.ts";

const root = process.env["Q3_DATA_PATH"] ?? resolve(import.meta.dir, "../../../../qfiles/q3a");
const fixtures = [
  { archive: "baseq3/pak0.pk3", member: "maps/q3dm1.bsp", vertices: 13978, surfaces: 2097, lightmaps: 9 },
  { archive: "missionpack/pak0.pk3", member: "maps/mpteam1.bsp", vertices: 69060, surfaces: 13455, lightmaps: 30 },
  { archive: "missionpack/pak0.pk3", member: "maps/mpterra3.bsp", vertices: null, surfaces: null, lightmaps: null },
];

for (const fixture of fixtures) {
  const archivePath = resolve(root, fixture.archive);
  test.skipIf(!existsSync(archivePath))(`retail ${fixture.member} decodes through the shared world contract`, async () => {
    const archive = await openArchive(archivePath, "pk3");
    try {
      const entry = archive.findEntries(fixture.member)[0];
      if (entry === undefined) throw new Error(`Missing ${fixture.member} in ${archivePath}`);
      const bytes = await archive.readEntry(entry);
      const map = parseQ3Bsp(bytes, `${fixture.archive}:${fixture.member}`);
      const world = adaptQ3Bsp(map);
      expect(map.entityRecords[0]?.get("classname")).toBe("worldspawn");
      expect(world.models.length).toBeGreaterThan(0);
      expect(world.nodes.length).toBeGreaterThan(0);
      expect(world.brushes.length).toBeGreaterThan(0);
      expect(world.lightGrid.length).toBeGreaterThan(0);
      expect(world.visibility?.clusterCount).toBeGreaterThan(0);
      const patch = world.surfaces.find(surface => surface.kind === "patch");
      if (patch === undefined || patch.kind !== "patch") throw new Error("Retail map has no patch surface");
      expect(patch.width * patch.height).toBe(patch.vertices.count);
      if (fixture.vertices !== null) expect(world.vertices).toHaveLength(fixture.vertices);
      if (fixture.surfaces !== null) expect(world.surfaces).toHaveLength(fixture.surfaces);
      if (fixture.lightmaps !== null) expect(world.lightmaps).toHaveLength(fixture.lightmaps);
      if (fixture.member === "maps/mpteam1.bsp") {
        expect(world.fogs).toHaveLength(0);
        expect(world.surfaces.some(surface => surface.kind === "flare" && surface.fog === 0)).toBe(true);
      }
      if (fixture.member === "maps/mpterra3.bsp") {
        expect(world.vertices.some(vertex => Number.isNaN(vertex.lightmapCoord.x) || Number.isNaN(vertex.lightmapCoord.y))).toBe(true);
      }
    } finally {
      archive.close();
    }
  });
}
