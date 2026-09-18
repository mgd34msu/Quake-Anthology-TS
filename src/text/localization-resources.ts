import type { SeatId } from "../contracts/identity.ts";
import { LocalizationCatalog, LocalizationTable } from "./localization.ts";

type LocalizationReader = (path: string) => Promise<Uint8Array | null>;
type LocalizationProfile = LocalizationTable["profile"];
/** English fills missing entries; selected language and its mod overlay take precedence. */
async function loadResources<T extends LocalizationTable>(catalog: T, language: string, read: LocalizationReader): Promise<T> {
  for (const name of language === "english" ? ["english"] : ["english", language]) {
    const [base, mod] = await Promise.all([read(`localization/loc_${name}.txt`), read(`localization/loc_${name}_mod.txt`)]);
    if (base !== null) catalog.merge(base);
    if (mod !== null) catalog.merge(mod);
  }
  return catalog;
}
export function loadLocalizationResources(seat: SeatId, language: string, read: LocalizationReader, profile: LocalizationProfile = "q1-rerelease"): Promise<LocalizationCatalog> {
  return loadResources(new LocalizationCatalog(seat, profile), language, read);
}
/** Server-authored strings use the same grammar and overlays without a fabricated player seat. */
export function loadServerLocalizationResources(language: string, read: LocalizationReader, profile: LocalizationProfile = "q1-rerelease"): Promise<LocalizationTable> {
  return loadResources(new LocalizationTable(profile), language, read);
}
