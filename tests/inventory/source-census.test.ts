import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enumerateFunctions, safeRelativePath, sha256, writeOrCheck } from "../../tools/inventory/source-census.ts";

describe("source function census", () => {
  test("retains nested functions, callback expressions, methods and bodyless overloads independently", () => {
    const source = [
      "export function decode(value: string): number;",
      "export function decode(value: string | number): number {",
      "  function nested(): number { return 2; }",
      "  return typeof value === 'number' ? value : nested();",
      "}",
      "const increment = (value: number): number => value + 1;",
      "class Counter {",
      "  constructor() {}",
      "  get current(): number { return 1; }",
      "  set current(value: number) { void value; }",
      "  values(): number[] { return [1].map((value) => increment(value)); }",
      "}",
      "interface CallbackType { invoke(): number; }",
    ].join("\n");
    const functions = enumerateFunctions("donor", "src/test.ts", source);
    expect(functions.map((fn) => fn.name)).toEqual(["decode", "decode", "nested", "increment", "constructor", "current", "current", "values", "[1].map callback"]);
    expect(functions.filter((fn) => !fn.hasBody).map((fn) => fn.name)).toEqual(["decode"]);
    expect(new Set(functions.map((fn) => fn.id)).size).toBe(functions.length);
    expect(functions.find((fn) => fn.name === "nested")?.line).toBe(3);
    expect(functions.find((fn) => fn.name === "values")?.endLine).toBe(11);
    expect(enumerateFunctions("donor", "src/test.ts", source)).toEqual(functions);
  });

  test("offset identity is scoped to repository and file, including Unicode source text", () => {
    const source = "// 🌀\nexport const move = () => 1;";
    const first = enumerateFunctions("q1", "src/move.ts", source);
    const second = enumerateFunctions("q2", "src/move.ts", source);
    expect(first[0]?.name).toBe("move");
    expect(first[0]?.line).toBe(2);
    expect(first[0]?.startOffset).toBe(source.indexOf("()"));
    expect(first[0]?.id).not.toBe(second[0]?.id);
  });

  test("paths reject traversal before file access", () => {
    for (const path of ["", "../outside", "src/../../outside", "/absolute", "src//move.ts", "src/./move.ts", "src\\move.ts"]) {
      expect(() => safeRelativePath(path)).toThrow("Invalid repository-relative path");
    }
    expect(safeRelativePath("Mission Packs/hipnotic/items.qc")).toBe("Mission Packs/hipnotic/items.qc");
  });

  test("check mode detects changed artifacts without rewriting them", async () => {
    const directory = await mkdtemp(join(tmpdir(), "quake-source-census-"));
    const path = join(directory, "manifest.json");
    try {
      await writeOrCheck(path, { digest: sha256("source") }, false);
      await writeOrCheck(path, { digest: sha256("source") }, true);
      await writeFile(path, "stale\n");
      await expect(writeOrCheck(path, { digest: sha256("source") }, true)).rejects.toThrow("Generated inventory differs");
      expect(await Bun.file(path).text()).toBe("stale\n");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
