// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { stat, writeFile } from "node:fs/promises";
import { main, redactArguments, writeCrashLog } from "../../src/main.ts";

test("fatal errors leave a crash log with the stack and recent output", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "quake-crash-log-"));
  try {
    expect(await main(["--definitely-invalid-option"])).toBe(1);
    writeCrashLog(new Error("probe failure"), ["--probe"], home);
    const log = await readFile(join(home, "crash.log"), "utf8");
    expect(log).toContain("Quake Anthology");
    expect(log).toContain("crash");
    expect(log).toContain("--probe");
    expect(log).toContain("probe failure");
    expect(log).toContain("--- recent output ---");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("the crash log keeps wrapped causes, hides secrets and is private to the user", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "quake-crash-log-"));
  try {
    const inner = new Error("inner cause"),
      aggregate = new AggregateError([new Error("first aggregated")], "outer", { cause: inner });
    writeCrashLog(aggregate, ["+set", "rcon_password", "hunter2"], home);
    const log = await readFile(join(home, "crash.log"), "utf8");
    expect(log).toContain("first aggregated");
    expect(log).toContain("inner cause");
    expect(log).not.toContain("hunter2");
    expect((await stat(join(home, "crash.log"))).mode & 0o777).toBe(0o600);
    expect(redactArguments(["--map", "e1m1"])).toEqual(["--map", "e1m1"]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("a crash log past its size limit is rotated once instead of growing", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "quake-crash-log-"));
  try {
    await writeFile(join(home, "crash.log"), "x".repeat(1024 * 1024 + 1));
    writeCrashLog(new Error("after rotation"), ["--probe"], home);
    expect(await readFile(join(home, "crash.log.1"), "utf8")).toHaveLength(1024 * 1024 + 1);
    const log = await readFile(join(home, "crash.log"), "utf8");
    expect(log).toContain("after rotation");
    expect(log).toContain("entry=");
    expect(log.length).toBeLessThan(100_000);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

import { redactOutput } from "../../src/main.ts";
test("PLATFORM-008 recent output masks password-like values", () => {
  expect(redactOutput('rcon_password "hunter2"\nset password abc\nname is "x"\n')).toBe('rcon_password <redacted>\nset password <redacted>\nname is "x"\n');
});
