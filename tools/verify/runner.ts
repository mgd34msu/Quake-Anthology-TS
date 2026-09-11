import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Artifact, CaseManifest, Checkpoint, CommandContract, DriverOutput, ExecutionRecord, ExpectedCase, Fingerprints, InputRequirement, Reconciliation, RuntimeEnvironment, VerificationProfile } from "../../verification/schema/contracts.ts";
import { parseDriverOutput, parseManifest, parseRecord } from "../../verification/schema/parse.ts";
import { artifactFailures, assertionFailures, canResume, reconcile } from "./accounting.ts";
import { hashBytes, hashFile, hashJson } from "./hash.ts";
import { copyPinnedFile, leasePorts, startPrivateDisplay } from "./isolation.ts";
import { belongsToShard } from "./product.ts";
import type { Shard } from "./product.ts";
import { isWithin, WorkspaceSnapshot } from "./snapshot.ts";

export interface CandidateExecutable {
  readonly path: string;
  readonly sha256: string;
  readonly sourceSha256: string;
}

export interface RunOptions {
  readonly workspace: string;
  readonly outputParent: string;
  readonly profile: VerificationProfile;
  readonly shard: Shard;
  readonly changedPaths: readonly string[] | null;
  readonly executable: CandidateExecutable | null;
  readonly environment: Readonly<Record<string, string>>;
  readonly libraries: readonly InputRequirement[];
  readonly previousRecords: readonly ExecutionRecord[];
}

