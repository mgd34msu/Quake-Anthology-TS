import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContentDigest } from "../../../src/contracts/content.ts";
import { DownloadSink } from "../../../src/network/services/downloads.ts";
import type { DownloadSpan } from "../../../src/network/services/downloads.ts";

const bounded = { kind: "protocol-completion", maximumBytes: 1024 * 1024 } satisfies Parameters<typeof DownloadSink.create>[2];

test("ranged staging assembles interleaved spans and hashes the file in byte order", async () => {
  const root = mkdtempSync(join(tmpdir(), "download-ranges-"));
  const bytes = Uint8Array.from({ length: 200_003 }, (_, index) => index * 37 % 251);
  const digest = createContentDigest(createHash("sha256").update(bytes).digest("hex"));
  const sink = DownloadSink.createRanged(root, "archive.pk3", { digest, byteLength: bytes.length }, bytes.length,
    [{ start: 120_000, end: bytes.length - 1 }, { start: 0, end: 49_999 }, { start: 50_000, end: 119_999 }]);
  try {
    sink.appendRange(120_000, bytes.subarray(120_000));
    sink.appendRange(50_000, bytes.subarray(50_000, 70_000));
    expect(sink.byteLength).toBe(100_003);
    await expect(sink.inspectStaged(async () => { throw new Error("Must not inspect incomplete ranges"); })).rejects.toThrow("incomplete");
    sink.appendRange(0, bytes.subarray(0, 49_999));
    sink.appendRange(50_000, bytes.subarray(70_000, 120_000));
    sink.appendRange(0, bytes.subarray(49_999, 50_000));
    expect(sink.byteLength).toBe(bytes.length);
    expect(readdirSync(root)).toHaveLength(1);
    await sink.inspectStaged(async path => {
      expect(readFileSync(path)).toEqual(Buffer.from(bytes));
      expect(() => sink.appendRange(0, new Uint8Array())).toThrow("inspection");
    });
    expect(sink.finish()).toBe(digest);
    expect(readFileSync(join(root, "archive.pk3"))).toEqual(Buffer.from(bytes));
    expect(readdirSync(root)).toEqual(["archive.pk3"]);
  } finally { sink.close(); rmSync(root, { recursive: true, force: true }); }
});

test("range partitions and declared limits reject missing overlapping duplicate or unsafe spans before staging", () => {
  const root = mkdtempSync(join(tmpdir(), "download-range-invalid-"));
  const partitions: readonly (readonly DownloadSpan[])[] = [
    [], [{ start: 1, end: 3 }], [{ start: 0, end: 1 }, { start: 3, end: 3 }],
    [{ start: 0, end: 2 }, { start: 2, end: 3 }], [{ start: 0, end: 3 }, { start: 0, end: 3 }],
    [{ start: 0, end: 4 }], [{ start: 0, end: -1 }], [{ start: 0, end: Number.MAX_SAFE_INTEGER }],
    [{ start: 0, end: 1.5 }, { start: 2.5, end: 3 }],
  ];
  try {
    for (const spans of partitions) expect(() => DownloadSink.createRanged(root, "bad", bounded, 4, spans)).toThrow();
    for (const total of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => DownloadSink.createRanged(root, "bad", bounded, total, [])).toThrow();
    expect(() => DownloadSink.createRanged(root, "bad", { kind: "protocol-completion", maximumBytes: 3 }, 4, [{ start: 0, end: 3 }])).toThrow();
    expect(() => DownloadSink.createRanged(root, "bad", { kind: "protocol-completion", maximumBytes: Number.NaN }, 0, [])).toThrow();
    const digest = createContentDigest("0".repeat(64));
    expect(() => DownloadSink.createRanged(root, "bad", { digest, byteLength: 5 }, 4, [{ start: 0, end: 3 }])).toThrow();
    expect(readdirSync(root)).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("ranged writes reject oversize unknown and sequential calls without changing byte count", () => {
  const root = mkdtempSync(join(tmpdir(), "download-range-bounds-"));
  const sink = DownloadSink.createRanged(root, "ranged", bounded, 4, [{ start: 0, end: 1 }, { start: 2, end: 3 }]);
  const ordinary = DownloadSink.create(root, "ordinary", bounded);
  try {
    expect(() => sink.append(new Uint8Array([1]))).toThrow("appendRange");
    expect(() => ordinary.appendRange(0, new Uint8Array([1]))).toThrow("append");
    expect(() => sink.appendRange(1, new Uint8Array([1]))).toThrow("Unknown");
    expect(() => sink.appendRange(0, new Uint8Array([1, 2, 3]))).toThrow("span size");
    expect(sink.byteLength).toBe(0);
    sink.appendRange(0, new Uint8Array([1, 2]));
    expect(() => sink.appendRange(0, new Uint8Array([3]))).toThrow("span size");
    expect(sink.byteLength).toBe(2);
    expect(() => sink.finish()).toThrow("incomplete");
    ordinary.close();
    expect(readdirSync(root)).toEqual([]);
  } finally { sink.close(); ordinary.close(); rmSync(root, { recursive: true, force: true }); }
});

test("ranged publication retains installed destinations and cleans cancelled or mismatched staging", () => {
  const root = mkdtempSync(join(tmpdir(), "download-range-cleanup-"));
  writeFileSync(join(root, "installed"), "keep");
  try {
    const conflict = DownloadSink.createRanged(root, "installed", bounded, 2, [{ start: 0, end: 1 }]);
    conflict.appendRange(0, new Uint8Array([1, 2]));
    expect(() => conflict.finish()).toThrow();
    expect(readFileSync(join(root, "installed"), "utf8")).toBe("keep");
    const cancelled = DownloadSink.createRanged(root, "cancelled", bounded, 4, [{ start: 0, end: 1 }, { start: 2, end: 3 }]);
    cancelled.appendRange(2, new Uint8Array([3])); cancelled.close(); cancelled.close();
    expect(() => cancelled.appendRange(0, new Uint8Array([1]))).toThrow("closed");
    const mismatch = DownloadSink.createRanged(root, "mismatch", { digest: createContentDigest("0".repeat(64)), byteLength: 1 }, 1, [{ start: 0, end: 0 }]);
    mismatch.appendRange(0, new Uint8Array([1])); expect(() => mismatch.finish()).toThrow("checksum");
    expect(readdirSync(root)).toEqual(["installed"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("empty ranged files complete with the standard empty digest", async () => {
  const root = mkdtempSync(join(tmpdir(), "download-range-empty-"));
  const sink = DownloadSink.createRanged(root, "empty", bounded, 0, []);
  try {
    await sink.inspectStaged(async path => { expect(readFileSync(path).length).toBe(0); });
    expect(sink.finish()).toBe(createContentDigest(createHash("sha256").digest("hex")));
    expect(readFileSync(join(root, "empty")).length).toBe(0);
  } finally { sink.close(); rmSync(root, { recursive: true, force: true }); }
});
