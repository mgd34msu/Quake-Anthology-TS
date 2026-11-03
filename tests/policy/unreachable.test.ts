import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { auditUnreachable, unreachableModules } from "../../tools/unreachable.ts";

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function project(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "quake-unreachable-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

test("modules reachable through imports, re-exports, dynamic imports and worker URLs are live", () => {
  const root = project({
    "src/main.ts": 'import { a } from "./a.ts"; export * from "./barrel/index.ts"; export const lazy = () => import("./lazy.ts"); new Worker(new URL("./worker.ts", import.meta.url)); export { a };',
    "src/a.ts": "export const a = 1;",
    "src/barrel/index.ts": 'export * from "./member.ts";',
    "src/barrel/member.ts": "export const member = 1;",
    "src/lazy.ts": "export const lazy = 1;",
    "src/worker.ts": "export {};",
    "src/dead.ts": "export const dead = 1;",
    "src/deep/dead-index.ts": 'import "../dead.ts";',
  });
  expect(unreachableModules(root)).toEqual(["src/dead.ts", "src/deep/dead-index.ts"]);
});

test("an unlisted unreachable module is a diagnostic and a stale list entry is too", () => {
  const root = project({
    "src/main.ts": 'import "./a.ts";',
    "src/a.ts": "export {};",
    "src/orphan.ts": "export {};",
    "src/listed.ts": "export {};",
    "tools/unreachable-modules.json": JSON.stringify({ "src/listed.ts": "integration pending", "src/a.ts": "was dead once", "src/gone.ts": "deleted" }),
  });
  const problems = auditUnreachable(root).map(problem => `${problem.file}: ${problem.message}`);
  expect(problems).toEqual([
    "src/orphan.ts: src/orphan.ts is not reachable from src/main.ts; wire it into a user path or delete it.",
    "tools/unreachable-modules.json: src/a.ts is listed as pending but is reachable; remove it from the list.",
    "tools/unreachable-modules.json: src/gone.ts is listed as pending but is missing; remove it from the list.",
  ]);
});

test("the pending list rejects an entry without a reason", () => {
  const root = project({ "src/main.ts": "export {};", "src/x.ts": "export {};", "tools/unreachable-modules.json": JSON.stringify({ "src/x.ts": " " }) });
  expect(() => auditUnreachable(root)).toThrow("needs a nonempty reason");
});

test("projects without the application entry are not audited", () => {
  expect(auditUnreachable(project({ "src/x.ts": "export {};" }))).toEqual([]);
});

test("the repository has no unreachable module outside the pending list", () => {
  expect(auditUnreachable(resolve(import.meta.dir, "../.."))).toEqual([]);
});
