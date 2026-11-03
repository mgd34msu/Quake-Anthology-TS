import { expect, test } from "bun:test";
import { SkyBuilder, cloudTexCoord } from "../../src/materials/sky.ts";
import type { Vec3 } from "../../src/core/math.ts";

// Independent restatement of tr_sky.c R_InitSkyTexCoords: the ray from the viewer along a cube-face direction meets the
// cloud sphere of radius R + h centred R below the viewer, and the texture coordinates are the arccosines of the x and y
// components of the unit vector from the sphere centre to that point.
const RADIUS = 4096, BOX = 1024 / 1.75;
// st_to_vec from tr_sky.c, with b = (s * box, t * box, box); positive k picks b[k - 1], negative k its negation.
const ST_TO_VEC: readonly (readonly [number, number, number])[] = [[3, -1, 2], [-3, 1, 2], [1, 3, 2], [-1, -3, 2], [-2, -1, 3], [2, -1, -3]];
function faceVector(face: number, s: number, t: number): Vec3 {
  const b = [s * BOX, t * BOX, BOX], row = ST_TO_VEC[face];
  if (row === undefined) throw new Error("bad face");
  const pick = (k: number): number => (k < 0 ? -(b[-k - 1] ?? NaN) : (b[k - 1] ?? NaN));
  return { x: pick(row[0]), y: pick(row[1]), z: pick(row[2]) };
}
function expectedCloud(face: number, s: number, t: number, height: number): { x: number; y: number } {
  const d = faceVector(face, s, t), length2 = d.x * d.x + d.y * d.y + d.z * d.z;
  const p = (-RADIUS * d.z + Math.sqrt(RADIUS * RADIUS * d.z * d.z + length2 * (2 * RADIUS * height + height * height))) / length2;
  const v = { x: d.x * p, y: d.y * p, z: d.z * p + RADIUS };
  const norm = Math.hypot(v.x, v.y, v.z);
  expect(norm).toBeCloseTo(RADIUS + height, 2);
  return { x: Math.acos(v.x / norm), y: Math.acos(v.y / norm) };
}

test("cloud coordinates for the zenith are a quarter turn on both axes", () => {
  // Looking straight up the ray is (0, 0, B); it meets the layer at (0, 0, R + h), whose unit vector is (0, 0, 1).
  const zenith = cloudTexCoord(4, 0, 0, 512);
  expect(zenith.x).toBeCloseTo(Math.PI / 2, 6);
  expect(zenith.y).toBeCloseTo(Math.PI / 2, 6);
});

test("cloud coordinates match the sphere intersection on all 81 points of the five cloud faces", () => {
  for (const height of [128, 512]) for (let face = 0; face < 5; face++) for (let ti = 0; ti <= 8; ti++) for (let si = 0; si <= 8; si++) {
    const s = (si - 4) / 4, t = (ti - 4) / 4, actual = cloudTexCoord(face, s, t, height), expected = expectedCloud(face, s, t, height);
    expect(actual.x).toBeCloseTo(expected.x, 4);
    expect(actual.y).toBeCloseTo(expected.y, 4);
  }
});

test("cloud coordinates are mirrored across the sky axes the faces share", () => {
  // Opposite horizontal offsets on the up face swap the sign of the y component's cosine about the quarter turn.
  const left = cloudTexCoord(4, -0.5, 0, 512), right = cloudTexCoord(4, 0.5, 0, 512);
  expect(left.x).toBeCloseTo(right.x, 6);
  expect(left.y + right.y).toBeCloseTo(Math.PI, 5);
  // The rim of the horizon sees the layer at a grazing angle, so it is much further from the zenith than the centre.
  expect(Math.abs(cloudTexCoord(0, 0, 0, 512).x - Math.PI / 2)).toBeGreaterThan(Math.abs(cloudTexCoord(4, 0.25, 0.25, 512).x - Math.PI / 2));
});

test("the sky builder stores the source table and attaches it to the cloud vertices of each face", () => {
  const builder = new SkyBuilder(), height = 512;
  builder.initializeCloudCoordinates(height);
  const corner = (x: number, y: number, z: number) => ({ position: { x, y, z }, normal: { x: 0, y: 0, z: 1 }, texCoord: { x: 0, y: 0 },
    lightmapCoord: { x: 0, y: 0 }, color: { x: 255, y: 255, z: 255, w: 255 } });
  const half = 64, points: readonly (readonly [number, number, number])[] = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  const vertices = points.map(([x, y, z]) => corner(x * half, y * half, z * half));
  const quads: readonly (readonly [number, number, number, number])[] = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 3, 7, 4]];
  const indices = quads.flatMap(([a, b, c, d]) => [a, b, c, a, c, d]);
  const origin = { x: 0, y: 0, z: 0 };
  builder.clip([{ vertices, indices }], origin);
  const sky = builder.build(origin, 1024);
  let checked = 0;
  for (const [index, face] of sky.box.entries()) {
    if (face.face === 5) continue;
    // Cloud vertices are emitted in box order for every face but the last; find this face's run by its starting offset.
    const start = sky.box.slice(0, index).filter(other => other.face !== 5).reduce((sum, other) => sum + other.geometry.vertices.length, 0);
    for (const [offset, vertex] of face.geometry.vertices.entries()) {
      const d = { x: vertex.position.x / (1024 / 1.75) * BOX, y: vertex.position.y / (1024 / 1.75) * BOX, z: vertex.position.z / (1024 / 1.75) * BOX };
      const s = [-d.y, d.y, d.x, -d.x, -d.y][face.face], t = [d.z, d.z, d.z, d.z, -d.x][face.face];
      if (s === undefined || t === undefined) throw new Error("bad face");
      const expected = expectedCloud(face.face, Math.round(s / BOX * 4) / 4, Math.round(t / BOX * 4) / 4, height);
      const actual = sky.clouds.vertices[start + offset]?.texCoord;
      expect(actual?.x).toBeCloseTo(expected.x, 4);
      expect(actual?.y).toBeCloseTo(expected.y, 4);
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(20);
});
