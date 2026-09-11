import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { CaseManifest, ExecutionRecord, ExpectedCase, Fingerprints, Reconciliation, VerificationStatus } from "../../verification/schema/contracts.ts";
import { parseDriverOutput, parseManifest, parseRecord } from "../../verification/schema/parse.ts";
import { hashBytes, hashJson } from "./hash.ts";
import { isWithin } from "./snapshot.ts";

export function assertionFailures(expected: ExpectedCase, record: Pick<ExecutionRecord, "assertions" | "assertionCount">): readonly string[] {
  const failures: string[] = [];
  if (record.assertionCount !== record.assertions.length) failures.push("Assertion count does not match observations");
  if (record.assertions.length === 0) failures.push("Zero-assertion success is forbidden");
  const ids = new Set<string>();
  const contracts = new Set(expected.contracts.map(contract => contract.id));
  for (const assertion of record.assertions) {
    if (ids.has(assertion.id)) failures.push(`Duplicate assertion ID ${assertion.id}`);
    ids.add(assertion.id);
    if (!contracts.has(assertion.contractId)) failures.push(`Unknown assertion contract ${assertion.contractId}`);
    if (!assertion.passed) failures.push(`Failed assertion ${assertion.id}`);
  }
  for (const contract of expected.contracts) {
    const count = record.assertions.filter(assertion => assertion.contractId === contract.id).length;
    if (count < contract.minimumAssertions) failures.push(`Contract ${contract.id} requires ${contract.minimumAssertions} assertions, received ${count}`);
    if (contract.oracle.sha256 === null) failures.push(`Contract ${contract.id} has no pinned oracle`);
  }
  return failures;
}

export function recordFailures(expected: ExpectedCase, record: ExecutionRecord, manifestHash: string): readonly string[] {
  const failures: string[] = [];
  if (record.caseId !== expected.id || record.configurationId !== expected.configurationId || record.suiteId !== expected.suiteId) failures.push("Record identity does not match expected case");
  if (record.evidenceKind !== expected.evidenceKind) failures.push("Record evidence kind does not match expected case");
  if (hashJson(record.contracts) !== hashJson(expected.contracts)) failures.push("Recorded contracts do not match expected contracts");
  if (hashJson(record.inputs) !== hashJson(expected.requirements)) failures.push("Recorded inputs do not match required inputs");
  if (hashJson(record.command) !== hashJson(expected.command)) failures.push("Recorded command does not match expected command");
  if (record.fingerprints.manifest !== manifestHash || record.fingerprints.expectedCase !== hashJson(expected)) failures.push("Stale manifest or case fingerprint");
  if (record.fingerprints.environment !== hashJson(record.environment)) failures.push("Environment fingerprint does not match recorded conditions");
  if (record.fingerprints.seed !== expected.seed || record.fingerprints.clockSchedule !== expected.clockScheduleSha256 || record.fingerprints.networkSchedule !== expected.networkScheduleSha256) failures.push("Seed or schedule fingerprint does not match expected case");
  if (Date.parse(record.finishedAt) < Date.parse(record.startedAt)) failures.push("Record finishes before it starts");
  if (record.outcome.status === "PASS") {
    failures.push(...assertionFailures(expected, record));
    if (expected.command === null) failures.push("Unbound command cannot pass");
    if (record.resolvedCommand.length === 0) failures.push("PASS has no executed command");
    if (record.fingerprints.source !== record.fingerprints.snapshot) failures.push("Snapshot does not match source fingerprint");
    if (expected.clockScheduleSha256 === null || expected.networkScheduleSha256 === null) failures.push("PASS has an unpinned clock or network schedule");
    if (record.artifacts.length === 0) failures.push("PASS has no raw evidence artifacts");
    if (expected.requirements.some(requirement => requirement.sha256 === null)) failures.push("PASS contains unpinned required inputs");
  }
  if (record.outcome.status === "FAIL" && record.outcome.reasons.length === 0) failures.push("FAIL must explain its failure");
  if (record.outcome.status === "BLOCKED_MISSING_INPUT" && record.outcome.missingInputs.length === 0) failures.push("BLOCKED_MISSING_INPUT must identify its inputs");
  return failures;
}

