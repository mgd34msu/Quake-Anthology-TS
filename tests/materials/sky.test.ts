import { expect, test } from "bun:test";
import { SkyBuilder } from "../../src/materials/sky.ts";

const vertex = (x: number, y: number, z: number) => ({ position: { x, y, z }, normal: { x: 0, y: 0, z: 1 }, texCoord: { x: 0, y: 0 }, lightmapCoord: { x: 0, y: 0 }, color: { x: 255, y: 255, z: 255, w: 255 } });

test("negative cloud heights keep every cloud texture coordinate finite", () => {
  for (const height of [64, -64, -512, -4096]) {
    const builder = new SkyBuilder();
    builder.initializeCloudCoordinates(height);
    const hull = [vertex(-1000, -1000, 100), vertex(1000, -1000, 100), vertex(1000, 1000, 100), vertex(-1000, 1000, 100), vertex(0, 0, 1000), vertex(0, 0, -1000)];
    builder.clip([{ vertices: hull, indices: [0, 1, 2, 0, 2, 3, 0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4] }], { x: 0, y: 0, z: 0 });
    const clouds = builder.build({ x: 0, y: 0, z: 0 }, 4096).clouds;
    expect(clouds.vertices.length).toBeGreaterThan(0);
    for (const entry of clouds.vertices) expect(Number.isFinite(entry.texCoord.x) && Number.isFinite(entry.texCoord.y)).toBe(true);
  }
});
