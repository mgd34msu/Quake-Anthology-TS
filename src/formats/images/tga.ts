/* Adapted from quake-1-re-ts/src/lib/tga.ts and Q3 tr_image.c LoadTGA.
 * Copyright (C) 1996-2005 Id Software, Inc. GPL-2.0-or-later. */
import { BinaryError, BinaryReader, BinaryWriter } from "../../core/binary/index.ts";
import type { ImageLevel } from "../../contracts/render.ts";

export interface TgaImage extends ImageLevel {
  readonly descriptor: number;
  readonly indexed: { readonly indices: Uint16Array; readonly first: number; readonly paletteRgba: Uint8Array } | null;
}

/** Format-oriented TGA reader. Q3's original origin quirk has a separate export. */
export function decodeTga(bytes: Uint8Array, source = "<tga>"): TgaImage {
  const reader = new BinaryReader(bytes, source), idLength = reader.u8(), mapType = reader.u8(), type = reader.u8();
  const mapFirst = reader.u16(), mapLength = reader.u16(), mapDepth = reader.u8();
  reader.skip(4);
  const width = reader.u16(), height = reader.u16(), depth = reader.u8(), descriptor = reader.u8();
  const indexed = type === 1 || type === 9, gray = type === 3 || type === 11, rle = type >= 9;
  if (![1, 2, 3, 9, 10, 11].includes(type) || width === 0 || height === 0 || width * height * 4 > 0x7fffffff
    || (descriptor & 192) !== 0 || mapType !== (indexed ? 1 : 0)
    || (indexed ? depth !== 8 && depth !== 16 : gray ? depth !== 8 && depth !== 16 : ![16, 24, 32].includes(depth)))
    throw new BinaryError(source, 0, "Unsupported TGA header");
  reader.skip(idLength);
  const color = (bits: number): readonly [number, number, number, number] => {
    if (bits === 15 || bits === 16) {
      const word = reader.u16(), r = word >> 10 & 31, g = word >> 5 & 31, b = word & 31;
      return [(r << 3) | (r >> 2), (g << 3) | (g >> 2), (b << 3) | (b >> 2), bits === 16 && (descriptor & 15) !== 0 && (word & 32768) === 0 ? 0 : 255];
    }
    if (bits !== 24 && bits !== 32) throw new BinaryError(source, reader.offset, `Unsupported TGA color depth ${bits}`);
    const b = reader.u8(), g = reader.u8(), r = reader.u8(); return [r, g, b, bits === 32 ? reader.u8() : 255];
  };
  const palette: (readonly [number, number, number, number])[] = [];
  if (indexed) for (let entry = 0; entry < mapLength; entry++) palette.push(color(mapDepth));
  let currentIndex = 0;
  const read = (): readonly [number, number, number, number] => {
    if (indexed) {
      const index = depth === 8 ? reader.u8() : reader.u16(), value = palette[index - mapFirst];
      if (value === undefined) throw new BinaryError(source, reader.offset, "TGA palette index out of range");
      currentIndex = index;
      return value;
    }
    if (gray) { const value = reader.u8(); return [value, value, value, depth === 16 ? reader.u8() : 255]; }
    return color(depth);
  };
  const pixels = new Uint8Array(width * height * 4);
  const indices = indexed ? new Uint16Array(width * height) : null;
  let pixel = 0;
  const write = (rgba: readonly [number, number, number, number]): void => {
    const x = pixel % width, y = Math.floor(pixel / width);
    const destinationX = (descriptor & 16) === 0 ? x : width - 1 - x, destinationY = (descriptor & 32) === 0 ? height - 1 - y : y;
    const at = destinationY * width + destinationX;
    pixels.set(rgba, at * 4);
    if (indices !== null) indices[at] = currentIndex;
    pixel++;
  };
  while (pixel < width * height) {
    const packet = rle ? reader.u8() : 0, count = rle ? (packet & 127) + 1 : 1;
    if (count > width * height - pixel) throw new BinaryError(source, reader.offset, "TGA packet exceeds pixel count");
    if ((packet & 128) !== 0) { const rgba = read(); for (let index = 0; index < count; index++) write(rgba); }
    else for (let index = 0; index < count; index++) write(read());
  }
  const paletteRgba = new Uint8Array(palette.length * 4);
  for (const [entry, rgba] of palette.entries()) paletteRgba.set(rgba, entry * 4);
  return { width, height, pixels, descriptor, indexed: indices === null ? null : { indices, first: mapFirst, paletteRgba } };
}

export function encodeTga(image: ImageLevel): Uint8Array {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width <= 0 || image.width > 65535
    || image.height <= 0 || image.height > 65535 || image.pixels.length !== image.width * image.height * 4) throw new RangeError("Invalid TGA output");
  const writer = new BinaryWriter(18 + image.pixels.length), input = new BinaryReader(image.pixels);
  writer.u8(0); writer.u8(0); writer.u8(2); writer.bytes(new Uint8Array(9)); writer.u16(image.width); writer.u16(image.height); writer.u8(32); writer.u8(40);
  while (input.remaining > 0) { const r = input.u8(), g = input.u8(), b = input.u8(), a = input.u8(); writer.u8(b); writer.u8(g); writer.u8(r); writer.u8(a); }
  return writer.finish();
}

export { decodeTga as decodeQ3Tga } from "./q3-tga.ts";
