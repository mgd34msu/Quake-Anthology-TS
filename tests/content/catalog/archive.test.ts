import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { decodeArchive, normalizeEntryPath, openArchive, openLooseEntry, readLooseEntry } from "../../../src/content/archive/index.ts";

function duplicatePak(): Uint8Array {
  const bytes = new Uint8Array(142);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("PACK"));
  view.setInt32(4, 14, true);
  view.setInt32(8, 128, true);
  bytes[12] = 41;
  bytes[13] = 42;
  for (let ordinal = 0; ordinal < 2; ordinal++) {
    const offset = 14 + ordinal * 64;
    bytes.set(new TextEncoder().encode("Models\\duplicate.mdl"), offset);
    view.setInt32(offset + 56, 12 + ordinal, true);
    view.setInt32(offset + 60, 1, true);
  }
  return bytes;
}

test("memory PAK retains duplicate ordinals, source spelling and owned bytes", async () => {
  const bytes = duplicatePak();
  const archive = decodeArchive(bytes);
  bytes[12] = 0;
  expect(archive.entries.map(entry => entry.ordinal)).toEqual([0, 1]);
  expect(archive.entries[0]?.rawPath).toBe("Models\\duplicate.mdl");
  expect(archive.findEntries("Models/duplicate.mdl")).toHaveLength(2);
  expect(archive.findEntries("models/duplicate.mdl")).toHaveLength(0);
  expect(archive.findEntries("models/duplicate.mdl", "ascii-insensitive")).toHaveLength(2);
  expect(archive.readEntrySync(0)).toEqual(new Uint8Array([41]));
  expect(await archive.readEntry(1)).toEqual(new Uint8Array([42]));
  expect(() => archive.readEntrySync(2)).toThrow("does not belong");
  archive.close();
  expect(() => archive.readEntrySync(0)).toThrow("closed");
  expect(() => decodeArchive(bytes.subarray(0, 100))).toThrow("exceeds");
  const unsafe = duplicatePak();
  unsafe.fill(0, 14, 70);
  unsafe.set(new TextEncoder().encode("../escape"), 14);
  expect(() => decodeArchive(unsafe)).toThrow("Unsafe archive member path");
  expect(normalizeEntryPath("models/monsters/tank/../ctank/skin.pcx")).toBe("models/monsters/ctank/skin.pcx");
});

test("loose reads stay within their root and reject changed retained bytes", async () => {
  const root = mkdtempSync(join(tmpdir(), "quake-archive-"));
  try {
    writeFileSync(join(root, "asset"), "first");
    expect(new TextDecoder().decode(await readLooseEntry(root, "asset"))).toBe("first");
    const retained = openLooseEntry(root, "asset");
    try {
      writeFileSync(join(root, "asset"), "changed");
      await expect(retained.read()).rejects.toThrow("source changed");
    } finally { retained.close(); }
    symlinkSync("/etc/passwd", join(root, "outside"));
    expect(() => openLooseEntry(root, "outside")).toThrow("escapes root");
    expect(() => openLooseEntry(root, "../outside")).toThrow("Unsafe archive member path");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const corpus = resolve(import.meta.dir, "../../../../qfiles");
const q3Archive = join(corpus, "q3a/baseq3/pak0.pk3");

test.skipIf(!existsSync(q3Archive))("parallel Sarge asset reads match sequential reads from one retained archive", async () => {
  const archive = await openArchive(q3Archive);
  try {
    const entries = ["lower.md3", "upper.md3", "head.md3", "animation.cfg"].map(name => {
      const entry = archive.findEntries(`models/players/sarge/${name}`)[0];
      if (entry === undefined) throw new Error(`Missing Sarge asset ${name}`);
      return entry;
    });
    const sequential: Uint8Array[] = [];
    for (const entry of entries) sequential.push(await archive.readEntry(entry));
    expect(await Promise.all(entries.map(entry => archive.readEntry(entry)))).toEqual(sequential);
  } finally { archive.close(); }
});

const witnesses = [
  { file: "q1/id1/PAK0.PAK", member: "quake.rc", ordinal: 268, byteLength: 293, entries: 339 },
  { file: "q2/rerelease/baseq2/pak0.pak", member: "default.cfg", ordinal: 0, byteLength: 3213, entries: 14663 },
  { file: "q3a/baseq3/pak0.pk3", member: "default.cfg", ordinal: 11, byteLength: 1737, entries: 3539 },
  { file: "q1/rerelease/QuakeEX.kpf", member: "exdefault.cfg", ordinal: 466, byteLength: 1819, entries: 497 },
];

for (const witness of witnesses) {
  const path = join(corpus, witness.file);
  test.skipIf(!existsSync(path))(`real external archive reads ${witness.file}:${witness.member}`, async () => {
    const archive = await openArchive(path);
    try {
      expect(archive.entries).toHaveLength(witness.entries);
      const entry = archive.findEntries(witness.member)[0];
      if (entry === undefined) throw new Error(`Missing witness ${witness.member}`);
      expect(entry.ordinal).toBe(witness.ordinal);
      const bytes = await archive.readEntry(entry);
      expect(bytes.byteLength).toBe(witness.byteLength);
      expect(new TextDecoder().decode(bytes)).toMatch(/bind|exec/);
      if (archive.format === "kpf") {
        const memory = decodeArchive(new Uint8Array(await Bun.file(path).arrayBuffer()), "kpf");
        try { expect(memory.readEntrySync(entry.ordinal)).toEqual(bytes); }
        finally { memory.close(); }
      }
    } finally { archive.close(); }
  });
}
