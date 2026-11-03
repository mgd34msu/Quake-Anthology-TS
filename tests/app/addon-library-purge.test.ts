// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AddonLibrary } from "../../src/app/bootstrap/addon-library.ts";
import { literal } from "../support/literal.ts";

const exists = async (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

test("a removed add-on's directory, cached package and tombstone are deleted at the next start", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-addon-purge-"));
  try {
    const hidden = `qd_${"a".repeat(20)}_${"b".repeat(20)}`,
      kept = `qd_${"c".repeat(20)}_${"d".repeat(20)}`,
      sha256 = "e".repeat(64),
      keptSha = "f".repeat(64);
    for (const [name, digest] of literal([
      [hidden, sha256],
      [kept, keptSha],
    ])) {
      await mkdir(join(root, "q1", name), { recursive: true });
      await writeFile(join(root, "q1", name, ".quaddicted.json"), JSON.stringify({ sha256: digest, title: name, group: name, start: null }));
      await mkdir(join(root, ".addons"), { recursive: true });
      await writeFile(join(root, ".addons", `${digest}.zip`), "package");
    }
    await mkdir(join(root, ".addons", "removed", "q1"), { recursive: true });
    await writeFile(join(root, ".addons", "removed", "q1", hidden), "");
    const library = new AddonLibrary({ root, changed: async () => undefined, launch: () => undefined });
    await library["readInstalled"]();
    expect(await exists(join(root, "q1", hidden))).toBe(false);
    expect(await exists(join(root, ".addons", `${sha256}.zip`))).toBe(false);
    expect(await exists(join(root, ".addons", "removed", "q1", hidden))).toBe(false);
    expect(await exists(join(root, "q1", kept, ".quaddicted.json"))).toBe(true);
    expect(await exists(join(root, ".addons", `${keptSha}.zip`))).toBe(true);
    await library.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
