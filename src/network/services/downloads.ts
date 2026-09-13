// Download windows adapted from Quake III sv_client.c. GPL-2.0-or-later.
import { closeSync, constants, fstatSync, linkSync, mkdirSync, openSync, readSync, unlinkSync, writeSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import type { Hash } from "node:crypto";
import type { ContentDigest } from "../../contracts/content.ts";
import { createContentDigest } from "../../contracts/content.ts";
import { isReadableStream } from "../common/value.ts";

export function downloadPath(name: string): readonly string[] {
  const parts = name.split("/");
  if (name.length === 0 || name.includes("\\") || name.includes("\0") || name.includes(":" ) || parts.some(part => part.length === 0 || part === "." || part === "..")) throw new RangeError("Download needs a contained relative path");
  return parts;
}
function isExists(error: unknown): boolean { return error instanceof Error && "code" in error && error.code === "EEXIST"; }

/** Linux directory descriptors keep all child operations anchored despite path renames. */
function openParent(root: string, name: string, create: boolean): { readonly descriptor: number; readonly leaf: string } {
  if (process.platform !== "linux") throw new Error("Contained download storage currently requires Linux directory descriptors");
  const parts = downloadPath(name), leaf = parts.at(-1);
  if (leaf === undefined) throw new RangeError("Download has no filename");
  let descriptor = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    for (const part of parts.slice(0, -1)) {
      const path = `/proc/self/fd/${descriptor}/${part}`;
      if (create) { try { mkdirSync(path); } catch (error) { if (!isExists(error)) throw error; } }
      const next = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      closeSync(descriptor); descriptor = next;
    }
    return { descriptor, leaf };
  } catch (error) { closeSync(descriptor); throw error; }
}

