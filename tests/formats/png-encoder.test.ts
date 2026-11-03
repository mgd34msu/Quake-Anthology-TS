import { expect, test } from "bun:test";
import { encodePng } from "../../src/formats/images/png-encoder.ts";

function bitwiseCrc(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) === 0 ? 0 : 0xedb88320);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

test("every PNG chunk carries the standard CRC-32 of its type and data", () => {
  const rgba = new Uint8Array(8 * 4 * 4).map((_, index) => (index * 37) & 0xff);
  const png = encodePng(8, 4, rgba), view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const types: string[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = view.getUint32(offset);
    types.push(String.fromCharCode(...png.subarray(offset + 4, offset + 8)));
    expect(view.getUint32(offset + 8 + length)).toBe(bitwiseCrc(png.subarray(offset + 4, offset + 8 + length)));
    offset += length + 12;
  }
  expect(types).toEqual(["IHDR", "IDAT", "IEND"]);
});
