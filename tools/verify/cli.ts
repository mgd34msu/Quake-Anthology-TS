import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExecutionRecord, VerificationProfile } from "../../verification/schema/contracts.ts";
import { list, object, parseManifest, parseRecord, profile, sha256 } from "../../verification/schema/parse.ts";
import { parseShard } from "./product.ts";
import type { Shard } from "./product.ts";
import { runManifest, verifyArchivedReport } from "./runner.ts";
import type { CandidateExecutable } from "./runner.ts";

async function readJson(path: string): Promise<unknown> {
  const raw: unknown = JSON.parse(await readFile(path, "utf8"));
  return raw;
}

export async function main(args: readonly string[]): Promise<void> {
  let selectedProfile: VerificationProfile = "dev";
  let manifestPath = "verification/suites.json";
  let outputParent = ".artifacts/verification";
  let shard: Shard = { index: 0, count: 1 };
  let executablePath: string | null = null;
  let resumePath: string | null = null;
  let resumeLatest = false;
  let changed = false;
  let reconcileOnly = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--changed") { changed = true; continue; }
    if (argument === "--reconcile") { reconcileOnly = true; continue; }
    if (argument === "--resume" && (args[index + 1] === undefined || args[index + 1]?.startsWith("--"))) { resumeLatest = true; continue; }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    if (argument === "--profile") selectedProfile = profile(value);
    else if (argument === "--manifest") manifestPath = value;
    else if (argument === "--output-root") outputParent = value;
    else if (argument === "--shard") shard = parseShard(value);
    else if (argument === "--executable") executablePath = value;
    else if (argument === "--resume") resumePath = value;
    else throw new Error(`Unknown verification argument ${argument}`);
    index += 1;
  }
  if (changed && selectedProfile !== "dev") throw new Error("--changed is only valid for the explicitly partial dev profile");
  if (resumeLatest) {
    const { readdir, stat } = await import("node:fs/promises");
    const candidates: { readonly path: string; readonly modified: number }[] = [];
    for (const entry of await readdir(resolve(outputParent), { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || !entry.name.startsWith("run-")) continue;
      const path = resolve(outputParent, entry.name, "report.json");
      try { candidates.push({ path, modified: (await stat(path)).mtimeMs }); } catch { continue; }
    }
    candidates.sort((left, right) => right.modified - left.modified || (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    resumePath = candidates[0]?.path ?? null;
    if (resumePath === null) process.stderr.write("No completed prior report exists; every selected case will receive a fresh attempt.\n");
  }
  const manifest = parseManifest(await readJson(manifestPath));
  let previousRecords: readonly ExecutionRecord[] = [];
  if (resumePath !== null) {
    const report = object(await readJson(resumePath), "previous report");
    previousRecords = list(report["records"], "previous records").map(parseRecord);
  }
  if (reconcileOnly) {
    if (resumePath === null) throw new Error("--reconcile requires --resume REPORT.json");
    const result = await verifyArchivedReport(manifest, previousRecords);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.complete ? 0 : 1;
    return;
  }
  let executable: CandidateExecutable | null = null;
  if (executablePath !== null) {
    const build = object(await readJson(`${executablePath}.build.json`), "build provenance");
    if (build["schemaVersion"] !== 1) throw new Error("Unsupported build provenance version");
    executable = { path: executablePath, sourceSha256: sha256(build["sourceSha256"], "build source hash"), sha256: sha256(build["executableSha256"], "build executable hash") };
  }
  let changedPaths: readonly string[] | null = null;
  if (changed) {
    const child = Bun.spawn(["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"], { stdout: "pipe", stderr: "pipe" });
    const [status, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new Error(`Cannot determine changed files: ${stderr}`);
    const paths: string[] = [];
    const entries = status.split("\0");
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (entry === undefined || entry.length === 0) continue;
      paths.push(entry.slice(3));
      if (entry[0] === "R" || entry[0] === "C" || entry[1] === "R" || entry[1] === "C") {
        const previousPath = entries[index + 1];
        if (previousPath !== undefined) paths.push(previousPath);
        index += 1;
      }
    }
    changedPaths = paths;
  }
  const report = await runManifest(manifest, { workspace: process.cwd(), outputParent, profile: selectedProfile, shard, changedPaths, executable, environment: {}, libraries: [], previousRecords });
  process.stdout.write(`${JSON.stringify({ report: `${report.outputRoot}/report.json`, selected: report.selectedCaseIds.length, selectedComplete: report.selectedComplete, completeRequiredManifest: report.reconciliation.complete, gameplayComplete: report.reconciliation.gameplayComplete, counts: report.reconciliation.counts })}\n`);
  process.exitCode = report.selectedComplete ? 0 : 1;
}

if (import.meta.main) {
  try { await main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
