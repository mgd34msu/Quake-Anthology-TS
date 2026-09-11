/* Adapted from quake-2-re-ts/src/qcommon/gif.ts. GPL-2.0-or-later.
 * The rerelease port composites disposal 2 to transparency. Timing stays with callers. */
import { BinaryError, BinaryReader } from "../../core/binary/index.ts";
import type { ImageLevel } from "../../contracts/render.ts";

export interface GifFrame {
  readonly image: ImageLevel;
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly indices: Uint8Array;
  readonly palette: Uint8Array;
  readonly transparentIndex: number | null;
  readonly delayCentiseconds: number;
  readonly disposal: number;
}
export interface GifImage {
  readonly width: number; readonly height: number;
  readonly frames: readonly [GifFrame, ...GifFrame[]];
  readonly loopCount: number | null;
  readonly backgroundIndex: number;
  readonly globalPalette: Uint8Array | null;
}

function subBlocks(reader: BinaryReader): Uint8Array {
  const blocks: Uint8Array[] = [];
  let total = 0;
  for (let count = reader.u8(); count !== 0; count = reader.u8()) { blocks.push(reader.bytes(count)); total += count; }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const block of blocks) { bytes.set(block, offset); offset += block.length; }
  return bytes;
}

function lzw(data: Uint8Array, minimum: number, count: number, source: string): Uint8Array {
  if (minimum < 2 || minimum > 8) throw new BinaryError(source, 0, "Invalid GIF LZW code size");
  const clear = 1 << minimum, end = clear + 1, output = new Uint8Array(count);
  const bits = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let dictionary: number[][] = [], size = minimum + 1, next = end + 1, bit = 0, written = 0;
  let previous: number[] | null = null;
  const reset = (): void => { dictionary = []; for (let index = 0; index < clear; index++) dictionary.push([index]); dictionary.push([], []); size = minimum + 1; next = end + 1; previous = null; };
  reset();
  while (written < count) {
    if (bit + size > data.length * 8) throw new BinaryError(source, bit >>> 3, "Truncated GIF LZW data");
    let code = 0;
    for (let index = 0; index < size; index++, bit++) code |= (bits.getUint8(bit >>> 3) >>> (bit & 7) & 1) << index;
    if (code === clear) { reset(); continue; }
    if (code === end) break;
    let entry: number[] | undefined = dictionary[code];
    if (entry === undefined && code === next && previous !== null) {
      const first: number | undefined = previous[0];
      if (first !== undefined) entry = [...previous, first];
    }
    const first = entry?.[0];
    if (entry === undefined || first === undefined || entry.length > count - written) throw new BinaryError(source, bit >>> 3, "Invalid GIF LZW code");
    output.set(entry, written); written += entry.length;
    if (previous !== null && next < 4096) {
      dictionary[next++] = [...previous, first];
      if (next === 1 << size && size < 12) size++;
    }
    previous = entry;
  }
  if (written !== count) throw new BinaryError(source, bit >>> 3, "Incomplete GIF image");
  return output;
}

export function decodeGif(bytes: Uint8Array, source = "<gif>"): GifImage {
  const reader = new BinaryReader(bytes, source), signature = reader.fixedByteString(6);
  if (signature !== "GIF87a" && signature !== "GIF89a") throw new BinaryError(source, 0, "Invalid GIF signature");
  const width = reader.u16(), height = reader.u16(), packed = reader.u8(), backgroundIndex = reader.u8(); reader.skip(1);
  if (width === 0 || height === 0 || width * height * 4 > 0x7fffffff) throw new BinaryError(source, 6, "Invalid GIF dimensions");
  const globalPalette = (packed & 128) === 0 ? null : reader.bytes((2 << (packed & 7)) * 3);
  const canvas = new Uint8Array(width * height * 4), frames: GifFrame[] = [];
  let transparentIndex: number | null = null, delayCentiseconds = 0, disposal = 0, loopCount: number | null = null;
  for (let block = reader.u8(); block !== 59; block = reader.u8()) {
    if (block === 33) {
      const label = reader.u8();
      if (label === 249) {
        if (reader.u8() !== 4) throw new BinaryError(source, reader.offset, "Invalid GIF graphic control extension");
        const flags = reader.u8(); delayCentiseconds = reader.u16(); const index = reader.u8();
        transparentIndex = (flags & 1) === 0 ? null : index; disposal = flags >> 2 & 7;
        if (reader.u8() !== 0) throw new BinaryError(source, reader.offset, "Invalid GIF extension terminator");
      } else if (label === 255) {
        const application = reader.fixedByteString(reader.u8()), payload = subBlocks(reader);
        if ((application === "NETSCAPE2.0" || application === "ANIMEXTS1.0") && payload.length >= 3 && payload[0] === 1)
          loopCount = new DataView(payload.buffer).getUint16(1, true);
      } else subBlocks(reader);
      continue;
    }
    if (block !== 44) throw new BinaryError(source, reader.offset - 1, `Unknown GIF block ${block}`);
    const x = reader.u16(), y = reader.u16(), frameWidth = reader.u16(), frameHeight = reader.u16(), flags = reader.u8();
    if (frameWidth === 0 || frameHeight === 0 || x + frameWidth > width || y + frameHeight > height)
      throw new BinaryError(source, reader.offset, "GIF frame exceeds its logical screen");
    const palette = (flags & 128) === 0 ? globalPalette : reader.bytes((2 << (flags & 7)) * 3);
    if (palette === null) throw new BinaryError(source, reader.offset, "GIF frame has no palette");
    const minimum = reader.u8(), decoded = lzw(subBlocks(reader), minimum, frameWidth * frameHeight, source);
    const rows: number[] = [];
    if ((flags & 64) === 0) for (let row = 0; row < frameHeight; row++) rows.push(row);
    else {
      const passes: readonly (readonly [number, number])[] = [[0, 8], [4, 8], [2, 4], [1, 2]];
      for (const [start, step] of passes) for (let row = start; row < frameHeight; row += step) rows.push(row);
    }
    const indices = new Uint8Array(decoded.length), colors = new DataView(palette.buffer, palette.byteOffset, palette.byteLength);
    const previous = disposal === 3 ? canvas.slice() : null;
    for (let row = 0; row < frameHeight; row++) {
      const destinationY = rows[row];
      if (destinationY === undefined) throw new BinaryError(source, reader.offset, "Incomplete GIF interlace");
      for (let column = 0; column < frameWidth; column++) {
        const index = decoded[row * frameWidth + column];
        if (index === undefined || index * 3 + 3 > palette.length) throw new BinaryError(source, reader.offset, "GIF palette index out of range");
        indices[destinationY * frameWidth + column] = index;
        if (index !== transparentIndex) canvas.set([colors.getUint8(index * 3), colors.getUint8(index * 3 + 1), colors.getUint8(index * 3 + 2), 255], ((y + destinationY) * width + x + column) * 4);
      }
    }
    frames.push({ image: { width, height, pixels: canvas.slice() }, rect: { x, y, width: frameWidth, height: frameHeight },
      indices, palette: palette.slice(), transparentIndex, delayCentiseconds, disposal });
    if (disposal === 2) for (let row = y; row < y + frameHeight; row++) canvas.fill(0, (row * width + x) * 4, (row * width + x + frameWidth) * 4);
    else if (previous !== null) canvas.set(previous);
    transparentIndex = null; delayCentiseconds = 0; disposal = 0;
  }
  const [first, ...rest] = frames;
  if (first === undefined) throw new BinaryError(source, reader.offset, "GIF has no image frames");
  return { width, height, frames: [first, ...rest], loopCount, backgroundIndex, globalPalette };
}
