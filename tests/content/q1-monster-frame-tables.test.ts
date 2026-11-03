// SPDX-License-Identifier: GPL-2.0-or-later
import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { corpusFile, corpusTest } from "../support/corpus.ts";
import { openArchive } from "../../src/content/archive/index.ts";
import { FRAME_TABLE_TARGETS, renderTarget } from "../../tools/content/q1-frame-tables.ts";

const archives = [...new Set(FRAME_TABLE_TARGETS.map(target => target.archive))];
corpusTest(...archives.map(archive => `q1/${archive}`))(
  "committed Q1 monster frame tables equal the tables generated from the shipped progs.dat files",
  async () => {
    const progs = new Map<string, Uint8Array>();
    for (const archive of archives) {
      const opened = await openArchive(corpusFile(`q1/${archive}`));
      try {
        const entry = opened.findEntries("progs.dat").at(-1);
        if (entry === undefined) throw new Error(`${archive} has no progs.dat`);
        progs.set(archive, await opened.readEntry(entry));
      } finally {
        opened.close();
      }
    }
    for (const target of FRAME_TABLE_TARGETS) {
      const bytes = progs.get(target.archive);
      if (bytes === undefined) throw new Error(`Missing ${target.archive}`);
      expect(readFileSync(resolve(import.meta.dir, "../..", target.output), "utf8"), target.output).toBe(renderTarget(target, bytes));
    }
  },
);
