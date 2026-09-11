// Central/local header validation adapted from quake-3-ts/src/assets/pk3.ts.
// STORE/DEFLATE extraction follows quake-1-re-ts/src/lib/zipfile.ts.
// GPL-2.0-or-later.
import { inflateRawSync } from "node:zlib";
import type { ArchiveFormat } from "../../contracts/content.ts";
import { BinaryReader } from "../../core/binary/index.ts";
import { ArchiveError, checkRange, normalizeEntryPath } from "./types.ts";
import type { ZipEntry } from "./types.ts";

export const ZIP_TAIL_LENGTH = 22 + 0xffff;

export interface ZipDirectory {
  readonly offset: number;
  readonly byteLength: number;
  readonly entryCount: number;
  readonly prefixLength: number;
}

export function readZipTail(tail: Uint8Array, source: string, fileSize: number): ZipDirectory {
  const view = new BinaryReader(tail, source).dataView(0, tail.byteLength);
  for (let offset = tail.byteLength - 22; offset >= 0; offset--) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue;
    if (offset + 22 + view.getUint16(offset + 20, true) !== tail.byteLength) continue;
    const disk = view.getUint16(offset + 4, true);
    const centralDisk = view.getUint16(offset + 6, true);
    const diskEntries = view.getUint16(offset + 8, true);
    const entryCount = view.getUint16(offset + 10, true);
    const byteLength = view.getUint32(offset + 12, true);
    const relativeOffset = view.getUint32(offset + 16, true);
    const endOffset = fileSize - tail.byteLength + offset;
    if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount) throw new ArchiveError(source, endOffset, "multi-disk ZIP is unsupported");
    if (entryCount === 0xffff || byteLength === 0xffffffff || relativeOffset === 0xffffffff) throw new ArchiveError(source, endOffset, "ZIP64 is unsupported");
    checkRange(source, endOffset, relativeOffset, byteLength);
    const prefixLength = endOffset - relativeOffset - byteLength;
    return { offset: relativeOffset + prefixLength, byteLength, entryCount, prefixLength };
  }
  throw new ArchiveError(source, fileSize - tail.byteLength, "ZIP end-of-central-directory record not found");
}

function byteString(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) result += String.fromCharCode(byte);
  return result;
}

export function readZipDirectory(bytes: Uint8Array, source: string, directory: ZipDirectory,
  format: Exclude<ArchiveFormat, "pak">): readonly ZipEntry[] {
  const reader = new BinaryReader(bytes, source);
  const entries: ZipEntry[] = [];
  for (let ordinal = 0; ordinal < directory.entryCount; ordinal++) {
    const offset = reader.offset;
    const header = reader.dataView(offset, 46);
    if (header.getUint32(0, true) !== 0x02014b50) throw new ArchiveError(source, directory.offset + offset, "invalid central directory signature");
    const flags = header.getUint16(8, true);
    const compressionMethod = header.getUint16(10, true);
    const crc32 = header.getUint32(16, true);
    const compressedSize = header.getUint32(20, true);
    const byteLength = header.getUint32(24, true);
    const nameLength = header.getUint16(28, true);
    const extraLength = header.getUint16(30, true);
    const commentLength = header.getUint16(32, true);
    const disk = header.getUint16(34, true);
    const localOffset = header.getUint32(42, true);
    if (compressedSize === 0xffffffff || byteLength === 0xffffffff || localOffset === 0xffffffff) throw new ArchiveError(source, directory.offset + offset, "ZIP64 entry is unsupported");
    if (disk !== 0) throw new ArchiveError(source, directory.offset + offset, "entry starts on another disk");
    if ((flags & 1) !== 0) throw new ArchiveError(source, directory.offset + offset, "encrypted entry is unsupported");
    if (compressionMethod !== 0 && compressionMethod !== 8) throw new ArchiveError(source, directory.offset + offset, `unsupported compression method ${compressionMethod}`);
    if (compressionMethod === 0 && compressedSize !== byteLength) throw new ArchiveError(source, directory.offset + offset, "stored entry sizes disagree");
    const localHeaderOffset = localOffset + directory.prefixLength;
    checkRange(source, directory.offset, localHeaderOffset, 30);
    reader.skip(46);
    const rawPath = byteString(reader.bytes(nameLength));
    reader.skip(extraLength + commentLength);
    const path = normalizeEntryPath(rawPath);
    entries.push(Object.freeze({ format, ordinal, rawPath, path, byteLength, compressedSize,
      compressionMethod, flags, crc32, localHeaderOffset, isDirectory: path.endsWith("/") }));
  }
  if (reader.remaining !== 0) throw new ArchiveError(source, directory.offset + reader.offset, "central directory size disagrees with entry count");
  return Object.freeze(entries);
}

export function readZipLocalHeader(bytes: Uint8Array, source: string, entry: ZipEntry) {
  const view = new BinaryReader(bytes, source).dataView(0, 30);
  if (view.getUint32(0, true) !== 0x04034b50) throw new ArchiveError(source, entry.localHeaderOffset, "invalid local file header signature");
  const flags = view.getUint16(6, true);
  const method = view.getUint16(8, true);
  const crc32 = view.getUint32(14, true);
  const compressedSize = view.getUint32(18, true);
  const byteLength = view.getUint32(22, true);
  if (flags !== entry.flags || method !== entry.compressionMethod) throw new ArchiveError(source, entry.localHeaderOffset, "local header disagrees with central directory");
  const usesDescriptor = (flags & 8) !== 0;
  if ((!usesDescriptor || crc32 !== 0) && crc32 !== entry.crc32
    || (!usesDescriptor || compressedSize !== 0) && compressedSize !== entry.compressedSize
    || (!usesDescriptor || byteLength !== 0) && byteLength !== entry.byteLength) {
    throw new ArchiveError(source, entry.localHeaderOffset, "local sizes or CRC disagree with central directory");
  }
  const nameLength = view.getUint16(26, true);
  const extraLength = view.getUint16(28, true);
  return { nameLength, byteLength: nameLength + extraLength };
}

export function zipDataOffset(variable: Uint8Array, nameLength: number, source: string,
  centralOffset: number, entry: ZipEntry): number {
  if (byteString(variable.subarray(0, nameLength)) !== entry.rawPath) throw new ArchiveError(source, entry.localHeaderOffset, "local entry name disagrees with central directory");
  const dataOffset = entry.localHeaderOffset + 30 + variable.byteLength;
  checkRange(source, centralOffset, dataOffset, entry.compressedSize);
  return dataOffset;
}

export function decodeZipEntry(compressed: Uint8Array, source: string, dataOffset: number, entry: ZipEntry): Uint8Array {
  let output: Uint8Array;
  try {
    output = entry.compressionMethod === 0 ? compressed
      : new Uint8Array(inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.byteLength) }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ArchiveError(source, dataOffset, `DEFLATE failed: ${message}`);
  }
  if (output.byteLength !== entry.byteLength) throw new ArchiveError(source, dataOffset, `decoded size ${output.byteLength} disagrees with ${entry.byteLength}`);
  if (Bun.hash.crc32(output) !== entry.crc32) throw new ArchiveError(source, dataOffset, "entry CRC32 mismatch");
  return output;
}
