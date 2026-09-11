import { expect, test } from "bun:test";
import { BinaryError, BinaryReader, BinaryWriter } from "../../src/core/binary/index.ts";

test("binary scalars preserve wire bytes and subarray bounds", () => {
  const writer = new BinaryWriter(12);
  writer.u16(0x1234);
  writer.i16(-2);
  writer.f32(-0);
  writer.u32(0x89abcdef);
  expect(Array.from(writer.finish())).toEqual([0x34, 0x12, 0xfe, 0xff, 0, 0, 0, 0x80, 0xef, 0xcd, 0xab, 0x89]);
  const container = new Uint8Array(20);
  container.set(writer.finish(), 4);
  const reader = new BinaryReader(container.subarray(4, 16), "fixture");
  expect(reader.u16()).toBe(0x1234);
  expect(reader.i16()).toBe(-2);
  expect(Object.is(reader.f32(), -0)).toBe(true);
  expect(reader.u32()).toBe(0x89abcdef);
  expect(() => reader.u8()).toThrow(BinaryError);
  expect(reader.offset).toBe(12);
  expect(() => reader.dataView(12, 1)).toThrow(BinaryError);
  expect(() => reader.section(-1, 1)).toThrow(BinaryError);
  expect(() => reader.records(0, 11, 4)).toThrow(BinaryError);
});

test("sections share checked storage while byte reads copy", () => {
  const storage = new Uint8Array([9, 65, 255, 0, 8]);
  const reader = new BinaryReader(storage.subarray(1, 4));
  const section = reader.section(0, 3);
  const copied = reader.bytes(3);
  section.dataView(0, 1).setUint8(0, 66);
  expect(copied).toEqual(new Uint8Array([65, 255, 0]));
  expect(section.fixedByteString(3)).toBe("B\xff");
  expect(reader.offset).toBe(3);
  expect(storage).toEqual(new Uint8Array([9, 66, 255, 0, 8]));
});
