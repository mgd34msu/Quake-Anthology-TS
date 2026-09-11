import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compareText, inventoryArguments, safeRelativePath, sha256, writeOrCheck } from "./source-census.ts";

interface Evidence {
  readonly repository: string;
  readonly path: string;
  readonly symbol: string | null;
  readonly line: number;
  readonly endLine: number;
  readonly role: "implementation" | "original-contract" | "test" | "document";
  readonly observation: string;
}

interface Workflow {
  readonly id: string;
  readonly trigger: string;
  readonly steps: readonly string[];
  readonly observableOutcome: string;
}

interface LinkedEvidence extends Evidence {
  readonly revision: string;
  readonly sha256: string;
  readonly functionIds: readonly string[];
}

interface LinkedFeature extends Omit<Feature, "evidence"> {
  readonly evidence: readonly LinkedEvidence[];
  readonly acceptanceState: "not-run";
}

export interface Feature {
  readonly id: string;
  readonly sourceFamilyIds: readonly string[];
  readonly unifiedFeatureIds: readonly string[];
  readonly title: string;
  readonly requirement: string;
  readonly sourceStatus: "implemented" | "partial" | "missing";
  readonly targetStatus: "required";
  readonly products: readonly string[];
  readonly ownerTaskIds: readonly string[];
  readonly acceptanceCaseIds: readonly string[];
  readonly evidence: readonly Evidence[];
  readonly workflows: readonly Workflow[];
  readonly gaps: readonly string[];
}

interface FeatureShard {
  readonly family: "q1" | "q2" | "q3";
  readonly sourceRevision: string;
  readonly features: readonly Feature[];
}

interface IndexedFunction {
  readonly id: string;
  readonly name: string;
  readonly line: number;
  readonly endLine: number;
}

interface IndexedFile {
  readonly path: string;
  readonly kind: string;
  readonly sha256: string;
  readonly lineCount: number;
  readonly functions: readonly IndexedFunction[];
}

interface IndexedRepository {
  readonly id: string;
  readonly path: string;
  readonly revision: string;
  readonly sourceSetSha256: string;
  readonly files: readonly IndexedFile[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, location: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${location} must be an object`);
  return value;
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function unknownArray(value: unknown, location: string): readonly unknown[] {
  if (!isUnknownArray(value)) throw new Error(`${location} must be an array`);
  return value;
}

function parseArray<T>(value: unknown, location: string, parse: (entry: unknown, location: string) => T): T[] {
  return unknownArray(value, location).map((entry, index) => parse(entry, `${location}[${index}]`));
}

function string(value: unknown, location: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${location} must be a nonempty string`);
  return value;
}

function strings(value: unknown, location: string): string[] {
  const result = parseArray(value, location, string);
  unique(result, location);
  return result;
}

function nonemptyStrings(value: unknown, location: string): string[] {
  const result = strings(value, location);
  if (result.length === 0) throw new Error(`${location} must not be empty`);
  return result;
}

function positiveInteger(value: unknown, location: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error(`${location} must be a positive integer`);
  return value;
}

function hash(value: unknown, location: string): string {
  const result = string(value, location);
  if (!/^[a-f0-9]{64}$/u.test(result)) throw new Error(`${location} must be a SHA-256 digest`);
  return result;
}

function revision(value: unknown, location: string): string {
  const result = string(value, location);
  if (!/^[a-f0-9]{40}$/u.test(result)) throw new Error(`${location} must be a Git revision`);
  return result;
}

