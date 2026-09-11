/* Adapted from Q1 model.c/wad.c and Q2 gl_image.c/qfiles.h.
 * Copyright (C) 1996-1997 Id Software, Inc. GPL-2.0-or-later. */
import { BinaryError, BinaryReader, BinaryWriter } from "../../core/binary/index.ts";
import type { ImageLevel } from "../../contracts/render.ts";

export interface IndexedImage { readonly width: number; readonly height: number; readonly indices: Uint8Array; }
export interface PcxImage extends IndexedImage { readonly palette: Uint8Array | null; }
export type MipLevels = readonly [ImageLevel, ImageLevel, ImageLevel, ImageLevel];
export type Q1MipTexture = { readonly kind: "embedded"; readonly name: string; readonly width: number; readonly height: number; readonly levels: MipLevels }
  | { readonly kind: "external"; readonly name: string; readonly width: number; readonly height: number };
export interface WalImage {
  readonly name: string; readonly width: number; readonly height: number; readonly levels: MipLevels;
  readonly animation: string; readonly flags: number; readonly contents: number; readonly value: number;
}

function dimensions(width: number, height: number, source: string): number {
  const count = width * height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || count > 0x7fffffff)
    throw new BinaryError(source, 0, `Invalid image dimensions ${width}x${height}`);
  return count;
}

function mipLevel(reader: BinaryReader, width: number, height: number, offset: number, minimum: number): ImageLevel {
  if (offset < minimum) throw new BinaryError(reader.source, offset, "Mip data overlaps the header");
  return { width, height, pixels: reader.section(offset, dimensions(width, height, reader.source)).bytes(width * height) };
}

export function decodeQ1MipTexture(bytes: Uint8Array, source = "<miptex>"): Q1MipTexture {
  const reader = new BinaryReader(bytes, source), name = reader.fixedByteString(16), width = reader.u32(), height = reader.u32();
  dimensions(width, height, source);
  if (width % 16 !== 0 || height % 16 !== 0) throw new BinaryError(source, 16, "Q1 mip dimensions must be multiples of 16");
  const a = reader.u32(), b = reader.u32(), c = reader.u32(), d = reader.u32();
  if (a === 0 && b === 0 && c === 0 && d === 0) return { kind: "external", name, width, height };
  return { kind: "embedded", name, width, height, levels: [mipLevel(reader, width, height, a, 40),
    mipLevel(reader, width / 2, height / 2, b, 40), mipLevel(reader, width / 4, height / 4, c, 40), mipLevel(reader, width / 8, height / 8, d, 40)] };
}

export function decodeWal(bytes: Uint8Array, source = "<wal>"): WalImage {
  const reader = new BinaryReader(bytes, source), name = reader.fixedByteString(32), width = reader.u32(), height = reader.u32();
  dimensions(width, height, source);
  const a = reader.u32(), b = reader.u32(), c = reader.u32(), d = reader.u32();
  const animation = reader.fixedByteString(32), flags = reader.i32(), contents = reader.i32(), value = reader.i32();
  return { name, width, height, animation, flags, contents, value, levels: [mipLevel(reader, width, height, a, 100),
    mipLevel(reader, Math.max(1, width >> 1), Math.max(1, height >> 1), b, 100),
    mipLevel(reader, Math.max(1, width >> 2), Math.max(1, height >> 2), c, 100),
    mipLevel(reader, Math.max(1, width >> 3), Math.max(1, height >> 3), d, 100)] };
}

export function decodeQpic(bytes: Uint8Array, source = "<qpic>"): IndexedImage {
  const reader = new BinaryReader(bytes, source), width = reader.i32(), height = reader.i32();
  return { width, height, indices: reader.bytes(dimensions(width, height, source)) };
}

/** PCX format rows include padding; the historical Q3 reader is exported separately. */
export function decodePcx(bytes: Uint8Array, source = "<pcx>"): PcxImage {
  const reader = new BinaryReader(bytes, source);
  if (reader.u8() !== 10 || reader.u8() !== 5 || reader.u8() !== 1 || reader.u8() !== 8)
    throw new BinaryError(source, 0, "Expected version 5, RLE, 8-bit PCX");
  const xmin = reader.u16(), ymin = reader.u16(), xmax = reader.u16(), ymax = reader.u16();
  const width = xmax - xmin + 1, height = ymax - ymin + 1;
  dimensions(width, height, source);
  reader.seek(65);
  const planes = reader.u8(), bytesPerLine = reader.u16();
  if (planes !== 1 || bytesPerLine < width) throw new BinaryError(source, 65, "Expected single-plane PCX with a complete scanline");
  const paletteOffset = bytes.length - 769;
  const hasPalette = paletteOffset >= 128 && bytes[paletteOffset] === 12;
  const encoded = reader.section(128, (hasPalette ? paletteOffset : bytes.length) - 128);
  const indices = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    let x = 0;
    while (x < bytesPerLine) {
      let value = encoded.u8(), count = 1;
      if ((value & 192) === 192) { count = value & 63; value = encoded.u8(); }
      if (count === 0 || count > bytesPerLine - x) throw new BinaryError(source, encoded.offset + 128, "PCX run exceeds its scanline");
      if (x < width) indices.fill(value, y * width + x, y * width + Math.min(width, x + count));
      x += count;
    }
  }
  return { width, height, indices, palette: hasPalette ? bytes.slice(paletteOffset + 1) : null };
}

/** Quake screenshot PCX with even scanline padding and the original RGB palette. */
export function encodePcx(image: IndexedImage, palette: Uint8Array): Uint8Array {
  dimensions(image.width, image.height, "PCX output");
  if (image.width > 65534 || image.height > 65536 || image.indices.length !== image.width * image.height || palette.length !== 768)
    throw new RangeError("Invalid PCX output dimensions or palette");
  const stride = (image.width + 1) & ~1, writer = new BinaryWriter(128 + stride * image.height * 2 + 769);
  writer.bytes(new Uint8Array([10, 5, 1, 8])); writer.u16(0); writer.u16(0);
  writer.u16(image.width - 1); writer.u16(image.height - 1); writer.u16(image.width); writer.u16(Math.min(65535, image.height));
  writer.bytes(new Uint8Array(49)); writer.u8(1); writer.u16(stride); writer.u16(1); writer.bytes(new Uint8Array(58));
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < stride; x++) {
      const value = x < image.width ? image.indices[y * image.width + x] : 0;
      if (value === undefined) throw new RangeError("Incomplete PCX pixels");
      if ((value & 192) === 192) writer.u8(193);
      writer.u8(value);
    }
  }
  writer.u8(12); writer.bytes(palette); return writer.finish();
}

export function decodeLit(bytes: Uint8Array, expectedSamples: number | null = null, source = "<lit>"): { readonly kind: "qlit-rgb8"; readonly samples: Uint8Array } {
  const reader = new BinaryReader(bytes, source); reader.expectMagic("QLIT");
  if (reader.i32() !== 1) throw new BinaryError(source, 4, "Only QLIT version 1 is supported");
  if (reader.remaining % 3 !== 0 || (expectedSamples !== null && reader.remaining !== expectedSamples * 3))
    throw new BinaryError(source, 8, "QLIT sample count does not match lighting");
  return { kind: "qlit-rgb8", samples: reader.bytes(reader.remaining) };
}