export interface RunReport {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly outputRoot: string;
  readonly snapshotRoot: string;
  readonly sourceSha256: string;
  readonly profile: VerificationProfile;
  readonly shard: Shard;
  readonly manifest: CaseManifest;
  readonly selectedCaseIds: readonly string[];
  readonly records: readonly ExecutionRecord[];
  readonly reconciliation: Reconciliation;
  readonly selectedComplete: boolean;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function artifact(outputRoot: string, path: string): Promise<Artifact> {
  const root = await realpath(outputRoot);
  const absolute = resolve(root, path);
  if (isAbsolute(path) || !isWithin(root, absolute) || absolute === root || !isWithin(root, await realpath(absolute))) throw new Error(`Artifact escapes owned output: ${path}`);
  const stat = await lstat(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Artifact is not a regular owned file: ${path}`);
  const bytes = await readFile(absolute);
  return { path, sha256: hashBytes(bytes), bytes: bytes.length };
}

async function readDriver(path: string): Promise<DriverOutput> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  return parseDriverOutput(value);
}

interface CheckedInputs {
  readonly identities: readonly { readonly id: string; readonly path: string; readonly sha256: string | null }[];
  readonly missing: readonly string[];
  readonly changed: readonly string[];
}

async function inspectInputs(inputs: readonly InputRequirement[], workspace: string): Promise<CheckedInputs> {
  const identities: { readonly id: string; readonly path: string; readonly sha256: string | null }[] = [];
  const missing: string[] = [];
  const changed: string[] = [];
  for (const input of inputs) {
    const path = resolve(workspace, input.path);
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || await realpath(path) !== path) throw new Error("Required input is not a regular file without symlink ancestors");
      const actual = await hashFile(path);
      identities.push({ id: input.id, path: input.path, sha256: actual });
      if (input.sha256 === null) missing.push(`${input.id}: expected SHA-256 is not pinned`);
      else if (actual !== input.sha256) changed.push(`${input.id}: input hash differs from the expected fixture`);
    } catch (error) {
      identities.push({ id: input.id, path: input.path, sha256: null });
      missing.push(`${input.id}: ${message(error)}`);
    }
  }
  return { identities, missing, changed };
}

function selected(item: ExpectedCase, options: RunOptions): boolean {
  const profileSelected = options.profile === "full" || options.profile === "release" || item.profiles.includes(options.profile);
  const changedSelected = options.changedPaths === null || item.sourcePaths.length === 0 || item.sourcePaths.some(source => options.changedPaths?.some(path => path === source || path.startsWith(`${source}/`)));
  return profileSelected && changedSelected && belongsToShard(item.id, item.seed, options.shard);
}

function substitute(value: string, variables: ReadonlyMap<string, string>): string {
  return value.replace(/\{([^{}]+)\}/g, (_match: string, key: string) => {
    const replacement = variables.get(key);
    if (replacement === undefined) throw new Error(`Unbound command placeholder {${key}}`);
    return replacement;
  });
}

interface ProcessResult {
  readonly outcome: ExecutionRecord["outcome"];
  readonly resolvedCommand: readonly string[];
  readonly output: DriverOutput | null;
  readonly artifacts: readonly Artifact[];
  readonly checkpoints: readonly Checkpoint[];
}

async function executeCase(item: ExpectedCase, command: CommandContract, context: {
  readonly runId: string;
  readonly outputRoot: string;
  readonly snapshotRoot: string;
  readonly workspace: string;
  readonly runtimePath: string;
  readonly candidatePath: string | null;
  readonly environment: RuntimeEnvironment;
  readonly displayProvider: InputRequirement | null;
}): Promise<ProcessResult> {
  const root = context.outputRoot;
  const home = join(root, "home");
  const temporary = join(root, "tmp");
  const data = join(root, "inputs");
  await Promise.all([home, temporary, data].map(path => mkdir(path, { recursive: true })));
  const ports = await leasePorts(command.ports, `${context.runId}/${item.id}`);
  const resolvedCommand: string[] = [];
  const artifacts: Artifact[] = [];
  let display: Awaited<ReturnType<typeof startPrivateDisplay>> | null = null;
  const variables = new Map<string, string>([
    ["snapshot", context.snapshotRoot], ["output", root], ["home", home], ["data", data], ["case", item.id], ["result", join(root, "driver-result.json")], ["bun", context.runtimePath],
  ]);
  if (context.candidatePath !== null) variables.set("executable", context.candidatePath);
  for (const [index, port] of ports.ports.entries()) variables.set(`port:${index}`, String(port));
  try {
    for (const input of item.requirements) {
      if (input.sha256 === null) throw new Error(`Unpinned input ${input.id} reached execution`);
      const destination = join(data, hashBytes(input.id));
      await copyPinnedFile(resolve(context.workspace, input.path), destination, input.sha256, input.kind === "executable");
      variables.set(`input:${input.id}`, destination);
    }
    const executable = substitute(command.executable, variables);
    const executablePath = isAbsolute(executable) ? executable : resolve(context.snapshotRoot, executable);
    if (!isWithin(context.snapshotRoot, executablePath) && executablePath !== context.runtimePath && executablePath !== context.candidatePath && !isWithin(data, executablePath)) throw new Error("Command executable must come from owned source, pinned runtime, candidate, or required inputs");
    resolvedCommand.push(executablePath, ...command.args.map(value => substitute(value, variables)));
    const env: Record<string, string> = {
      ...context.environment.variables,
      ...Object.fromEntries(Object.entries(command.environment).map(([key, value]) => [key, substitute(value, variables)])),
      HOME: home, TMPDIR: temporary, XDG_CONFIG_HOME: join(home, "config"), XDG_DATA_HOME: join(home, "data"), XDG_CACHE_HOME: join(home, "cache"), XDG_RUNTIME_DIR: join(home, "runtime"),
      VERIFY_OUTPUT_ROOT: root, VERIFY_DATA_ROOT: data, VERIFY_CASE_ID: item.id, VERIFY_RESULT_PATH: join(root, "driver-result.json"), VERIFY_PORTS: ports.ports.join(","), VERIFY_SEED: String(item.seed),
      SDL_VIDEODRIVER: command.display === "offscreen" ? "offscreen" : command.display === "xvfb" ? "x11" : "dummy", SDL_AUDIODRIVER: command.environment["SDL_AUDIODRIVER"] ?? "dummy",
    };
    if (command.display === "xvfb") {
      if (context.displayProvider === null || context.displayProvider.sha256 === null) throw new Error("Private display executable was not pinned");
      const xvfb = join(root, "xvfb");
      await copyPinnedFile(context.displayProvider.path, xvfb, context.displayProvider.sha256, true);
      display = await startPrivateDisplay(xvfb, root, env);
      env["DISPLAY"] = display.display;
    }
    await mkdir(env["XDG_RUNTIME_DIR"] ?? join(home, "runtime"), { recursive: true, mode: 0o700 });
    await writeFile(join(root, "launch.json"), JSON.stringify({ command: resolvedCommand, cwd: context.snapshotRoot, environment: env, ports: ports.ports }, null, 2), { flag: "wx" });
    await ports.releaseSockets();
    const stdoutPath = join(root, "stdout.txt");
    const stderrPath = join(root, "stderr.txt");
    const child = Bun.spawn(resolvedCommand, { cwd: context.snapshotRoot, env, stdin: "ignore", stdout: Bun.file(stdoutPath), stderr: Bun.file(stderrPath), detached: true });
    let timedOut = false;
    function killGroup(): void {
      try { process.kill(-child.pid, "SIGKILL"); }
      catch { child.kill("SIGKILL"); }
    }
    const timer = setTimeout(() => { timedOut = true; killGroup(); }, command.timeoutMs);
    let exitCode: number;
    try { exitCode = await child.exited; }
    finally { clearTimeout(timer); killGroup(); }
    for (const path of ["launch.json", "stdout.txt", "stderr.txt", ...(display === null ? [] : ["display.txt", "display-stderr.txt"])]) artifacts.push(await artifact(root, path));
    let output: DriverOutput | null = null;
    const reasons: string[] = [];
    try {
      output = await readDriver(join(root, "driver-result.json"));
      artifacts.push(await artifact(root, "driver-result.json"));
      for (const path of output.artifactPaths) {
        if (artifacts.some(existing => existing.path === path)) throw new Error(`Duplicate or reserved driver artifact ${path}`);
        artifacts.push(await artifact(root, path));
      }
    } catch (error) { reasons.push(`Missing or invalid driver output: ${message(error)}`); }
    if (timedOut) return { outcome: { status: "TIMEOUT", timeoutMs: command.timeoutMs, exitCode }, resolvedCommand, output, artifacts, checkpoints: output?.checkpoints ?? [] };
    if (exitCode !== 0) reasons.push(`Driver exited ${exitCode}`);
    if (output !== null) {
      if (output.caseId !== item.id) reasons.push("Driver output case ID differs from expected case");
      reasons.push(...assertionFailures(item, { assertions: output.assertions, assertionCount: output.assertions.length }));
    }
    return { outcome: reasons.length === 0 ? { status: "PASS", exitCode: 0 } : { status: "FAIL", exitCode, reasons }, resolvedCommand, output, artifacts, checkpoints: output?.checkpoints ?? [] };
  } catch (error) {
    return { outcome: { status: "FAIL", exitCode: null, reasons: [message(error)] }, resolvedCommand, output: null, artifacts, checkpoints: [] };
  } finally { if (display !== null) await display.dispose(); await ports.dispose(); }
}

export async function runManifest(manifestInput: CaseManifest, options: RunOptions): Promise<RunReport> {
  const manifest = parseManifest(manifestInput);
  const workspace = await realpath(options.workspace);
  const outputParent = resolve(options.outputParent);
  if (isWithin(workspace, outputParent) && !isWithin(join(workspace, ".artifacts"), outputParent)) throw new Error("Output roots inside source must be under .artifacts");
  const previous = new Map<string, ExecutionRecord>();
  for (const recordInput of options.previousRecords) {
    const record = parseRecord(recordInput);
    if (previous.has(record.caseId)) throw new Error(`Resume input contains duplicate case ID ${record.caseId}`);
    previous.set(record.caseId, record);
  }
  const snapshot = await WorkspaceSnapshot.capture(workspace);
  await mkdir(outputParent, { recursive: true });
  const outputRoot = await mkdtemp(join(outputParent, "run-"));
  const runId = randomUUID();
  const snapshotRoot = await snapshot.materialize(join(outputRoot, "source"));
  await writeFile(join(outputRoot, "snapshot.json"), JSON.stringify(snapshot.manifest, null, 2), { flag: "wx" });
  const runtimeHash = await hashFile(process.execPath);
  const runtimePath = join(outputRoot, "bun");
  await copyPinnedFile(await realpath(process.execPath), runtimePath, runtimeHash, true);
  let candidatePath: string | null = null;
  let candidateFailure: string | null = null;
  if (options.executable !== null) {
    if (options.executable.sourceSha256 !== snapshot.manifest.sha256) candidateFailure = "Compiled executable was built from a different source snapshot";
    else {
      candidatePath = join(outputRoot, "candidate");
      try { await copyPinnedFile(resolve(workspace, options.executable.path), candidatePath, options.executable.sha256, true); }
      catch (error) { candidateFailure = `Compiled executable is stale or absent: ${message(error)}`; candidatePath = null; }
    }
  }
  const records: ExecutionRecord[] = [];
  const selectedCaseIds: string[] = [];
  for (const item of manifest.cases) {
    const start = performance.now();
    const startedAt = new Date().toISOString();
    const attemptId = randomUUID();
    const attemptRoot = join(outputRoot, "attempts", attemptId);
    await mkdir(attemptRoot, { recursive: true });
    const displayPath = item.command?.display === "xvfb" ? Bun.which("Xvfb") : null;
    const displayProvider: InputRequirement | null = displayPath === null ? null : { id: "runner:private-display", kind: "executable", path: await realpath(displayPath), sha256: await hashFile(displayPath) };
    const environment: RuntimeEnvironment = {
      platform: platform(), architecture: arch(), osRelease: release(), bunVersion: Bun.version, cpu: cpus()[0]?.model ?? "unknown", libraries: [...options.libraries, ...(displayProvider === null ? [] : [displayProvider])],
      variables: { PATH: process.env["PATH"] ?? "", LANG: "C.UTF-8", TZ: "UTC", ...options.environment, ...item.command?.environment },
    };
    const checked = await inspectInputs([...item.requirements, ...environment.libraries], workspace);
    const fingerprints: Fingerprints = {
      manifest: hashJson(manifest), expectedCase: hashJson(item), source: snapshot.manifest.sha256, snapshot: snapshot.manifest.sha256,
      executable: options.executable?.sha256 ?? runtimeHash, runtimeExecutable: runtimeHash, fixtures: hashJson(checked.identities), environment: hashJson(environment),
      clockSchedule: item.clockScheduleSha256, networkSchedule: item.networkScheduleSha256, seed: item.seed,
    };
    const prior = previous.get(item.id);
    const previousAttempt = prior === undefined ? null : { runId: prior.provenance.runId, attemptId: prior.provenance.attemptId, recordSha256: hashJson(prior) };
    const base = {
      schemaVersion: 1, caseId: item.id, configurationId: item.configurationId, suiteId: item.suiteId, evidenceKind: item.evidenceKind,
      contracts: item.contracts, provenance: { runId, attemptId, previousAttempt, reuse: null }, fingerprints, inputs: item.requirements, environment,
      command: item.command, resolvedCommand: [], outputRoot: attemptRoot, startedAt, finishedAt: startedAt, durationMs: 0, assertionCount: 0, assertions: [], checkpoints: [], artifacts: [],
    } satisfies Omit<ExecutionRecord, "outcome">;
    let record: ExecutionRecord;
    const missing = [...checked.missing, ...item.contracts.filter(contract => contract.oracle.sha256 === null).map(contract => `${contract.id}: independent oracle is not pinned`), ...(item.clockScheduleSha256 === null ? ["Clock schedule is not pinned"] : []), ...(item.networkScheduleSha256 === null ? ["Network schedule is not pinned"] : []), ...(item.command?.display === "xvfb" && displayProvider === null ? ["Private Xvfb display executable is unavailable"] : [])];
    const chosen = selected(item, options);
    if (chosen) selectedCaseIds.push(item.id);
    if (!chosen) record = { ...base, outcome: { status: "NOT_RUN", reason: "Case is outside this explicit profile, changed-path selection, or shard; it remains required" } };
    else if (missing.length > 0) record = { ...base, outcome: { status: "BLOCKED_MISSING_INPUT", missingInputs: missing } };
    else if (checked.changed.length > 0 || candidateFailure !== null) record = { ...base, outcome: { status: "FAIL", exitCode: null, reasons: [...checked.changed, ...(candidateFailure === null ? [] : [candidateFailure])] } };
    else if (item.command === null) record = { ...base, outcome: { status: "NOT_RUN", reason: "Required behavior has no bound executable driver" } };
    else if (options.profile === "release" && candidatePath === null) record = { ...base, outcome: { status: "BLOCKED_MISSING_INPUT", missingInputs: ["Release profile requires an exact compiled executable and matching build provenance"] } };
    else if (options.profile === "release" && item.evidenceKind !== "tooling" && ![item.command.executable, ...item.command.args].some(value => value.includes("{executable}"))) record = { ...base, outcome: { status: "NOT_RUN", reason: "Release behavior driver does not bind the exact candidate executable" } };
    else if (prior !== undefined && (await canResume(item, fingerprints, prior)).reusable) {
      for (const priorArtifact of prior.artifacts) {
        const destination = join(attemptRoot, priorArtifact.path);
        await mkdir(dirname(destination), { recursive: true });
        await copyPinnedFile(resolve(prior.outputRoot, priorArtifact.path), destination, priorArtifact.sha256);
      }
      record = { ...prior, provenance: { runId, attemptId, previousAttempt, reuse: previousAttempt }, outputRoot: attemptRoot, startedAt, finishedAt: new Date().toISOString(), durationMs: performance.now() - start };
    } else {
      const result = await executeCase(item, item.command, { runId, outputRoot: attemptRoot, snapshotRoot, workspace, runtimePath, candidatePath, environment, displayProvider });
      const after = await inspectInputs([...item.requirements, ...environment.libraries], workspace);
      const sourceAfter = await WorkspaceSnapshot.capture(workspace);
      const snapshotAfter = await WorkspaceSnapshot.capture(snapshotRoot);
      const drift: string[] = [];
      if (hashJson(after.identities) !== hashJson(checked.identities)) drift.push("Required input changed during execution");
      if (sourceAfter.manifest.sha256 !== snapshot.manifest.sha256) drift.push("Source workspace changed during execution");
      if (snapshotAfter.manifest.sha256 !== snapshot.manifest.sha256) drift.push("Owned source snapshot changed during execution");
      if (await hashFile(runtimePath) !== runtimeHash) drift.push("Runtime executable changed during execution");
      if (candidatePath !== null && await hashFile(candidatePath) !== options.executable?.sha256) drift.push("Candidate executable changed during execution");
      record = {
        ...base, resolvedCommand: result.resolvedCommand, finishedAt: new Date().toISOString(), durationMs: performance.now() - start,
        assertionCount: result.output?.assertions.length ?? 0, assertions: result.output?.assertions ?? [], checkpoints: result.checkpoints, artifacts: result.artifacts,
        outcome: drift.length === 0 ? result.outcome : { status: "FAIL", exitCode: result.outcome.status === "PASS" || result.outcome.status === "FAIL" || result.outcome.status === "TIMEOUT" ? result.outcome.exitCode : null, reasons: drift },
      };
    }
    const parsed = parseRecord(record);
    await writeFile(join(attemptRoot, "record.json"), JSON.stringify(parsed, null, 2), { flag: "wx" });
    records.push(parsed);
  }
  const reconciliation = reconcile(manifest, records);
  const selectedSet = new Set(selectedCaseIds);
  const report: RunReport = {
    schemaVersion: 1, runId, outputRoot, snapshotRoot, sourceSha256: snapshot.manifest.sha256, profile: options.profile, shard: options.shard, manifest, selectedCaseIds, records, reconciliation,
    selectedComplete: selectedCaseIds.length > 0 && records.filter(record => selectedSet.has(record.caseId)).every(record => record.outcome.status === "PASS") && reconciliation.invalidRecords.length === 0,
  };
  await writeFile(join(outputRoot, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  return report;
}

export async function verifyArchivedReport(manifest: CaseManifest, records: readonly ExecutionRecord[]): Promise<Reconciliation> {
  const report = reconcile(manifest, records);
  const invalidRecords = [...report.invalidRecords];
  for (const record of records) {
    const reasons = await artifactFailures(record);
    if (reasons.length > 0) invalidRecords.push({ caseId: record.caseId, reasons });
  }
  return { ...report, invalidRecords, complete: report.complete && invalidRecords.length === 0, gameplayComplete: report.gameplayComplete && invalidRecords.length === 0 };
}
