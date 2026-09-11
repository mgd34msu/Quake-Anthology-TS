/* Adapted from Q1 wad.c/wad.h and the WAD3 miptex palette layout.
 * Copyright (C) 1996 Id Software, Inc. GPL-2.0-or-later. */
import { BinaryError, BinaryReader } from "../../core/binary/index.ts";
import { decodeQ1MipTexture, decodeQpic } from "./indexed.ts";
import type { IndexedImage, Q1MipTexture } from "./indexed.ts";

export interface WadLump {
  readonly name: string; readonly type: number; readonly compression: number;
  readonly offset: number; readonly diskSize: number; readonly byteLength: number;
  readonly bytes: Uint8Array;
}
export interface WadImageArchive { readonly kind: "WAD2" | "WAD3"; readonly lumps: readonly WadLump[]; }
export type WadImage = { readonly kind: "qpic"; readonly image: IndexedImage }
  | { readonly kind: "miptex"; readonly texture: Q1MipTexture; readonly palette: Uint8Array | null }
  | { readonly kind: "palette"; readonly colors: Uint8Array }
  | { readonly kind: "raw"; readonly lump: WadLump };

export function decodeWad(bytes: Uint8Array, source = "<wad>"): WadImageArchive {
  const reader = new BinaryReader(bytes, source), kind = reader.fixedByteString(4);
  if (kind !== "WAD2" && kind !== "WAD3") throw new BinaryError(source, 0, "Expected WAD2 or WAD3");
  const count = reader.i32(), offset = reader.i32();
  if (count < 0) throw new BinaryError(source, 4, "Negative WAD lump count");
  const directory = reader.section(offset, count * 32), lumps: WadLump[] = [];
  for (let index = 0; index < count; index++) {
    const start = directory.i32(), diskSize = directory.i32(), byteLength = directory.i32(), type = directory.u8(), compression = directory.u8();
    directory.skip(2); const name = directory.fixedByteString(16).toLowerCase();
    if (byteLength < 0) throw new BinaryError(source, offset + index * 32 + 8, "Negative WAD decoded size");
    const lumpBytes = reader.section(start, diskSize).bytes(diskSize);
    lumps.push({ name, type, compression, offset: start, diskSize, byteLength, bytes: lumpBytes });
  }
  return { kind, lumps };
}

export function decodeWadImage(archive: WadImageArchive, lump: WadLump, source = "<wad>"): WadImage {
  if (lump.compression !== 0) throw new BinaryError(source, lump.offset, `WAD compression ${lump.compression} is unsupported`);
  if (lump.diskSize !== lump.byteLength) throw new BinaryError(source, lump.offset, "Uncompressed WAD lump size mismatch");
  if (lump.type === 66) return { kind: "qpic", image: decodeQpic(lump.bytes, `${source}:${lump.name}`) };
  if (lump.type === 68 || archive.kind === "WAD3" && lump.type === 67) {
    const texture = decodeQ1MipTexture(lump.bytes, `${source}:${lump.name}`);
    let palette: Uint8Array | null = null;
    if (archive.kind === "WAD3" && texture.kind === "embedded") {
      const reader = new BinaryReader(lump.bytes, source); reader.seek(36);
      const end = reader.u32() + texture.levels[3].pixels.length;
      reader.seek(end);
      const count = reader.u16();
      if (count !== 256) throw new BinaryError(source, end, "WAD3 miptex requires 256 palette colors");
      palette = reader.bytes(count * 3);
    }
    return { kind: "miptex", texture, palette };
  }
  if (lump.type === 64 && lump.bytes.length === 768) return { kind: "palette", colors: lump.bytes.slice() };
  return { kind: "raw", lump };
}
