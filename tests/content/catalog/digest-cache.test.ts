import { expect, spyOn, test } from "bun:test";
import * as fsPromises from "node:fs/promises";
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
    // Each hash of file contents opens the file; a fingerprint hit must not.
    const opens = spyOn(fsPromises, "open");
    try {
      expect(await digestFile(path)).toBe(digestBytes(original));
      expect(opens.mock.calls.filter(call => call[0] === path)).toHaveLength(1);
      expect(await digestFile(path)).toBe(digestBytes(original));
      expect(opens.mock.calls.filter(call => call[0] === path)).toHaveLength(1);
      await Bun.sleep(5);
      const modified = new TextEncoder().encode("modified archive bytes"); // same length, new fingerprint
      await writeFile(path, modified);
      expect(await digestFile(path)).toBe(digestBytes(modified));
      expect(opens.mock.calls.filter(call => call[0] === path)).toHaveLength(2);
      expect(await digestFile(path)).not.toBe(digestBytes(original));
    } finally { opens.mockRestore(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
