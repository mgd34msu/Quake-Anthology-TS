#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const validatorVersion = "1.0.0";

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function record(value: unknown, location: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${location}: expected an object`);
  return value;
}

function string(value: unknown, location: string): string {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${location}: expected a nonempty string`);
  return value;
}

function strings(value: unknown, location: string): string[] {
  if (!isUnknownArray(value)) fail(`${location}: expected an array`);
  return value.map((item, index) => string(item, `${location}[${index}]`));
}

function unique(values: readonly string[], location: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) fail(`${location}: duplicate ${value}`);
    seen.add(value);
  }
}

function sameSet(actual: readonly string[], expected: readonly string[], location: string): void {
  unique(actual, location);
  const observed = new Set(actual);
  const wanted = new Set(expected);
  const missing = expected.filter(value => !observed.has(value));
  const extra = actual.filter(value => !wanted.has(value));
  if (missing.length > 0 || extra.length > 0) {
    fail(`${location}: missing [${missing.join(", ")}]; unexpected [${extra.join(", ")}]`);
  }
}

function sequence(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1).padStart(2, "0")}`);
}

function localPath(value: unknown, location: string): string {
  const path = string(value, location);
  if (isAbsolute(path) || path.includes("\\") || path.split("/").some(part => part === ".." || part === "." || part === "")
    || /[*?\[\]{}]/.test(path)) fail(`${location}: expected a normalized relative file or directory path`);
  return path;
}

function file(root: string, path: string): string {
  const target = resolve(root, path);
  if (!existsSync(target)) fail(`Missing required artifact: ${path}`);
  return readFileSync(target, "utf8");
}

function overlaps(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function rootArgument(args: readonly string[]): string {
  if (args.length === 0) return resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const [flag, directory] = args;
  if (args.length !== 2 || flag !== "--root" || directory === undefined) fail("Usage: bun docs/validate-plan.ts [--root DIRECTORY]");
  return resolve(directory);
}

function array<T>(value: unknown, location: string, parse: (item: unknown, location: string) => T): T[] {
  if (!isUnknownArray(value)) fail(`${location}: expected an array`);
  return value.map((item, index) => parse(item, `${location}[${index}]`));
}

function literal<T extends string | number | boolean>(value: unknown, expected: T, location: string): T {
  if (value !== expected) fail(`${location}: expected ${String(expected)}`);
  return expected;
}

function nonemptyStrings(value: unknown, location: string): string[] {
  const result = strings(value, location);
  if (result.length === 0) fail(`${location}: expected at least one entry`);
  unique(result, location);
  return result;
}

function textFields(value: unknown, fields: readonly string[], location: string): void {
  const object = record(value, location);
  for (const field of fields) string(object[field], `${location}.${field}`);
}

function ownershipPath(value: unknown, location: string): string {
  const path = string(value, location);
  return localPath(path.endsWith("/**") ? path.slice(0, -3) : path, location);
}

function parseTask(value: unknown, location: string) {
  const task = record(value, location);
  const effort = string(task["effort"], `${location}.effort`);
  if (!["low", "medium", "high", "xhigh", "max", "ultra"].includes(effort)) fail(`${location}.effort: unsupported ${effort}`);
  const owns = array(task["owns"], `${location}.owns`, ownershipPath);
  unique(owns, `${location}.owns`);
  const dependsOn = strings(task["dependsOn"], `${location}.dependsOn`);
  unique(dependsOn, `${location}.dependsOn`);
  return {
    id: string(task["id"], `${location}.id`),
    title: string(task["title"], `${location}.title`),
    stage: string(task["stage"], `${location}.stage`),
    kind: string(task["kind"], `${location}.kind`),
    status: literal(task["status"], "planned", `${location}.status`),
    model: literal(task["model"], "gpt-6-astra", `${location}.model`),
    effort,
    dependsOn,
    owns,
    sourceInputs: nonemptyStrings(task["sourceInputs"], `${location}.sourceInputs`),
    deliverables: nonemptyStrings(task["deliverables"], `${location}.deliverables`),
    acceptance: nonemptyStrings(task["acceptance"], `${location}.acceptance`),
  };
}

function parseFeature(value: unknown, location: string) {
  const feature = record(value, location);
  const sourceFeatureIds = strings(feature["sourceFeatureIds"], `${location}.sourceFeatureIds`);
  unique(sourceFeatureIds, `${location}.sourceFeatureIds`);
  return {
    id: string(feature["id"], `${location}.id`),
    title: string(feature["title"], `${location}.title`),
    sourceFeatureIds,
    workPackages: nonemptyStrings(feature["workPackages"], `${location}.workPackages`),
    required: literal(feature["required"], true, `${location}.required`),
    acceptanceGates: nonemptyStrings(feature["acceptanceGates"], `${location}.acceptanceGates`),
  };
}

function parseTransfer(value: unknown, location: string) {
  const transfer = record(value, location);
  const paths = array(transfer["paths"], `${location}.paths`, ownershipPath);
  if (paths.length === 0) fail(`${location}.paths: expected at least one path`);
  unique(paths, `${location}.paths`);
  return {
    from: string(transfer["from"], `${location}.from`),
    to: string(transfer["to"], `${location}.to`),
    paths,
    condition: string(transfer["condition"], `${location}.condition`),
  };
}

function parsePlan(value: unknown) {
  const plan = record(value, "plan");
  literal(plan["schemaVersion"], 1, "plan.schemaVersion");
  literal(plan["status"], "planned", "plan.status");
  literal(plan["implementationAuthorized"], false, "plan.implementationAuthorized");
  textFields(plan, ["title", "architecture"], "plan");
  textFields(plan["interpretation"], ["edges", "readiness", "scope", "evidence", "proofBoundary", "schedule"], "plan.interpretation");
  const policy = record(plan["orchestrationPolicy"], "plan.orchestrationPolicy");
  const maxActiveAgents = literal(policy["maxActiveAgents"], 25, "orchestrationPolicy.maxActiveAgents");
  literal(policy["excludesLead"], true, "orchestrationPolicy.excludesLead");
  literal(policy["model"], "gpt-6-astra", "orchestrationPolicy.model");
  literal(policy["schedulingOwner"], "lead", "orchestrationPolicy.schedulingOwner");
  literal(policy["allImplementationThroughAgents"], true, "orchestrationPolicy.allImplementationThroughAgents");
  literal(policy["reviewersAndIntegratorsCount"], true, "orchestrationPolicy.reviewersAndIntegratorsCount");
  textFields(policy, ["subdelegation", "announcement", "readyOrder", "writeOwnership", "correctionRouting"], "orchestrationPolicy");
  textFields(policy["commits"], ["policy", "gitWriter", "staging", "message", "completion"], "orchestrationPolicy.commits");
  sameSet(strings(policy["stateTransitions"], "orchestrationPolicy.stateTransitions"),
    ["planned", "running", "review", "accepted", "failed", "blocked_missing_input"], "orchestrationPolicy.stateTransitions");
  return {
    maxActiveAgents,
    authorityDocuments: array(plan["authorityDocuments"], "plan.authorityDocuments", localPath),
    stages: nonemptyStrings(plan["stages"], "plan.stages"),
    taskKinds: nonemptyStrings(plan["taskKinds"], "plan.taskKinds"),
    requiredReleaseTask: string(plan["requiredReleaseTask"], "plan.requiredReleaseTask"),
    sourceFeatureIds: nonemptyStrings(plan["sourceFeatureIds"], "plan.sourceFeatureIds"),
    featureCoverage: array(plan["featureCoverage"], "plan.featureCoverage", parseFeature),
    ownershipTransfers: array(plan["ownershipTransfers"], "plan.ownershipTransfers", parseTransfer),
    tasks: array(plan["tasks"], "plan.tasks", parseTask),
  };
}

type Plan = ReturnType<typeof parsePlan>;
type Task = Plan["tasks"][number];

function graph(plan: Plan) {
  unique(plan.tasks.map(task => task.id), "task IDs");
  if (plan.tasks.length === 0) fail("tasks: expected at least one task");
  const tasks = new Map(plan.tasks.map(task => [task.id, task]));
  const ancestors = new Map<string, Set<string>>();
  const active = new Set<string>();
  function visit(id: string): Set<string> {
    const prior = ancestors.get(id);
    if (prior !== undefined) return prior;
    if (active.has(id)) fail(`Dependency cycle at ${id}`);
    const task = tasks.get(id);
    if (task === undefined) fail(`Unknown dependency ${id}`);
    active.add(id);
    const result = new Set<string>();
    for (const dependency of task.dependsOn) {
      if (dependency === id) fail(`${id}: self dependency`);
      result.add(dependency);
      for (const ancestor of visit(dependency)) result.add(ancestor);
    }
    active.delete(id);
    ancestors.set(id, result);
    return result;
  }
  for (const task of plan.tasks) {
    if (!/^W\d{2,}$/.test(task.id)) fail(`Invalid task ID ${task.id}`);
    if (!plan.stages.includes(task.stage)) fail(`${task.id}: unknown stage ${task.stage}`);
    if (!plan.taskKinds.includes(task.kind)) fail(`${task.id}: unknown kind ${task.kind}`);
    if (task.kind === "review" && task.owns.length !== 0) fail(`${task.id}: read-only review must own no write paths`);
    visit(task.id);
  }
  const releaseAncestors = visit(plan.requiredReleaseTask);
  const missing = plan.tasks.filter(task => task.id !== plan.requiredReleaseTask && !releaseAncestors.has(task.id));
  if (missing.length !== 0) fail(`Release closure missing ${missing.map(task => task.id).join(", ")}`);
  const ordered = (before: string, after: string): boolean => ancestors.get(after)?.has(before) ?? false;
  function transferred(from: string, to: string, path: string, visited = new Set<string>()): boolean {
    if (from === to) return true;
    if (visited.has(from)) return false;
    visited.add(from);
    return plan.ownershipTransfers.some(transfer => transfer.from === from
      && transfer.paths.some(owned => owned === path || path.startsWith(`${owned}/`))
      && transferred(transfer.to, to, path, visited));
  }
  for (const [index, left] of plan.tasks.entries()) {
    for (const right of plan.tasks.slice(index + 1)) {
      for (const leftPath of left.owns) for (const rightPath of right.owns) {
        if (!overlaps(leftPath, rightPath)) continue;
        if (!ordered(left.id, right.id) && !ordered(right.id, left.id)) {
          fail(`Concurrent write ownership collision: ${left.id} ${leftPath} and ${right.id} ${rightPath}`);
        }
        const from = ordered(left.id, right.id) ? left : right;
        const to = from === left ? right : left;
        const sharedPath = leftPath.length >= rightPath.length ? leftPath : rightPath;
        if (!transferred(from.id, to.id, sharedPath)) {
          fail(`Ordered write ownership overlap lacks explicit transfer: ${from.id} -> ${to.id}, ${sharedPath}`);
        }
      }
    }
  }
  for (const transfer of plan.ownershipTransfers) {
    const from = tasks.get(transfer.from), to = tasks.get(transfer.to);
    if (from === undefined || to === undefined) fail(`Ownership transfer references unknown task ${transfer.from} -> ${transfer.to}`);
    if (!to.dependsOn.includes(from.id)) fail(`Ownership transfer lacks direct dependency: ${from.id} -> ${to.id}`);
    for (const path of transfer.paths) {
      if (!from.owns.some(owned => owned === path || path.startsWith(`${owned}/`))
        || !to.owns.some(owned => owned === path || path.startsWith(`${owned}/`))) {
        fail(`Ownership transfer ${from.id} -> ${to.id}: ${path} must be owned by both tasks`);
      }
    }
  }
  return { tasks, ordered, closure: releaseAncestors.size + 1 };
}

function expandOwners(cell: string): string[] {
  const result: string[] = [];
  for (const part of cell.split(",")) {
    const match = /^\s*(W\d{2,})(?:[–-](W\d{2,}))?\s*$/.exec(part);
    const start = match?.[1], end = match?.[2];
    if (start === undefined) fail(`Feature ledger: invalid owner expression ${part}`);
    if (end === undefined) result.push(start);
    else {
      const first = Number(start.slice(1)), last = Number(end.slice(1));
      if (last < first || last - first > 1000) fail(`Feature ledger: invalid owner range ${part}`);
      for (let number = first; number <= last; number++) result.push(`W${String(number).padStart(2, "0")}`);
    }
  }
  return result;
}

function coverage(plan: Plan, tasks: Map<string, Task>, ledger: string): void {
  const expectedFeatures = sequence("F", 25);
  const expectedSources = [...sequence("Q1F", 11), ...sequence("Q2F", 13), ...sequence("Q3F", 16)];
  sameSet(plan.featureCoverage.map(feature => feature.id), expectedFeatures, "Feature coverage IDs");
  sameSet(plan.sourceFeatureIds, expectedSources, "Source feature IDs");
  sameSet([...new Set(plan.featureCoverage.flatMap(feature => feature.sourceFeatureIds))], expectedSources, "Mapped source feature IDs");
  const rows = new Map<string, { title: string; sources: string[]; owners: string[] }>();
  for (const line of ledger.split(/\r?\n/)) {
    if (!/^\| F\d+\b/.test(line)) continue;
    const cells = line.split("|");
    const heading = cells[1]?.trim(), sourceCell = cells[2], ownerCell = cells[4];
    const match = heading === undefined ? null : /^(F\d+) (.+)$/.exec(heading);
    const id = match?.[1], title = match?.[2];
    if (id === undefined || title === undefined || sourceCell === undefined || ownerCell === undefined) fail(`Malformed feature ledger row: ${line}`);
    if (rows.has(id)) fail(`Feature ledger duplicate ${id}`);
    rows.set(id, { title, sources: [...new Set([...sourceCell.matchAll(/\bQ[123]F\d{2}\b/g)].map(match => match[0]))], owners: expandOwners(ownerCell) });
  }
  sameSet([...rows.keys()], expectedFeatures, "Feature ledger rows");
  for (const feature of plan.featureCoverage) {
    const row = rows.get(feature.id);
    if (row === undefined) fail(`Feature ledger missing ${feature.id}`);
    if (row.title !== feature.title) fail(`${feature.id}: feature ledger title drift`);
    sameSet(row.sources, feature.sourceFeatureIds, `${feature.id} ledger source mapping`);
    sameSet(row.owners, feature.workPackages, `${feature.id} ledger work-package mapping`);
    for (const id of [...feature.workPackages, ...feature.acceptanceGates]) {
      if (!tasks.has(id)) fail(`${feature.id}: unknown work package or gate ${id}`);
    }
    if (!feature.acceptanceGates.includes(plan.requiredReleaseTask)) fail(`${feature.id}: missing release acceptance gate`);
  }
}

function diagram(plan: Plan, source: string): void {
  const nodes: string[] = [], edges: string[] = [], stages: string[] = [];
  const expectedNodes = plan.tasks.map(task => `${task.id}\t${task.stage}\t${task.id}: ${task.title}`);
  const expectedEdges = plan.tasks.flatMap(task => task.dependsOn.map(dependency => `${dependency} -> ${task.id}`));
  let stage: string | undefined;
  let header = false;
  for (const [index, raw] of source.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("%%")) continue;
    if (!header) {
      if (line !== "flowchart TD") fail("Mermaid: expected flowchart TD header");
      header = true;
      continue;
    }
    const subgraph = /^subgraph [a-z0-9_]+\["([a-z0-9-]+)"\]$/.exec(line)?.[1];
    if (subgraph !== undefined) {
      if (stage !== undefined) fail("Mermaid: nested stages are unsupported");
      stage = subgraph;
      stages.push(stage);
      continue;
    }
    if (line === "end") {
      if (stage === undefined) fail("Mermaid: unmatched end");
      stage = undefined;
      continue;
    }
    const node = /^(W\d{2,})\["([^"\n]+)"\]$/.exec(line);
    const id = node?.[1], label = node?.[2];
    if (id !== undefined && label !== undefined && stage !== undefined) {
      nodes.push(`${id}\t${stage}\t${label}`);
      continue;
    }
    const edge = /^(W\d{2,}) --> (W\d{2,})$/.exec(line);
    const from = edge?.[1], to = edge?.[2];
    if (from !== undefined && to !== undefined) {
      edges.push(`${from} -> ${to}`);
      continue;
    }
    fail(`Mermaid line ${index + 1}: unsupported syntax ${line}`);
  }
  if (!header || stage !== undefined) fail("Mermaid: missing header or unclosed stage");
  sameSet(stages, plan.stages, "Mermaid stages");
  sameSet(nodes, expectedNodes, "Mermaid nodes");
  sameSet(edges, expectedEdges, "Mermaid edges");
}

function artifacts(root: string, plan: Plan, ordered: (before: string, after: string) => boolean): void {
  sameSet(plan.authorityDocuments, ["docs/project-plan.md", "docs/source-assessment.md", "docs/feature-coverage.md", "docs/verification-plan.md"], "Authority documents");
  for (const path of plan.authorityDocuments) file(root, path);
  for (const task of plan.tasks) for (const input of task.sourceInputs) {
    if (existsSync(resolve(root, input))) continue;
    const producer = plan.tasks.find(candidate => ordered(candidate.id, task.id)
      && candidate.owns.some(path => path === input || input.startsWith(`${path}/`)));
    if (producer === undefined) fail(`${task.id}: missing source input without an ancestor producer: ${input}`);
  }
}

function readyBatches(plan: Plan): string[][] {
  const accepted = new Set<string>();
  const batches: string[][] = [];
  while (accepted.size < plan.tasks.length) {
    const ready = plan.tasks.filter(task => !accepted.has(task.id) && task.dependsOn.every(id => accepted.has(id)))
      .sort((left, right) => Number(left.id.slice(1)) - Number(right.id.slice(1)))
      .slice(0, plan.maxActiveAgents).map(task => task.id);
    if (ready.length === 0) fail("No ready tasks remain before illustrative scheduling completed");
    batches.push(ready);
    for (const id of ready) accepted.add(id);
  }
  return batches;
}

function main(): void {
  const root = rootArgument(process.argv.slice(2));
  const value: unknown = JSON.parse(file(root, "docs/work-packages.json"));
  const plan = parsePlan(value);
  const checked = graph(plan);
  coverage(plan, checked.tasks, file(root, "docs/feature-coverage.md"));
  diagram(plan, file(root, "docs/dependency-graph.mmd"));
  artifacts(root, plan, checked.ordered);
  const batches = readyBatches(plan);
  const edges = plan.tasks.reduce((count, task) => count + task.dependsOn.length, 0);
  const peak = batches.reduce((count, batch) => Math.max(count, batch.length), 0);
  process.stdout.write(`Plan validator v${validatorVersion}: PASS\nRoot: ${relative(process.cwd(), root) || "."}\n`
    + `Tasks: ${plan.tasks.length}; edges: ${edges}; features: ${plan.featureCoverage.length}; source families: ${plan.sourceFeatureIds.length}\n`
    + `Release closure: ${checked.closure}/${plan.tasks.length}; illustrative peak batch: ${peak}/${plan.maxActiveAgents}, lead excluded\n`
    + "Illustrative dependency batches only. No duration or completion estimate; live dispatch refills available slots as dependencies pass.\n");
  for (const [index, batch] of batches.entries()) process.stdout.write(`Batch ${index + 1}: ${batch.join(", ")}\n`);
  process.stdout.write("Validated planning consistency only; implementation and release acceptance remain unverified.\n");
}

try {
  main();
} catch (error: unknown) {
  process.stderr.write(`Plan validator v${validatorVersion}: FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
