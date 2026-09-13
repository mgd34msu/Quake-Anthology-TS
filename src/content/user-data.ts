import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathWithinRoot } from "./mounts/paths.ts";

export function defaultUserContentRoot(): string { return resolve(homedir(), ".local/share/quake-typescript/content"); }

/** Every family uses its catalog contentDirectory beneath the common writable root. */
export function userProductDirectory(userContentRoot: string, contentDirectory: string): string {
  return pathWithinRoot(userContentRoot, contentDirectory);
}
