import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildWorkspace, parseBuildKind } from "../../tools/build.ts";

const temporary = await mkdtemp(join(tmpdir(), "quake-unified-build-"));
const buildTool = resolve(import.meta.dir, "../../tools/build.ts");

afterAll(async () => { await rm(temporary, { recursive: true, force: true }); });

test("build CLI rejects unsupported flags and missing real application entries", async () => {
  expect(parseBuildKind([])).toBe("runtime");
  expect(parseBuildKind(["--tools"])).toBe("tools");
  expect(() => parseBuildKind(["--tools", "--tools"])).toThrow("Usage:");
  expect(() => parseBuildKind(["--skip-checks"])).toThrow("Usage:");
  const project = join(temporary, "missing-runtime");
  await Bun.write(join(project, "package.json"), "{}\n");
  await expect(buildWorkspace(project, "runtime")).rejects.toThrow("src/main.ts is not implemented");
  expect(await Bun.file(join(project, "dist/runtime.json")).exists()).toBe(false);
});

async function runFixtureBuild(project: string, environment: Readonly<Record<string, string>> = {}): Promise<{ readonly code: number; readonly output: string }> {
  const child = Bun.spawn([process.execPath, buildTool], {
    cwd: project, env: { ...process.env, ...environment }, stdout: "pipe", stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, output: stdout + stderr };
}

test("compiled output runs away from sources and rejected builds preserve published evidence", async () => {
  const project = join(temporary, "isolated project");
  await Bun.write(join(project, "package.json"), JSON.stringify({ type: "module", scripts: {
    typecheck: "bun gate.ts", policy: "bun gate.ts",
  } }));
  await Bun.write(join(project, "gate.ts"), [
    "if (process.env['FIXTURE_REJECT_BUILD'] === '1') process.exit(17);",
    "const liveFile = process.env['FIXTURE_MUTATE_BUILD'];",
    "if (liveFile !== undefined) await Bun.write(liveFile, 'export const changed = true;\\n');",
  ].join("\n"));
  await Bun.write(join(project, "src/main.ts"), "process.stdout.write(`${6 * 7}\\n`);\n");
  const evidence = await buildWorkspace(project, "runtime");
  expect(evidence.bun.version).toBe(Bun.version);
  expect(evidence.typescript).toBe("5.9.3");
  expect(evidence.gates).toEqual(["typecheck", "policy", "input-stability"]);
  expect(evidence.entries).toHaveLength(1);
  const entry = evidence.entries[0];
  if (entry === undefined) throw new Error("Build omitted its entry");
  const binary = join(evidence.directory, entry.executable);
  const beforeHash = Bun.CryptoHasher.hash("sha256", await Bun.file(binary).bytes(), "hex");
  expect(entry.sha256).toBe(beforeHash);
  const launched = Bun.spawn([binary], { cwd: temporary, stdout: "pipe", stderr: "pipe" });
  const [code, output] = await Promise.all([launched.exited, new Response(launched.stdout).text()]);
  expect(code).toBe(0);
  expect(output).toBe("42\n");
  const pointer = join(project, "dist/runtime.json");
  const previousEvidence = await Bun.file(pointer).text();
  const rejected = await runFixtureBuild(project, { FIXTURE_REJECT_BUILD: "1" });
  expect(rejected.code).toBe(1);
  expect(rejected.output).toContain("typecheck failed with exit 17");
  expect(await Bun.file(pointer).text()).toBe(previousEvidence);
  const mutated = await runFixtureBuild(project, { FIXTURE_MUTATE_BUILD: join(project, "src/main.ts") });
  expect(mutated.code).toBe(1);
  expect(mutated.output).toContain("Build inputs changed");
  expect(await Bun.file(pointer).text()).toBe(previousEvidence);
  expect(Bun.CryptoHasher.hash("sha256", await Bun.file(binary).bytes(), "hex")).toBe(beforeHash);
}, 30_000);
