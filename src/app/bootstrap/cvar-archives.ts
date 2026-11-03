// SPDX-License-Identifier: GPL-2.0-or-later
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
  // Text that is not JSON restores nothing, like the absent archive;
  // parsed archives still face owner/dialect validation.
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  try {
    const reader = new SaveReader(value, "cvar archive");
    reader.field("version").literal(1);
    reader.field("dialect").literal(dialect);
    const entries = reader.field("entries").list(entry => ({ name: entry.field("name").string(), value: entry.field("value").string() }));
    if (new Set(entries.map(entry => entry.name)).size !== entries.length) reader.fail("duplicate archived cvar");
    return entries;
  } catch {
    return [];
  } // A malformed archive restores nothing; the registry's own defaults apply.
}

export async function saveCvarArchive(
  store: ConfigStore,
  owner: CvarArchiveOwner,
  registry: CvarRegistry,
  entries: readonly CvarArchiveEntry[] = registry.archiveEntries(),
): Promise<void> {
  await store.dump(archivePath(owner), `${JSON.stringify({ version: 1, dialect: registry.dialect, entries })}\n`);
}

const ARCHIVE_COMMANDS = new Set(["seta", "set", "sets", "setu", "bind", "unbind", "unbindall"]);
/** Saved settings are data: only variable and binding lines survive, one command per line, so a damaged or injected file cannot run anything else. */
export function archiveDataText(text: string, isCommand: (name: string) => boolean): string {
  const kept: string[] = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("//")) continue;
    let quoted = false,
      chained = false;
    for (const character of trimmed) {
      if (character === '"') quoted = !quoted;
      else if (character === ";" && !quoted) chained = true;
    }
    const first = trimmed.split(/\s+/, 1)[0] ?? "";
    // Quake I writes a bare `name "value"` line for an archived variable.
    const bareVariable = /^[^\s";]+ +"[^"]*"$/.test(trimmed) && !isCommand(first);
    if (quoted || chained || (!ARCHIVE_COMMANDS.has(first.toLowerCase()) && !bareVariable)) continue;
    kept.push(trimmed);
  }
  return kept.length === 0 ? "" : `${kept.join("\n")}\n`;
}
