import { expect, test } from "bun:test";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { identifyFile, observeCommand } from "./environment.ts";
import { isCorpusBinaryCandidate, steamCommonPath, steamTitleForPath } from "./steam.ts";

test("corpus discovery excludes account and profile files before opening executable-permission files", () => {
  for (const name of ["q3key", "config.cfg", "q3config.cfg", "localconfig.vdf", "loginusers.vdf", "appmanifest_2200.acf", "pak0.pak"]) {
    expect(isCorpusBinaryCandidate(name)).toBe(false);
  }
  for (const name of ["Winquake.exe", "quake3.exe", "game_x64.dll", "gamei386.so.glibc", "game.so.1", "quake3-ts"]) {
    expect(isCorpusBinaryCandidate(name)).toBe(true);
  }
});

test("Steam title classification is restricted to exact selected installation directories", () => {
  expect(steamTitleForPath(join(steamCommonPath, "Quake", "Winquake.exe"))?.family).toBe("q1");
  expect(steamTitleForPath(join(steamCommonPath, "Quake 2", "quake2.exe"))?.family).toBe("q2");
  expect(steamTitleForPath(join(steamCommonPath, "Quake 3 Arena", "quake3.exe"))?.family).toBe("q3");
  expect(steamTitleForPath(join(steamCommonPath, "Quake Live", "quakelive_steam.exe"))).toBeUndefined();
  expect(steamTitleForPath(join(steamCommonPath, "Quake-unrelated", "game.exe"))).toBeUndefined();
});

test("file identity hashes bytes and resolves a symlink to the actual input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "quake-reference-hash-"));
  try {
    const path = join(directory, "input.txt");
    const link = join(directory, "alias.txt");
    await Bun.write(path, "abc");
    await symlink(path, link);
    expect(await identifyFile(link)).toEqual({
      path,
      size: 3,
      sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("command capture preserves streams, command identity and nonzero exit status", async () => {
  const directory = await mkdtemp(join(tmpdir(), "quake-reference-command-"));
  try {
    const path = join(directory, "probe.ts");
    await Bun.write(path, 'process.stdout.write("output\\n"); process.stderr.write("diagnostic\\n"); process.exitCode = 7;\n');
    const result = await observeCommand([process.execPath, path], directory);
    expect(result.command).toEqual([process.execPath, path]);
    expect(result.outcome).toEqual({ kind: "exited", exitCode: 7 });
    expect(result.stdout).toBe("output\n");
    expect(result.stderr).toBe("diagnostic\n");
    expect(result.cwd).toBe(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("command timeout terminates a live process and preserves its partial output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "quake-reference-timeout-"));
  try {
    const path = join(directory, "probe.ts");
    await Bun.write(path, 'process.stdout.write("started\\n"); setInterval(() => process.stdout.write("tick\\n"), 20);\n');
    const result = await observeCommand([process.execPath, path], directory, 250);
    expect(result.outcome).toEqual({ kind: "timed-out", timeoutMs: 250 });
    expect(result.stdout).toContain("started\n");
    expect(result.durationMs).toBeLessThan(5_000);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
