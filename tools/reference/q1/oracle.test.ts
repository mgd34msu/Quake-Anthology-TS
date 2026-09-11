import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { q1Cases } from "./cases.ts";
import { runQ1Oracle } from "./oracle.ts";
import { verifyCapturedCases, verifySourcePin } from "./capture.ts";
import { hashBytes, hashJson } from "../../verify/hash.ts";
import type { SourcePin } from "./sources.ts";

describe("Q1 original-source equations", () => {
  for (const item of q1Cases) test(item.id, () => expect(runQ1Oracle(item.input)).toEqual(item.expected));

  test("mg1 exhausts five required bits independently of extra flags", () => {
    for (let flags = 0; flags < 128; flags++) {
      const result = runQ1Oracle({ kind: "mg1-hub", serverFlags: flags });
      if (result.kind !== "mg1-hub") throw new Error("Wrong oracle result kind");
      expect(result.calls).toEqual([flags % 32 === 31 ? "trigger_changelevel()" : "remove(self)"]);
    }
  });

  test("mg3 exhausts rune masks and thresholds using a fixed independent nibble table", () => {
    const runeCounts = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
    for (let flags = 0; flags < 64; flags++) {
      const runes = runeCounts[flags % 16];
      if (runes === undefined) throw new Error("Missing independent nibble expectation");
      for (const threshold of [-1, 0, 1, 2, 2.5, 3, 4, 5]) {
        const result = runQ1Oracle({ kind: "mg3-counter", serverFlags: flags, count: threshold,
          coop: false, spawnFlags: 0, entity: 40, activator: 2 });
        if (result.kind !== "mg3-counter") throw new Error("Wrong oracle result kind");
        expect(result.runes).toBe(runes);
        expect(result.callback !== null).toBe(runes >= (threshold === 0 ? 2 : threshold));
      }
    }
  });

  test("mg3 permits matching coop-only entities and noncoop NOT_IN_COOP entities", () => {
    for (const mode of [{ coop: true, spawnFlags: 32768 }, { coop: false, spawnFlags: 131072 }]) {
      const result = runQ1Oracle({ kind: "mg3-counter", serverFlags: 3, count: 0, entity: 40, activator: 2, ...mode });
      expect(result).toEqual({ kind: "mg3-counter", removed: false, count: 2, use: "rune_counter_use", runes: 2,
        callback: { name: "SUB_UseTargets", self: 40, activator: 2 } });
    }
  });

  test("numeric records distinguish signed zero", () => {
    expect(runQ1Oracle({ kind: "scalar-program", initial: -0, operations: [{ operator: "multiply", operand: 2 }] }))
      .toEqual({ kind: "scalar-program", values: [-0, -0], bits: ["80000000", "80000000"] });
  });

  test("signed int conversion truncates negative fractions toward zero", () => {
    expect(runQ1Oracle({ kind: "scalar-program", initial: -1.75, operations: [{ operator: "bit-and", operand: 15 }] }))
      .toEqual({ kind: "scalar-program", values: [-1.75, 15], bits: ["bfe00000", "41700000"] });
  });

  test("malformed and undefined arithmetic inputs fail at the boundary", () => {
    const malformed: readonly unknown[] = [null, [], "mg1-hub", {}, { kind: "other" },
      { kind: "mg1-hub" }, { kind: "mg1-hub", serverFlags: "31" }, { kind: "mg1-hub", serverFlags: NaN },
      { kind: "mg1-hub", serverFlags: 2147483648 }, { kind: "mg1-hub", serverFlags: -2147483904 },
      { kind: "mg1-hub", serverFlags: 31, ignored: true },
      { kind: "scalar-program", initial: Infinity, operations: [] },
      { kind: "scalar-program", initial: 1e100, operations: [] },
      { kind: "scalar-program", initial: 1, operations: "add" },
      { kind: "scalar-program", initial: 1, operations: [null] },
      { kind: "scalar-program", initial: 1, operations: [{ operator: "power", operand: 2 }] },
      { kind: "scalar-program", initial: 1, operations: [{ operator: "divide", operand: 0 }] },
      { kind: "scalar-program", initial: 3e38, operations: [{ operator: "multiply", operand: 2 }] },
      { kind: "scalar-program", initial: 2147483648, operations: [{ operator: "bit-or", operand: 1 }] },
      { kind: "run-think", serverTime: 10, frameTime: -1, nextThink: 10, entity: 3,
        globals: { time: 7, self: 99, other: 98 }, effect: { kind: "retain" } },
      { kind: "run-think", serverTime: 10, frameTime: 1, nextThink: 10, entity: 0.5,
        globals: { time: 7, self: 99, other: 98 }, effect: { kind: "retain" } },
      { kind: "run-think", serverTime: 10, frameTime: 1, nextThink: 10, entity: 3,
        globals: { time: 7, self: 99, other: 98 }, effect: { kind: "arbitrary-code" } },
      { kind: "mg3-counter", serverFlags: 3, count: 2, coop: 1, spawnFlags: 0, entity: 40, activator: 2 },
    ];
    for (const value of malformed) expect(() => runQ1Oracle(value)).toThrow();
  });

  test("source identities reject changed, missing and wrongly bounded evidence", async () => {
    const directory = await mkdtemp(resolve(import.meta.dir, ".source-test-"));
    try {
      const text = "one\ntwo\nthree\n", path = resolve(directory, "evidence.txt");
      await writeFile(path, text);
      const pin: SourcePin = { id: "test-source", path: "evidence.txt", sha256: hashBytes(text),
        excerpts: [{ firstLine: 2, lastLine: 3, purpose: "line slicing" }] };
      const result = await verifySourcePin(directory, pin);
      expect(result.excerpts).toEqual([{ firstLine: 2, lastLine: 3, purpose: "line slicing", code: "two\nthree", sha256: hashBytes("two\nthree") }]);
      await expect(verifySourcePin(directory, { ...pin, excerpts: [{ firstLine: 0, lastLine: 1, purpose: "invalid" }] })).rejects.toThrow("bounds");
      await writeFile(path, "changed");
      await expect(verifySourcePin(directory, pin)).rejects.toThrow("hash mismatch");
      await rm(path);
      await expect(verifySourcePin(directory, pin)).rejects.toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test("the oracle has no dependency on the engine implementation under test", async () => {
    const source = await readFile(resolve(import.meta.dir, "oracle.ts"), "utf8");
    expect(source).not.toMatch(/\bimport\s|\brequire\s*\(/);
  });

  test("stored captures reject relabeling and changed expected steps", () => {
    const cases = q1Cases.map(item => ({ ...item, observed: runQ1Oracle(item.input), passed: true,
      inputSha256: hashJson(item.input), expectedSha256: hashJson(item.expected) }));
    const record = { schemaVersion: 1, game: "q1", oracle: { kind: "source-derived", measuredOriginalExecution: false },
      caseCount: cases.length, cases };
    expect(() => verifyCapturedCases(record)).not.toThrow();
    expect(() => verifyCapturedCases({ ...record, oracle: { kind: "retail-trace", measuredOriginalExecution: true } })).toThrow();
    expect(() => verifyCapturedCases({ ...record, cases: cases.slice(1) })).toThrow();
    expect(() => verifyCapturedCases(null)).toThrow();
  });
});
