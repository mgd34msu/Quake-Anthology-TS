import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWorkspace } from "../../tools/build.ts";
import { parseSemver, releaseWorkspace } from "../../tools/release.ts";

const temporary = await mkdtemp(join(tmpdir(), "quake-unified-release-"));
afterAll(async () => { await rm(temporary, { recursive: true, force: true }); });

async function git(directory: string, ...args: string[]): Promise<string> {
  const child = Bun.spawn(["git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-C", directory, ...args], { stdout: "pipe", stderr: "pipe" });
  const [code, output] = await Promise.all([child.exited, new Response(child.stdout).text()]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed`);
  return output.trim();
}

test("AUDIT-004/018 release refuses a dirty tree and packs the commit with license, notices and README", async () => {
  const project = join(temporary, "release project");
  await Bun.write(join(project, "package.json"), JSON.stringify({ name: "fixture", version: "9.8.7", type: "module", scripts: { typecheck: "bun gate.ts", policy: "bun gate.ts" } }));
  await Bun.write(join(project, "gate.ts"), "export {};\n");
  await Bun.write(join(project, ".gitignore"), "/dist/\n/.artifacts/\n");
  await Bun.write(join(project, "src/version.ts"), 'export const version = "9.8.7";\n');
  await Bun.write(join(project, "src/main.ts"), "process.stdout.write('ok\\n');\n");
  for (const path of ["src/render/worker-entry.ts", "src/render/cpu/row-worker.ts", "src/llm/auth-worker.ts"]) await Bun.write(join(project, path), "export {};\n");
  for (const path of ["LICENSE", "THIRD-PARTY-NOTICES.md", "README.md", "src/formats/images/IJG-LICENSE.md"]) await Bun.write(join(project, path), `${path}\n`);
  await git(project, "init", "-q");
  await git(project, "add", "-A");
  await git(project, "commit", "-q", "-m", "fixture");

  await Bun.write(join(project, "untracked.ts"), "export {};\n");
  await expect(releaseWorkspace(project, { gates: ["typecheck"] })).rejects.toThrow("uncommitted or untracked");
  await rm(join(project, "untracked.ts"));

  await Bun.write(join(project, "src/version.ts"), 'export const version = "9.8.6";\n');
  await git(project, "commit", "-q", "-am", "stale version");
  await expect(releaseWorkspace(project, { gates: ["typecheck"] })).rejects.toThrow('src/version.ts reports "9.8.6" but package.json is 9.8.7');
  await Bun.write(join(project, "src/version.ts"), 'export const version = "9.8.7";\n');
  await git(project, "commit", "-q", "-am", "fix version");
  const commit = await git(project, "rev-parse", "HEAD");
  const release = await releaseWorkspace(project, { gates: ["typecheck"] });
  expect(release.commit).toBe(commit);
  expect(release.archive).toEndWith("quake-anthology-9.8.7-linux-x64.tar.gz");
  const listing = Bun.spawn(["tar", "tzf", release.archive], { stdout: "pipe" });
  const entries = (await new Response(listing.stdout).text()).split("\n").filter(line => line !== "").sort();
  expect(entries).toEqual([
    "quake-anthology-9.8.7-linux-x64/",
    "quake-anthology-9.8.7-linux-x64/LICENSE",
    "quake-anthology-9.8.7-linux-x64/README.md",
    "quake-anthology-9.8.7-linux-x64/RELEASE.json",
    "quake-anthology-9.8.7-linux-x64/THIRD-PARTY-NOTICES.md",
    "quake-anthology-9.8.7-linux-x64/licenses/",
    "quake-anthology-9.8.7-linux-x64/licenses/IJG-LICENSE.md",
    "quake-anthology-9.8.7-linux-x64/quake-typescript",
  ]);
  const extracted = Bun.spawn(["tar", "xzOf", release.archive, "quake-anthology-9.8.7-linux-x64/RELEASE.json"], { stdout: "pipe" });
  const record: unknown = JSON.parse(await new Response(extracted.stdout).text());
  expect(record).toMatchObject({ version: "9.8.7", commit });
  expect(release.evidence.commit).toBe(commit);
  expect(release.evidence.dirty).toBe(false);

  // DOCS-010: a development build reports a SemVer pre-release; it builds, and it cannot be released.
  await Bun.write(join(project, "package.json"), JSON.stringify({ name: "fixture", version: "9.8.8-dev", type: "module", scripts: { typecheck: "bun gate.ts", policy: "bun gate.ts" } }));
  await Bun.write(join(project, "src/version.ts"), 'export const version = "9.8.8-dev";\n');
  await git(project, "commit", "-q", "-am", "development version");
  await expect(releaseWorkspace(project, { gates: ["typecheck"] })).rejects.toThrow('"9.8.8-dev" is a pre-release');
  const development = await buildWorkspace(project, "runtime");
  expect(development.entries.length).toBeGreaterThan(0);
  expect(development.dirty).toBe(false);
}, 400_000);

test("DOCS-010 parseSemver accepts MAJOR.MINOR.PATCH with an optional pre-release and nothing else", () => {
  expect(parseSemver("1.2.6")).toEqual({ major: 1, minor: 2, patch: 6, prerelease: null });
  expect(parseSemver("1.2.7-dev")).toEqual({ major: 1, minor: 2, patch: 7, prerelease: "dev" });
  expect(parseSemver("1.2.7-rc.1")?.prerelease).toBe("rc.1");
  for (const bad of ["1.2", "1.2.7.1", "01.2.7", "1.2.7-", "1.2.7-01", "v1.2.7", "1.2.7+build", ""]) expect(parseSemver(bad)).toBeNull();
});
