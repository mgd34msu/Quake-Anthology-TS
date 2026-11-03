// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Installed game content for tests, from QTS_TEST_CORPUS. The root may use the
 * Steam layout ("Quake"/"Quake 2"/"Quake 3 Arena") or the assembled layout
 * ("q1"/"q2"/"q3a"). Without the variable, returns {@link UNSET_CORPUS_ROOT} (a path that does not exist) and content-dependent
 * tests skip or report the missing files; nothing is guessed from local disks.
 */
export function testCorpusRoot(): string {
  const configured = process.env["QTS_TEST_CORPUS"] ?? "";
  return configured === "" ? UNSET_CORPUS_ROOT : configured;
}

/** Stands in for the corpus root when none is configured, so joined or resolved paths cannot hit the cwd or the filesystem root. */
export const UNSET_CORPUS_ROOT = "/nonexistent/quake-test-corpus-is-not-configured";

const steamHeads: Readonly<Record<string, string>> = { q1: "Quake", q2: "Quake 2", q3a: "Quake 3 Arena" };

function resolveCaseInsensitive(path: string): string | null {
  if (existsSync(path)) return path;
  const segments = path.split("/").filter(segment => segment.length > 0);
  let current = path.startsWith("/") ? "/" : ".";
  for (const segment of segments) {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return null;
    }
    const match = entries.find(entry => entry === segment) ?? entries.find(entry => entry.toLowerCase() === segment.toLowerCase());
    if (match === undefined) return null;
    current = join(current, match);
  }
  return current;
}

/** Actual filesystem path for a logical corpus file ("q2/baseq2/pak0.pak") in either layout. */
export function corpusFile(logicalPath: string): string {
  const root = testCorpusRoot(),
    direct = resolveCaseInsensitive(join(root, logicalPath));
  if (direct !== null) return direct;
  const [head, ...rest] = logicalPath.split("/");
  const steamHead = head === undefined ? undefined : steamHeads[head];
  if (steamHead !== undefined) {
    const mapped = resolveCaseInsensitive(join(root, steamHead, ...rest));
    if (mapped !== null) return mapped;
  }
  return join(root, logicalPath);
}

/** True when a logical corpus file ("q2/baseq2/pak0.pak") exists in either layout. */
export function corpusHasFile(logicalPath: string): boolean {
  return existsSync(corpusFile(logicalPath));
}

export function corpusMissing(...logicalPaths: readonly string[]): string[] {
  return logicalPaths.filter(path => !corpusHasFile(path));
}

/**
 * The one gate for tests that need installed game data. Skips when any file is
 * absent. With QTS_TEST_REQUIRE_CORPUS=1 (a corpus run) a missing file fails the
 * test instead, so a wrong guard path cannot hide a test.
 */
export function corpusTest(...logicalPaths: readonly string[]): typeof test {
  const missing = corpusMissing(...logicalPaths);
  if (missing.length === 0) return test;
  if (process.env["QTS_TEST_REQUIRE_CORPUS"] === "1")
    test("corpus files are present", () => {
      throw new Error(`Corpus file missing: ${missing.join(", ")}`);
    });
  return test.skip;
}

/** Variant of {@link corpusTest} for `describe` blocks. */
export function corpusDescribe(...logicalPaths: readonly string[]): typeof describe {
  const missing = corpusMissing(...logicalPaths);
  if (missing.length === 0) return describe;
  if (process.env["QTS_TEST_REQUIRE_CORPUS"] === "1")
    test("corpus files are present", () => {
      throw new Error(`Corpus file missing: ${missing.join(", ")}`);
    });
  return describe.skip;
}

const copperLogical = "q1/rerelease/copper/progs.dat";
let copperNoticed = false;

/** The Copper add-on is an optional, user-installed mod and is not in the assembled corpus; put it at q1/rerelease/copper under the corpus root to enable its tests. */
export function copperProgramPath(): string {
  return corpusFile(copperLogical);
}

export function copperAvailable(): boolean {
  const present = corpusHasFile(copperLogical);
  if (!present && !copperNoticed) {
    copperNoticed = true;
    console.warn(`Copper add-on not found at ${copperProgramPath()}; its tests are skipped.`);
  }
  return present;
}
