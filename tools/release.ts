// SPDX-License-Identifier: GPL-2.0-or-later
import { copyFile, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildWorkspace, type BuildEvidence } from "./build.ts";
import { gitState } from "./verify/git.ts";

export interface ReleaseOptions {
  /** Test seam: the gates run before the build. Defaults to typecheck and the corpus-free unit tier. */
  readonly gates?: readonly string[];
}

export interface ReleaseResult {
  readonly archive: string;
  readonly sha256: string;
  readonly commit: string;
  readonly version: string;
  readonly evidence: BuildEvidence;
}

const archiveFiles: readonly { readonly from: string; readonly to: string }[] = [
  { from: "LICENSE", to: "LICENSE" },
  { from: "THIRD-PARTY-NOTICES.md", to: "THIRD-PARTY-NOTICES.md" },
  { from: "README.md", to: "README.md" },
  { from: "src/formats/images/IJG-LICENSE.md", to: "licenses/IJG-LICENSE.md" },
];

async function run(directory: string, command: readonly string[]): Promise<void> {
  const child = Bun.spawn([...command], { cwd: directory, stdout: "inherit", stderr: "inherit" });
  const code = await child.exited;
  if (code !== 0) throw new Error(`${command.join(" ")} failed with exit ${code}.`);
}

export interface Semver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: string | null;
}

const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?$/;

/** Parses a SemVer 2.0.0 version without build metadata; development builds carry a pre-release such as 1.2.7-dev. */
export function parseSemver(version: string): Semver | null {
  const match = semverPattern.exec(version);
  if (match === null) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ?? null };
}

async function manifestVersion(workspace: string): Promise<string> {
  const text = await Bun.file(join(workspace, "package.json")).text();
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed === "object" && parsed !== null && "version" in parsed && typeof parsed.version === "string") return parsed.version;
  throw new Error("package.json has no version.");
}

/**
 * Builds the runtime and packs it with the license, notices and README. The tree must be clean, so the commit
 * recorded in RELEASE.json is the source of the executable; package.json and src/version.ts must agree on the version.
 */
export async function releaseWorkspace(directory: string, options: ReleaseOptions = {}): Promise<ReleaseResult> {
  if (process.platform !== "linux" || process.arch !== "x64") throw new Error("Release archives are built for linux-x64 only.");
  const workspace = resolve(directory);
  const before = await gitState(workspace);
  if (before.commit === null) throw new Error("Release refused: not a git work tree.");
  if (before.dirty !== false) throw new Error("Release refused: the working tree has uncommitted or untracked changes. Commit or remove them first.");
  const version = await manifestVersion(workspace);
  const parsedVersion = parseSemver(version);
  if (parsedVersion === null)
    throw new Error(`Release refused: package.json version "${version}" is not SemVer (MAJOR.MINOR.PATCH with an optional -prerelease).`);
  if (parsedVersion.prerelease !== null)
    throw new Error(
      `Release refused: package.json version "${version}" is a pre-release; set the final MAJOR.MINOR.PATCH in package.json and src/version.ts first (bun run build accepts pre-release versions).`,
    );
  const reported = /export const version = "([^"]+)"/.exec(await Bun.file(join(workspace, "src/version.ts")).text())?.[1];
  if (reported !== version)
    throw new Error(`Release refused: src/version.ts reports "${reported ?? "nothing"}" but package.json is ${version}; --version would be wrong.`);
  for (const file of archiveFiles) {
    if (!(await Bun.file(join(workspace, file.from)).exists())) throw new Error(`Release refused: ${file.from} is missing.`);
  }
  for (const gate of options.gates ?? ["typecheck", "test:unit"]) await run(workspace, [process.execPath, "run", gate]);
  const evidence = await buildWorkspace(workspace, "runtime");
  const after = await gitState(workspace);
  if (after.commit !== before.commit || after.dirty !== false) throw new Error("Release refused: the tree or HEAD changed while the release was building.");
  if (evidence.commit !== before.commit || evidence.dirty !== false) throw new Error("Release refused: the build did not record the release commit.");
  const executable = evidence.entries[0];
  if (executable === undefined) throw new Error("Release build produced no executable.");

  const releases = join(workspace, "dist", "release");
  await mkdir(releases, { recursive: true });
  const stage = await mkdtemp(join(releases, ".stage-"));
  const name = `quake-anthology-${version}-linux-x64`;
  try {
    const root = join(stage, name);
    await mkdir(join(root, "licenses"), { recursive: true });
    await copyFile(join(workspace, evidence.directory, executable.executable), join(root, executable.executable));
    for (const file of archiveFiles) await copyFile(join(workspace, file.from), join(root, file.to));
    await Bun.write(
      join(root, "RELEASE.json"),
      `${JSON.stringify(
        {
          version,
          commit: before.commit,
          builtAt: evidence.builtAt,
          sourceSha256: evidence.sourceSha256,
          executable: executable.executable,
          executableSha256: executable.sha256,
          source: "https://github.com/mgd34msu/quake-anthology-ts",
        },
        null,
        2,
      )}\n`,
    );
    // Fixed order, owner and mtime so the same commit and executable pack to the same bytes.
    const tarball = join(stage, `${name}.tar`);
    await run(stage, ["tar", "--sort=name", "--owner=0", "--group=0", "--numeric-owner", "--mtime=@0", "-cf", tarball, name]);
    await run(stage, ["gzip", "-n", "-6", tarball]);
    const archive = join(releases, `${name}.tar.gz`);
    await rename(`${tarball}.gz`, archive);
    const sha256 = Bun.CryptoHasher.hash("sha256", await Bun.file(archive).bytes(), "hex");
    await Bun.write(`${archive}.sha256`, `${sha256}  ${name}.tar.gz\n`);
    process.stdout.write(`Release ${version} at ${before.commit}: ${archive}\nSHA-256 ${sha256}\n`);
    return { archive, sha256, commit: before.commit, version, evidence };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    if (process.argv.length > 2) throw new Error("Usage: bun tools/release.ts");
    await releaseWorkspace(process.cwd());
  } catch (error) {
    process.stderr.write(`Release failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
