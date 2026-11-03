// Download windows adapted from Quake III sv_client.c. GPL-2.0-or-later.
import { closeSync, constants, fstatSync, linkSync, openSync, readFileSync, readSync, unlinkSync, writeSync } from "node:fs";
import { openContainedParent } from "../../core/files/contained.ts";
export { containedFileParts as downloadPath } from "../../core/files/contained.ts";
import { createHash, randomUUID } from "node:crypto";
import type { Hash } from "node:crypto";
import type { ContentDigest } from "../../contracts/content.ts";
import { createContentDigest } from "../../contracts/content.ts";

export interface DownloadSource {
  readonly byteLength: number;
  read(offset: number, maxBytes: number): Uint8Array;
  close(): void;
}
export class DownloadFile implements DownloadSource {
  private ended = false;
  private constructor(private readonly descriptor: number, readonly byteLength: number) {}
  static open(root: string, name: string): DownloadFile {
    const parent = openContainedParent(root, name, false);
    try {
      const descriptor = openSync(`/proc/self/fd/${parent.descriptor}/${parent.leaf}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const info = fstatSync(descriptor);
        if (!info.isFile() || !Number.isSafeInteger(info.size)) throw new Error("Download source is not a regular bounded file");
        return new DownloadFile(descriptor, info.size);
      } catch (error) { closeSync(descriptor); throw error; }
    } finally { closeSync(parent.descriptor); }
  }
  read(offset: number, maxBytes: number): Uint8Array {
    if (this.ended) throw new Error("Download source is closed");
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > this.byteLength || !Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError("Invalid download range");
    if (fstatSync(this.descriptor).size !== this.byteLength) throw new Error("Download changed size while open");
    const bytes = new Uint8Array(Math.min(maxBytes, this.byteLength - offset));
    let read = 0;
    while (read < bytes.length) {
      const count = readSync(this.descriptor, bytes, read, bytes.length - read, offset + read);
      if (count === 0) throw new Error("Unexpected download EOF");
      read += count;
    }
    return bytes;
  }
  close(): void { if (!this.ended) { this.ended = true; closeSync(this.descriptor); } }
}

export interface DownloadExpectation { readonly digest: ContentDigest; readonly byteLength: number; }
export interface ProtocolDownloadExpectation { readonly kind: "protocol-completion"; readonly maximumBytes: number; }
export interface DownloadSpan { readonly start: number; readonly end: number; }
type DownloadWriteMode = { readonly kind: "sequential" }
  | { readonly kind: "ranged"; readonly total: number; readonly spans: ReadonlyMap<number, { readonly end: number; written: number }> };
export class DownloadSink {
  private readonly hash: Hash = createHash("sha256");
  private count = 0;
  private ended = false;
  private inspecting = false;
  private suspended = false;
  /** Bytes already staged and hash-verified when the sink continues an interrupted download. */
  readonly resumedFrom: number;
  private constructor(private readonly parent: number, private readonly descriptor: number, private readonly temporary: string,
    private readonly target: string, readonly expected: DownloadExpectation | ProtocolDownloadExpectation, private readonly mode: DownloadWriteMode,
    private readonly resumable = false, seed: { readonly hash: Hash; readonly count: number } | null = null) {
    if (seed !== null) { this.hash = seed.hash; this.count = seed.count; }
    this.resumedFrom = this.count;
  }
  /**
   * Stage under a stable `<name>.part` with a `.part.sha256` record so an interrupted transfer can continue.
   * A partial file is reused only when its length and SHA-256 match the record; anything else is discarded.
   */
  static resumable(root: string, name: string, expected: ProtocolDownloadExpectation): DownloadSink {
    if (!Number.isSafeInteger(expected.maximumBytes) || expected.maximumBytes < 0) throw new RangeError("Invalid download size");
    const parent = openContainedParent(root, name, true), partial = `${parent.leaf}.part`;
    try {
      const reused = reopenPartial(parent.descriptor, partial, expected.maximumBytes);
      if (reused !== null) return new DownloadSink(parent.descriptor, reused.descriptor, partial, parent.leaf, expected, { kind: "sequential" }, true, reused);
      const descriptor = openSync(`/proc/self/fd/${parent.descriptor}/${partial}`, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      return new DownloadSink(parent.descriptor, descriptor, partial, parent.leaf, expected, { kind: "sequential" }, true);
    } catch (error) { closeSync(parent.descriptor); throw error; }
  }
  static create(root: string, name: string, expected: DownloadExpectation | ProtocolDownloadExpectation): DownloadSink {
    return DownloadSink.open(root, name, expected, { kind: "sequential" });
  }
  static createRanged(root: string, name: string, expected: DownloadExpectation | ProtocolDownloadExpectation, total: number, spans: readonly DownloadSpan[]): DownloadSink {
    const limit = "kind" in expected ? expected.maximumBytes : expected.byteLength;
    if (!Number.isSafeInteger(limit) || limit < 0 || !Number.isSafeInteger(total) || total < 0 || total > limit
      || !("kind" in expected) && total !== expected.byteLength) throw new RangeError("Invalid ranged download size");
    const ranges = new Map<number, { readonly end: number; written: number }>();
    let next = 0;
    for (const span of [...spans].sort((left, right) => left.start - right.start)) {
      if (!Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) || span.start !== next || span.end < span.start || span.end >= total)
        throw new RangeError("Download spans must partition the complete file");
      ranges.set(span.start, { end: span.end, written: 0 }); next = span.end + 1;
    }
    if (next !== total) throw new RangeError("Download spans must partition the complete file");
    return DownloadSink.open(root, name, expected, { kind: "ranged", total, spans: ranges });
  }
  private static open(root: string, name: string, expected: DownloadExpectation | ProtocolDownloadExpectation, mode: DownloadWriteMode): DownloadSink {
    const limit = "kind" in expected ? expected.maximumBytes : expected.byteLength;
    if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError("Invalid download size");
    const parent = openContainedParent(root, name, true), temporary = `.download-${randomUUID()}`;
    try {
      const descriptor = openSync(`/proc/self/fd/${parent.descriptor}/${temporary}`, (mode.kind === "ranged" ? constants.O_RDWR : constants.O_WRONLY) | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      return new DownloadSink(parent.descriptor, descriptor, temporary, parent.leaf, expected, mode);
    } catch (error) { closeSync(parent.descriptor); throw error; }
  }
  get byteLength(): number { return this.count; }
  append(bytes: Uint8Array): void {
    if (this.mode.kind !== "sequential") throw new Error("Ranged downloads require appendRange");
    if (this.ended) throw new Error("Download sink is closed");
    if (this.inspecting) throw new Error("Download inspection is in progress");
    const limit = "kind" in this.expected ? this.expected.maximumBytes : this.expected.byteLength;
    if (this.count + bytes.length > limit) throw new RangeError("Download exceeds expected size");
    let written = 0;
    while (written < bytes.length) {
      const count = writeSync(this.descriptor, bytes, written, bytes.length - written);
      if (count === 0) throw new Error("Download write made no progress");
      written += count;
    }
    this.hash.update(bytes); this.count += bytes.length;
  }
  appendRange(spanStart: number, bytes: Uint8Array): void {
    if (this.mode.kind !== "ranged") throw new Error("Sequential downloads require append");
    if (this.ended) throw new Error("Download sink is closed");
    if (this.inspecting) throw new Error("Download inspection is in progress");
    const span = this.mode.spans.get(spanStart);
    if (span === undefined) throw new RangeError("Unknown download span");
    if (bytes.length > span.end - spanStart + 1 - span.written) throw new RangeError("Download exceeds span size");
    let written = 0;
    while (written < bytes.length) {
      const count = writeSync(this.descriptor, bytes, written, bytes.length - written, spanStart + span.written);
      if (count === 0) throw new Error("Download write made no progress");
      written += count; span.written += count; this.count += count;
    }
  }
  private requireCompleteRanges(): void {
    if (this.mode.kind !== "ranged") return;
    if (this.count !== this.mode.total || [...this.mode.spans].some(([start, span]) => span.written !== span.end - start + 1))
      throw new Error("Ranged download is incomplete");
    if (fstatSync(this.descriptor).size !== this.mode.total) throw new Error("Ranged download staged size changed");
  }
  private digest(): ContentDigest {
    if (this.mode.kind === "ranged") {
      const bytes = new Uint8Array(64 * 1024);
      let offset = 0;
      while (offset < this.mode.total) {
        const count = readSync(this.descriptor, bytes, 0, Math.min(bytes.length, this.mode.total - offset), offset);
        if (count === 0) throw new Error("Unexpected ranged download EOF");
        this.hash.update(bytes.subarray(0, count)); offset += count;
      }
    }
    return createContentDigest(this.hash.digest("hex"));
  }
  finish(): ContentDigest {
    if (this.ended) throw new Error("Download sink is closed");
    if (this.inspecting) throw new Error("Download inspection is in progress");
    try {
      this.requireCompleteRanges();
      if (!("kind" in this.expected) && this.count !== this.expected.byteLength) throw new Error("Download size differs from content identity");
      const digest = this.digest();
      if (!("kind" in this.expected) && digest !== this.expected.digest) throw new Error("Download checksum differs from content identity");
      // link fails if the destination exists, avoiding replacement of installed game assets.
      linkSync(`/proc/self/fd/${this.parent}/${this.temporary}`, `/proc/self/fd/${this.parent}/${this.target}`);
      return digest;
    } finally { this.close(); }
  }
  /** Inspect the retained inode before publication; cancellation still removes its staged name. */
  async inspectStaged(inspect: (path: string) => Promise<void>): Promise<void> {
    if (this.ended) throw new Error("Download sink is closed");
    if (this.inspecting) throw new Error("Download inspection is in progress");
    this.requireCompleteRanges();
    const retained = openSync(`/proc/self/fd/${this.descriptor}`, constants.O_RDONLY);
    this.inspecting = true;
    try {
      await inspect(`/proc/self/fd/${retained}`);
      if (this.ended) throw new Error("Download sink closed during inspection");
    } catch (error) { this.close(); throw error; }
    finally { this.inspecting = false; closeSync(retained); }
  }
  /** Keep the staged bytes and their hash record for a later resumable sink; other sinks are discarded. */
  suspend(): void {
    if (this.ended || this.inspecting || !this.resumable || this.count === 0) { this.close(); return; }
    try {
      const record = openSync(`/proc/self/fd/${this.parent}/${this.temporary}.sha256`, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
      try { writeSync(record, `${this.count} ${this.hash.copy().digest("hex")}\n`); } finally { closeSync(record); }
      this.suspended = true;
    } finally { this.close(); }
  }
  close(): void {
    if (this.ended) return;
    this.ended = true;
    try { closeSync(this.descriptor); }
    finally {
      try {
        if (!this.suspended) {
          unlinkIfPresent(`/proc/self/fd/${this.parent}/${this.temporary}`);
          if (this.resumable) unlinkIfPresent(`/proc/self/fd/${this.parent}/${this.temporary}.sha256`);
        }
      } finally { closeSync(this.parent); }
    }
  }
}

function unlinkIfPresent(path: string): void {
  try { unlinkSync(path); } catch (error) { if (!isMissing(error)) throw error; }
}
function isMissing(error: unknown): boolean { return error instanceof Error && "code" in error && error.code === "ENOENT"; }

/** Returns a descriptor positioned for appending, with the hash state of its verified prefix, or null after discarding a bad partial. */
function reopenPartial(parent: number, partial: string, limit: number): { readonly descriptor: number; readonly hash: Hash; readonly count: number } | null {
  const path = `/proc/self/fd/${parent}/${partial}`, record = `${path}.sha256`;
  let descriptor: number;
  try { descriptor = openSync(path, constants.O_RDWR | constants.O_APPEND | constants.O_NOFOLLOW); }
  catch (error) { if (isMissing(error)) { unlinkIfPresent(record); return null; } throw error; }
  try {
    const info = fstatSync(descriptor);
    let claimed: RegExpExecArray | null = null;
    try { claimed = /^(\d{1,15}) ([0-9a-f]{64})\n?$/.exec(readFileSync(record, "utf8")); } catch (error) { if (!isMissing(error)) throw error; }
    const hash = createHash("sha256");
    let verified = claimed !== null && info.isFile() && info.size === Number(claimed[1]) && info.size > 0 && info.size <= limit;
    if (verified) {
      const chunk = new Uint8Array(64 * 1024);
      for (let offset = 0; offset < info.size;) {
        const count = readSync(descriptor, chunk, 0, Math.min(chunk.length, info.size - offset), offset);
        if (count === 0) { verified = false; break; }
        hash.update(chunk.subarray(0, count)); offset += count;
      }
      verified &&= claimed !== null && hash.copy().digest("hex") === claimed[2];
    }
    if (verified) return { descriptor, hash, count: info.size };
    closeSync(descriptor);
    unlinkIfPresent(path); unlinkIfPresent(record);
    return null;
  } catch (error) { closeSync(descriptor); throw error; }
}
