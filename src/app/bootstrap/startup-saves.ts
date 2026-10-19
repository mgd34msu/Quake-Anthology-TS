import { mkdir, readdir, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import type { InstalledCatalog } from "../../content/catalog/index.ts";
import { readKexQ2SaveInfo } from "../../persistence/kex-q2-save.ts";
import { readSavedGame } from "../../persistence/saved-game.ts";
import { selectQ1SaveProduct } from "../../persistence/q1-selection.ts";
import { savedSimulationSettings } from "./simulation/index.ts";

/**
 * First `name.sav` under a read-only external save root or one of its game
 * directories, in root order. External saves are only ever read.
 */
export async function resolveExternalSavePath(directories: readonly string[], name: string): Promise<string | null> {
  const filename = name.toLowerCase().endsWith(".sav") ? name : `${name}.sav`;
  if (filename.includes("/") || filename.includes("\\") || filename === ".sav") return null;
  for (const directory of directories) {
    const direct = join(directory, filename);
    if (await Bun.file(direct).exists()) return direct;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const nested = join(directory, entry.name, filename);
      if (await Bun.file(nested).exists()) return nested;
    }
  }
  return null;
}

export interface StartupSaveRow {
  readonly id: string;
  readonly label: string;
  readonly map: string;
  readonly game: string;
  readonly savedAtMilliseconds: number;
  readonly unavailable: string | null;
}
export interface StartupSaveList { readonly rows: readonly StartupSaveRow[]; readonly error: string | null; }

/** Files are inspected on browser open/refresh. Drawing only reads this retained list. */
export class StartupSaves {
  private current: StartupSaveList = { rows: [], error: null };
  private paths = new Map<string, string>();
  constructor(private readonly catalog: InstalledCatalog, readonly directory: string, readonly externalDirectories: readonly string[] = []) {}
  get list(): StartupSaveList { return this.current; }
  path(id: string): string {
    const row = this.current.rows.find(row => row.id === id), path = this.paths.get(id);
    if (row === undefined || path === undefined) throw new Error("This saved game is no longer listed. Refresh the saved games.");
    if (row.unavailable !== null) throw new Error(row.unavailable);
    return path;
  }
  async namedPath(name: string): Promise<string> {
    const label = name.trim();
    if (!/^[\p{L}\p{N} _-]{1,48}$/u.test(label)) throw new Error("Use 1-48 letters, numbers, spaces, - or _.");
    await mkdir(this.directory, { recursive: true });
    const path = join(this.directory, `${label}.sav`);
    if (await Bun.file(path).exists()) throw new Error("Name exists. Select its slot to overwrite.");
    return path;
  }
  async refresh(): Promise<void> {
    const files: { readonly path: string; readonly id: string }[] = [], rows: StartupSaveRow[] = [], paths = new Map<string, string>();
    const seen = new Set<string>();
    let error: string | null = null;
    const scan = async (directory: string, collect: (path: string) => void): Promise<void> => {
      try {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const path = join(directory, entry.name);
          if (entry.isDirectory()) await scan(path, collect);
          else if (entry.isFile() && (entry.name.toLowerCase().endsWith(".sav") || entry.name.toLowerCase().endsWith(".pak.gz"))) collect(path);
        }
      } catch (cause) {
        if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return;
        error = "Some saved games could not be read. Check access and refresh.";
      }
    };
    await scan(this.directory, path => {
      if (path.toLowerCase().endsWith(".pak.gz") || seen.has(path)) return;
      seen.add(path); files.push({ path, id: relative(this.directory, path) });
    });
    // Read-only saves from other engines (Nightdive/Steam Saved Games):
    // listed and loadable where the format is supported, never written.
    for (const [index, root] of this.externalDirectories.entries())
      await scan(root, path => {
        if (seen.has(path)) return;
        seen.add(path); files.push({ path, id: `external/${index}/${relative(root, path)}` });
      });
    for (const { path, id } of files) {
      if (path.toLowerCase().endsWith(".pak.gz")) {
        let label = basename(path).replace(/\.pak\.gz$/i, ""), map = "Unknown map", game = "Quake II (rerelease)", savedAtMilliseconds = 0;
        let unavailable: string | null = "Retail Quake II saves are identified here but cannot be restored by this engine yet.";
        try {
          savedAtMilliseconds = (await stat(path)).mtimeMs;
          const info = await readKexQ2SaveInfo(path);
          if (info.comment !== "") label = info.comment;
          map = info.mapCommand;
          if (info.timestamp > 0n && info.timestamp < 253402300800n) savedAtMilliseconds = Number(info.timestamp) * 1000;
          const product = this.catalog.products.find(candidate => candidate.expectation.family === "q2" && candidate.expectation.edition === "rerelease"
            && basename(candidate.expectation.contentDirectory).toLowerCase() === (info.gameDirectory ?? "").toLowerCase());
          if (product !== undefined) game = `${product.expectation.title} (${product.expectation.edition})`;
        } catch (cause) { unavailable = cause instanceof Error ? cause.message : "This saved game is unreadable or uses an unsupported save version."; }
        paths.set(id, path); rows.push({ id, label, map, game, savedAtMilliseconds, unavailable });
        continue;
      }
      const name = basename(path).replace(/\.sav$/i, "");
      const label = name.toLowerCase() === "autosave" ? "Autosave" : name.toLowerCase() === "quicksave" ? "Quicksave" : name.replaceAll("_", " ");
      let savedAtMilliseconds = 0, map = "Unknown map", game = "Unknown game", unavailable: string | null = null;
      try {
        savedAtMilliseconds = (await stat(path)).mtimeMs;
        const save = await readSavedGame(path);
        const product = save.kind === "shared" ? this.catalog.product(save.image.recipe.map.entities.content)
          : selectQ1SaveProduct(this.catalog, save.data, path);
        map = save.kind === "shared" ? save.image.recipe.map.geometry.requestedPath.replace(/^maps\//, "").replace(/\.bsp$/, "") : save.data.map;
        game = `${product.expectation.title} (${product.expectation.edition})`;
        if (save.kind === "shared") savedSimulationSettings(save.image);
        if (product.availability.kind !== "installed") unavailable = "Required game content is not installed.";
      } catch (cause) {
        unavailable = cause instanceof Error ? cause.message : "This saved game is unreadable or uses an unsupported save version.";
      }
      paths.set(id, path); rows.push({ id, label, map, game, savedAtMilliseconds, unavailable });
    }
    rows.sort((left, right) => right.savedAtMilliseconds - left.savedAtMilliseconds || left.id.localeCompare(right.id));
    this.paths = paths; this.current = { rows, error };
  }
}
