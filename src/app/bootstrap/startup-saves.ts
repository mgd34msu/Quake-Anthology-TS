import { readdir, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import type { InstalledCatalog } from "../../content/catalog/index.ts";
import { readSaveImage } from "../../persistence/save-image.ts";
import { savedSimulationSettings } from "./simulation/index.ts";

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
  constructor(private readonly catalog: InstalledCatalog, readonly directory: string) {}
  get list(): StartupSaveList { return this.current; }
  path(id: string): string {
    const row = this.current.rows.find(row => row.id === id), path = this.paths.get(id);
    if (row === undefined || path === undefined) throw new Error("This saved game is no longer listed. Refresh the saved games.");
    if (row.unavailable !== null) throw new Error(row.unavailable);
    return path;
  }
  async refresh(): Promise<void> {
    const files: string[] = [], rows: StartupSaveRow[] = [], paths = new Map<string, string>();
    let error: string | null = null;
    const scan = async (directory: string): Promise<void> => {
      try {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const path = join(directory, entry.name);
          if (entry.isDirectory()) await scan(path);
          else if (entry.isFile() && entry.name.toLowerCase().endsWith(".sav")) files.push(path);
        }
      } catch (cause) {
        if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return;
        error = "Some saved games could not be read. Check access and refresh.";
      }
    };
    await scan(this.directory);
    for (const path of files) {
      const id = relative(this.directory, path), name = basename(path).replace(/\.sav$/i, "");
      const label = name.toLowerCase() === "autosave" ? "Autosave" : name.toLowerCase() === "quicksave" ? "Quicksave" : name.replaceAll("_", " ");
      let savedAtMilliseconds = 0, map = "Unknown map", game = "Unknown game", unavailable: string | null = null;
      try {
        savedAtMilliseconds = (await stat(path)).mtimeMs;
        const image = await readSaveImage(path);
        map = image.recipe.map.geometry.requestedPath.replace(/^maps\//, "").replace(/\.bsp$/, "");
        const product = this.catalog.product(image.recipe.map.entities.content);
        game = `${product.expectation.title} (${product.expectation.edition})`;
        if (product.expectation.family === "q3") unavailable = "Quake III saved games are not supported yet.";
        else {
          savedSimulationSettings(image);
          if (product.availability.kind !== "installed") unavailable = "Required game content is not installed.";
        }
      } catch {
        unavailable = "This saved game is unreadable or uses an unsupported save version.";
      }
      paths.set(id, path); rows.push({ id, label, map, game, savedAtMilliseconds, unavailable });
    }
    rows.sort((left, right) => right.savedAtMilliseconds - left.savedAtMilliseconds || left.id.localeCompare(right.id));
    this.paths = paths; this.current = { rows, error };
  }
}