function unique(values: readonly string[], location: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${location} contains duplicates`);
}

function parseEvidence(value: unknown, location: string): Evidence {
  const item = record(value, location);
  const role = item["role"];
  if (role !== "implementation" && role !== "original-contract" && role !== "test" && role !== "document") throw new Error(`${location}.role is invalid`);
  const symbol = item["symbol"] === null ? null : string(item["symbol"], `${location}.symbol`);
  const line = positiveInteger(item["line"], `${location}.line`);
  const endLine = positiveInteger(item["endLine"], `${location}.endLine`);
  if (endLine < line) throw new Error(`${location} has a reversed line range`);
  return {
    repository: string(item["repository"], `${location}.repository`),
    path: safeRelativePath(string(item["path"], `${location}.path`)),
    symbol,
    line,
    endLine,
    role,
    observation: string(item["observation"], `${location}.observation`),
  };
}

function parseWorkflow(value: unknown, location: string): Workflow {
  const item = record(value, location);
  return {
    id: string(item["id"], `${location}.id`),
    trigger: string(item["trigger"], `${location}.trigger`),
    steps: nonemptyStrings(item["steps"], `${location}.steps`),
    observableOutcome: string(item["observableOutcome"], `${location}.observableOutcome`),
  };
}

function parseFeature(value: unknown, location: string): Feature {
  const item = record(value, location);
  const sourceStatus = item["sourceStatus"];
  if (sourceStatus !== "implemented" && sourceStatus !== "partial" && sourceStatus !== "missing") throw new Error(`${location}.sourceStatus is invalid`);
  if (item["targetStatus"] !== "required") throw new Error(`${location}.targetStatus must retain the required feature`);
  const evidence = parseArray(item["evidence"], `${location}.evidence`, parseEvidence);
  const workflows = parseArray(item["workflows"], `${location}.workflows`, parseWorkflow);
  const gaps = strings(item["gaps"], `${location}.gaps`);
  if (sourceStatus !== "missing" && evidence.length === 0) throw new Error(`${location} needs source evidence`);
  if (sourceStatus !== "implemented" && gaps.length === 0) throw new Error(`${location} must describe the donor gap`);
  if (workflows.length === 0) throw new Error(`${location} needs an exposed workflow`);
  unique(workflows.map((workflow) => workflow.id), `${location}.workflows`);
  return {
    id: string(item["id"], `${location}.id`),
    sourceFamilyIds: nonemptyStrings(item["sourceFamilyIds"], `${location}.sourceFamilyIds`),
    unifiedFeatureIds: nonemptyStrings(item["unifiedFeatureIds"], `${location}.unifiedFeatureIds`),
    title: string(item["title"], `${location}.title`),
    requirement: string(item["requirement"], `${location}.requirement`),
    sourceStatus,
    targetStatus: "required",
    products: nonemptyStrings(item["products"], `${location}.products`),
    ownerTaskIds: nonemptyStrings(item["ownerTaskIds"], `${location}.ownerTaskIds`),
    acceptanceCaseIds: nonemptyStrings(item["acceptanceCaseIds"], `${location}.acceptanceCaseIds`),
    evidence,
    workflows,
    gaps,
  };
}

export function parseFeatureShard(value: unknown, location: string): FeatureShard {
  const item = record(value, location);
  if (item["schemaVersion"] !== 1) throw new Error(`${location}.schemaVersion must equal 1`);
  const family = item["family"];
  if (family !== "q1" && family !== "q2" && family !== "q3") throw new Error(`${location}.family is invalid`);
  const features = parseArray(item["features"], `${location}.features`, parseFeature);
  if (features.length === 0) throw new Error(`${location} cannot drop its features`);
  unique(features.map((feature) => feature.id), `${location}.features`);
  if (features.some((feature) => !feature.id.startsWith(`${family}.`))) throw new Error(`${location} contains a feature outside ${family}`);
  return { family, sourceRevision: revision(item["sourceRevision"], `${location}.sourceRevision`), features };
}

function parseIndexedFunction(value: unknown, location: string): IndexedFunction {
  const item = record(value, location);
  return {
    id: string(item["id"], `${location}.id`),
    name: string(item["name"], `${location}.name`),
    line: positiveInteger(item["line"], `${location}.line`),
    endLine: positiveInteger(item["endLine"], `${location}.endLine`),
  };
}

function parseIndexedFile(value: unknown, location: string): IndexedFile {
  const item = record(value, location);
  const lineCount = item["lineCount"];
  if (typeof lineCount !== "number" || !Number.isSafeInteger(lineCount) || lineCount < 0) throw new Error(`${location}.lineCount is invalid`);
  return {
    path: safeRelativePath(string(item["path"], `${location}.path`)),
    kind: string(item["kind"], `${location}.kind`),
    sha256: hash(item["sha256"], `${location}.sha256`),
    lineCount,
    functions: parseArray(item["functions"], `${location}.functions`, parseIndexedFunction),
  };
}

function parseRepository(value: unknown, location: string): IndexedRepository {
  const item = record(value, location);
  return {
    id: string(item["id"], `${location}.id`),
    path: string(item["path"], `${location}.path`),
    revision: revision(item["revision"], `${location}.revision`),
    sourceSetSha256: hash(item["sourceSetSha256"], `${location}.sourceSetSha256`),
    files: parseArray(item["files"], `${location}.files`, parseIndexedFile),
  };
}

async function jsonFile(path: string): Promise<{ readonly text: string; readonly value: unknown }> {
  const text = await readFile(path, "utf8");
  const value: unknown = JSON.parse(text);
  return { text, value };
}

function requireMembers(actual: readonly string[], expected: ReadonlySet<string>, location: string): void {
  for (const id of actual) if (!expected.has(id)) throw new Error(`${location} refers to unknown ${id}`);
}

export async function buildFeatureLedger(root: string) {
  const sourceInput = await jsonFile(resolve(root, "verification/source-manifest.json"));
  const source = record(sourceInput.value, "source-manifest");
  if (source["schemaVersion"] !== 1) throw new Error("source-manifest.schemaVersion must equal 1");
  const repositories = parseArray(source["repositories"], "source-manifest.repositories", parseRepository);
  unique(repositories.map((repository) => repository.id), "source-manifest.repositories");
  const repositoryIndex = new Map(repositories.map((repository) => [repository.id, repository]));
  const fileIndex = new Map<string, IndexedFile>();
  for (const repository of repositories) {
    unique(repository.files.map((file) => file.path), `${repository.id}.files`);
    for (const file of repository.files) fileIndex.set(`${repository.id}:${file.path}`, file);
  }
  const graphInput = await jsonFile(resolve(root, "docs/work-packages.json"));
  const graph = record(graphInput.value, "work-packages");
  const taskIds = new Set(parseArray(graph["tasks"], "work-packages.tasks", (value, location) => string(record(value, location)["id"], `${location}.id`)));
  const sourceFamilyIds = new Set(strings(graph["sourceFeatureIds"], "work-packages.sourceFeatureIds"));
  const featureCoverage = parseArray(graph["featureCoverage"], "work-packages.featureCoverage", (value, location) => record(value, location));
  const unifiedFeatureIds = new Set(featureCoverage.map((row) => string(row["id"], "featureCoverage.id")));
  const productInput = await jsonFile(resolve(root, "verification/product-manifest.json"));
  const productRoot = record(productInput.value, "product-manifest");
  const productIds = new Set(parseArray(productRoot["products"], "product-manifest.products", (value, location) => string(record(value, location)["id"], `${location}.id`)));
  const shardInputs: { readonly path: string; readonly sha256: string }[] = [];
  const features: Feature[] = [];
  for (const family of ["q1", "q2", "q3"]) {
    const path = `verification/features/${family}.json`;
    const input = await jsonFile(resolve(root, path));
    const shard = parseFeatureShard(input.value, path);
    const repository = repositoryIndex.get(`${family}-ts`);
    if (shard.family !== family || repository === undefined || shard.sourceRevision !== repository.revision) throw new Error(`${path} does not match its pinned donor source`);
    shardInputs.push({ path, sha256: sha256(input.text) });
    features.push(...shard.features);
  }
  features.sort((left, right) => compareText(left.id, right.id));
  unique(features.map((feature) => feature.id), "features");
  const linked = new Map<string, Set<string>>();
  const checkedFiles = new Set<string>();
  const enriched: LinkedFeature[] = [];
  for (const feature of features) {
    requireMembers(feature.sourceFamilyIds, sourceFamilyIds, `${feature.id}.sourceFamilyIds`);
    requireMembers(feature.unifiedFeatureIds, unifiedFeatureIds, `${feature.id}.unifiedFeatureIds`);
    requireMembers(feature.ownerTaskIds, taskIds, `${feature.id}.ownerTaskIds`);
    requireMembers(feature.products, productIds, `${feature.id}.products`);
    const evidence: LinkedEvidence[] = [];
    for (const anchor of feature.evidence) {
      const repository = repositoryIndex.get(anchor.repository);
      const key = `${anchor.repository}:${anchor.path}`;
      const file = fileIndex.get(key);
      if (repository === undefined || file === undefined) throw new Error(`${feature.id}: unpinned evidence ${key}`);
      if (anchor.endLine > file.lineCount) throw new Error(`${feature.id}: evidence exceeds ${key}'s ${file.lineCount} lines`);
      if (!checkedFiles.has(key)) {
        const actual = await readFile(resolve(root, repository.path, anchor.path));
        if (sha256(actual) !== file.sha256) throw new Error(`${feature.id}: evidence changed since source capture: ${key}`);
        checkedFiles.add(key);
      }
      const matches = file.functions.filter((fn) => fn.line <= anchor.endLine && fn.endLine >= anchor.line && (anchor.symbol === null || anchor.symbol === fn.name));
      if (anchor.symbol !== null && /\.tsx?$/u.test(anchor.path) && matches.length === 0) throw new Error(`${feature.id}: symbol ${anchor.symbol} does not match ${key}:${anchor.line}-${anchor.endLine}`);
      for (const fn of matches) {
        const owners = linked.get(fn.id) ?? new Set<string>();
        owners.add(feature.id);
        linked.set(fn.id, owners);
      }
      evidence.push({ ...anchor, revision: repository.revision, sha256: file.sha256, functionIds: matches.map((fn) => fn.id) });
    }
    enriched.push({ ...feature, evidence, acceptanceState: "not-run" });
  }
  const coveredSourceFamilies = new Set(features.flatMap((feature) => feature.sourceFamilyIds));
  const coveredUnifiedFeatures = new Set(features.flatMap((feature) => feature.unifiedFeatureIds));
  requireMembers([...sourceFamilyIds], coveredSourceFamilies, "source-family coverage");
  requireMembers([...unifiedFeatureIds], coveredUnifiedFeatures, "unified-feature coverage");
  const functionRepositories = repositories.map((repository) => {
    const files = repository.files.filter((file) => file.functions.length > 0).map((file) => ({
      path: file.path,
      kind: file.kind,
      functions: file.functions.map((fn) => ({ id: fn.id, featureIds: [...(linked.get(fn.id) ?? [])].sort(compareText) })),
    }));
    const runtimeFunctions = files.filter((file) => file.kind === "runtime").flatMap((file) => file.functions);
    return {
      repository: repository.id,
      sourceSetSha256: repository.sourceSetSha256,
      totalFunctions: files.reduce((sum, file) => sum + file.functions.length, 0),
      runtimeFunctions: runtimeFunctions.length,
      linkedRuntimeFunctions: runtimeFunctions.filter((fn) => fn.featureIds.length > 0).length,
      unassignedRuntimeFunctions: runtimeFunctions.filter((fn) => fn.featureIds.length === 0).length,
      files,
    };
  });
  return {
    schemaVersion: 1,
    generator: "tools/inventory/aggregate-features.ts",
    status: "required-features-inventoried; implementation-and-acceptance-not-established",
    inputs: {
      sourceManifest: { path: "verification/source-manifest.json", sha256: sha256(sourceInput.text) },
      productManifest: { path: "verification/product-manifest.json", sha256: sha256(productInput.text) },
      featureShards: shardInputs,
    },
    summary: {
      features: features.length,
      sourceFamilies: coveredSourceFamilies.size,
      unifiedFeatures: coveredUnifiedFeatures.size,
      workflows: features.reduce((sum, feature) => sum + feature.workflows.length, 0),
      expectedAcceptanceCases: new Set(features.flatMap((feature) => feature.acceptanceCaseIds)).size,
      implementedDonorFeatures: features.filter((feature) => feature.sourceStatus === "implemented").length,
      partialDonorFeatures: features.filter((feature) => feature.sourceStatus === "partial").length,
      missingDonorFeatures: features.filter((feature) => feature.sourceStatus === "missing").length,
      unassignedRuntimeFunctions: functionRepositories.reduce((sum, repository) => sum + repository.unassignedRuntimeFunctions, 0),
      acceptedTargetFeatures: 0,
    },
    features: enriched,
    functionAccounting: {
      method: "Every TypeScript function is retained. Direct links require a matching evidence file and overlapping line range, plus an exact symbol when specified.",
      limits: ["A source anchor identifies relevant implementation; it does not prove the complete call path or passing behavior.", "Unassigned runtime functions remain required census follow-up. An empty featureIds array never means discarded functionality.", "Test and tool functions remain inventoried separately from runtime requirements. Original-language function semantics require original-contract evidence and independent baselines.", "Donor implementation status is separate from target acceptance. Every target feature remains required and not-run."],
      repositories: functionRepositories,
    },
  };
}

if (import.meta.main) {
  try {
    const options = inventoryArguments(process.argv.slice(2));
    const ledger = await buildFeatureLedger(options.root);
    await writeOrCheck(resolve(options.root, "verification/feature-ledger.json"), ledger, options.check);
    process.stdout.write(`${options.check ? "Verified" : "Wrote"} verification/feature-ledger.json: ${ledger.summary.features} required features, ${ledger.summary.workflows} workflows, ${ledger.summary.unassignedRuntimeFunctions} runtime functions awaiting direct feature links. No target acceptance claimed.\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
