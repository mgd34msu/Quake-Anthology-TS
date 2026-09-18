import { extname } from "node:path";
import type { ArchiveFormat } from "../../contracts/content.ts";
import { readPakDirectory, readPakHeader } from "./pak.ts";
import { FileSource, MemorySource } from "./source.ts";
import type { ArchiveSource } from "./source.ts";
import { ArchiveError, compareEntryPath } from "./types.ts";
import type { ArchiveEntry, ArchiveHandle, ArchivePathComparison, MemoryArchiveHandle } from "./types.ts";
import { decodeZipEntry, readZipDirectory, readZipLocalHeader, readZipTail, ZIP_TAIL_LENGTH, zipDataOffset } from "./zip.ts";

export { ArchiveError, normalizeEntryPath } from "./types.ts";
export { openLooseEntry, readLooseEntry } from "./loose.ts";
export type { LooseEntryHandle } from "./loose.ts";
export type { ArchiveEntry, ArchiveHandle, ArchivePathComparison, MemoryArchiveHandle, PakEntry, ZipEntry } from "./types.ts";

class OpenArchive implements ArchiveHandle {
  readonly source: string;
  readonly byteLength: number;
  private readonly entryIndexes = new Map<ArchivePathComparison, ReadonlyMap<string, readonly ArchiveEntry[]>>();

  constructor(protected readonly storage: ArchiveSource, readonly format: ArchiveFormat,
    readonly entries: readonly ArchiveEntry[], protected readonly centralOffset: number) {
    this.source = storage.source;
    this.byteLength = storage.byteLength;
  }

  findEntries(path: string, comparison: ArchivePathComparison = "exact"): readonly ArchiveEntry[] {
    const key = compareEntryPath(path, comparison);
    let index = this.entryIndexes.get(comparison);
    if (index === undefined) {
      const created = new Map<string, ArchiveEntry[]>();
      for (const entry of this.entries) {
        const name = compareEntryPath(entry.path, comparison), matches = created.get(name);
        if (matches === undefined) created.set(name, [entry]);
        else matches.push(entry);
      }
      for (const matches of created.values()) Object.freeze(matches);
      index = created;
      this.entryIndexes.set(comparison, index);
    }
    return index.get(key) ?? [];
  }

  protected select(requested: ArchiveEntry | number): ArchiveEntry {
    const ordinal = typeof requested === "number" ? requested : requested.ordinal;
    const entry = this.entries[ordinal];
    if (!Number.isSafeInteger(ordinal) || entry === undefined
      || typeof requested !== "number" && requested !== entry) {
      throw new ArchiveError(this.source, 0, `entry ${ordinal} does not belong to this archive`);
    }
    if (entry.isDirectory) throw new ArchiveError(this.source, 0, `entry ${ordinal} is a directory`);
    return entry;
  }

  async readEntry(requested: ArchiveEntry | number): Promise<Uint8Array> {
    const entry = this.select(requested);
    if (entry.format === "pak") return this.storage.read(entry.dataOffset, entry.byteLength);
    const header = readZipLocalHeader(await this.storage.read(entry.localHeaderOffset, 30), this.source, entry);
    const variable = await this.storage.read(entry.localHeaderOffset + 30, header.byteLength);
    const offset = zipDataOffset(variable, header.nameLength, this.source, this.centralOffset, entry);
    return decodeZipEntry(await this.storage.read(offset, entry.compressedSize), this.source, offset, entry);
  }

  close(): void { this.entryIndexes.clear(); this.storage.close(); }
}

class DecodedArchive extends OpenArchive implements MemoryArchiveHandle {
  constructor(private readonly memory: MemorySource, format: ArchiveFormat,
    entries: readonly ArchiveEntry[], centralOffset: number) {
    super(memory, format, entries, centralOffset);
  }

  readEntrySync(requested: ArchiveEntry | number): Uint8Array {
    const entry = this.select(requested);
    if (entry.format === "pak") return this.memory.readSync(entry.dataOffset, entry.byteLength);
    const header = readZipLocalHeader(this.memory.readSync(entry.localHeaderOffset, 30), this.source, entry);
    const variable = this.memory.readSync(entry.localHeaderOffset + 30, header.byteLength);
    const offset = zipDataOffset(variable, header.nameLength, this.source, this.centralOffset, entry);
    return decodeZipEntry(this.memory.readSync(offset, entry.compressedSize), this.source, offset, entry);
  }
}

function detectFormat(header: Uint8Array, source: string): ArchiveFormat {
  if (header[0] === 80 && header[1] === 65 && header[2] === 67 && header[3] === 75) return "pak";
  const extension = extname(source).toLowerCase();
  if (extension === ".pk3") return "pk3";
  if (extension === ".kpf") return "kpf";
  if (extension === ".pak") return "pak";
  return "zip";
}

/** Copies the input so later caller mutations cannot replace retained entry bytes. */
export function decodeArchive(bytes: Uint8Array, format?: ArchiveFormat, source = "<memory>"): MemoryArchiveHandle {
  const storage = new MemorySource(bytes, source);
  const header = storage.readSync(0, Math.min(12, storage.byteLength));
  const selected = format ?? detectFormat(header, source);
  if (selected === "pak") {
    const directory = readPakHeader(header, source, storage.byteLength);
    const entries = readPakDirectory(storage.readSync(directory.offset, directory.byteLength), source, storage.byteLength);
    return new DecodedArchive(storage, selected, entries, directory.offset);
  }
  const tailLength = Math.min(ZIP_TAIL_LENGTH, storage.byteLength);
  const directory = readZipTail(storage.readSync(storage.byteLength - tailLength, tailLength), source, storage.byteLength);
  const entries = readZipDirectory(storage.readSync(directory.offset, directory.byteLength), source, directory, selected);
  return new DecodedArchive(storage, selected, entries, directory.offset);
}

/** Reads only the header/tail and directory; asset payloads are read on demand. */
export async function openArchive(path: string, format?: ArchiveFormat): Promise<ArchiveHandle> {
  return openArchiveSource(new FileSource(path), format);
}

/** Takes ownership of the retained source, including on parse failure. */
export async function openArchiveSource(storage: ArchiveSource, format?: ArchiveFormat): Promise<ArchiveHandle> {
  const path = storage.source;
  try {
    const header = await storage.read(0, Math.min(12, storage.byteLength));
    const selected = format ?? detectFormat(header, path);
    if (selected === "pak") {
      const directory = readPakHeader(header, path, storage.byteLength);
      const entries = readPakDirectory(await storage.read(directory.offset, directory.byteLength), path, storage.byteLength);
      return new OpenArchive(storage, selected, entries, directory.offset);
    }
    const tailLength = Math.min(ZIP_TAIL_LENGTH, storage.byteLength);
    const directory = readZipTail(await storage.read(storage.byteLength - tailLength, tailLength), path, storage.byteLength);
    const entries = readZipDirectory(await storage.read(directory.offset, directory.byteLength), path, directory, selected);
    return new OpenArchive(storage, selected, entries, directory.offset);
  } catch (error) {
    storage.close();
    throw error;
  }
}

export function readEntry(archive: ArchiveHandle, entry: ArchiveEntry | number): Promise<Uint8Array> {
  return archive.readEntry(entry);
}
