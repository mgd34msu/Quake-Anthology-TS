import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { nightdiveAddonDirectories, type NightdiveAddonRoot } from "./roots.ts";
import { pathWithinRoot } from "./mounts/paths.ts";

export function defaultUserContentRoot(): string { return resolve(homedir(), ".local/share/quake-typescript/content"); }

/** Saves and settings sit beside the content root by default and inside a custom --user-content-root. */
export function userDataDirectory(kind: "saves" | "settings", userContentRoot?: string): string {
  return userContentRoot === undefined ? resolve(homedir(), ".local/share/quake-typescript", kind) : join(resolve(userContentRoot), kind);
}

/** Read-only Nightdive/Steam add-on roots, layered below corpus and user content. */
export function defaultAddonContentRoots(home: string = homedir()): readonly NightdiveAddonRoot[] {
  return nightdiveAddonDirectories(home);
}

/** Every family uses its catalog contentDirectory beneath the common writable root. */
export function userProductDirectory(userContentRoot: string, contentDirectory: string): string {
  return pathWithinRoot(userContentRoot, contentDirectory);
}
