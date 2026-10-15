import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import type { GameFamily } from "../contracts/content.ts";

/** The base game directory every install of a family ships; it anchors its game root. */
const ANCHORS: Readonly<Record<GameFamily, string>> = { q1: "id1", q2: "baseq2", q3: "baseq3" };
/** Preferred directory names for a curated corpus; other parent names also resolve. */
const CANONICAL: Readonly<Record<GameFamily, string>> = { q1: "q1", q2: "q2", q3: "q3a" };
const FAMILIES: readonly GameFamily[] = ["q1", "q2", "q3"];

export function gameFamilyDirectory(family: GameFamily): string { return CANONICAL[family]; }

export function gameFamilyForDirectory(name: string): GameFamily | null {
  const lowered = name.toLowerCase();
  return FAMILIES.find(family => CANONICAL[family] === lowered) ?? null;
}

/** Path below the family segment of a canonical content path (`q1/id1/pak0.pak` -> `id1/pak0.pak`). */
export function gameRelativePath(canonicalPath: string, family: GameFamily): string {
  const parts = canonicalPath.split("/");
  return parts[0]?.toLowerCase() === CANONICAL[family] ? parts.slice(1).join("/") : canonicalPath;
}

function isDirectory(path: string): boolean {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

function childDirectories(directory: string): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isDirectory() || entry.isSymbolicLink() && isDirectory(resolve(directory, entry.name)))
      .map(entry => entry.name).sort((left, right) => left.toLowerCase() < right.toLowerCase() ? -1 : left.toLowerCase() > right.toLowerCase() ? 1 : left < right ? -1 : left > right ? 1 : 0);
  } catch { return []; }
}

/** Actual spelling of a child directory, matching case-insensitively. */
function childDirectory(directory: string, loweredName: string): string | null {
  const matches = childDirectories(directory).filter(name => name.toLowerCase() === loweredName);
  return matches.find(name => name === loweredName) ?? matches[0] ?? null;
}

function anchoredGameRoot(root: string, family: GameFamily): string | null {
  const absolute = resolve(root), anchor = ANCHORS[family];
  const canonical = childDirectory(absolute, CANONICAL[family]);
  if (canonical !== null && childDirectory(resolve(absolute, canonical), anchor) !== null) return resolve(absolute, canonical);
  if (childDirectory(absolute, anchor) !== null) return absolute;
  for (const child of childDirectories(absolute))
    if (child.toLowerCase() !== CANONICAL[family] && childDirectory(resolve(absolute, child), anchor) !== null) return resolve(absolute, child);
  return null;
}

/**
 * Locate one family's game root under a search root. The anchor directory
 * (`id1`, `baseq2`, `baseq3`) identifies the game; the directory holding it is
 * the game root, so expansions, rerelease trees and mods resolve as its
 * siblings whatever the parent folder is named. A canonical family directory
 * with no anchor yet (a mods-only user root) still resolves.
 */
export function gameRootIn(root: string, family: GameFamily): string | null {
  const anchored = anchoredGameRoot(root, family);
  if (anchored !== null) return anchored;
  const canonical = childDirectory(resolve(root), CANONICAL[family]);
  return canonical === null ? null : resolve(root, canonical);
}

export type GameRoots = ReadonlyMap<GameFamily, string | null>;

export function resolveGameRoots(root: string): GameRoots {
  return new Map(FAMILIES.map(family => [family, gameRootIn(root, family)]));
}

/** True when a search root holds at least one game's anchor directory. */
export function hasGameAnchor(root: string): boolean {
  return FAMILIES.some(family => anchoredGameRoot(root, family) !== null);
}

/** Default Steam `steamapps/common` directories, including extra libraries. */
export function steamCommonDirectories(home: string = homedir()): string[] {
  const steamRoots = [resolve(home, ".local/share/Steam"), resolve(home, ".steam/steam"),
    resolve(home, ".var/app/com.valvesoftware.Steam/.local/share/Steam")];
  const libraries = new Set<string>();
  for (const steamRoot of steamRoots) {
    libraries.add(resolve(steamRoot, "steamapps/common"));
    try {
      for (const match of readFileSync(resolve(steamRoot, "steamapps/libraryfolders.vdf"), "utf8").matchAll(/"path"\s+"([^"]+)"/g)) {
        const library = match[1];
        if (library !== undefined) libraries.add(resolve(library.replaceAll("\\\\", "/"), "steamapps/common"));
      }
    } catch { /* This Steam root is not installed. */ }
  }
  return [...libraries].filter(isDirectory);
}

export interface ContentRootSearch {
  /** Directory of the executable (or working directory when run from source). */
  readonly ownDirectory?: string;
  readonly homeDirectory?: string;
}

function ownDirectory(): string {
  return Bun.main.startsWith("/$bunfs/") || Bun.main.startsWith("B:/~BUN/") ? dirname(process.execPath) : process.cwd();
}

/** Search order: own folder, the folder above it, then default Steam libraries. */
export function contentRootCandidates(search: ContentRootSearch = {}, steamOnly = false): string[] {
  const steam = steamCommonDirectories(search.homeDirectory ?? homedir());
  if (steamOnly) return steam;
  const own = resolve(search.ownDirectory ?? ownDirectory());
  return [...new Set([own, dirname(own), ...steam])];
}

/** First candidate holding a game anchor; searching stops there. */
export function resolveDefaultContentRoot(search: ContentRootSearch = {}, steamOnly = false): string {
  const candidates = contentRootCandidates(search, steamOnly);
  for (const candidate of candidates) if (hasGameAnchor(candidate)) return candidate;
  return candidates[0] ?? resolve(search.homeDirectory ?? homedir(), ".local/share/Steam/steamapps/common");
}
