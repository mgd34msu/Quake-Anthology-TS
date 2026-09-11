import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { FileSource } from "./source.ts";
import { normalizeEntryPath } from "./types.ts";

export interface LooseEntryHandle {
  readonly path: string;
  readonly source: string;
  readonly byteLength: number;
  read(): Promise<Uint8Array>;
  close(): void;
}

/** Native path resolution is confined to the selected loose root. */
export function openLooseEntry(rootPath: string, memberPath: string): LooseEntryHandle {
  const path = normalizeEntryPath(memberPath);
  if (path.endsWith("/")) throw new RangeError("Expected a loose file path");
  const root = realpathSync(rootPath);
  const source = realpathSync(resolve(root, path));
  const within = relative(root, source);
  if (within === ".." || within.startsWith("../") || isAbsolute(within)) throw new RangeError(`Loose entry escapes root: ${memberPath}`);
  const storage = new FileSource(source);
  return Object.freeze({ path, source, byteLength: storage.byteLength,
    read: () => storage.read(0, storage.byteLength), close: () => storage.close() });
}

export async function readLooseEntry(rootPath: string, memberPath: string): Promise<Uint8Array> {
  const entry = openLooseEntry(rootPath, memberPath);
  try { return await entry.read(); }
  finally { entry.close(); }
}
