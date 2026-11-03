// SPDX-License-Identifier: GPL-2.0-or-later
/** Native menu strings are English literals; a catalog maps a literal to its translation per language. */
export type MenuCatalogs = ReadonlyMap<string, ReadonlyMap<string, string>>;

/** Unknown languages and strings missing from a catalog fall back to the source literal. */
export function createMenuLocalizer(catalogs: () => MenuCatalogs, language: () => string): (text: string) => string {
  return text => {
    const lang = language();
    return lang === "english" ? text : (catalogs().get(lang)?.get(text) ?? text);
  };
}
