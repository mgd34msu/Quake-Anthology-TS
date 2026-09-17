/* Q3 BSP fixture adapted from quake-3-ts. GPL-2.0-or-later. */
import { expect } from "bun:test";
import { BinaryWriter } from "../../../src/core/binary/index.ts";

function record(size: number, write: (writer: BinaryWriter) => void): Uint8Array {
  const writer = new BinaryWriter(size);
  write(writer);
  const result = writer.finish();
  expect(result.length).toBe(size);
  return result;
}

export function q3Fixture(): Uint8Array {
  const lumps: Uint8Array[] = Array.from({ length: 17 }, () => new Uint8Array(0));
  lumps[0] = new TextEncoder().encode('{\n"classname" "worldspawn"\n"message" "BSP test"\n}\n\0');
  lumps[1] = record(72, w => { w.bytes(new TextEncoder().encode("textures/test/wall")); w.bytes(new Uint8Array(46)); w.i32(0x80); w.i32(1); });
  lumps[2] = record(16, w => { w.f32(1); w.f32(0); w.f32(0); w.f32(16); });
  lumps[3] = record(36, w => { w.i32(0); w.i32(-1); w.i32(-1); for (const value of [-32, -32, -32, 32, 32, 32]) w.i32(value); });
  lumps[4] = record(48, w => {
    w.i32(0); w.i32(0);
    for (const value of [-32, -32, -32, 32, 32, 32]) w.i32(value);
    w.i32(0); w.i32(4); w.i32(0); w.i32(1);
  });
  lumps[5] = record(16, w => { for (let i = 0; i < 4; i++) w.i32(i); });
  lumps[6] = record(4, w => { w.i32(0); });
  lumps[7] = record(40, w => {
    for (const value of [-32, -32, -32, 32, 32, 32]) w.f32(value);
    w.i32(0); w.i32(4); w.i32(0); w.i32(1);
  });
  lumps[8] = record(12, w => { w.i32(0); w.i32(6); w.i32(0); });
  lumps[9] = record(48, w => { for (let i = 0; i < 6; i++) { w.i32(0); w.i32(0); } });
  lumps[10] = record(44 * 12, w => {
    for (let i = 0; i < 12; i++) {
      w.f32(i); w.f32(i + 0.5); w.f32(-i);
      w.f32(0.25); w.f32(0.75); w.f32(0.125); w.f32(0.875);
      w.f32(0); w.f32(0); w.f32(1);
      w.u8(12); w.u8(34); w.u8(56); w.u8(255);
    }
  });
  lumps[11] = record(12, w => { w.i32(0); w.i32(1); w.i32(2); });
  lumps[12] = record(72, w => { w.bytes(new TextEncoder().encode("fog")); w.bytes(new Uint8Array(61)); w.i32(0); w.i32(-1); });
  lumps[13] = record(104 * 4, w => {
    for (let type = 1; type <= 4; type++) {
      w.i32(0); w.i32(type === 4 ? -1 : 0); w.i32(type);
      w.i32(type === 2 ? 3 : 0); w.i32(type === 2 ? 9 : type === 4 ? 0 : 3);
      w.i32(0); w.i32(type === 2 || type === 4 ? 0 : 3);
      w.i32(type === 4 ? -1 : 0);
      w.i32(8); w.i32(16); w.i32(32); w.i32(64);
      for (let field = 0; field < 12; field++) w.f32(field + 0.5);
      w.i32(type === 2 ? 3 : 0); w.i32(type === 2 ? 3 : 0);
    }
  });
  lumps[14] = new Uint8Array(128 * 128 * 3).fill(127);
  lumps[15] = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  lumps[16] = record(9, w => { w.i32(1); w.i32(1); w.u8(1); });
  const output = new BinaryWriter(144 + lumps.reduce((sum, lump) => sum + lump.length, 0));
  output.bytes(new TextEncoder().encode("IBSP")); output.i32(46);
  let offset = 144;
  for (const lump of lumps) { output.i32(offset); output.i32(lump.length); offset += lump.length; }
  for (const lump of lumps) output.bytes(lump);
  return output.finish();
}

export function q3TestFixture(): Uint8Array {
  const original = q3Fixture(), view = new DataView(original.buffer);
  const lump = (index: number): Uint8Array => {
    const offset = view.getInt32(8 + index * 8, true), length = view.getInt32(12 + index * 8, true);
    return original.slice(offset, offset + length);
  };
  const leaves = lump(4); new DataView(leaves.buffer).setInt32(36, 3, true);
  const surfaces = lump(13), shader = lump(1).subarray(0, 64);
  const surfaceWriter = new BinaryWriter(164 * 3);
  for (let i = 0; i < 3; i++) {
    const input = new DataView(surfaces.buffer, i * 104, 104);
    surfaceWriter.bytes(shader); surfaceWriter.i32(0); surfaceWriter.i32(0);
    surfaceWriter.i32(input.getInt32(12, true)); surfaceWriter.i32(input.getInt32(16, true));
    surfaceWriter.i32(0); surfaceWriter.i32(i === 2 ? 3 : 0);
    surfaceWriter.i32(i === 1 ? 3 : 0); surfaceWriter.i32(i === 1 ? 3 : 0);
    surfaceWriter.bytes(surfaces.subarray(i * 104 + 28, i * 104 + 96));
  }
  const parts = [lump(0), record(20, w => { w.bytes(lump(2)); w.i32(0); }), lump(3), leaves, lump(5).subarray(0, 12), lump(6),
    record(48, w => { w.bytes(lump(7).subarray(0, 24)); w.i32(0); w.i32(0); w.i32(0); w.i32(0); w.i32(999); w.i32(999); }),
    record(12, w => { w.i32(0); w.i32(6); w.i32(1); }),
    record(48, w => { for (let i = 0; i < 6; i++) { w.i32(0); w.i32(128); } }),
    lump(14), lump(16), lump(10), surfaceWriter.finish(), lump(12).subarray(0, 68), lump(11)];
  const writer = new BinaryWriter(128 + parts.reduce((sum, part) => sum + part.length, 0));
  writer.u32(0x50534249); writer.i32(44);
  let offset = 128;
  for (const part of parts) { writer.i32(offset); writer.i32(part.length); offset += part.length; }
  for (const part of parts) writer.bytes(part);
  return writer.finish();
}
