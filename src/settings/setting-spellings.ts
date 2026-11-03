// SPDX-License-Identifier: GPL-2.0-or-later
import type { CvarAlias } from "../core/cvars/index.ts";
import {
  ENGINE_SETTINGS,
  finiteNumber,
  identityConversion as identity,
  type EngineSetting,
  type LayerFormat,
  type SettingSpelling,
} from "../core/cvars/setting-declarations.ts";

export type { LayerFormat };

const byName = new Map<string, { readonly setting: EngineSetting; readonly spelling: SettingSpelling | null }>();
for (const setting of ENGINE_SETTINGS) {
  byName.set(setting.canonical, { setting, spelling: null });
  for (const entry of setting.spellings) byName.set(entry.name.toLowerCase(), { setting, spelling: entry });
}

/** The setting a cvar name spells, in any game: the canonical name or one of its spellings. */
export function settingFor(name: string): { readonly setting: EngineSetting; readonly spelling: SettingSpelling | null } | null {
  return byName.get(name.toLowerCase()) ?? null;
}

/** A value read in a cvar's own spelling, as the canonical value; null when it is not a value of the setting. */
export function toCanonical(name: string, value: string): { readonly canonical: string; readonly value: string } | null {
  const found = settingFor(name);
  if (found === null) return null;
  const conversion = found.spelling?.conversion ?? identity;
  if (conversion.kind === "identity") return finiteNumber(value) === null ? null : { canonical: found.setting.canonical, value };
  const written = conversion.write(value);
  return written.kind === "value" ? { canonical: found.setting.canonical, value: written.value } : null;
}

/** The spelling a game's native file uses for a canonical setting, or null when the game does not have it. */
export function spellingIn(format: LayerFormat, canonical: string): { readonly name: string; toFile(value: string): string } | null {
  const found = byName.get(canonical);
  if (found === undefined || found.spelling !== null) return null;
  const render = (conversion: CvarAlias["conversion"], value: string): string => {
    if (conversion.kind === "identity") return value;
    const converted = Number(conversion.read(value));
    return Number.isFinite(converted) ? String(Number(converted.toPrecision(7))) : conversion.read(value);
  };
  if (found.setting.formats.includes(format)) return { name: canonical, toFile: value => value };
  const used = found.setting.spellings.find(entry => entry.formats.includes(format));
  return used === undefined ? null : { name: used.name, toFile: value => render(used.conversion, value) };
}

/** What a game's file holds for the canonical settings given: file spellings and values, plus the companions it needs. */
export function fileCvars(format: LayerFormat, canonical: ReadonlyMap<string, string>): Map<string, { readonly name: string; readonly value: string }> {
  const out = new Map<string, { readonly name: string; readonly value: string }>();
  for (const setting of ENGINE_SETTINGS) {
    const value = canonical.get(setting.canonical);
    const used = value === undefined ? null : spellingIn(format, setting.canonical);
    if (value === undefined || used === null) continue;
    out.set(used.name.toLowerCase(), { name: used.name, value: used.toFile(value) });
    for (const companion of setting.companions ?? [])
      if (companion.format === format) out.set(companion.name.toLowerCase(), { name: companion.name, value: companion.value });
  }
  return out;
}
