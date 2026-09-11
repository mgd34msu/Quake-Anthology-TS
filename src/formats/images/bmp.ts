/* Adapted from quake-2-re-ts/src/qcommon/bmp.ts. GPL-2.0-or-later. */
import { BinaryError, BinaryReader } from "../../core/binary/index.ts";
import type { ImageLevel } from "../../contracts/render.ts";

export interface BmpImage extends ImageLevel {
  readonly indexed: { readonly indices: Uint8Array; readonly palette: Uint8Array } | null;
}

export function decodeBmp(bytes: Uint8Array, source = "<bmp>"): BmpImage {
  const reader = new BinaryReader(bytes, source); reader.expectMagic("BM"); reader.skip(8);
  const offset = reader.u32(), header = reader.u32(), width = reader.i32(), signedHeight = reader.i32();
  const planes = reader.u16(), depth = reader.u16(), compression = reader.u32(); reader.skip(12);
  let colorCount = reader.u32(); reader.skip(4);
  const height = Math.abs(signedHeight);
  if (header !== 40 || planes !== 1 || compression !== 0 || ![8, 24, 32].includes(depth))
    throw new BinaryError(source, 14, "BMP requires BITMAPINFOHEADER, BI_RGB and 8/24/32-bit pixels");
  if (width <= 0 || height <= 0 || width * height * 4 > 0x7fffffff) throw new BinaryError(source, 18, "Invalid BMP dimensions");
  let palette: Uint8Array | null = null;
  if (depth === 8) {
    if (colorCount === 0) colorCount = 256;
    if (colorCount > 256) throw new BinaryError(source, 46, "BMP palette has too many entries");
    palette = new Uint8Array(colorCount * 3);
    for (let entry = 0; entry < colorCount; entry++) {
      const b = reader.u8(), g = reader.u8(), r = reader.u8(); reader.skip(1);
      palette.set([r, g, b], entry * 3);
    }
  }
  if (offset < reader.offset) throw new BinaryError(source, offset, "BMP pixels overlap the header or palette");
  const stride = Math.floor((width * depth + 31) / 32) * 4;
  const data = reader.dataView(offset, stride * height), pixels = new Uint8Array(width * height * 4);
  const indices = palette === null ? null : new Uint8Array(width * height), colors = palette === null ? null : new DataView(palette.buffer);
  for (let row = 0; row < height; row++) for (let x = 0; x < width; x++) {
    const index = (signedHeight < 0 ? row : height - row - 1) * width + x, at = row * stride + x * depth / 8;
    if (indices !== null && colors !== null) {
      const color = data.getUint8(at);
      if (color >= colorCount) throw new BinaryError(source, offset + at, "BMP palette index out of range");
      indices[index] = color;
      pixels.set([colors.getUint8(color * 3), colors.getUint8(color * 3 + 1), colors.getUint8(color * 3 + 2), 255], index * 4);
    } else pixels.set([data.getUint8(at + 2), data.getUint8(at + 1), data.getUint8(at), depth === 32 ? data.getUint8(at + 3) : 255], index * 4);
  }
  return { width, height, pixels, indexed: indices !== null && palette !== null ? { indices, palette } : null };
}

export { decodeBmp as decodeQ3Bmp, BmpDropError } from "./q3-bmp.ts";
