import type { CommandDialect } from "../../contracts/common.ts";
import type { CvarArchiveEntry, CvarRegistry } from "../../core/cvars/index.ts";
import { SaveReader } from "../../persistence/value.ts";
import type { ConfigStore } from "../../settings/config.ts";

export type CvarArchiveOwner = readonly ["source" | "client" | "input" | "movement" | "fallback", ...string[]];

function archivePath(owner: CvarArchiveOwner): string {
  return `cvars/${owner.map(encodeURIComponent).join("/")}.json`;
}

export async function loadCvarArchive(store: ConfigStore, owner: CvarArchiveOwner, dialect: CommandDialect): Promise<readonly CvarArchiveEntry[]> {
  const text = await store.loadText(archivePath(owner));
  if (text === null) return [];
  const value: unknown = JSON.parse(text), reader = new SaveReader(value, "cvar archive");
  reader.field("version").literal(1); reader.field("dialect").literal(dialect);
  const entries = reader.field("entries").list(entry => ({ name: entry.field("name").string(), value: entry.field("value").string() }));
  if (new Set(entries.map(entry => entry.name)).size !== entries.length) reader.fail("duplicate archived cvar");
  return entries;
}

export async function saveCvarArchive(store: ConfigStore, owner: CvarArchiveOwner, registry: CvarRegistry, entries: readonly CvarArchiveEntry[] = registry.archiveEntries()): Promise<void> {
  await store.dump(archivePath(owner), `${JSON.stringify({ version: 1, dialect: registry.dialect, entries })}\n`);
}
