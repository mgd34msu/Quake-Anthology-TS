import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { MountedContent, OpenedResource } from "../../content/mounts/index.ts";
import type { InstalledCatalog } from "../../content/catalog/index.ts";

export interface BotAssetResources { open(path: string): Promise<OpenedResource | null>; }
export interface BotSourceFiles {
  read(path: string): Uint8Array | null;
  list(directory: string, extension: string): readonly string[];
}

function key(path: string): string { return path.replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase(); }

/** Text is prepared from selected mounted resources before synchronous source AI setup. */
export class BotAssetFiles implements BotSourceFiles {
  private readonly files = new Map<string, Uint8Array>();
  private readonly paths: string[] = [];

  add(path: string, bytes: Uint8Array): void {
    const normalized = key(path);
    if (!this.files.has(normalized)) this.paths.push(path.replaceAll("\\", "/"));
    this.files.set(normalized, bytes.slice());
  }
  read(path: string): Uint8Array | null { return this.files.get(key(path))?.slice() ?? null; }
  list(directory: string, extension: string): readonly string[] {
    const prefix = key(directory).replace(/\/$/, "") + "/", suffix = extension.toLowerCase();
    const result: string[] = [];
    let bytes = 0;
    for (const path of this.paths) {
      const normalized = key(path);
      if (!normalized.startsWith(prefix) || !normalized.endsWith(suffix)) continue;
      const name = path.slice(prefix.length);
      if (name.includes("/")) continue;
      if (bytes + name.length + 1 >= 1024) break;
      result.push(name); bytes += name.length + 1;
    }
    return result;
  }
}

/** orderedPaths comes from the source mount/archive listing, before alphabetical presentation sorting. */
export async function loadBotAssetFiles(resources: BotAssetResources, orderedPaths: readonly string[],
  extraPaths: readonly string[] = []): Promise<BotAssetFiles> {
  const files = new BotAssetFiles(), loaded = new Set<string>();
  const candidates = [...orderedPaths.filter(path => /^(botfiles|bots)\//i.test(path)
    || /^scripts\/.*\.(txt|bot|arena)$/i.test(path)), ...extraPaths];
  for (const path of candidates) {
    const normalized = key(path);
    if (loaded.has(normalized) || normalized.endsWith("/")) continue;
    loaded.add(normalized);
    const resource = await resources.open(path);
    if (resource !== null) files.add(path, resource.bytes);
  }
  return files;
}

/** Enumerate source mounts in precedence order, then resolve every payload through those same mounts. */
export async function loadMountedBotAssetFiles(mounts: MountedContent,
  catalog: Pick<InstalledCatalog, "products" | "rootArchives">, extraPaths: readonly string[] = []): Promise<BotAssetFiles> {
  const archives = new Map([...catalog.rootArchives, ...catalog.products.flatMap(product => product.archives)].map(archive => [archive.path, archive]));
  const paths: string[] = [];
  const loose = async (root: string, directory: string): Promise<void> => {
    const entries = await readdir(resolve(root, directory), { withFileTypes: true }).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await loose(root, path);
      else if (entry.isFile()) paths.push(path);
    }
  };
  for (const directory of ["botfiles", "bots", "scripts"]) {
    const order = mounts.plan.prefixOrders.find(entry => `${directory}/`.startsWith(entry.prefix.toLowerCase()))?.mounts ?? mounts.plan.defaultOrder;
    for (const id of order) {
      const mount = mounts.plan.mounts.find(entry => entry.identity.id === id);
      if (mount === undefined) throw new Error(`Bot listing references missing mount ${id}`);
      if (mount.kind === "loose") { await loose(mount.rootPath, directory); continue; }
      const archive = archives.get(mount.archivePath);
      if (archive === undefined) throw new Error(`Bot listing lacks mounted archive index ${mount.archivePath}`);
      for (const entry of archive.entries) if (key(entry.path).startsWith(`${directory}/`)) paths.push(entry.path);
    }
  }
  return loadBotAssetFiles(mounts, paths, extraPaths);
}
