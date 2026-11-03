// SPDX-License-Identifier: GPL-2.0-or-later
import { mkdir, mkdtemp, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import ts from "typescript";
import { gitState } from "./verify/git.ts";
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

export interface BuildOptions {
  /** Keep the verified source snapshot after a successful build. */
  readonly keepSnapshot?: boolean;
  /** Published builds of this kind to keep in dist/, newest first. */
  readonly keepBuilds?: number;
}

export const defaultKeepBuilds = 3;
const keptFailureSnapshots = 2;

/** Paths are relative to the workspace so evidence does not record a machine layout. */
export interface BuildEvidence {
  readonly schemaVersion: 2;
  readonly kind: BuildKind;
  readonly builtAt: string;
  readonly directory: string;
  readonly sourceSha256: string;
  /** HEAD at build time; null outside a git work tree. */
  readonly commit: string | null;
  /** True when the tree differed from HEAD, including untracked files; the source hash then does not identify the commit. */
  readonly dirty: boolean | null;
  /** Null when the snapshot was removed after a successful build. */
  readonly snapshotPath: string | null;
  readonly bun: { readonly version: string; readonly revision: string; readonly executable: string };
  readonly typescript: string;
  readonly platform: string;
  readonly architecture: string;
  readonly gates: readonly string[];
  readonly entries: readonly BuiltEntry[];
}

const usage = "Usage: bun tools/build.ts [--tools] [--keep-snapshot] [--keep-builds=N]";

export function parseBuildOptions(args: readonly string[]): { readonly kind: BuildKind; readonly options: BuildOptions } {
  let kind: BuildKind = "runtime",
    keepSnapshot = false,
    keepBuilds = defaultKeepBuilds;
  const seen = new Set<string>();
  for (const arg of args) {
    const flag = arg.split("=")[0] ?? arg;
    if (seen.has(flag)) throw new Error(usage);
    seen.add(flag);
    if (arg === "--tools") kind = "tools";
    else if (arg === "--keep-snapshot") keepSnapshot = true;
    else if (/^--keep-builds=[1-9]\d{0,2}$/.test(arg)) keepBuilds = Number(arg.slice("--keep-builds=".length));
    else throw new Error(usage);
  }
  return { kind, options: { keepSnapshot, keepBuilds } };
}

export function parseBuildKind(args: readonly string[]): BuildKind {
  return parseBuildOptions(args).kind;
}

async function directoriesByAge(parent: string, pattern: RegExp): Promise<string[]> {
  const names = await readdir(parent).catch(() => []);
  const dated = await Promise.all(
    names.filter(name => pattern.test(name)).map(async name => ({ path: join(parent, name), time: (await stat(join(parent, name))).mtimeMs })),
  );
  return dated.sort((left, right) => right.time - left.time).map(entry => entry.path);
}

async function pruneDirectories(parent: string, pattern: RegExp, keep: number, protectedPath?: string): Promise<void> {
  const ordered = await directoriesByAge(parent, pattern);
  let kept = 0;
  for (const path of ordered) {
    if (path === protectedPath || kept < keep) {
      kept += 1;
      continue;
    }
    await rm(path, { recursive: true, force: true });
  }
}

async function runGate(snapshotPath: string, name: string): Promise<void> {
  const child = Bun.spawn([process.execPath, "run", name], { cwd: snapshotPath, stdout: "inherit", stderr: "inherit" });
  const code = await child.exited;
  if (code !== 0) throw new Error(`Build snapshot ${name} failed with exit ${code}.`);
}

export async function buildWorkspace(directory: string, kind: BuildKind, options: BuildOptions = {}): Promise<BuildEvidence> {
  if (process.platform !== "linux") throw new Error("The first build target is Linux. Run this build on Linux.");
  const workspace = resolve(directory);
  const entries: readonly BuildEntry[] =
    kind === "runtime"
      ? [{ source: "src/main.ts", executable: "quake-typescript" }]
      : [
          { source: "tools/check-policy.ts", executable: "check-policy" },
          { source: "tools/source-camera.ts", executable: "source-camera" },
          { source: "tools/navigation/aas.ts", executable: "aas" },
        ];
  for (const entry of entries) {
    if (!(await Bun.file(join(workspace, entry.source)).exists())) {
      throw new Error(`Build entry is missing: ${entry.source}`);
    }
  }
  const snapshotParent = join(workspace, ".artifacts", "snapshots");
  // Snapshots of failed builds are kept for diagnosis; older ones are not.
  await pruneDirectories(snapshotParent, /^build-/, keptFailureSnapshots - 1);
  const [snapshot, git] = await Promise.all([WorkspaceSnapshot.capture(workspace), gitState(workspace)]);
  const snapshotPath = await snapshot.materialize(snapshotParent, "build-");
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
        entrypoints: [
          join(snapshotPath, entry.source),
          ...(kind === "runtime"
            ? [
                join(snapshotPath, "src/render/worker-entry.ts"),
                join(snapshotPath, "src/render/cpu/row-worker.ts"),
                join(snapshotPath, "src/llm/auth-worker.ts"),
              ]
            : []),
        ],
        naming: { entry: "[name].ts" },
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
      schemaVersion: 2,
      kind,
      builtAt: new Date().toISOString(),
      directory: relative(workspace, finalDirectory),
      sourceSha256: snapshot.manifest.sha256,
      commit: git.commit,
      dirty: git.dirty,
      snapshotPath: options.keepSnapshot === true ? relative(workspace, snapshotPath) : null,
      bun: { version: Bun.version, revision: Bun.revision, executable: basename(process.execPath) },
      typescript: ts.version,
      platform: process.platform,
      architecture: process.arch,
      gates: ["typecheck", "policy", "input-stability"],
      entries: builtEntries,
    };
    const metadata = `${JSON.stringify(evidence, null, 2)}\n`;
    await Bun.write(join(candidate, "build.json"), metadata);
    for (const entry of builtEntries) {
      await Bun.write(
        join(candidate, `${entry.executable}.build.json`),
        `${JSON.stringify(
          {
            schemaVersion: 2,
            sourceSha256: evidence.sourceSha256,
            commit: evidence.commit,
            dirty: evidence.dirty,
            executableSha256: entry.sha256,
            source: entry.source,
            bun: evidence.bun,
            typescript: evidence.typescript,
          },
          null,
          2,
        )}\n`,
      );
    }
    await rename(candidate, finalDirectory);
    published = true;
    const pointer = join(dist, `.${kind}-${Date.now()}-${crypto.randomUUID()}.json`);
    await Bun.write(pointer, metadata);
    await rename(pointer, join(dist, `${kind}.json`));
    if (options.keepSnapshot !== true) await rm(snapshotPath, { recursive: true, force: true });
    await pruneDirectories(dist, new RegExp(`^${kind}-[0-9a-f]{16}-`), options.keepBuilds ?? defaultKeepBuilds, finalDirectory);
    const state = git.commit === null ? "no git commit" : `commit ${git.commit}${git.dirty === true ? " (dirty tree)" : ""}`;
    process.stdout.write(`Built ${kind} from ${snapshot.manifest.sha256}, ${state}: ${finalDirectory}\n`);
    return evidence;
  } finally {
    if (!published) await rm(candidate, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    const parsed = parseBuildOptions(process.argv.slice(2));
    await buildWorkspace(process.cwd(), parsed.kind, parsed.options);
  } catch (error) {
    process.stderr.write(`Build failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
