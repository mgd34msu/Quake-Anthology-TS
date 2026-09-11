import { closeSync, fstatSync, openSync } from "node:fs";
import { ArchiveError, checkRange } from "./types.ts";

export class MemorySource {
  readonly kind = "memory";
  private readonly bytes: Uint8Array;
  private closed = false;

  constructor(bytes: Uint8Array, readonly source = "<memory>") {
    this.bytes = new Uint8Array(bytes);
  }

  get byteLength(): number { return this.bytes.byteLength; }

  readSync(offset: number, length: number): Uint8Array {
    if (this.closed) throw new ArchiveError(this.source, offset, "archive is closed");
    checkRange(this.source, this.byteLength, offset, length);
    return this.bytes.slice(offset, offset + length);
  }

  async read(offset: number, length: number): Promise<Uint8Array> { return this.readSync(offset, length); }
  close(): void { this.closed = true; }
}

/** A retained descriptor keeps path replacements from changing an open archive. */
export class FileSource {
  readonly kind = "file";
  readonly byteLength: number;
  private readonly descriptor: number;
  private readonly file: Bun.BunFile;
  private readonly modified: bigint;
  private readonly changed: bigint;
  private closed = false;
  private activeReads = 0;

  constructor(readonly source: string) {
    const descriptor = openSync(source, "r");
    try {
      const info = fstatSync(descriptor, { bigint: true });
      const byteLength = Number(info.size);
      if (!info.isFile() || !Number.isSafeInteger(byteLength)) throw new ArchiveError(source, 0, "expected a regular file with a safe byte length");
      this.byteLength = byteLength;
      this.modified = info.mtimeNs;
      this.changed = info.ctimeNs;
      this.descriptor = descriptor;
      this.file = Bun.file(descriptor);
    } catch (error) {
      closeSync(descriptor);
      throw error;
    }
  }

  private verifyUnchanged(offset: number): void {
    const info = fstatSync(this.descriptor, { bigint: true });
    if (info.size !== BigInt(this.byteLength) || info.mtimeNs !== this.modified || info.ctimeNs !== this.changed) {
      throw new ArchiveError(this.source, offset, "source changed after it was opened");
    }
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    if (this.closed) throw new ArchiveError(this.source, offset, "archive is closed");
    checkRange(this.source, this.byteLength, offset, length);
    this.verifyUnchanged(offset);
    this.activeReads++;
    try {
      const bytes = new Uint8Array(await this.file.slice(offset, offset + length).arrayBuffer());
      this.verifyUnchanged(offset);
      if (bytes.byteLength !== length) throw new ArchiveError(this.source, offset, `short read: expected ${length}, got ${bytes.byteLength}`);
      return bytes;
    } finally {
      this.activeReads--;
      if (this.closed && this.activeReads === 0) closeSync(this.descriptor);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.activeReads === 0) closeSync(this.descriptor);
  }
}

export type ArchiveSource = MemorySource | FileSource;
