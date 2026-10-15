import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { main, writeCrashLog } from "../../src/main.ts";

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
  } finally { await rm(home, { recursive: true, force: true }); }
});
