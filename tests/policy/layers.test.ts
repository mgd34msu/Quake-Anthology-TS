// SPDX-License-Identifier: GPL-2.0-or-later
import { afterAll, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, readdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { auditProject } from "../../tools/check-policy.ts";
import { layerEdgeAllowed, layerOf, loadLayerEdges, loadLayerOrder, scanLayerEdges } from "../../tools/layers.ts";

const root = resolve(import.meta.dir, "../..");
const temporary = mkdtempSync(join(tmpdir(), "quake-unified-layers-"));
afterAll(() => {
  rmSync(temporary, { recursive: true, force: true });
});

function fixture(
  name: string,
  allowed: Readonly<Record<string, readonly string[]>> | undefined,
  order: readonly (readonly string[])[] = [["low"], ["high"]],
): string {
  const project = join(temporary, name);
  const files: Readonly<Record<string, string>> = {
    "src/low/base.ts": "export const base = 1;\n",
    "src/high/use.ts": 'import { base } from "../low/base.ts";\nexport const high = base + 1;\n',
    "src/low/up.ts": 'import { high } from "../high/use.ts";\nexport const up = high;\n',
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(project, path)), { recursive: true });
    writeFileSync(join(project, path), text);
  }
  copyFileSync(join(root, "tsconfig.json"), join(project, "tsconfig.json"));
  if (allowed !== undefined) {
    mkdirSync(join(project, "tools"), { recursive: true });
    writeFileSync(join(project, "tools/layer-edges.json"), JSON.stringify(allowed));
    writeFileSync(join(project, "tools/layer-order.json"), JSON.stringify(order));
  }
  return project;
}

test("AUDIT-009 the policy tool rejects an upward layer import that is not an exception", () => {
  const diagnostics = auditProject(fixture("strict", {})).filter(item => item.rule === "layer-edge");
  expect(diagnostics.map(item => item.file.slice(item.file.indexOf("src/")))).toEqual(["src/low/up.ts"]);
  expect(diagnostics[0]?.message).toContain("src/low may not import src/high");
});

test("AUDIT-009 a listed exception, a same-tier import, or no rules, reports nothing", () => {
  expect(auditProject(fixture("both", { low: ["high"] })).filter(item => item.rule === "layer-edge")).toEqual([]);
  expect(auditProject(fixture("same", {}, [["low", "high"]])).filter(item => item.rule === "layer-edge")).toEqual([]);
  expect(auditProject(fixture("none", undefined)).filter(item => item.rule === "layer-edge")).toEqual([]);
});

test("AUDIT-009 every src layer is ranked, and the committed exceptions are exactly the upward imports", () => {
  expect(layerOf("src/core/a/b.ts")).toBe("core");
  expect(layerOf("src/main.ts")).toBeUndefined();
  expect(layerOf("tests/x.ts")).toBeUndefined();
  const exceptions = loadLayerEdges(root),
    rank = loadLayerOrder(root);
  if (exceptions === undefined) throw new Error("tools/layer-edges.json is missing");
  const scanned = scanLayerEdges(root);
  for (const layer of readdirSync(join(root, "src"), { withFileTypes: true }))
    if (layer.isDirectory()) expect(`${layer.name} ${rank.has(layer.name)}`).toBe(`${layer.name} true`);
  const rules = { rank, exceptions };
  for (const [from, imported] of scanned)
    for (const to of imported) expect(`${from} -> ${to} ${layerEdgeAllowed(rules, from, to)}`).toBe(`${from} -> ${to} true`);
  for (const [from, imported] of exceptions)
    for (const to of imported) {
      expect(`${from} -> ${to} imported ${scanned.get(from)?.has(to)}`).toBe(`${from} -> ${to} imported true`);
      expect(`${from} -> ${to} upward ${(rank.get(to) ?? Infinity) > (rank.get(from) ?? -1)}`).toBe(`${from} -> ${to} upward true`);
    }
}, 120_000);
