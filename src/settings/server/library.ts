import { readdir } from "node:fs/promises";
import { settingsPath, type ConfigStore } from "../config.ts";

export interface ServerProfileEntry { readonly name: string; readonly path: string; }
/** Lists the same named files written by the server settings menu. */
export async function listServerProfiles(store: ConfigStore): Promise<readonly ServerProfileEntry[]> {
  try {
    const entries = await readdir(settingsPath(store.root, "servers"), { withFileTypes: true });
    return entries.flatMap(entry => {
      if (!entry.isFile() || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}\.json$/.test(entry.name)) return [];
      return [{ name: entry.name.slice(0, -5), path: `servers/${entry.name}` }];
    }).sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}
