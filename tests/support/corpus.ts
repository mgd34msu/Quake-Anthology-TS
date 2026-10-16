import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Locate installed game content for tests. Mirrors product discovery anchors:
 * a root qualifies when it contains a Quake game directory (Steam layout
 * "Quake"/"Quake 2"/"Quake 3 Arena" or assembled "q1"/"q2"/"q3a").
 * Override with QTS_TEST_CORPUS.
 */
export function testCorpusRoot(): string {
  const candidates = [process.env["QTS_TEST_CORPUS"], resolve(import.meta.dir, "../../../qfiles"), resolve(homedir(), "qfiles")]
    .filter((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0);
  for (const candidate of candidates)
    if (["Quake", "Quake 2", "Quake 3 Arena", "q1", "q2", "q3a"].some(directory => existsSync(join(candidate, directory)))) return candidate;
  return candidates[0] ?? resolve(homedir(), "qfiles");
}

const steamHeads: Readonly<Record<string, string>> = { q1: "Quake", q2: "Quake 2", q3a: "Quake 3 Arena" };

function resolveCaseInsensitive(path: string): string | null {
  if (existsSync(path)) return path;
  const segments = path.split("/").filter(segment => segment.length > 0);
  let current = path.startsWith("/") ? "/" : ".";
  for (const segment of segments) {
    let entries: string[];
    try { entries = readdirSync(current); } catch { return null; }
    const match = entries.find(entry => entry === segment) ?? entries.find(entry => entry.toLowerCase() === segment.toLowerCase());
    if (match === undefined) return null;
    current = join(current, match);
  }
  return current;
}

/** Actual filesystem path for a logical corpus file ("q2/baseq2/pak0.pak") in either layout. */
export function corpusFile(logicalPath: string): string {
  const root = testCorpusRoot(), direct = resolveCaseInsensitive(join(root, logicalPath));
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
