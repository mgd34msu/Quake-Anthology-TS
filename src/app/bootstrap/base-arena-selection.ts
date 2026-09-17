import type { InstalledCatalog } from "../../content/catalog/index.ts";
import { createIdentityOwner } from "../../contracts/identity.ts";
import { CvarRegistry, CvarFlag } from "../../core/cvars/index.ts";
import { readBaseArenaCatalog, type BaseArena, type BaseArenaCatalog } from "./base-arena-catalog.ts";
import { BaseArenaProgression } from "./base-arena-progression.ts";
import { configurationStore, openInitialConfigurationContent } from "./configuration.ts";
import { loadCvarArchive } from "./cvar-archives.ts";
import type { ApplicationOptions } from "./options.ts";

export interface ArenaSelectionRow {
  readonly arena: BaseArena;
  readonly tier: string;
  readonly available: boolean;
  readonly record: string;
}
export interface ArenaSelection {
  readonly tiers: readonly { readonly id: string; readonly label: string }[];
  readonly rows: readonly ArenaSelectionRow[];
  readonly current: string | null;
}

export function arenaSelection(catalog: BaseArenaCatalog, progress: BaseArenaProgression, savedSelection = ""): ArenaSelection {
  const tiers = new Map<string, string>();
  const rows = catalog.arenas.filter(arena => arena.special !== "" || arena.number < catalog.regularCount).sort((a, b) => a.selection - b.selection).map(arena => {
    const special = arena.special.toLowerCase();
    const tier = special === "training" ? "training" : special === "final" ? "final" : String(Math.trunc(arena.number / 4) + 1);
    tiers.set(tier, tier === "training" ? "Training" : tier === "final" ? "Final arena" : `Tier ${tier}`);
    const best = progress.best(arena.number);
    return { arena, tier, available: progress.levelAvailable(arena.number),
      record: best.rank === 0 ? "Not completed" : `Rank ${best.rank} · Skill ${best.skill}` };
  });
  return { tiers: [...tiers].map(([id, label]) => ({ id, label })), rows,
    current: (savedSelection.trim() === "" ? undefined : rows.find(row => row.available && row.arena.selection === Number(savedSelection)))?.arena.map
      ?? catalog.arenas.find(arena => arena.number === progress.currentLevel())?.map ?? rows.find(row => row.available)?.arena.map ?? null };
}

/** Reads the same source profile used by launch without starting a world or writing settings. */
export async function readArenaSelection(installed: InstalledCatalog, options: ApplicationOptions): Promise<ArenaSelection> {
  const content = await openInitialConfigurationContent(options, undefined, installed);
  try {
    const catalog = await readBaseArenaCatalog(content.mounts);
    const cvars = new CvarRegistry({ dialect: "q3", context: { session: createIdentityOwner("arena-selection").session, origin: { kind: "server-console" } } });
    const progress = new BaseArenaProgression(cvars, {
      regularLevels: catalog.regularCount, totalLevels: catalog.regularCount + catalog.arenas.filter(arena => arena.special !== "").length,
      training: catalog.arenas.find(arena => arena.special.toLowerCase() === "training")?.number ?? null,
      final: catalog.arenas.find(arena => arena.special.toLowerCase() === "final")?.number ?? null,
    });
    cvars.register("ui_spSelection", "", CvarFlag.Archive);
    const source = content.selection.source;
    const entries = await loadCvarArchive(configurationStore(options, content, source.content), ["source", source.content, source.provider], "q3");
    cvars.applyArchive(entries.filter(entry => cvars.find(entry.name) !== undefined));
    return arenaSelection(catalog, progress, cvars.variableString("ui_spSelection"));
  } finally { await content.close(); }
}
