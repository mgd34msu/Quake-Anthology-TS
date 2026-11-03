// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { QcStrings, QcWords } from "../../../src/compat/qc/memory.ts";

test("engine strings move to a larger buffer when a later value outgrows the first", () => {
  for (const quakeworld of [false, true]) {
    const strings = new QcStrings(new Uint8Array([0]), quakeworld);
    const first = strings.setEngine("name", "short", 8);
    expect(strings.get(first)).toBe("short");
    const second = strings.setEngine("name", "x".repeat(200), 8);
    expect(strings.get(second)).toBe("x".repeat(200));
    expect(strings.get(strings.setEngine("name", "again", 8))).toBe("again");
    const restored = new QcStrings(new Uint8Array([0]), quakeworld);
    restored.restore(strings.snapshot());
    expect(restored.get(restored.setEngine("name", "y".repeat(300), 8))).toBe("y".repeat(300));
  }
});

test("interned strings are allocated once per distinct value", () => {
  const strings = new QcStrings(new Uint8Array([0]), false);
  const first = strings.intern("monster_army");
  const snapshotSize = strings.snapshot().length;
  for (let index = 0; index < 1000; index++) expect(strings.intern("monster_army")).toBe(first);
  expect(strings.snapshot().length).toBe(snapshotSize);
  expect(strings.get(first)).toBe("monster_army");
});

test("RETURN copies treat words beyond the last global as zero", () => {
  const globals = new QcWords(new Uint8Array(30 * 4));
  globals.setFloat(29, 7);
  globals.copyReturnWords(globals, 29, 1, 3);
  expect(globals.float(1)).toBe(7);
  expect(globals.float(2)).toBe(0);
  expect(globals.float(3)).toBe(0);
  expect(() => globals.copyWords(globals, 29, 1, 3)).toThrow("progs.dat: word 30 outside 30-word storage");
});
