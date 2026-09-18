import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isMissingFile, normalizeResourcePath } from "../../content/mounts/paths.ts";
import { demoFamily, type DemoFamily } from "./demo-playback.ts";

export interface DemoLibraryEntry { readonly id: string; readonly label: string; readonly family: DemoFamily; }
export interface DemoLibraryMounts {
  listFiles(directory: string, extension: string): Promise<readonly string[]>;
  read(path: string): Promise<Uint8Array | undefined>;
}

/** User recordings and active mounted demos share the same public resource names. */
export class DemoLibrary {
  constructor(readonly root: string, private readonly mounts: DemoLibraryMounts) {}
  async list(): Promise<readonly DemoLibraryEntry[]> {
    const names = new Map<string, string>();
    const add = (path: string): void => {
      if (!/\.(dem|qwd|dm2|mvd|dm_\d+)$/i.test(path)) return;
      const normalized = normalizeResourcePath(path);
      names.set(normalized.toLowerCase(), normalized);
    };
    for (const [directory, extension] of [["", ".dem"], ["", ".qwd"], ["demos", ".dm2"], ["demos", ".mvd"], ["demos", ".dm_66"], ["demos", ".dm_67"], ["demos", ".dm_68"]] satisfies readonly (readonly [string, string])[]) {
      for (const name of await this.mounts.listFiles(directory, extension)) add(directory === "" ? name : `${directory}/${name}`);
    }
    const scan = async (directory: string): Promise<void> => {
      const entries = await readdir(join(this.root, directory), { withFileTypes: true }).catch((error: unknown) => {
        if (isMissingFile(error)) return [];
        throw error;
      });
      for (const entry of entries) {
        const path = directory === "" ? entry.name : `${directory}/${entry.name}`;
        if (entry.isDirectory()) await scan(path);
        else if (entry.isFile()) add(path);
      }
    };
    await scan("");
    return [...names.values()].sort((a, b) => a.localeCompare(b)).map(id => ({ id, label: id, family: demoFamily(id, "q1") }));
  }
  async read(path: string): Promise<Uint8Array | undefined> {
    const normalized = normalizeResourcePath(path);
    try { return await readFile(join(this.root, normalized)); }
    catch (error) { if (!isMissingFile(error)) throw error; }
    return this.mounts.read(normalized);
  }
}
