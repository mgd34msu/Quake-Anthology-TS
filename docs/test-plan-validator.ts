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
    name: "acceptance needs evidence", expected: "acceptanceRecord: expected an object", diagram: unchanged,
    mutate: plan => { task(plan, "W01")["status"] = "accepted"; },
  },
  {
    name: "unknown status", expected: "unsupported task status", diagram: unchanged,
    mutate: plan => { task(plan, "W01")["status"] = "complete"; },
  },
  {
    name: "unauthorized execution", expected: "Running plan requires implementation authorization", diagram: unchanged,
    mutate: plan => { plan["implementationAuthorized"] = false; },
  },
  {
    name: "running task in planned graph", expected: "execution state requires an authorized running plan", diagram: unchanged,
    mutate: plan => { plan["status"] = "planned"; },
  },
  {
    name: "running with failed dependency", expected: "W07: running has failed or blocked dependencies: W01", diagram: unchanged,
    mutate: plan => { task(plan, "W01")["status"] = "failed"; task(plan, "W07")["status"] = "running"; },
  },
  {
    name: "review before dependency acceptance", expected: "W07: review requires accepted dependencies: W01", diagram: unchanged,
    mutate: plan => { task(plan, "W07")["status"] = "review"; },
  },
  {
    name: "acceptance before dependency acceptance", expected: "W07: accepted requires accepted dependencies: W01", diagram: unchanged,
    mutate: plan => { accept(task(plan, "W07")); },
  },
  {
    name: "acceptance by worker", expected: "acceptanceRecord.acceptedBy: expected lead", diagram: unchanged,
    mutate: plan => { const candidate = task(plan, "W01"); accept(candidate); object(candidate["acceptanceRecord"])["acceptedBy"] = "worker"; },
  },
  {
    name: "acceptance without review", expected: "acceptanceRecord.review: expected at least one entry", diagram: unchanged,
    mutate: plan => { const candidate = task(plan, "W01"); accept(candidate); object(candidate["acceptanceRecord"])["review"] = []; },
  },
  {
    name: "acceptance without evidence", expected: "acceptanceRecord.evidence: expected at least one entry", diagram: unchanged,
    mutate: plan => { const candidate = task(plan, "W01"); accept(candidate); object(candidate["acceptanceRecord"])["evidence"] = []; },
  },
  {
    name: "acceptance with partial revision", expected: "acceptanceRecord.sourceRevision: expected a full Git revision", diagram: unchanged,
    mutate: plan => { const candidate = task(plan, "W01"); accept(candidate); object(candidate["acceptanceRecord"])["sourceRevision"] = "1234567"; },
  },
  {
    name: "acceptance attached to running task", expected: "acceptanceRecord requires accepted status", diagram: unchanged,
    mutate: plan => { const candidate = task(plan, "W01"); accept(candidate); candidate["status"] = "running"; },
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

function accept(candidate: Record<string, unknown>): void {
  candidate["status"] = "accepted";
  candidate["acceptanceRecord"] = {
    acceptedBy: "lead",
    sourceRevision: "0123456789012345678901234567890123456789",
    commit: "1234567890123456789012345678901234567890",
    evidence: ["Synthetic fixture evidence; no runtime acceptance"],
    review: ["Synthetic fixture review; no real reviewer"],
  };
}

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
    symlinkSync(join(root, "verification"), join(fixtureRoot, "verification"), "dir");
    const graphPath = join(fixtureRoot, "docs/work-packages.json");
    const diagramPath = join(fixtureRoot, "docs/dependency-graph.mmd");
    const liveGraph: unknown = JSON.parse(readFileSync(graphPath, "utf8"));
    const baseline = object(liveGraph);
    baseline["status"] = "running";
    baseline["implementationAuthorized"] = true;
    for (const entry of array(baseline["tasks"])) {
      const candidate = object(entry);
      candidate["status"] = array(candidate["dependsOn"]).length === 0 ? "running" : "planned";
      delete candidate["acceptanceRecord"];
    }
    const graph = `${JSON.stringify(baseline, null, 2)}\n`;
    const diagram = readFileSync(diagramPath, "utf8");
    const control = execute(script, fixtureRoot);
    if (control.exitCode !== 0) throw new Error(`Unmodified fixture must pass:\n${control.output}`);
    process.stdout.write("PASS live plan and unmodified temporary control\n");
    writeFileSync(graphPath, graph);
    const resetControl = execute(script, fixtureRoot);
    if (resetControl.exitCode !== 0) throw new Error(`Foundation state fixture must pass:\n${resetControl.output}`);
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
    const parsed: unknown = JSON.parse(graph);
    const progressed = object(parsed);
    accept(task(progressed, "W01"));
    task(progressed, "W07")["status"] = "running";
    writeFileSync(graphPath, `${JSON.stringify(progressed, null, 2)}\n`);
    writeFileSync(diagramPath, diagram);
    const progressedResult = execute(script, fixtureRoot);
    if (progressedResult.exitCode !== 0 || !progressedResult.output.includes("recorded accepted: W01")
      || !progressedResult.output.includes("Planned tasks with recorded accepted prerequisites: none")
      || !progressedResult.output.includes("Acceptance records are declarations")) {
      throw new Error(`Recorded acceptance must unlock dependents without claiming runtime proof:\n${progressedResult.output}`);
    }
    process.stdout.write("PASS recorded acceptance unlocks dependent work with explicit proof boundary\n");
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
