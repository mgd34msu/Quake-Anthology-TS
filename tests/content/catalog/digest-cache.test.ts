import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { digestBytes, digestFile } from "../../../src/content/mounts/index.ts";

test("digestFile caches by fingerprint and rehashes rewritten files", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "digest-cache-"));
  try {
    const path = resolve(root, "archive.pak");
    const original = new TextEncoder().encode("original archive bytes");
    await writeFile(path, original);
    expect(await digestFile(path)).toBe(digestBytes(original));
    expect(await digestFile(path)).toBe(digestBytes(original)); // fingerprint cache hit
    await Bun.sleep(5);
    const modified = new TextEncoder().encode("modified archive bytes"); // same length, new fingerprint
    await writeFile(path, modified);
    expect(await digestFile(path)).toBe(digestBytes(modified));
    expect(await digestFile(path)).not.toBe(digestBytes(original));
  } finally { await rm(root, { recursive: true, force: true }); }
});
