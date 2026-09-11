#!/usr/bin/env bun
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function object(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Fixture must contain an object");
  return value;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function array(value: unknown): unknown[] {
  if (!isUnknownArray(value)) throw new Error("Fixture must contain an array");
  return value;
}

function task(plan: Record<string, unknown>, id: string): Record<string, unknown> {
  for (const entry of array(plan["tasks"])) {
    const candidate = object(entry);
    if (candidate["id"] === id) return candidate;
  }
  throw new Error(`Fixture is missing ${id}`);
}

type Case = {
  name: string;
  expected: string;
  mutate: (plan: Record<string, unknown>) => void;
  diagram: (source: string) => string;
};

const unchanged = (source: string): string => source;
const cases: Case[] = [
  {
    name: "unknown dependency", expected: "Unknown dependency W999", diagram: unchanged,
    mutate: plan => { array(task(plan, "W01")["dependsOn"]).push("W999"); },
  },
  {
    name: "cycle", expected: "Dependency cycle", diagram: unchanged,
    mutate: plan => { array(task(plan, "W01")["dependsOn"]).push(plan["requiredReleaseTask"]); },
  },
  {
    name: "concurrent ownership", expected: "Concurrent write ownership collision", diagram: unchanged,
    mutate: plan => { array(task(plan, "W01")["owns"]).push(array(task(plan, "W02")["owns"])[0]); },
  },
  {
    name: "missing feature", expected: "Feature coverage IDs: missing", diagram: unchanged,
    mutate: plan => { array(plan["featureCoverage"]).pop(); },
  },
  {
    name: "diagram drift", expected: "Mermaid nodes:",
    mutate: () => {},
    diagram: source => source.replace('W01["W01:', 'W01["DRIFT W01:'),
  },
  {
    name: "schema boundary", expected: "expected an array", diagram: unchanged,
    mutate: plan => { task(plan, "W01")["dependsOn"] = null; },
  },
  {
    name: "planned status", expected: "expected planned", diagram: unchanged,
    mutate: plan => { task(plan, "W01")["status"] = "accepted"; },
  },
  {
    name: "required release closure", expected: "Release closure missing W99", diagram: unchanged,
    mutate: plan => { array(plan["tasks"]).push({ ...task(plan, "W01"), id: "W99", owns: [] }); },
  },
  {
    name: "missing handoff", expected: "Ordered write ownership overlap lacks explicit transfer", diagram: unchanged,
    mutate: plan => { plan["ownershipTransfers"] = []; },
  },
];

function execute(script: string, root: string) {
  const result = Bun.spawnSync([process.execPath, script, "--root", root], { stdout: "pipe", stderr: "pipe" });
  return { exitCode: result.exitCode, output: `${result.stdout.toString()}${result.stderr.toString()}` };
}

function main(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const script = join(root, "docs/validate-plan.ts");
  const live = execute(script, root);
  if (live.exitCode !== 0) throw new Error(`Live plan must pass before negative fixtures run:\n${live.output}`);
  const temporary = mkdtempSync(join(tmpdir(), "quake-plan-validator-"));
  try {
    const fixtureRoot = join(temporary, "project");
    cpSync(join(root, "docs"), join(fixtureRoot, "docs"), { recursive: true });
    for (const sibling of ["qsrc", "qfiles", "quake-1-re-ts", "quake-2-re-ts", "quake-3-ts"]) {
      symlinkSync(resolve(root, "..", sibling), join(temporary, sibling), "dir");
    }
    const graphPath = join(fixtureRoot, "docs/work-packages.json");
    const diagramPath = join(fixtureRoot, "docs/dependency-graph.mmd");
    const graph = readFileSync(graphPath, "utf8");
    const diagram = readFileSync(diagramPath, "utf8");
    const control = execute(script, fixtureRoot);
    if (control.exitCode !== 0) throw new Error(`Unmodified fixture must pass:\n${control.output}`);
    process.stdout.write("PASS live plan and unmodified temporary control\n");
    for (const test of cases) {
      const parsed: unknown = JSON.parse(graph);
      const plan = object(parsed);
      test.mutate(plan);
      writeFileSync(graphPath, `${JSON.stringify(plan, null, 2)}\n`);
      writeFileSync(diagramPath, test.diagram(diagram));
      const result = execute(script, fixtureRoot);
      if (result.exitCode !== 1 || !result.output.includes(test.expected)) {
        throw new Error(`${test.name}: expected exit 1 containing ${JSON.stringify(test.expected)}; got ${result.exitCode}\n${result.output}`);
      }
      process.stdout.write(`PASS rejected ${test.name}\n`);
    }
    process.stdout.write(`Plan validator boundaries: ${cases.length}/${cases.length} negative cases passed\n`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
