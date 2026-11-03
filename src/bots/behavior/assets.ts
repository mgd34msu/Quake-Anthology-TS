// SPDX-License-Identifier: GPL-2.0-or-later
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import type { MountedContent, OpenedResource } from "../../content/mounts/index.ts";
import type { InstalledCatalog } from "../../content/catalog/index.ts";

export interface BotAssetResources {
  open(path: string): Promise<Pick<OpenedResource, "bytes"> | null>;
}
export interface BotSourceFiles {
  read(path: string): Uint8Array | null;
  list(directory: string, extension: string): readonly string[];
  provenance?(): string;
  /** Digest recorded by version 1 bot saves; present once prepared for a restore. */
  legacyProvenance?(): string;
}

function key(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}

/** Navigation graphs are read through the mounted resources by the navigation loader, never through these files. */
const NAVIGATION_PATH = /^bots\/navigation\//i;

function hashEntry(hash: ReturnType<typeof createHash>, path: string, bytes: Uint8Array): void {
  const name = new TextEncoder().encode(path),
    size = new Uint8Array(8),
    view = new DataView(size.buffer);
  view.setUint32(0, name.length, true);
  view.setUint32(4, bytes.length, true);
  hash.update(size);
  hash.update(name);
  hash.update(bytes);
}

/** Text is prepared from selected mounted resources before synchronous source AI setup. */
export class BotAssetFiles implements BotSourceFiles {
  private readonly files = new Map<string, Uint8Array>();
  private readonly paths: string[] = [];
  /** Listed but unread files, kept only so a version 1 save, whose digest covered them, can still be verified. */
  private readonly unread = new Map<string, () => Promise<Uint8Array | null>>();
  private readonly legacyOverrides = new Map<string, Uint8Array>();
  private legacyDigest: string | null = null;

  add(path: string, bytes: Uint8Array, legacyBytes?: Uint8Array): void {
    const normalized = key(path);
    if (!this.files.has(normalized) && !this.unread.has(normalized)) this.paths.push(path.replaceAll("\\", "/"));
    this.files.set(normalized, bytes.slice());
    if (legacyBytes !== undefined) this.legacyOverrides.set(normalized, legacyBytes.slice());
  }
  /** Records a path whose bytes are not loaded unless a legacy digest is requested. */
  addUnread(path: string, open: () => Promise<Uint8Array | null>): void {
    const normalized = key(path);
    if (this.files.has(normalized) || this.unread.has(normalized)) return;
    this.paths.push(path.replaceAll("\\", "/"));
    this.unread.set(normalized, open);
  }
  read(path: string): Uint8Array | null {
    return this.files.get(key(path))?.slice() ?? null;
  }
  provenance(): string {
    const hash = createHash("sha256");
    for (const path of this.paths) {
      if (this.unread.has(key(path))) continue;
      const bytes = this.files.get(key(path));
      if (bytes === undefined) throw new Error("Bot asset provenance lost its mounted payload");
      hashEntry(hash, path, bytes);
    }
    return hash.digest("hex");
  }
  /** Computes the digest that version 1 bot saves recorded, which included every navigation file. */
  async prepareLegacyProvenance(): Promise<void> {
    const hash = createHash("sha256");
    for (const path of this.paths) {
      const normalized = key(path),
        open = this.unread.get(normalized);
      const bytes = open === undefined ? (this.legacyOverrides.get(normalized) ?? this.files.get(normalized)) : await open();
      // A navigation file that does not exist was never part of the version 1 digest either.
      if (bytes === null) continue;
      if (bytes === undefined) throw new Error("Bot asset provenance lost its mounted payload");
      hashEntry(hash, path, bytes);
    }
    this.legacyDigest = hash.digest("hex");
  }
  legacyProvenance(): string {
    if (this.legacyDigest === null) throw new Error("Version 1 bot saves require prepared legacy asset provenance");
    return this.legacyDigest;
  }
  list(directory: string, extension: string): readonly string[] {
    const prefix = key(directory).replace(/\/$/, "") + "/",
      suffix = extension.toLowerCase();
    const result: string[] = [];
    let bytes = 0;
    for (const path of this.paths) {
      const normalized = key(path);
      if (this.unread.has(normalized) || !normalized.startsWith(prefix) || !normalized.endsWith(suffix)) continue;
      const name = path.slice(prefix.length);
      if (name.includes("/")) continue;
      if (bytes + name.length + 1 >= 1024) break;
      result.push(name);
      bytes += name.length + 1;
    }
    return result;
  }
}

/** orderedPaths comes from the source mount/archive listing, before alphabetical presentation sorting. */
export async function loadBotAssetFiles(
  resources: BotAssetResources,
  orderedPaths: readonly string[],
  extraPaths: readonly string[] = [],
): Promise<BotAssetFiles> {
  const files = new BotAssetFiles(),
    loaded = new Set<string>();
  const candidates = [...orderedPaths.filter(path => /^(botfiles|bots)\//i.test(path) || /^scripts\/.*\.(txt|bot|arena)$/i.test(path)), ...extraPaths];
  for (const path of candidates) {
    const normalized = key(path);
    if (loaded.has(normalized) || normalized.endsWith("/")) continue;
    loaded.add(normalized);
    if (NAVIGATION_PATH.test(path.replaceAll("\\", "/"))) {
      files.addUnread(path, async () => (await resources.open(path))?.bytes ?? null);
      continue;
    }
    const resource = await resources.open(path);
    if (resource !== null) files.add(path, resource.bytes);
  }
  return files;
}

/** Enumerate source mounts in precedence order, then resolve every payload through those same mounts. */
export async function loadMountedBotAssetFiles(
  mounts: MountedContent,
  catalog: Pick<InstalledCatalog, "products" | "rootArchives">,
  extraPaths: readonly string[] = [],
): Promise<BotAssetFiles> {
  const archives = new Map([...catalog.rootArchives, ...catalog.products.flatMap(product => product.archives)].map(archive => [archive.path, archive]));
  const paths: string[] = [];
  const loose = async (root: string, directory: string): Promise<void> => {
    const entries = (
      await readdir(resolve(root, directory), { withFileTypes: true }).catch((error: unknown) => {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
        throw error;
      })
    ).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
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
      if (mount.kind === "loose") {
        await loose(mount.rootPath, directory);
        continue;
      }
      const archive = archives.get(mount.archivePath);
      if (archive === undefined) throw new Error(`Bot listing lacks mounted archive index ${mount.archivePath}`);
      for (const entry of archive.entries) if (key(entry.path).startsWith(`${directory}/`)) paths.push(entry.path);
    }
  }
  return loadBotAssetFiles(mounts, paths, extraPaths);
}
