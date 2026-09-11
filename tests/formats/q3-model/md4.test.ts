/* Synthetic fixture adapted from quake-3-ts MD4 model tests. GPL-2.0-or-later. */
import { test, expect } from "bun:test";
import { BinaryWriter } from "../../../src/core/binary/index.ts";
import { parseMd4, skinMd4Surface } from "../../../src/formats/q3-model/index.ts";

// 100-byte header; two 40+2*48-byte frames; LODs with two/one surfaces.
// Each surface: 168-byte header, triangle, one bone reference, then vertices
// with two, zero, and one 20-byte weights. Vertex records have no extra padding.
const FRAME_START = 100;
const LOD_START = 372;
const SURFACE_LENGTH = 316;
const MODEL_END = 1344;

function string(writer: BinaryWriter, value: string): void {
  const bytes = new Uint8Array(64);
  for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i);
  writer.bytes(bytes);
}

function surface(writer: BinaryWriter, name: string): void {
  const start = writer.offset;
  writer.i32(123); // Source replaces the surface ident without a magic check.
  string(writer, name);
  string(writer, "Textures/Armor");
  writer.i32(-33); // Replaced by R_FindShader, not a retained runtime handle.
  writer.i32(-start);
  writer.i32(3);
  writer.i32(184);
  writer.i32(1);
  writer.i32(168);
  writer.i32(1);
  writer.i32(180);
  writer.i32(SURFACE_LENGTH);
  for (const value of [2, 0, 1, 0]) writer.i32(value);
  for (const count of [2, 0, 1]) {
    for (const value of [0, -0, 2, -0.25, 1.5]) writer.f32(value);
    writer.i32(count);
    for (let weight = 0; weight < count; weight++) {
      writer.i32(weight === 0 ? 1 : 0);
      writer.f32(weight === 0 ? 0.25 : 1.25);
      for (const value of [0.1, 2, -3]) writer.f32(value);
    }
  }
}

function fixture(): Uint8Array {
  const writer = new BinaryWriter(MODEL_END + 7);
  writer.u32(0x34504449);
  writer.i32(1);
  string(writer, "Models/Test.MD4");
  writer.i32(2);
  writer.i32(2);
  writer.i32(-0x80000000); // ofsBoneNames has no selected source reader.
  writer.i32(FRAME_START);
  writer.i32(2);
  writer.i32(LOD_START);
  writer.i32(MODEL_END);
  for (let frame = 0; frame < 2; frame++) {
    for (const value of [-1, -2, -3, 4, 5, 6, 0.5, 1.5, 2.5, 7]) writer.f32(value + frame);
    for (let bone = 0; bone < 2; bone++) {
      for (let entry = 1; entry <= 12; entry++) writer.f32(frame * 100 + bone * 20 + entry);
    }
  }
  writer.i32(2);
  writer.i32(12);
  writer.i32(644);
  surface(writer, "BODY_1");
  surface(writer, "HEAD");
  writer.i32(1);
  writer.i32(12);
  writer.i32(328);
  surface(writer, "LOD_1");
  writer.bytes(new Uint8Array([255, 254, 253, 252, 251, 250, 249]));
  return writer.finish();
}

test("MD4 reads independent LODs, variable weights, and global bone indices", () => {
  const bytes = fixture();
  const model = parseMd4(bytes);
  expect(model.byteLength).toBe(1344);
  expect(model.lods.map(lod => lod.surfaces.length)).toEqual([2, 1]);
  const surface = model.lods[0]?.surfaces[0];
  if (surface === undefined) throw new Error("Fixture surface missing");
  expect(surface.boneReferences).toEqual([0]);
  expect(surface.vertices[0]?.weights[0]?.boneIndex).toBe(1);
  expect(surface.vertices.map(vertex => vertex.weights.length)).toEqual([2, 0, 1]);
  const vertices = skinMd4Surface(model, surface, 1, 0, 0.5);
  expect(vertices[0]?.position.x).toBeCloseTo(0.25 * 6.1 + 1.25 * 4.1, 4);
  expect(vertices[0]?.normal).toEqual({ x: 169, y: 181, z: 193 });
  expect(vertices[1]?.position).toEqual({ x: 0, y: 0, z: 0 });
  bytes.fill(0);
  expect(model.bytes[0]).toBe(73);
});

test("MD4 rejects a truncated declared allocation", () => {
  expect(() => parseMd4(fixture().slice(0, 1300))).toThrow();
});
