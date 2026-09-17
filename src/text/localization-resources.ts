import type { SeatId } from "../contracts/identity.ts";
import { LocalizationCatalog } from "./localization.ts";

/** English fills missing entries; selected language and its mod overlay take precedence. */
export async function loadLocalizationResources(seat: SeatId, language: string, read: (path: string) => Promise<Uint8Array | null>, profile: "q1-rerelease" | "q2-rerelease" = "q1-rerelease"): Promise<LocalizationCatalog> {
  const catalog = new LocalizationCatalog(seat, profile);
  for (const name of language === "english" ? ["english"] : ["english", language]) {
    const [base, mod] = await Promise.all([read(`localization/loc_${name}.txt`), read(`localization/loc_${name}_mod.txt`)]);
    if (base !== null) catalog.merge(base);
    if (mod !== null) catalog.merge(mod);
  }
  return catalog;
}
