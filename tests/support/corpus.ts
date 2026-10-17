import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Installed game content for tests, from QTS_TEST_CORPUS. The root may use the
 * Steam layout ("Quake"/"Quake 2"/"Quake 3 Arena") or the assembled layout
 * ("q1"/"q2"/"q3a"). Without the variable, returns "" and content-dependent
 * tests skip or report the missing files; nothing is guessed from local disks.
 */
export function testCorpusRoot(): string {
  return process.env["QTS_TEST_CORPUS"] ?? process.env["QUAKE_DATA_PATH"] ?? process.env["QFILES_ROOT"] ?? "";
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
