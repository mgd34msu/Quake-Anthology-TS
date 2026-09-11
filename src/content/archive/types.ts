import type { ArchiveFormat } from "../../contracts/content.ts";

interface EntryMetadata {
  readonly ordinal: number;
  /** Separators and internal parent segments are normalized; case is retained. */
  readonly path: string;
  readonly rawPath: string;
  readonly byteLength: number;
  readonly compressedSize: number;
  readonly isDirectory: boolean;
}

export interface PakEntry extends EntryMetadata {
  readonly format: "pak";
  readonly compressionMethod: 0;
  readonly dataOffset: number;
}

export interface ZipEntry extends EntryMetadata {
  readonly format: Exclude<ArchiveFormat, "pak">;
  readonly compressionMethod: 0 | 8;
  readonly flags: number;
  readonly crc32: number;
  readonly localHeaderOffset: number;
}

export type ArchiveEntry = PakEntry | ZipEntry;
export type ArchivePathComparison = "exact" | "ascii-insensitive";

export interface ArchiveHandle {
  readonly format: ArchiveFormat;
  readonly source: string;
  readonly byteLength: number;
  readonly entries: readonly ArchiveEntry[];
  findEntries(path: string, comparison?: ArchivePathComparison): readonly ArchiveEntry[];
  readEntry(entry: ArchiveEntry | number): Promise<Uint8Array>;
  close(): void;
}

export interface MemoryArchiveHandle extends ArchiveHandle {
  readEntrySync(entry: ArchiveEntry | number): Uint8Array;
}

export class ArchiveError extends Error {
  constructor(readonly source: string, readonly offset: number, message: string) {
    super(`${source}:${offset}: ${message}`);
    this.name = "ArchiveError";
  }
}

export function checkRange(source: string, size: number, offset: number, length: number): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length)
    || offset < 0 || length < 0 || offset > size - length) {
    throw new ArchiveError(source, offset, `range of ${length} bytes exceeds ${size}-byte source`);
  }
}

export function normalizeEntryPath(path: string): string {
  const separated = path.replaceAll("\\", "/");
  const candidate = separated.endsWith("/") ? separated.slice(0, -1) : separated;
  if (candidate.length === 0 || candidate.includes("\0") || candidate.includes(":")
    || candidate.split("/").some(part => part === "" || part === ".")) {
    throw new RangeError(`Unsafe archive member path: ${JSON.stringify(path)}`);
  }
  const parts: string[] = [];
  for (const part of candidate.split("/")) {
    if (part === "..") {
      if (parts.length === 0) throw new RangeError(`Unsafe archive member path: ${JSON.stringify(path)}`);
      parts.pop();
    } else parts.push(part);
  }
  if (parts.length === 0) throw new RangeError(`Unsafe archive member path: ${JSON.stringify(path)}`);
  return parts.join("/") + (separated.endsWith("/") ? "/" : "");
}

export function compareEntryPath(path: string, comparison: ArchivePathComparison): string {
  const normalized = normalizeEntryPath(path);
  return comparison === "exact" ? normalized : normalized.replace(/[A-Z]/g, character => character.toLowerCase());
}
