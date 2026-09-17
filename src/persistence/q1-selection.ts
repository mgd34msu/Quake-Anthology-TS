import { basename, dirname } from "node:path";
import type { CatalogProduct, InstalledCatalog } from "../content/catalog/index.ts";
import type { Q1SaveData } from "./q1.ts";

/** Original v5 does not identify progs.dat or the game directory. Never guess between mods. */
export function selectQ1SaveProduct(catalog: InstalledCatalog, save: Q1SaveData, path: string, selected?: string): CatalogProduct {
  const directory = basename(dirname(path));
  let candidates = catalog.products.filter(product => product.expectation.family === "q1" && product.availability.kind === "installed"
    && product.maps.some(map => map.path.toLowerCase() === `maps/${save.map.toLowerCase()}.bsp`));
  if (save.format.version === 6) {
    const directories = save.format.gameDirectories.split(";").filter(Boolean);
    const game = directories.at(-1)?.toLowerCase();
    if (game === undefined || directories.some(name => !/^[a-zA-Z0-9_-]+$/.test(name))) throw new Error("Invalid source save game directories.");
    candidates = candidates.filter(product => basename(product.expectation.contentDirectory).toLowerCase() === game);
  }
  if (selected !== undefined) {
    const explicit = candidates.find(product => product.expectation.id === selected || product.id === selected);
    if (explicit === undefined) throw new Error("Selected source game does not match this save.");
    return explicit;
  }
  const contextual = candidates.filter(product => product.expectation.id === directory);
  if (contextual.length === 1 && contextual[0] !== undefined) return contextual[0];
  if (candidates.length === 1 && candidates[0] !== undefined) return candidates[0];
  throw new Error(candidates.length === 0 ? "Required source save game content is not installed." : "Select the source game for this save; its original format does not identify the program.");
}
