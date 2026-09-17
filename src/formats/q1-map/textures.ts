/* Adapted from quake-1-re-ts miptex reading and FTE external mip textures.
 * GPL-2.0-or-later. */
import type { Q1MipTexture } from "../../contracts/scene.ts";
import { BinaryError, BinaryReader } from "../../core/binary/index.ts";

export interface Q1TextureLump {
  readonly textures: readonly (Q1MipTexture | null)[];
  readonly offsets: readonly (number | null)[];
  readonly mipOffsets: readonly (readonly [number, number, number, number] | null)[];
}

export function readTextures(reader: BinaryReader, quake64 = false): Q1TextureLump {
  if (reader.length === 0) return { textures: [], offsets: [], mipOffsets: [] };
  const count = reader.i32();
  if (count < 0 || count > reader.remaining / 4) throw new BinaryError(reader.source, 0, `invalid miptex count ${count}`);
  const offsets: (number | null)[] = [];
  for (let i = 0; i < count; i++) {
    const offset = reader.i32();
    if (offset !== -1 && offset < 4 + count * 4) throw new BinaryError(reader.source, reader.offset - 4, "miptex overlaps offset table");
    offsets.push(offset === -1 ? null : offset);
  }
  const textures: (Q1MipTexture | null)[] = [];
  const mipOffsets: (readonly [number, number, number, number] | null)[] = [];
  for (const offset of offsets) {
    if (offset === null) { textures.push(null); mipOffsets.push(null); continue; }
    const headerSize = quake64 ? 44 : 40;
    const header = reader.section(offset, headerSize);
    const name = header.fixedByteString(16);
    const width = header.u32();
    const height = header.u32();
    const metadata = quake64 ? { quake64Shift: header.u32() } : {};
    const mips: [number, number, number, number] = [header.u32(), header.u32(), header.u32(), header.u32()];
    mipOffsets.push(mips);
    if (width === 0 || height === 0) throw new BinaryError(reader.source, offset, "zero-sized mip texture");
    if (!quake64 && mips.every((value) => value === 0)) {
      textures.push({ kind: "external", name, width, height });
      continue;
    }
    const level = (mipOffset: number, scale: number): Uint8Array => {
      if (quake64 && mipOffset === 0) return new Uint8Array();
      if (mipOffset < headerSize) throw new BinaryError(reader.source, offset + mipOffset, "mip pixels overlap texture header");
      const length = Math.floor(width / scale) * Math.floor(height / scale);
      return reader.section(offset + mipOffset, length).bytes(length);
    };
    textures.push({
      kind: "embedded", name, width, height, ...metadata,
      levels: [level(quake64 ? headerSize : mips[0], 1), level(mips[1], 2), level(mips[2], 4), level(mips[3], 8)],
    });
  }
  return { textures, offsets, mipOffsets };
}

/** Convert palette indices to RGBA without changing their source pixels. */
export function q1TextureRgba(pixels: Uint8Array, palette: Uint8Array, transparentIndex: number | null = null): Uint8Array {
  if (palette.length !== 768) throw new RangeError(`Quake palette must contain 768 bytes, got ${palette.length}`);
  if (transparentIndex !== null && (!Number.isInteger(transparentIndex) || transparentIndex < 0 || transparentIndex > 255)) {
    throw new RangeError("Transparent palette index must be a byte");
  }
  const colors = new DataView(palette.buffer, palette.byteOffset, palette.byteLength);
  const output = new Uint8Array(pixels.length * 4);
  let offset = 0;
  for (const pixel of pixels) {
    output[offset++] = colors.getUint8(pixel * 3);
    output[offset++] = colors.getUint8(pixel * 3 + 1);
    output[offset++] = colors.getUint8(pixel * 3 + 2);
    output[offset++] = pixel === transparentIndex ? 0 : 255;
  }
  return output;
}
