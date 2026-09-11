import { expect, test } from "bun:test";
import { BinaryReader, BinaryWriter } from "../../../src/core/binary/index.ts";
import { readQ1Bsp } from "../../../src/formats/q1-map/index.ts";
import { readBrushList, readDecoupledLightmaps } from "../../../src/formats/q1-map/extensions.ts";
import { readEdges, readNodes } from "../../../src/formats/q1-map/records.ts";

test("BSP2 keeps float bounds and 2PSB keeps short bounds with wide indices", () => {
  const formats: readonly ("bsp2" | "2psb")[] = ["bsp2", "2psb"];
  for (const format of formats) {
    const writer = new BinaryWriter(format === "bsp2" ? 44 : 32);
    writer.i32(70000);
    writer.i32(-1);
    writer.i32(-70001);
    for (const bound of [-100, -200, -300, 100, 200, 300]) {
      if (format === "bsp2") writer.f32(bound + 0.5);
      else writer.i16(bound);
    }
    writer.u32(80000);
    writer.u32(90000);
    const node = readNodes(new BinaryReader(writer.finish()), format)[0];
    expect(node?.plane).toBe(70000);
    expect(node?.children[1]).toEqual({ kind: "leaf", index: 70000 });
    expect(node?.bounds.min.x).toBe(format === "bsp2" ? -99.5 : -100);
    expect(node?.faces).toEqual({ first: 80000, count: 90000 });
    const edge = new BinaryWriter(8);
    edge.u32(80000);
    edge.u32(90000);
    expect(readEdges(new BinaryReader(edge.finish()), format)[0]?.vertices).toEqual([80000, 90000]);
  }
});

test("retains unknown and empty BSPX entries", () => {
  const writer = new BinaryWriter(199);
  writer.u32(29);
  for (let i = 0; i < 30; i++) writer.u32(0);
  writer.bytes(new TextEncoder().encode("BSPX"));
  writer.u32(2);
  for (const entry of [{ name: "FUTURE_LUMP", offset: 196, length: 3 }, { name: "EMPTY_LUMP", offset: 199, length: 0 }]) {
    const name = new Uint8Array(24);
    name.set(new TextEncoder().encode(entry.name));
    writer.bytes(name);
    writer.u32(entry.offset);
    writer.u32(entry.length);
  }
  writer.bytes(new Uint8Array([1, 2, 3]));
  const map = readQ1Bsp(writer.finish());
  expect(map.bspx.map((entry) => entry.name)).toEqual(["FUTURE_LUMP", "EMPTY_LUMP"]);
  expect(map.extensions[0]?.bytes).toEqual(new Uint8Array([1, 2, 3]));
  expect(map.extensions[1]?.bytes.length).toBe(0);
});

test("reads authored brush planes and decoupled lightmap projection", () => {
  const brush = new BinaryWriter(60);
  brush.u32(1);
  brush.u32(0);
  brush.u32(1);
  brush.u32(1);
  for (const bound of [-1, -2, -3, 1, 2, 3]) brush.f32(bound);
  brush.i16(-2);
  brush.u16(1);
  for (const plane of [0.5, 0.5, 0, 0.25]) brush.f32(plane);
  const decoded = readBrushList(brush.finish(), 1);
  expect(decoded?.[0]?.brushes[0]?.planes).toEqual([{ normal: { x: 0.5, y: 0.5, z: 0 }, distance: 0.25 }]);
  const light = new BinaryWriter(40);
  light.u16(8);
  light.u16(16);
  light.u32(24);
  for (const axis of [0.25, 0, 0, 4, 0, -0.125, 0, 8]) light.f32(axis);
  expect(readDecoupledLightmaps(light.finish(), 1)?.[0]).toEqual({
    width: 8, height: 16, lightingOffset: 24,
    axes: [{ x: 0.25, y: 0, z: 0 }, { x: 0, y: -0.125, z: 0 }], offset: { x: 4, y: 8 },
  });
});