export function reconcile(manifestInput: CaseManifest, recordInputs: readonly ExecutionRecord[]): Reconciliation {
  const manifest = parseManifest(manifestInput);
  const records = recordInputs.map(parseRecord);
  const manifestSha256 = hashJson(manifest);
  const expected = new Map(manifest.cases.map(item => [item.id, item]));
  const actual = new Map<string, ExecutionRecord>();
  const duplicateCaseIds = new Set<string>();
  const unexpectedCaseIds = new Set<string>();
  const invalidRecords: { readonly caseId: string; readonly reasons: readonly string[] }[] = [];
  const counts: Record<VerificationStatus, number> = { PASS: 0, FAIL: 0, BLOCKED_MISSING_INPUT: 0, TIMEOUT: 0, NOT_RUN: 0 };
  for (const record of records) {
    if (actual.has(record.caseId)) duplicateCaseIds.add(record.caseId);
    actual.set(record.caseId, record);
    const item = expected.get(record.caseId);
    if (item === undefined) unexpectedCaseIds.add(record.caseId);
    else {
      const reasons = recordFailures(item, record, manifestSha256);
      if (reasons.length > 0) invalidRecords.push({ caseId: record.caseId, reasons });
    }
    counts[record.outcome.status] += 1;
  }
  const missingCaseIds = manifest.cases.filter(item => !actual.has(item.id)).map(item => item.id);
  const complete = missingCaseIds.length === 0 && unexpectedCaseIds.size === 0 && duplicateCaseIds.size === 0 && invalidRecords.length === 0 && counts.PASS === manifest.cases.length;
  return {
    schemaVersion: 1, manifestId: manifest.id, manifestSha256, expected: manifest.cases.length, records: records.length, counts,
    missingCaseIds, unexpectedCaseIds: [...unexpectedCaseIds].sort(), duplicateCaseIds: [...duplicateCaseIds].sort(), invalidRecords,
    complete, gameplayComplete: complete && manifest.cases.some(item => item.evidenceKind === "gameplay" || item.evidenceKind === "release"),
  };
}

export async function artifactFailures(record: ExecutionRecord): Promise<readonly string[]> {
  const failures: string[] = [];
  const paths = new Set<string>();
  let foundDriver = false;
  for (const artifact of record.artifacts) {
    if (paths.has(artifact.path)) failures.push(`Duplicate artifact ${artifact.path}`);
    paths.add(artifact.path);
    try {
      const root = await realpath(record.outputRoot);
      const path = resolve(root, artifact.path);
      if (isAbsolute(artifact.path) || !isWithin(root, path) || path === root || !isWithin(root, await realpath(path))) throw new Error("Artifact escapes owned output root");
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Artifact is not a regular owned file");
      const bytes = await readFile(path);
      if (bytes.byteLength !== artifact.bytes || hashBytes(bytes) !== artifact.sha256) failures.push(`Artifact changed: ${artifact.path}`);
      if (artifact.path === "driver-result.json") {
        foundDriver = true;
        const raw: unknown = JSON.parse(bytes.toString("utf8"));
        const output = parseDriverOutput(raw);
        if (output.caseId !== record.caseId || hashJson(output.assertions) !== hashJson(record.assertions) || hashJson(output.checkpoints) !== hashJson(record.checkpoints)) failures.push("Raw driver output does not match recorded assertions/checkpoints");
        for (const declared of output.artifactPaths) {
          if (!record.artifacts.some(item => item.path === declared)) failures.push(`Unrecorded driver artifact ${declared}`);
        }
      }
    } catch (error) {
      failures.push(`Artifact ${artifact.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (record.outcome.status === "PASS" && !foundDriver) failures.push("PASS has no raw driver-result.json");
  return failures;
}

export async function canResume(expected: ExpectedCase, current: Fingerprints, previous: ExecutionRecord): Promise<{ readonly reusable: boolean; readonly reasons: readonly string[] }> {
  const reasons = [...recordFailures(expected, previous, current.manifest)];
  if (previous.outcome.status !== "PASS") reasons.push(`Previous attempt status is ${previous.outcome.status}`);
  if (hashJson(current) !== hashJson(previous.fingerprints)) reasons.push("Source, fixture, environment, executable, or schedule fingerprint changed");
  reasons.push(...await artifactFailures(previous));
  return { reusable: reasons.length === 0, reasons };
}
