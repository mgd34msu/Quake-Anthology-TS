import type { Artifact, AssertionObservation, AttemptProvenance, CaseManifest, Checkpoint, CommandContract, CompositionDomain, DriverOutput, ExecutionRecord, ExpectedCase, ExpectedContract, Fingerprints, InputKind, InputRequirement, JsonValue, RuntimeEnvironment, VerificationProfile } from "./contracts.ts";
import { isObject, isUnknownArray } from "../../tools/verify/hash.ts";
import { validateDomain } from "../../tools/verify/product.ts";

export function object(value: unknown, label: string): Record<string, unknown> {
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  return value;
}
export function list(value: unknown, label: string): readonly unknown[] {
  if (!isUnknownArray(value)) throw new Error(`${label} must be an array`);
  return value;
}
export function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a nonempty string`);
  return value;
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}
function number(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) throw new Error(`${label} must be finite and >= ${minimum}`);
  return value;
}
function integer(value: unknown, label: string, minimum = 0): number {
  const parsed = number(value, label, minimum);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} must be a safe integer`);
  return parsed;
}
export function sha256(value: unknown, label: string): string {
  const parsed = string(value, label);
  if (!/^[a-f0-9]{64}$/.test(parsed)) throw new Error(`${label} must be a lowercase SHA-256`);
  return parsed;
}
function nullableHash(value: unknown, label: string): string | null {
  return value === null ? null : sha256(value, label);
}
function version(value: unknown): 1 {
  if (value !== 1) throw new Error("Unsupported verification schema version");
  return value;
}
function strings(value: unknown, label: string): readonly string[] {
  return list(value, label).map(item => string(item, label));
}
function stringRecord(value: unknown, label: string, allowEmpty = false): Readonly<Record<string, string>> {
  const parsed = object(value, label);
  return Object.fromEntries(Object.entries(parsed).map(([key, item]) => [string(key, label), allowEmpty ? text(item, label) : string(item, label)]));
}
export function profile(value: unknown): VerificationProfile {
  if (value === "dev" || value === "integration" || value === "full" || value === "release") return value;
  throw new Error(`Unsupported verification profile ${String(value)}`);
}
function inputKind(value: unknown): InputKind {
  if (value === "source" || value === "reference" || value === "content" || value === "executable" || value === "schedule") return value;
  throw new Error(`Unsupported input kind ${String(value)}`);
}
function evidenceKind(value: unknown): ExpectedCase["evidenceKind"] {
  if (value === "tooling" || value === "component" || value === "gameplay" || value === "release") return value;
  throw new Error(`Unsupported evidence kind ${String(value)}`);
}
export function parseRequirement(value: unknown): InputRequirement {
  const input = object(value, "input requirement");
  return { id: string(input["id"], "input ID"), kind: inputKind(input["kind"]), path: string(input["path"], "input path"), sha256: nullableHash(input["sha256"], "input SHA-256") };
}
export function parseContract(value: unknown): ExpectedContract {
  const contract = object(value, "expected contract");
  const oracle = object(contract["oracle"], "oracle");
  const kind = oracle["kind"];
  if (kind !== "source" && kind !== "reference" && kind !== "project") throw new Error("Unknown oracle kind");
  return {
    id: string(contract["id"], "contract ID"), description: string(contract["description"], "contract description"),
    oracle: { kind, identity: string(oracle["identity"], "oracle identity"), sha256: nullableHash(oracle["sha256"], "oracle SHA-256") },
    minimumAssertions: integer(contract["minimumAssertions"], "minimum assertions", 1),
    tolerances: list(contract["tolerances"], "tolerances").map(value => {
      const tolerance = object(value, "tolerance");
      return { metric: string(tolerance["metric"], "metric"), absolute: number(tolerance["absolute"], "absolute tolerance"), relative: number(tolerance["relative"], "relative tolerance"), justification: string(tolerance["justification"], "tolerance justification") };
    }),
  };
}
export function parseCommand(value: unknown): CommandContract | null {
  if (value === null) return null;
  const command = object(value, "command");
  const display = command["display"];
  if (display !== "headless" && display !== "offscreen" && display !== "xvfb") throw new Error("Unknown display isolation mode");
  const ports = integer(command["ports"], "ports");
  if (ports > 64) throw new Error("A case may lease at most 64 ports");
  const environment = stringRecord(command["environment"], "command environment", true);
  for (const key of Object.keys(environment)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || /^(?:HOME|TMPDIR|XDG_.*|DISPLAY|WAYLAND_DISPLAY|VERIFY_.*)$/.test(key)) throw new Error(`Reserved or invalid command environment key ${key}`);
  }
  return { executable: string(command["executable"], "executable"), args: list(command["args"], "arguments").map(value => text(value, "argument")), environment, timeoutMs: integer(command["timeoutMs"], "timeout", 1), ports, display };
}
export function parseCase(value: unknown): ExpectedCase {
  const item = object(value, "expected case");
  const contracts = list(item["contracts"], "contracts").map(parseContract);
  if (contracts.length === 0) throw new Error("Expected case must have a contract");
  const profiles = list(item["profiles"], "profiles").map(profile);
  if (profiles.length === 0) throw new Error("Expected case must have a profile");
  const result: ExpectedCase = {
    id: string(item["id"], "case ID"), configurationId: string(item["configurationId"], "configuration ID"), suiteId: string(item["suiteId"], "suite ID"), evidenceKind: evidenceKind(item["evidenceKind"]),
    configuration: stringRecord(item["configuration"], "configuration"), profiles,
    requirements: list(item["requirements"], "requirements").map(parseRequirement), contracts,
    seed: integer(item["seed"], "seed"), clockScheduleSha256: nullableHash(item["clockScheduleSha256"], "clock schedule hash"), networkScheduleSha256: nullableHash(item["networkScheduleSha256"], "network schedule hash"),
    sourcePaths: strings(item["sourcePaths"], "source paths"), command: parseCommand(item["command"]),
  };
  uniqueIds(result.contracts, "contract");
  uniqueIds(result.requirements, "requirement");
  return result;
}
export function uniqueIds(items: readonly { readonly id: string }[], label: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) throw new Error(`Duplicate ${label} ID ${item.id}`);
    seen.add(item.id);
  }
}
export function parseManifest(value: unknown): CaseManifest {
  const manifest = object(value, "case manifest");
  const cases = list(manifest["cases"], "cases").map(parseCase);
  if (cases.length === 0) throw new Error("Case manifest must retain at least one required case");
  uniqueIds(cases, "case");
  return { schemaVersion: version(manifest["schemaVersion"]), id: string(manifest["id"], "manifest ID"), cases };
}
export function parseDomain(value: unknown): CompositionDomain {
  const domain = object(value, "composition domain");
  const result: CompositionDomain = {
    schemaVersion: version(domain["schemaVersion"]), id: string(domain["id"], "domain ID"),
    axes: list(domain["axes"], "axes").map(value => {
      const axis = object(value, "axis");
      return { id: string(axis["id"], "axis ID"), values: list(axis["values"], "axis values").map(value => {
        const member = object(value, "axis value");
        return { id: string(member["id"], "axis value ID"), requirements: list(member["requirements"], "axis requirements").map(parseRequirement) };
      }) };
    }),
    requirements: list(domain["requirements"], "requirements").map(parseRequirement),
    suites: list(domain["suites"], "suites").map(value => {
      const suite = object(value, "suite");
      return { id: string(suite["id"], "suite ID"), evidenceKind: evidenceKind(suite["evidenceKind"]), profiles: list(suite["profiles"], "suite profiles").map(profile), contracts: list(suite["contracts"], "suite contracts").map(parseContract), command: parseCommand(suite["command"]) };
    }),
    seed: integer(domain["seed"], "seed"), clockScheduleSha256: nullableHash(domain["clockScheduleSha256"], "clock schedule hash"), networkScheduleSha256: nullableHash(domain["networkScheduleSha256"], "network schedule hash"), sourcePaths: strings(domain["sourcePaths"], "source paths"),
  };
  validateDomain(result);
  return result;
}
export function jsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (isUnknownArray(value)) {
    return value.map(jsonValue);
  }
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  throw new Error("Observation must be finite JSON data");
}
function parseAssertion(value: unknown): AssertionObservation {
  const assertion = object(value, "assertion");
  if (typeof assertion["passed"] !== "boolean") throw new Error("Assertion passed must be boolean");
  return { id: string(assertion["id"], "assertion ID"), contractId: string(assertion["contractId"], "assertion contract ID"), passed: assertion["passed"], expected: jsonValue(assertion["expected"]), actual: jsonValue(assertion["actual"]) };
}
function timestamp(value: unknown, label: string): string {
  const parsed = string(value, label);
  if (!Number.isFinite(Date.parse(parsed)) || new Date(parsed).toISOString() !== parsed) throw new Error(`${label} must be an ISO UTC timestamp`);
  return parsed;
}
function parseCheckpoint(value: unknown): Checkpoint {
  const checkpoint = object(value, "checkpoint");
  return { id: string(checkpoint["id"], "checkpoint ID"), at: timestamp(checkpoint["at"], "checkpoint timestamp"), observations: jsonValue(checkpoint["observations"]) };
}
export function parseDriverOutput(value: unknown): DriverOutput {
  const output = object(value, "driver output");
  const keys = new Set(["schemaVersion", "caseId", "assertions", "checkpoints", "artifactPaths"]);
  for (const key of Object.keys(output)) if (!keys.has(key)) throw new Error(`Unknown driver output field ${key}; status and skips come from the runner`);
  const assertions = list(output["assertions"], "assertions").map(parseAssertion);
  const checkpoints = list(output["checkpoints"], "checkpoints").map(parseCheckpoint);
  uniqueIds(assertions, "assertion");
  uniqueIds(checkpoints, "checkpoint");
  return { schemaVersion: version(output["schemaVersion"]), caseId: string(output["caseId"], "driver case ID"), assertions, checkpoints, artifactPaths: strings(output["artifactPaths"], "artifact paths") };
}
function parseArtifact(value: unknown): Artifact {
  const artifact = object(value, "artifact");
  return { path: string(artifact["path"], "artifact path"), sha256: sha256(artifact["sha256"], "artifact hash"), bytes: integer(artifact["bytes"], "artifact bytes") };
}
function parseFingerprints(value: unknown): Fingerprints {
  const hashes = object(value, "fingerprints");
  return { manifest: sha256(hashes["manifest"], "manifest hash"), expectedCase: sha256(hashes["expectedCase"], "case hash"), source: sha256(hashes["source"], "source hash"), snapshot: sha256(hashes["snapshot"], "snapshot hash"), executable: sha256(hashes["executable"], "executable hash"), runtimeExecutable: sha256(hashes["runtimeExecutable"], "runtime executable hash"), fixtures: sha256(hashes["fixtures"], "fixture hash"), environment: sha256(hashes["environment"], "environment hash"), clockSchedule: nullableHash(hashes["clockSchedule"], "clock hash"), networkSchedule: nullableHash(hashes["networkSchedule"], "network hash"), seed: integer(hashes["seed"], "fingerprint seed") };
}
function parseEnvironment(value: unknown): RuntimeEnvironment {
  const environment = object(value, "runtime environment");
  return { platform: string(environment["platform"], "platform"), architecture: string(environment["architecture"], "architecture"), osRelease: string(environment["osRelease"], "OS release"), bunVersion: string(environment["bunVersion"], "Bun version"), cpu: string(environment["cpu"], "CPU"), libraries: list(environment["libraries"], "libraries").map(parseRequirement), variables: stringRecord(environment["variables"], "environment variables", true) };
}
function parseAttemptLink(value: unknown): AttemptProvenance["previousAttempt"] {
  if (value === null) return null;
  const link = object(value, "attempt link");
  return { runId: string(link["runId"], "previous run ID"), attemptId: string(link["attemptId"], "previous attempt ID"), recordSha256: sha256(link["recordSha256"], "record hash") };
}
function parseOutcome(value: unknown): ExecutionRecord["outcome"] {
  const outcome = object(value, "outcome");
  switch (outcome["status"]) {
    case "PASS": {
      if (outcome["exitCode"] !== 0) throw new Error("PASS requires exit code zero");
      return { status: "PASS", exitCode: 0 };
    }
    case "FAIL": return { status: "FAIL", exitCode: outcome["exitCode"] === null ? null : integer(outcome["exitCode"], "exit code", -2147483648), reasons: strings(outcome["reasons"], "failure reasons") };
    case "TIMEOUT": return { status: "TIMEOUT", timeoutMs: integer(outcome["timeoutMs"], "timeout", 1), exitCode: outcome["exitCode"] === null ? null : integer(outcome["exitCode"], "exit code", -2147483648) };
    case "BLOCKED_MISSING_INPUT": return { status: "BLOCKED_MISSING_INPUT", missingInputs: strings(outcome["missingInputs"], "missing inputs") };
    case "NOT_RUN": return { status: "NOT_RUN", reason: string(outcome["reason"], "not-run reason") };
    default: throw new Error(`Unknown verification status ${String(outcome["status"])}; skips are not accepted`);
  }
}
export function parseRecord(value: unknown): ExecutionRecord {
  const record = object(value, "execution record");
  const provenance = object(record["provenance"], "provenance");
  const parsed: ExecutionRecord = {
    schemaVersion: version(record["schemaVersion"]), caseId: string(record["caseId"], "case ID"), configurationId: string(record["configurationId"], "configuration ID"), suiteId: string(record["suiteId"], "suite ID"), evidenceKind: evidenceKind(record["evidenceKind"]), contracts: list(record["contracts"], "record contracts").map(parseContract),
    provenance: { runId: string(provenance["runId"], "run ID"), attemptId: string(provenance["attemptId"], "attempt ID"), previousAttempt: parseAttemptLink(provenance["previousAttempt"]), reuse: parseAttemptLink(provenance["reuse"]) },
    fingerprints: parseFingerprints(record["fingerprints"]), inputs: list(record["inputs"], "record inputs").map(parseRequirement), environment: parseEnvironment(record["environment"]), command: parseCommand(record["command"]), resolvedCommand: list(record["resolvedCommand"], "resolved command").map((value, index) => index === 0 ? string(value, "resolved executable") : text(value, "resolved argument")), outputRoot: string(record["outputRoot"], "output root"),
    startedAt: timestamp(record["startedAt"], "start timestamp"), finishedAt: timestamp(record["finishedAt"], "finish timestamp"), durationMs: number(record["durationMs"], "duration"), assertionCount: integer(record["assertionCount"], "assertion count"), assertions: list(record["assertions"], "record assertions").map(parseAssertion), checkpoints: list(record["checkpoints"], "record checkpoints").map(parseCheckpoint), artifacts: list(record["artifacts"], "record artifacts").map(parseArtifact), outcome: parseOutcome(record["outcome"]),
  };
  if (parsed.outcome.status === "PASS" && (parsed.fingerprints.clockSchedule === null || parsed.fingerprints.networkSchedule === null)) throw new Error("PASS requires pinned clock and network schedules");
  return parsed;
}
