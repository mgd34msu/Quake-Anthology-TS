import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import ts from "typescript";
import { WorkspaceSnapshot } from "./verify/snapshot.ts";

export type BuildKind = "runtime" | "tools";

interface BuildEntry {
  readonly source: string;
  readonly executable: string;
}

interface BuiltEntry extends BuildEntry {
  readonly sha256: string;
  readonly bytes: number;
}

export interface BuildEvidence {
  readonly schemaVersion: 1;
  readonly kind: BuildKind;
  readonly builtAt: string;
  readonly directory: string;
  readonly sourceSha256: string;
  readonly snapshotPath: string;
  readonly bun: { readonly version: string; readonly revision: string; readonly executable: string };
  readonly typescript: string;
  readonly platform: string;
  readonly architecture: string;
  readonly gates: readonly string[];
  readonly entries: readonly BuiltEntry[];
}

export function parseBuildKind(args: readonly string[]): BuildKind {
  if (args.length === 0) return "runtime";
  if (args.length === 1 && args[0] === "--tools") return "tools";
  throw new Error("Usage: bun tools/build.ts [--tools]");
}

async function runGate(snapshotPath: string, name: string): Promise<void> {
  const child = Bun.spawn([process.execPath, "run", name], { cwd: snapshotPath, stdout: "inherit", stderr: "inherit" });
  const code = await child.exited;
  if (code !== 0) throw new Error(`Build snapshot ${name} failed with exit ${code}.`);
}

export async function buildWorkspace(directory: string, kind: BuildKind): Promise<BuildEvidence> {
  if (process.platform !== "linux") throw new Error("The first build target is Linux. Run this build on Linux.");
  const workspace = resolve(directory);
  const entries: readonly BuildEntry[] = kind === "runtime"
    ? [{ source: "src/main.ts", executable: "quake-typescript" }]
    : [{ source: "docs/validate-plan.ts", executable: "validate-plan" }, { source: "tools/check-policy.ts", executable: "check-policy" }];
  for (const entry of entries) {
    if (!await Bun.file(join(workspace, entry.source)).exists()) {
      throw new Error(kind === "runtime"
        ? "Runtime build unavailable: src/main.ts is not implemented. W73 owns the real application entry. Use build:tools to compile existing tooling."
        : `Build entry is missing: ${entry.source}`);
    }
  }
  const snapshot = await WorkspaceSnapshot.capture(workspace);
  const snapshotPath = await snapshot.materialize(join(workspace, ".artifacts", "snapshots"), "build-");
  await runGate(snapshotPath, "typecheck");
  await runGate(snapshotPath, "policy");
  const dist = join(workspace, "dist");
  await mkdir(dist, { recursive: true });
  const candidate = await mkdtemp(join(dist, `.candidate-${kind}-`));
  let published = false;
  try {
    const builtEntries: BuiltEntry[] = [];
    for (const entry of entries) {
      const result = await Bun.build({
        entrypoints: [join(snapshotPath, entry.source)],
        target: "bun",
        loader: { ".png": "file" },
        compile: { outfile: join(candidate, entry.executable), autoloadDotenv: false, autoloadBunfig: false },
        sourcemap: "inline",
      });
      if (!result.success) throw new Error(result.logs.map(log => String(log)).join("\n"));
      const bytes = await Bun.file(join(candidate, entry.executable)).bytes();
      builtEntries.push({ ...entry, sha256: Bun.CryptoHasher.hash("sha256", bytes, "hex"), bytes: bytes.length });
    }
    const [current, copied] = await Promise.all([WorkspaceSnapshot.capture(workspace), WorkspaceSnapshot.capture(snapshotPath)]);
    if (current.manifest.sha256 !== snapshot.manifest.sha256 || copied.manifest.sha256 !== snapshot.manifest.sha256) {
      throw new Error(`Build inputs changed. Existing published artifacts were preserved. Snapshot: ${snapshotPath}`);
    }
    const finalDirectory = join(dist, `${kind}-${snapshot.manifest.sha256.slice(0, 16)}-${candidate.slice(candidate.lastIndexOf("-") + 1)}`);
    const evidence: BuildEvidence = {
      schemaVersion: 1,
      kind,
      builtAt: new Date().toISOString(),
      directory: finalDirectory,
      sourceSha256: snapshot.manifest.sha256,
      snapshotPath,
      bun: { version: Bun.version, revision: Bun.revision, executable: process.execPath },
      typescript: ts.version,
      platform: process.platform,
      architecture: process.arch,
      gates: ["typecheck", "policy", "input-stability"],
      entries: builtEntries,
    };
    const metadata = `${JSON.stringify(evidence, null, 2)}\n`;
    await Bun.write(join(candidate, "build.json"), metadata);
    for (const entry of builtEntries) {
      await Bun.write(join(candidate, `${entry.executable}.build.json`), `${JSON.stringify({
        schemaVersion: 1, sourceSha256: evidence.sourceSha256, executableSha256: entry.sha256,
        source: entry.source, bun: evidence.bun, typescript: evidence.typescript,
      }, null, 2)}\n`);
    }
    await rename(candidate, finalDirectory);
    published = true;
    const pointer = join(dist, `.${kind}-${Date.now()}-${crypto.randomUUID()}.json`);
    await Bun.write(pointer, metadata);
    await rename(pointer, join(dist, `${kind}.json`));
    process.stdout.write(`Built ${kind} from ${snapshot.manifest.sha256}: ${finalDirectory}\n`);
    return evidence;
  } finally {
    if (!published) await rm(candidate, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    await buildWorkspace(process.cwd(), parseBuildKind(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`Build failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
