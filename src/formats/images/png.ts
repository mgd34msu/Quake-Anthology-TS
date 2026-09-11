/* Adapted from quake-1-re-ts/src/lib/png.ts and quake-2-re-ts/src/qcommon/png.ts.
 * GPL-2.0-or-later. Keeps PNG palette/gamma data alongside decoded RGBA pixels. */
import { inflateSync } from "node:zlib";
import { BinaryError } from "../../core/binary/index.ts";
import type { ImageLevel } from "../../contracts/render.ts";

export interface PngImage extends ImageLevel {
  readonly bitDepth: number;
  readonly colorType: number;
  readonly gamma: number | null;
  readonly srgbIntent: number | null;
  readonly indexed: { readonly indices: Uint8Array; readonly palette: Uint8Array; readonly alpha: Uint8Array } | null;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ ((crc & 1) === 0 ? 0 : 0xedb88320);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function decodePng(bytes: Uint8Array, source = "<png>"): PngImage {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = (offset: number, message: string): never => { throw new BinaryError(source, offset, `PNG: ${message}`); };
  if (bytes.length < 33 || view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) fail(0, "bad signature");
  let width = 0, height = 0, bitDepth = 0, colorType = -1, interlace = 0;
  let gamma: number | null = null, srgbIntent: number | null = null;
  let palette: Uint8Array | null = null, transparency: Uint8Array | null = null;
  let ended = false, compressedLength = 0;
  const idat: Uint8Array[] = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset), start = offset + 8, end = start + length;
    if (end + 4 > bytes.length) fail(offset, "truncated chunk");
    const type = String.fromCharCode(view.getUint8(offset + 4), view.getUint8(offset + 5), view.getUint8(offset + 6), view.getUint8(offset + 7));
    if (view.getUint32(end) !== crc32(bytes.subarray(offset + 4, end))) fail(offset, `bad ${type} CRC`);
    if (type === "IHDR") {
      if (offset !== 8 || length !== 13) fail(offset, "misplaced or malformed IHDR");
      width = view.getUint32(start); height = view.getUint32(start + 4);
      bitDepth = view.getUint8(start + 8); colorType = view.getUint8(start + 9); interlace = view.getUint8(start + 12);
      if (view.getUint8(start + 10) !== 0 || view.getUint8(start + 11) !== 0 || interlace > 1) fail(start + 10, "unsupported compression, filter or interlace method");
      const valid = colorType === 0 ? [1, 2, 4, 8, 16] : colorType === 3 ? [1, 2, 4, 8]
        : colorType === 2 || colorType === 4 || colorType === 6 ? [8, 16] : [];
      if (!valid.includes(bitDepth)) fail(start + 8, `unsupported color type ${colorType} at depth ${bitDepth}`);
    } else if (type === "PLTE") {
      if (length === 0 || length > 768 || length % 3 !== 0) fail(start, "invalid palette");
      palette = bytes.slice(start, end);
    } else if (type === "tRNS") transparency = bytes.slice(start, end);
    else if (type === "gAMA") {
      if (length !== 4 || view.getUint32(start) === 0) fail(start, "invalid gamma");
      gamma = view.getUint32(start) / 100000;
    } else if (type === "sRGB") {
      if (length !== 1 || view.getUint8(start) > 3) fail(start, "invalid sRGB intent");
      srgbIntent = view.getUint8(start);
    } else if (type === "IDAT") { idat.push(bytes.subarray(start, end)); compressedLength += length; }
    else if (type === "IEND") { if (length !== 0) fail(start, "invalid IEND"); ended = true; break; }
    else if ((view.getUint8(offset + 4) & 32) === 0) fail(offset, `unsupported critical chunk ${type}`);
    offset = end + 4;
  }
  if (!ended || width <= 0 || height <= 0 || width * height * 4 > 0x7fffffff || idat.length === 0) fail(8, "missing chunks or invalid dimensions");
  if (colorType === 3 && palette === null) fail(8, "indexed image has no palette");
  const channels = colorType === 0 || colorType === 3 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : 4;
  const bitsPerPixel = channels * bitDepth, byteStride = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const passes: readonly (readonly [number, number, number, number])[] = interlace === 0 ? [[0, 0, 1, 1]]
    : [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
  let rawLength = 0;
  for (const [x, y, dx, dy] of passes) {
    const w = Math.max(0, Math.ceil((width - x) / dx)), h = Math.max(0, Math.ceil((height - y) / dy));
    if (w !== 0 && h !== 0) rawLength += (Math.ceil(w * bitsPerPixel / 8) + 1) * h;
  }
  const compressed = new Uint8Array(compressedLength);
  let destination = 0;
  for (const part of idat) { compressed.set(part, destination); destination += part.length; }
  let raw: Uint8Array;
  try { raw = new Uint8Array(inflateSync(compressed, { maxOutputLength: rawLength })); }
  catch (error) { throw new BinaryError(source, 8, `PNG inflate: ${error instanceof Error ? error.message : String(error)}`); }
  if (raw.length !== rawLength) fail(8, "unexpected decompressed size");
  const rawView = new DataView(raw.buffer, raw.byteOffset, raw.byteLength), pixels = new Uint8Array(width * height * 4);
  const indices = colorType === 3 ? new Uint8Array(width * height) : null;
  const paletteView = palette === null ? null : new DataView(palette.buffer, palette.byteOffset, palette.byteLength);
  const transparentView = transparency === null ? null : new DataView(transparency.buffer, transparency.byteOffset, transparency.byteLength);
  if (transparency !== null && (colorType === 0 && transparency.length !== 2 || colorType === 2 && transparency.length !== 6
    || colorType === 3 && transparency.length > (palette?.length ?? 0) / 3 || colorType === 4 || colorType === 6)) fail(8, "invalid transparency chunk");
  let rawOffset = 0;
  for (const [x, y, dx, dy] of passes) {
    const w = Math.max(0, Math.ceil((width - x) / dx)), h = Math.max(0, Math.ceil((height - y) / dy));
    if (w === 0 || h === 0) continue;
    const rowLength = Math.ceil(w * bitsPerPixel / 8), rows = new Uint8Array(rowLength * h), rowsView = new DataView(rows.buffer);
    for (let py = 0; py < h; py++) {
      const filter = rawView.getUint8(rawOffset++), row = py * rowLength;
      if (filter > 4) fail(8, `unknown scanline filter ${filter}`);
      for (let byte = 0; byte < rowLength; byte++) {
        const a = byte >= byteStride ? rowsView.getUint8(row + byte - byteStride) : 0;
        const b = py > 0 ? rowsView.getUint8(row + byte - rowLength) : 0;
        const c = py > 0 && byte >= byteStride ? rowsView.getUint8(row + byte - rowLength - byteStride) : 0;
        const prediction = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c);
        rows[row + byte] = rawView.getUint8(rawOffset++) + prediction;
      }
      for (let px = 0; px < w; px++) {
        const sample = (channel: number): number => {
          const bit = (px * channels + channel) * bitDepth, offset = row + Math.floor(bit / 8);
          return bitDepth === 16 ? rowsView.getUint16(offset) : bitDepth === 8 ? rowsView.getUint8(offset)
            : rowsView.getUint8(offset) >>> (8 - bitDepth - bit % 8) & ((1 << bitDepth) - 1);
        };
        const byte = (value: number): number => bitDepth === 16 ? value >>> 8 : bitDepth === 8 ? value : Math.round(value * 255 / ((1 << bitDepth) - 1));
        const index = (y + py * dy) * width + x + px * dx, out = index * 4;
        if (indices !== null && paletteView !== null) {
          const value = sample(0);
          if (value * 3 + 3 > paletteView.byteLength) fail(8, "palette index out of range");
          indices[index] = value;
          pixels[out] = paletteView.getUint8(value * 3); pixels[out + 1] = paletteView.getUint8(value * 3 + 1); pixels[out + 2] = paletteView.getUint8(value * 3 + 2);
          pixels[out + 3] = transparentView !== null && value < transparentView.byteLength ? transparentView.getUint8(value) : 255;
        } else if (colorType === 0 || colorType === 4) {
          const value = sample(0); pixels[out] = byte(value); pixels[out + 1] = byte(value); pixels[out + 2] = byte(value);
          pixels[out + 3] = colorType === 4 ? byte(sample(1)) : transparentView !== null && value === transparentView.getUint16(0) ? 0 : 255;
        } else {
          const r = sample(0), g = sample(1), b = sample(2);
          pixels[out] = byte(r); pixels[out + 1] = byte(g); pixels[out + 2] = byte(b);
          pixels[out + 3] = colorType === 6 ? byte(sample(3)) : transparentView !== null && r === transparentView.getUint16(0)
            && g === transparentView.getUint16(2) && b === transparentView.getUint16(4) ? 0 : 255;
        }
      }
    }
  }
  const alpha = new Uint8Array((palette?.length ?? 0) / 3).fill(255);
  if (colorType === 3 && transparency !== null) alpha.set(transparency);
  return { width, height, pixels, bitDepth, colorType, gamma, srgbIntent,
    indexed: indices !== null && palette !== null ? { indices, palette, alpha } : null };
}

export { encodePng } from "./png-encoder.ts";
