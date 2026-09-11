import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, readlink, realpath, symlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { hashBytes, hashJson } from "./hash.ts";

type SnapshotEntry =
  | { readonly kind: "file"; readonly path: string; readonly mode: number; readonly data: Uint8Array; readonly sha256: string }
  | { readonly kind: "link"; readonly path: string; readonly target: string };

export type SnapshotFile =
  | { readonly kind: "file"; readonly path: string; readonly mode: number; readonly bytes: number; readonly sha256: string }
  | { readonly kind: "link"; readonly path: string; readonly target: string };

export interface SnapshotManifest {
  readonly sha256: string;
  readonly files: readonly SnapshotFile[];
}

export function isWithin(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

export class WorkspaceSnapshot {
  readonly #entries: readonly SnapshotEntry[];
  readonly manifest: SnapshotManifest;

  private constructor(entries: readonly SnapshotEntry[]) {
    this.#entries = entries;
    const files: SnapshotFile[] = entries.map(entry => entry.kind === "link"
      ? { kind: "link", path: entry.path, target: entry.target }
      : { kind: "file", path: entry.path, mode: entry.mode, bytes: entry.data.length, sha256: entry.sha256 });
    this.manifest = { sha256: hashJson(files), files };
  }

  static async capture(directory: string, options: { readonly exclude?: readonly string[] } = {}): Promise<WorkspaceSnapshot> {
    const root = await realpath(directory);
    const dependencyRoot = join(root, "node_modules");
    const exclusions = [".git", ".artifacts", "dist", ...(options.exclude ?? [])].map(path => resolve(root, path));
    const entries: SnapshotEntry[] = [];
    async function visit(directoryPath: string, prefix: string): Promise<void> {
      for (const child of await readdir(directoryPath, { withFileTypes: true })) {
        const path = prefix === "" ? child.name : `${prefix}/${child.name}`;
        const absolutePath = join(directoryPath, child.name);
        if (exclusions.some(exclusion => isWithin(exclusion, absolutePath))) continue;
        if (/^(?:q3key|quake3cdkey)(?:\..*)?$/i.test(child.name)) throw new Error(`Snapshot refuses a credential filename: ${path}`);
        if (child.isDirectory()) await visit(absolutePath, path);
        else if (child.isSymbolicLink()) {
          const target = await readlink(absolutePath);
          if (!path.startsWith("node_modules/") || isAbsolute(target)
            || !isWithin(dependencyRoot, resolve(dirname(absolutePath), target))
            || !isWithin(dependencyRoot, await realpath(absolutePath))) {
            throw new Error(`Snapshot refuses a source or external dependency symlink: ${path}`);
          }
          entries.push({ kind: "link", path, target });
        } else if (child.isFile()) {
          const stat = await lstat(absolutePath);
          if (!stat.isFile()) throw new Error(`Snapshot input changed file kind: ${path}`);
          const data = new Uint8Array(await readFile(absolutePath));
          entries.push({ kind: "file", path, mode: stat.mode & 0o555, data, sha256: hashBytes(data) });
        } else throw new Error(`Snapshot refuses a non-regular input: ${path}`);
      }
    }
    await visit(root, "");
    entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    return new WorkspaceSnapshot(entries);
  }

  async materialize(parent: string, prefix = "verify-"): Promise<string> {
    if (!/^[a-zA-Z0-9_-]+$/.test(prefix)) throw new Error("Snapshot prefix must be a plain directory prefix");
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(join(resolve(parent), prefix));
    for (const entry of this.#entries) {
      const path = join(root, entry.path);
      await mkdir(dirname(path), { recursive: true });
      if (entry.kind === "link") await symlink(entry.target, path);
      else {
        await writeFile(path, entry.data, { flag: "wx" });
        await chmod(path, entry.mode);
      }
    }
    return root;
  }
}
