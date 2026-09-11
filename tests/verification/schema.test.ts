import { describe, expect, test } from "bun:test";
import type { CaseManifest, CompositionDomain, DriverOutput, ExecutionRecord, ExpectedCase, ExpectedContract, InputRequirement } from "../../verification/schema/contracts.ts";
import { jsonValue, parseCase, parseCommand, parseContract, parseDomain, parseDriverOutput, parseManifest, parseRecord, parseRequirement } from "../../verification/schema/parse.ts";
import { generateComposition } from "../../tools/verify/product.ts";

const source: InputRequirement = { id: "original-source", kind: "source", path: "source/game.c", sha256: "a".repeat(64) };
const contract: ExpectedContract = { id: "enumeration", description: "Declared Cartesian coverage", oracle: { kind: "project", identity: "docs/verification-plan.md", sha256: null }, minimumAssertions: 1, tolerances: [] };

function expectedCase(): ExpectedCase {
  return {
    id: "domain/configuration/suite", configurationId: "domain/configuration", suiteId: "suite", evidenceKind: "tooling",
    configuration: { product: "test-fixture" }, profiles: ["dev", "full", "release"], requirements: [source], contracts: [contract],
    seed: 1, clockScheduleSha256: "b".repeat(64), networkScheduleSha256: "c".repeat(64), sourcePaths: ["source/game.c"],
    command: { executable: "bun", args: ["driver.ts", ""], environment: { TEST_VALUE: "" }, timeoutMs: 1000, ports: 0, display: "headless" },
  };
}

function domain(): CompositionDomain {
  const item = expectedCase();
  return {
    schemaVersion: 1, id: "declared-domain", axes: [{ id: "product", values: [{ id: "test-fixture", requirements: [] }] }],
    requirements: [source], suites: [{ id: item.suiteId, evidenceKind: item.evidenceKind, profiles: item.profiles, contracts: item.contracts, command: item.command }],
    seed: item.seed, clockScheduleSha256: item.clockScheduleSha256, networkScheduleSha256: item.networkScheduleSha256, sourcePaths: item.sourcePaths,
  };
}

function driver(): DriverOutput {
  return { schemaVersion: 1, caseId: expectedCase().id, assertions: [{ id: "assertion", contractId: contract.id, passed: true, expected: { value: [1, null, true] }, actual: { value: [1, null, true] } }], checkpoints: [{ id: "checkpoint", at: "2026-09-11T00:00:00.000Z", observations: { tick: 4 } }], artifactPaths: ["trace.json"] };
}

function record(): ExecutionRecord {
  const item = expectedCase();
  const output = driver();
  const hash = "d".repeat(64);
  return {
    schemaVersion: 1, caseId: item.id, configurationId: item.configurationId, suiteId: item.suiteId, evidenceKind: item.evidenceKind, contracts: item.contracts,
    provenance: { runId: "run-1", attemptId: "attempt-1", previousAttempt: null, reuse: null },
    fingerprints: { manifest: hash, expectedCase: hash, source: hash, snapshot: hash, executable: hash, runtimeExecutable: hash, fixtures: hash, environment: hash, clockSchedule: item.clockScheduleSha256, networkSchedule: item.networkScheduleSha256, seed: item.seed },
    inputs: item.requirements, environment: { platform: "linux", architecture: "x64", osRelease: "test-release", bunVersion: "1.3.14", cpu: "test-cpu", libraries: [], variables: { EMPTY: "" } },
    command: item.command, resolvedCommand: ["/usr/bin/bun", "driver.ts"], outputRoot: "/tmp/owned-attempt",
    startedAt: "2026-09-11T00:00:00.000Z", finishedAt: "2026-09-11T00:00:01.000Z", durationMs: 1000,
    assertionCount: 1, assertions: output.assertions, checkpoints: output.checkpoints, artifacts: [{ path: "trace.json", sha256: hash, bytes: 15 }], outcome: { status: "PASS", exitCode: 0 },
  };
}

