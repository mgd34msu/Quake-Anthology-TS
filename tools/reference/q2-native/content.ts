import { createHash } from "node:crypto";
import { mkdir, symlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { identifyFile } from "../environment.ts";
import type { FileIdentity } from "../schema.ts";

export interface ArchiveEntry {
  readonly archive: string;
  readonly name: string;
  readonly offset: number;
  readonly size: number;
  readonly sha256: string;
}

export async function stageContent(archives: readonly string[], directory: string, maps: readonly string[]) {
  const identities: FileIdentity[] = [];
  const selected = new Map<string, ArchiveEntry>();
  const archiveDirectory = join(directory, "baseq2");
  await mkdir(archiveDirectory, { recursive: true });
  for (const archive of archives) {
    identities.push(await identifyFile(archive));
    await symlink(archive, join(archiveDirectory, basename(archive)));
    const file = Bun.file(archive);
    const header = Buffer.from(await file.slice(0, 12).arrayBuffer());
    if (header.length !== 12 || header.toString("ascii", 0, 4) !== "PACK") throw new Error(`Invalid PAK: ${archive}`);
    const offset = header.readUInt32LE(4);
    const size = header.readUInt32LE(8);
    if (size % 64 !== 0 || offset + size > file.size) throw new Error(`Invalid PAK directory: ${archive}`);
    const entries = Buffer.from(await file.slice(offset, offset + size).arrayBuffer());
    for (let index = 0; index < size; index += 64) {
      const name = entries.toString("ascii", index, index + 56).split("\0")[0];
      if (name === undefined || !maps.includes(name)) continue;
      const entryOffset = entries.readUInt32LE(index + 56);
      const entrySize = entries.readUInt32LE(index + 60);
      if (entryOffset + entrySize > file.size) throw new Error(`Invalid PAK entry: ${name}`);
      const data = new Uint8Array(await file.slice(entryOffset, entryOffset + entrySize).arrayBuffer());
      selected.set(name, { archive, name, offset: entryOffset, size: entrySize, sha256: createHash("sha256").update(data).digest("hex") });
    }
  }
  for (const name of maps) if (!selected.has(name)) throw new Error(`Missing selected content: ${name}`);
  return { archivesLowToHighPriority: identities, entries: [...selected.values()],
    mount: directory, selection: "Only explicitly listed archive symlinks; no corpus loose files or user configs." };
}
