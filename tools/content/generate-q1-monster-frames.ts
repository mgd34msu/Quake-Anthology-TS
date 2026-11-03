// SPDX-License-Identifier: GPL-2.0-or-later
// Regenerates the Quake monster frame tables from the shipped rerelease progs.dat files.
// Usage: bun tools/content/generate-q1-monster-frames.ts <quake root> [--check]
// <quake root> contains id1/ and the rerelease/<product>/pak0.pak archives. With --check nothing is written
// and the exit status reports whether the committed tables equal the generated ones.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openArchive } from "../../src/content/archive/index.ts";
import { FRAME_TABLE_TARGETS, renderTarget } from "./q1-frame-tables.ts";

const [root, flag] = process.argv.slice(2);
if (root === undefined) throw new Error("Usage: generate-q1-monster-frames.ts <quake root> [--check]");
const repository = resolve(import.meta.dir, "../..");
const archives = new Map<string, Uint8Array>();
let stale = 0;
for (const target of FRAME_TABLE_TARGETS) {
  let progs = archives.get(target.archive);
  if (progs === undefined) {
    const archive = await openArchive(resolve(root, target.archive));
    try {
      const entry = archive.findEntries("progs.dat").at(-1);
      if (entry === undefined) throw new Error(`${target.archive} has no progs.dat`);
      progs = await archive.readEntry(entry);
    } finally {
      archive.close();
    }
    archives.set(target.archive, progs);
  }
  const text = renderTarget(target, progs),
    path = resolve(repository, target.output);
  if (flag === "--check") {
    if (readFileSync(path, "utf8") !== text) {
      stale++;
      console.log(`stale: ${target.output}`);
    }
  } else writeFileSync(path, text);
}
if (flag === "--check" && stale !== 0) process.exit(1);
