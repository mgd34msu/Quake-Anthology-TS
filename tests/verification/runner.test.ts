import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CaseManifest, ExpectedCase } from "../../verification/schema/contracts.ts";
import { hashJson } from "../../tools/verify/hash.ts";
import { runManifest, verifyArchivedReport } from "../../tools/verify/runner.ts";

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const toolingDriver = `
const mode = process.argv[2];
if (mode === "timeout") await Bun.sleep(3000);
const path = process.env["VERIFY_RESULT_PATH"];
const caseId = process.env["VERIFY_CASE_ID"];
if (path === undefined || caseId === undefined) throw new Error("Missing runner context");
await Bun.write(path, JSON.stringify({
  schemaVersion: 1, caseId,
  assertions: mode === "zero" ? [] : [{ id: "observed", contractId: "tooling-driver", passed: mode !== "fail", expected: true, actual: mode !== "fail" }],
  checkpoints: [{ id: "launch", at: new Date().toISOString(), observations: { home: process.env["HOME"], ports: process.env["VERIFY_PORTS"] } }],
  artifactPaths: [],
}));
`;

function expected(id: string, mode: string): ExpectedCase {
  return {
    id, configurationId: id, suiteId: "tooling-driver", evidenceKind: "tooling", configuration: { mode }, profiles: ["dev", "full"], requirements: [],
    contracts: [{ id: "tooling-driver", description: "Disposable process proves verification plumbing only", oracle: { kind: "project", identity: "tooling-test", sha256: hashJson("tooling-test") }, minimumAssertions: 1, tolerances: [] }],
    seed: 4, clockScheduleSha256: hashJson("tooling-no-clock"), networkScheduleSha256: hashJson("tooling-no-network"), sourcePaths: [],
    command: { executable: "{bun}", args: ["driver.ts", mode, ""], environment: {}, timeoutMs: mode === "timeout" ? 25 : 2000, ports: 1, display: "headless" },
  };
}

async function workspace(): Promise<{ readonly source: string; readonly output: string }> {
  const root = await mkdtemp(join(tmpdir(), "quake-verification-test-"));
  temporaryRoots.push(root);
  const source = join(root, "source");
  await mkdir(source);
  await writeFile(join(source, "driver.ts"), toolingDriver);
  return { source, output: join(root, "output") };
}

test("basic runner records all five statuses and rejects zero assertions without claiming gameplay", async () => {
  const paths = await workspace();
  const manifest: CaseManifest = { schemaVersion: 1, id: "tooling-statuses", cases: [
    expected("pass", "pass"), expected("fail", "fail"), expected("timeout", "timeout"), expected("zero", "zero"),
    { ...expected("missing", "pass"), requirements: [{ id: "missing-file", kind: "content", path: "absent.pak", sha256: hashJson("missing") }] },
    { ...expected("unbound", "pass"), command: null },
  ] };
  const result = await runManifest(manifest, { workspace: paths.source, outputParent: paths.output, profile: "full", shard: { index: 0, count: 1 }, changedPaths: null, executable: null, environment: {}, libraries: [], previousRecords: [] });
  expect(result.records.map(record => [record.caseId, record.outcome.status])).toEqual([
    ["pass", "PASS"], ["fail", "FAIL"], ["timeout", "TIMEOUT"], ["zero", "FAIL"], ["missing", "BLOCKED_MISSING_INPUT"], ["unbound", "NOT_RUN"],
  ]);
  expect(result.reconciliation.invalidRecords).toEqual([]);
  expect(result.reconciliation.complete).toBe(false);
  expect(result.reconciliation.gameplayComplete).toBe(false);
  expect(result.records.every(record => record.provenance.runId === result.runId)).toBe(true);
  expect((await readFile(join(result.outputRoot, "report.json"), "utf8")).length).toBeGreaterThan(0);
}, 15000);

test("unchanged successful tooling evidence resumes with an explicit previous-attempt link", async () => {
  const paths = await workspace();
  const manifest: CaseManifest = { schemaVersion: 1, id: "tooling-resume", cases: [expected("resume", "pass")] };
  const options = { workspace: paths.source, outputParent: paths.output, profile: "full", shard: { index: 0, count: 1 }, changedPaths: null, executable: null, environment: {}, libraries: [], previousRecords: [] } satisfies Parameters<typeof runManifest>[1];
  const first = await runManifest(manifest, options);
  const second = await runManifest(manifest, { ...options, previousRecords: first.records });
  expect(first.reconciliation.complete).toBe(true);
  expect(second.reconciliation.complete).toBe(true);
  expect(second.reconciliation.gameplayComplete).toBe(false);
  expect(second.outputRoot).not.toBe(first.outputRoot);
  expect(second.records[0]?.provenance.reuse?.runId).toBe(first.runId);
  expect((await verifyArchivedReport(manifest, second.records)).complete).toBe(true);
}, 15000);
