// SPDX-License-Identifier: GPL-2.0-or-later
import type { CatalogProduct, InstalledCatalog } from "../content/catalog/index.ts";
import { basename } from "node:path";

/**
 * The product a Quake II save belongs to. A save folder is named by its game directory (`baseq2/save/NAME`), and a
 * retail pak records it in the `gamename` cvar. Several products can share one directory (the base game and the
 * expansions that run from it), so the selection, then the running product, then the directory's own stock game decide.
 */
export function selectQ2SaveProduct(
  catalog: InstalledCatalog,
  edition: "classic" | "rerelease",
  gameDirectory: string | null,
  selected?: string,
  running?: string,
): CatalogProduct {
  const candidates = catalog.products.filter(
    product =>
      product.expectation.family === "q2" &&
      product.expectation.edition === edition &&
      product.availability.kind === "installed" &&
      (gameDirectory === null || basename(product.expectation.contentDirectory).toLowerCase() === gameDirectory.toLowerCase()),
  );
  if (selected !== undefined) {
    const explicit = candidates.find(product => product.expectation.id === selected || product.id === selected);
    if (explicit === undefined) throw new Error("Selected source game does not match this save.");
    return explicit;
  }
  const only = candidates[0];
  if (candidates.length === 1 && only !== undefined) return only;
  const current = candidates.find(product => product.expectation.id === running);
  if (current !== undefined) return current;
  const stock = candidates.filter(product => gameDirectory !== null && product.expectation.id === `q2-${edition}-${gameDirectory.toLowerCase()}`);
  if (stock.length === 1 && stock[0] !== undefined) return stock[0];
  throw new Error(
    candidates.length === 0
      ? `Quake II game directory ${gameDirectory ?? "(unknown)"} is not installed.`
      : "Select the source game for this save; more than one installed game uses its directory.",
  );
}

export interface Q2SavedSettings {
  readonly skill: 0 | 1 | 2 | 3;
  readonly mode: "singleplayer" | "coop";
  readonly maxClients: number;
}
/** The server settings a save recorded, as the launch options they stand for. Deathmatch games cannot be saved or loaded. */
export function q2SavedSettings(cvars: ReadonlyMap<string, string>): Q2SavedSettings {
  if (Number(cvars.get("deathmatch") ?? "0") !== 0) throw new Error("A deathmatch game cannot be restored from a save.");
  const skill = Number(cvars.get("skill") ?? "1"),
    maxClients = Math.trunc(Number(cvars.get("maxclients") ?? "1"));
  const coop = Number(cvars.get("coop") ?? "0") !== 0;
  return {
    skill: skill === 0 || skill === 1 || skill === 2 || skill === 3 ? skill : 1,
    mode: coop ? "coop" : "singleplayer",
    maxClients: Number.isSafeInteger(maxClients) && maxClients >= 1 && maxClients <= 64 ? maxClients : 1,
  };
}
