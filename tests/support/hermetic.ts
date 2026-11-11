// SPDX-License-Identifier: GPL-2.0-or-later
import { afterAll, afterEach, beforeAll, mock, setDefaultTimeout } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import * as realOs from "node:os";
import { join } from "node:path";

/**
 * Preload for every `bun test` run. Application launches that omit a user root
 * fall back to `homedir()`, which would read and overwrite the developer's real
 * profile. Point HOME and `os.homedir()` at a throwaway directory so no test can
 * reach it. Set QTS_TEST_STRICT_HOME=1 to fail the run when anything lands there,
 * which finds launches that still lack an explicit user root.
 * Temp directories go under the same per-run root, so a failed or timed-out test
 * cannot leave anything behind in the system temp directory.
 */
// Many tests open real game content or a whole application; bun's 5 s default fails them whenever the machine is
// busy. bun resets the default for each file, so it is set again before each file's tests.
setDefaultTimeout(60_000);
beforeAll(() => setDefaultTimeout(60_000));
const realHome = realOs.homedir();
const runRoot = mkdtempSync(join(realOs.tmpdir(), "qts-test-run-"));
const home = join(runRoot, "home"),
  temporary = join(runRoot, "tmp");
mkdirSync(home);
mkdirSync(temporary);
process.env["HOME"] = home;
process.env["TMPDIR"] = temporary;
// Stock games write their own config beside the game data; tests send those writes here instead of the read-only install.
const gameWrites = join(runRoot, "game-writes");
process.env["QTS_TEST_GAME_WRITE_ROOT"] = gameWrites;
// Every test starts from untouched game folders, as on a fresh install: one test's written config.cfg, q3config.cfg,
// saves or downloads would otherwise be mounted into the next test that opens the same install.
afterEach(() => rmSync(gameWrites, { recursive: true, force: true }));
process.env["XDG_DATA_HOME"] = join(home, ".local", "share");
process.env["XDG_CONFIG_HOME"] = join(home, ".config");
process.env["XDG_STATE_HOME"] = join(home, ".local", "state");
// Audio tests must never open the machine's output device.
process.env["SDL_AUDIODRIVER"] ??= "dummy";
mock.module("node:os", () => ({
  ...realOs,
  default: { ...realOs, homedir: () => home, tmpdir: () => temporary },
  homedir: () => home,
  tmpdir: () => temporary,
}));

// mock.module patches the live module namespace, so the real functions are captured by value before it runs.
const realRoots = { ...(await import("../../src/content/roots.ts")) };
const { contentRootCandidates: realCandidates, resolveDefaultContentRoot: realResolve } = realRoots;
type Search = Parameters<typeof realCandidates>[0];
const corpusRoot = process.env["QTS_TEST_CORPUS"] ?? "";
/** Launches that pass no --content-root resolve against the corpus, not the checkout or a Steam install. */
const searchIn = (search: Search = {}): Search => (corpusRoot === "" || search.ownDirectory !== undefined ? search : { ...search, ownDirectory: corpusRoot });
mock.module("../../src/content/roots.ts", () => ({
  ...realRoots,
  contentRootCandidates: (search: Search = {}, steamOnly = false) => realCandidates(searchIn(search), steamOnly),
  resolveDefaultContentRoot: (search: Search = {}, steamOnly = false) => realResolve(searchIn(search), steamOnly),
}));

function leaked(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...leaked(path));
    else found.push(path);
  }
  return found;
}

function finish(): void {
  if (!existsSync(runRoot)) return;
  if (process.env["QTS_TEST_STRICT_HOME"] === "1") {
    const files = leaked(home);
    if (files.length > 0) {
      console.error(`${files.length} files were written under the test home by launches without an explicit user root:\n${files.slice(0, 20).join("\n")}`);
      process.exitCode = 1;
    }
  }
  rmSync(runRoot, { recursive: true, force: true });
}
// Bun runs preload afterAll hooks once, after the last file; the exit listener covers runs that end another way.
afterAll(finish);
process.on("exit", finish);

export const hermeticHome = home;
export const developerHome = realHome;