describe("external verification schema", () => {
  test("round-trips manifest, source identity, arguments, and evidence classification", () => {
    const manifest: CaseManifest = { schemaVersion: 1, id: "fixture-manifest", cases: [expectedCase()] };
    const incoming: unknown = JSON.parse(JSON.stringify(manifest));
    expect(parseManifest(incoming)).toEqual(manifest);
    const incomingDomain: unknown = JSON.parse(JSON.stringify(domain()));
    expect(parseDomain(incomingDomain)).toEqual(domain());
    expect(parseDriverOutput(driver())).toEqual(driver());
  });

  test("rejects malformed manifest roots and unsupported schema versions", () => {
    for (const incoming of [null, [], "manifest", 42, true, {}, { schemaVersion: 2, id: "manifest", cases: [expectedCase()] }, { schemaVersion: 1, id: "manifest", cases: [] }]) expect(() => parseManifest(incoming)).toThrow();
    for (const value of ["null", "[]", '{"schemaVersion":1,"id":"manifest","cases":[null]}']) {
      const incoming: unknown = JSON.parse(value);
      expect(() => parseManifest(incoming)).toThrow();
    }
  });

  test("rejects duplicate case, source, and expectation identities", () => {
    const item = expectedCase();
    expect(() => parseManifest({ schemaVersion: 1, id: "manifest", cases: [item, item] })).toThrow(/Duplicate case ID/);
    expect(() => parseCase({ ...item, requirements: [source, source] })).toThrow(/Duplicate requirement ID/);
    expect(() => parseCase({ ...item, contracts: [contract, contract] })).toThrow(/Duplicate contract ID/);
  });

  test("rejects duplicate or empty declared dimensions at the JSON boundary", () => {
    const item = domain();
    const invalid: readonly unknown[] = [
      { ...item, axes: [] }, { ...item, suites: [] },
      { ...item, axes: [...item.axes, ...item.axes] },
      { ...item, suites: [...item.suites, ...item.suites] },
      { ...item, axes: [{ id: "product", values: [] }] },
      { ...item, axes: [{ id: "product", values: [{ id: "same", requirements: [] }, { id: "same", requirements: [] }] }] },
    ];
    for (const incoming of invalid) expect(() => parseDomain(incoming)).toThrow();
  });

  test("does not silently drop malformed source requirements", () => {
    const invalid: readonly unknown[] = [null, { ...source, id: "" }, { ...source, kind: "guess" }, { ...source, path: "" }, { ...source, sha256: "A".repeat(64) }, { ...source, sha256: "a".repeat(63) }, { ...source, sha256: undefined }];
    for (const requirement of invalid) {
      expect(() => parseRequirement(requirement)).toThrow();
      expect(() => parseCase({ ...expectedCase(), requirements: [source, requirement] })).toThrow();
      expect(() => parseDomain({ ...domain(), requirements: [source, requirement] })).toThrow();
    }
    expect(parseRequirement({ ...source, sha256: null })).toEqual({ ...source, sha256: null });
  });

  test("requires profiles, contracts, explicit oracle attribution, and positive assertion counts", () => {
    expect(() => parseCase({ ...expectedCase(), profiles: [] })).toThrow();
    expect(() => parseCase({ ...expectedCase(), contracts: [] })).toThrow();
    for (const minimumAssertions of [0, -1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => parseContract({ ...contract, minimumAssertions })).toThrow();
    for (const oracle of [null, {}, { ...contract.oracle, kind: "implementation" }, { ...contract.oracle, identity: "" }]) expect(() => parseContract({ ...contract, oracle })).toThrow();
  });

  test("rejects invalid seeds, profiles, schedules, and source-path members", () => {
    for (const seed of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => parseCase({ ...expectedCase(), seed })).toThrow();
    for (const profiles of [["quick"], [null], "full"]) expect(() => parseCase({ ...expectedCase(), profiles })).toThrow();
    for (const clockScheduleSha256 of ["", "ab", "F".repeat(64)]) expect(() => parseCase({ ...expectedCase(), clockScheduleSha256 })).toThrow();
    const unboundSchedules: ExpectedCase = { ...expectedCase(), clockScheduleSha256: null, networkScheduleSha256: null };
    expect(parseCase(unboundSchedules)).toEqual(unboundSchedules);
    expect(() => parseCase({ ...expectedCase(), sourcePaths: ["source/a.c", null] })).toThrow();
  });

  test("accepts justified numeric tolerances and rejects malformed ones", () => {
    const tolerance = { metric: "distance", absolute: 0.001, relative: 0, justification: "Source operation rounding" };
    expect(parseContract({ ...contract, tolerances: [tolerance] }).tolerances).toEqual([tolerance]);
    for (const invalid of [{ ...tolerance, absolute: -1 }, { ...tolerance, relative: Infinity }, { ...tolerance, absolute: "0" }, { ...tolerance, justification: "" }]) expect(() => parseContract({ ...contract, tolerances: [invalid] })).toThrow();
  });

  test("rejects malformed commands and attempts to override owned process resources", () => {
    const command = expectedCase().command;
    if (command === null) throw new Error("Test fixture requires an executable command");
    for (const key of ["HOME", "TMPDIR", "DISPLAY", "WAYLAND_DISPLAY", "XDG_CONFIG_HOME", "VERIFY_CASE_ID", "bad-key"]) expect(() => parseCommand({ ...command, environment: { [key]: "override" } })).toThrow();
    for (const invalid of [{ ...command, timeoutMs: 0 }, { ...command, timeoutMs: 1.5 }, { ...command, ports: 65 }, { ...command, ports: -1 }, { ...command, display: "shared" }, { ...command, args: [false] }, { ...command, environment: { TEST_VALUE: 3 } }]) expect(() => parseCommand(invalid)).toThrow();
  });

  test("preserves hostile JSON property names as data", () => {
    const incoming: unknown = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":"retained"},"é":[null,false,0]}');
    const parsed = jsonValue(incoming);
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(incoming));
    if (typeof parsed !== "object" || parsed === null) throw new Error("Expected parsed object");
    expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
    expect(Object.hasOwn({}, "polluted")).toBe(false);
  });

  test("rejects non-JSON observations at nested boundaries", () => {
    for (const incoming of [undefined, NaN, Infinity, 1n, () => 1, Symbol("observation"), { nested: [undefined] }, { nested: { value: NaN } }]) expect(() => jsonValue(incoming)).toThrow();
  });

  test("does not drop malformed driver assertions or checkpoints", () => {
    const output = driver();
    expect(() => parseDriverOutput({ ...output, assertions: [...output.assertions, null] })).toThrow();
    expect(() => parseDriverOutput({ ...output, assertions: [...output.assertions, ...output.assertions] })).toThrow(/Duplicate assertion ID/);
    expect(() => parseDriverOutput({ ...output, checkpoints: [...output.checkpoints, ...output.checkpoints] })).toThrow(/Duplicate checkpoint ID/);
    expect(() => parseDriverOutput({ ...output, assertions: [{ id: "a", contractId: "c", passed: "true", expected: 1, actual: 1 }] })).toThrow();
    for (const at of ["yesterday", "2026-09-11", "2026-09-11T00:00:00+00:00"]) expect(() => parseDriverOutput({ ...output, checkpoints: [{ id: "c", at, observations: null }] })).toThrow();
    expect(() => parseDriverOutput({ ...output, status: "SKIP" })).toThrow();
    expect(() => parseDriverOutput({ ...output, skipped: true })).toThrow();
  });

  test("accepted domain suites produce parseable cases with a runnable profile", () => {
    const original = domain();
    const noProfiles = { ...original, suites: original.suites.map(suite => ({ ...suite, profiles: [] })) };
    expect(() => {
      const parsed = parseDomain(noProfiles);
      generateComposition(parsed).next();
    }).toThrow();
  });

  test("retains every terminal outcome and refuses skip aliases", () => {
    const outcomes: readonly ExecutionRecord["outcome"][] = [
      { status: "PASS", exitCode: 0 }, { status: "FAIL", exitCode: 1, reasons: ["Assertion mismatch"] },
      { status: "BLOCKED_MISSING_INPUT", missingInputs: [source.id] }, { status: "TIMEOUT", timeoutMs: 1000, exitCode: null },
      { status: "NOT_RUN", reason: "Different shard" },
    ];
    for (const outcome of outcomes) expect(parseRecord({ ...record(), outcome }).outcome).toEqual(outcome);
    for (const status of ["SKIP", "SKIPPED", "SUCCESS", "pass", ""]) expect(() => parseRecord({ ...record(), outcome: { status, exitCode: 0 } })).toThrow();
    expect(() => parseRecord({ ...record(), outcome: { status: "PASS", exitCode: 1 } })).toThrow();
  });

  test("requires executable, source, fixture, environment, and schedule fingerprints", () => {
    const item = record();
    for (const key of Object.keys(item.fingerprints).filter(key => key !== "seed")) {
      expect(() => parseRecord({ ...item, fingerprints: { ...item.fingerprints, [key]: null } })).toThrow();
    }
    expect(parseRecord(item)).toEqual(item);
  });

  test("preserves empty command arguments in the execution record", () => {
    const item: ExecutionRecord = { ...record(), resolvedCommand: ["/usr/bin/bun", "driver.ts", ""] };
    expect(parseRecord(item)).toEqual(item);
  });
});
