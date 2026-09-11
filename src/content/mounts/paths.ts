import { readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export function normalizeResourcePath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  if (!normalized || normalized.includes("\0") || /^[a-z]:/i.test(normalized)
    || normalized.split("/").some(part => !part || part === "." || part === "..")) {
    throw new RangeError(`Invalid relative resource path: ${path}`);
  }
  return normalized;
}

export function pathWithinRoot(root: string, path: string): string {
  const destination = resolve(root, normalizeResourcePath(path));
  const child = relative(resolve(root), destination);
  if (isAbsolute(child) || child === ".." || child.startsWith(`..${sep}`)) {
    throw new RangeError(`Resource escapes content root: ${path}`);
  }
  return destination;
}

export function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

/** Resolve spelling on case-sensitive hosts, rejecting ambiguous case collisions. */
export async function findContentPath(root: string, path: string, comparison: "exact" | "case-insensitive" = "case-insensitive"): Promise<string | null> {
  const parts = normalizeResourcePath(path).split("/");
  let current = resolve(root);
  try {
    const canonicalRoot = await realpath(current);
    for (const part of parts) {
      if (comparison === "exact") current = resolve(current, part);
      else {
        const entries = await readdir(current);
        const exact = entries.find(entry => entry === part);
        const matches = entries.filter(entry => entry.toLowerCase() === part.toLowerCase());
        if (exact !== undefined) current = resolve(current, exact);
        else if (matches.length > 1) throw new Error(`Ambiguous content path: ${path}`);
        else {
          const match = matches[0];
          if (match === undefined) return null;
          current = resolve(current, match);
        }
      }
    }
    const canonical = await realpath(current);
    const child = relative(canonicalRoot, canonical);
    if (isAbsolute(child) || child === ".." || child.startsWith(`..${sep}`)) throw new Error(`Content symlink escapes root: ${path}`);
    await stat(canonical);
    return current;
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}