export interface DownloadSource {
  readonly byteLength: number;
  read(offset: number, maxBytes: number): Uint8Array;
  close(): void;
}
export class DownloadFile implements DownloadSource {
  private ended = false;
  private constructor(private readonly descriptor: number, readonly byteLength: number) {}
  static open(root: string, name: string): DownloadFile {
    const parent = openParent(root, name, false);
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
export class DownloadSink {
  private readonly hash: Hash = createHash("sha256");
  private count = 0;
  private ended = false;
  private inspecting = false;
  private constructor(private readonly parent: number, private readonly descriptor: number, private readonly temporary: string,
    private readonly target: string, readonly expected: DownloadExpectation | ProtocolDownloadExpectation) {}
  static create(root: string, name: string, expected: DownloadExpectation | ProtocolDownloadExpectation): DownloadSink {
    const limit = "kind" in expected ? expected.maximumBytes : expected.byteLength;
    if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError("Invalid download size");
    const parent = openParent(root, name, true), temporary = `.download-${randomUUID()}`;
    try {
      const descriptor = openSync(`/proc/self/fd/${parent.descriptor}/${temporary}`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      return new DownloadSink(parent.descriptor, descriptor, temporary, parent.leaf, expected);
    } catch (error) { closeSync(parent.descriptor); throw error; }
  }
  get byteLength(): number { return this.count; }
  append(bytes: Uint8Array): void {
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
  finish(): ContentDigest {
    if (this.ended) throw new Error("Download sink is closed");
    if (this.inspecting) throw new Error("Download inspection is in progress");
    try {
      if (!("kind" in this.expected) && this.count !== this.expected.byteLength) throw new Error("Download size differs from content identity");
      const digest = createContentDigest(this.hash.digest("hex"));
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
    const retained = openSync(`/proc/self/fd/${this.descriptor}`, constants.O_RDONLY);
    this.inspecting = true;
    try {
      await inspect(`/proc/self/fd/${retained}`);
      if (this.ended) throw new Error("Download sink closed during inspection");
    } catch (error) { this.close(); throw error; }
    finally { this.inspecting = false; closeSync(retained); }
  }
  close(): void {
    if (this.ended) return;
    this.ended = true;
    try { closeSync(this.descriptor); }
    finally { try { unlinkSync(`/proc/self/fd/${this.parent}/${this.temporary}`); } finally { closeSync(this.parent); } }
  }
}

export interface DownloadBlock { readonly index: number; readonly totalBytes: number | null; readonly bytes: Uint8Array; }
export class DownloadWindow {
  private readonly blocks = new Map<number, Uint8Array>();
  private readOffset = 0;
  private currentBlock = 0;
  private clientBlock = 0;
  private transmitBlock = 0;
  private eof = false;
  private ended = false;
  private sendTime = 0;
  constructor(readonly source: DownloadSource, readonly blockBytes = 2048, readonly windowBlocks = 8) {
    if (!Number.isSafeInteger(blockBytes) || blockBytes < 1 || !Number.isSafeInteger(windowBlocks) || windowBlocks < 1) throw new RangeError("Invalid download window");
  }
  get closed(): boolean { return this.ended; }
  packets(now: number, count: number): readonly DownloadBlock[] {
    if (this.ended) throw new Error("Download window is closed");
    while (this.currentBlock - this.clientBlock < this.windowBlocks && this.readOffset < this.source.byteLength) {
      const bytes = this.source.read(this.readOffset, this.blockBytes);
      if (bytes.length === 0) throw new Error("Unexpected download EOF");
      this.blocks.set(this.currentBlock++, bytes); this.readOffset += bytes.length;
    }
    if (this.readOffset === this.source.byteLength && !this.eof && this.currentBlock - this.clientBlock < this.windowBlocks) {
      this.blocks.set(this.currentBlock++, new Uint8Array(0)); this.eof = true;
    }
    const packets: DownloadBlock[] = [];
    while (count-- > 0 && this.clientBlock !== this.currentBlock) {
      if (this.transmitBlock === this.currentBlock) {
        if (now - this.sendTime <= 1000) break;
        this.transmitBlock = this.clientBlock;
      }
      const bytes = this.blocks.get(this.transmitBlock);
      if (bytes === undefined) throw new Error("Download block was not retained");
      packets.push({ index: this.transmitBlock, totalBytes: this.transmitBlock === 0 ? this.source.byteLength : null, bytes: bytes.slice() });
      this.transmitBlock++; this.sendTime = now;
    }
    return packets;
  }
  acknowledge(block: number, now: number): "continue" | "complete" {
    if (this.ended || block !== this.clientBlock || block >= this.transmitBlock) throw new Error("Broken download acknowledgement");
    const bytes = this.blocks.get(block);
    if (bytes === undefined) throw new Error("Missing download block");
    this.blocks.delete(block);
    if (bytes.length === 0) { this.close(); return "complete"; }
    this.clientBlock++; this.sendTime = now; return "continue";
  }
  close(): void { if (!this.ended) { this.ended = true; this.blocks.clear(); this.source.close(); } }
}

export async function downloadHttp(url: URL, sink: DownloadSink, signal?: AbortSignal): Promise<ContentDigest> {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new RangeError("Downloads require HTTP or HTTPS");
  try {
    const response = await fetch(url, { redirect: "error", ...(signal === undefined ? {} : { signal }) });
    const body: unknown = response.body;
    if (!response.ok || !isReadableStream(body)) throw new Error(`Download HTTP status ${response.status}`);
    const reader = body.getReader();
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        if (!(result.value instanceof Uint8Array)) throw new TypeError("HTTP download supplied a non-byte chunk");
        sink.append(result.value);
      }
    } catch (error) { await reader.cancel(); throw error; }
    finally { reader.releaseLock(); }
    return sink.finish();
  } catch (error) { sink.close(); throw error; }
}

export function verifyPureContent(required: readonly ContentDigest[], available: ReadonlySet<ContentDigest>): readonly ContentDigest[] {
  return required.filter(digest => !available.has(digest));
}
