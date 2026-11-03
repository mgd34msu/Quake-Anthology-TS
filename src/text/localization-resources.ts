// SPDX-License-Identifier: GPL-2.0-or-later
import type { SeatId } from "../contracts/identity.ts";
import { LocalizationCatalog, LocalizationTable } from "./localization.ts";
import type { LibLog } from "./localization.ts";

type LocalizationReader = (path: string) => Promise<Uint8Array | null>;
type LocalizationProfile = LocalizationTable["profile"];
/** English fills missing entries; selected language and its mod overlay take precedence. */
async function loadResources<T extends LocalizationTable>(catalog: T, language: string, read: LocalizationReader, log?: LibLog): Promise<T> {
  const options = log === undefined ? {} : { log };
  // Sequential on purpose: readers may record what they loaded (bot asset
  // provenance hashes insertion order), so load order must be deterministic.
  for (const name of language === "english" ? ["english"] : ["english", language]) {
    const base = await read(`localization/loc_${name}.txt`);
    if (base !== null) catalog.merge(base, options);
    const mod = await read(`localization/loc_${name}_mod.txt`);
    if (mod !== null) catalog.merge(mod, options);
  }
  return catalog;
}
export function loadLocalizationResources(
  seat: SeatId,
  language: string,
  read: LocalizationReader,
  profile: LocalizationProfile = "q1-rerelease",
  log?: LibLog,
): Promise<LocalizationCatalog> {
  return loadResources(new LocalizationCatalog(seat, profile), language, read, log);
}
/** Server-authored strings use the same grammar and overlays without a fabricated player seat. */
export function loadServerLocalizationResources(
  language: string,
  read: LocalizationReader,
  profile: LocalizationProfile = "q1-rerelease",
  log?: LibLog,
): Promise<LocalizationTable> {
  return loadResources(new LocalizationTable(profile), language, read, log);
}
