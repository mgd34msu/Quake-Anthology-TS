// Adapted from quake-1-re-ts common.ts and quake-2-re-ts qcommon/files.ts.
// id Software PACK header and ordered 64-byte directory. GPL-2.0-or-later.
import { BinaryReader } from "../../core/binary/index.ts";
import { ArchiveError, checkRange, normalizeEntryPath } from "./types.ts";
import type { PakEntry } from "./types.ts";

export function readPakHeader(bytes: Uint8Array, source: string, fileSize: number) {
  const reader = new BinaryReader(bytes, source);
  reader.expectMagic("PACK");
  const offset = reader.i32();
  const byteLength = reader.i32();
  checkRange(source, fileSize, offset, byteLength);
  if (offset < 12 || byteLength % 64 !== 0) throw new ArchiveError(source, offset, "invalid PACK directory range");
  return { offset, byteLength };
}

export function readPakDirectory(bytes: Uint8Array, source: string, fileSize: number): readonly PakEntry[] {
  const reader = new BinaryReader(bytes, source);
  const entries: PakEntry[] = [];
  while (reader.remaining > 0) {
    const rawPath = reader.fixedByteString(56);
    const dataOffset = reader.i32();
    const byteLength = reader.i32();
    checkRange(source, fileSize, dataOffset, byteLength);
    const path = normalizeEntryPath(rawPath);
    entries.push(Object.freeze({ format: "pak", ordinal: entries.length, path, rawPath, byteLength,
      compressedSize: byteLength, compressionMethod: 0, dataOffset, isDirectory: path.endsWith("/") }));
  }
  return Object.freeze(entries);
}
