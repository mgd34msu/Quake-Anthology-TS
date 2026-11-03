// SPDX-License-Identifier: GPL-2.0-or-later
// Versioned carrier for a rerelease localization key plus its arguments inside a print string.
//
// RR gamecode calls `ex_bprint("$qc_death_ax", victim, attacker)`; the key's slots take the
// remaining arguments. The classic NetQuake and QuakeWorld print messages only carry one string,
// so the key and arguments travel in that string, behind a marker no gamecode text uses.
// Layout: RS "QLK" <version digit> US <key> (US <argument>)*. Version 1 is the only layout defined;
// a reader that sees a newer version shows the key and arguments as plain text.

export const LOCALIZATION_KEY_VERSION = 1;
const RS = "\u001e",
  US = "\u001f",
  TAG = `${RS}QLK`;

export interface LocalizationKeyText {
  readonly key: string;
  readonly args: readonly string[];
}

/** Separators inside a field would corrupt the layout, so they are replaced by spaces. */
function clean(value: string): string {
  return value.includes(RS) || value.includes(US) ? value.replaceAll(RS, " ").replaceAll(US, " ") : value;
}

export function encodeLocalizationKey(key: string, args: readonly string[]): string {
  let text = `${TAG}${LOCALIZATION_KEY_VERSION}${US}${clean(key)}`;
  for (const argument of args) text += US + clean(argument);
  return text;
}

export function isLocalizationKeyText(text: string): boolean {
  return text.startsWith(TAG);
}

/** Returns null for ordinary text and for versions this reader does not define. */
export function decodeLocalizationKey(text: string): LocalizationKeyText | null {
  if (!text.startsWith(TAG)) return null;
  const fields = text.slice(TAG.length).split(US);
  const version = fields[0];
  if (version !== String(LOCALIZATION_KEY_VERSION)) return null;
  const key = fields[1];
  return key === undefined ? null : { key, args: fields.slice(2) };
}

/** Text for sinks that cannot localize (server console, logs): ordinary text is unchanged. */
export function plainLocalizationText(text: string): string {
  if (!text.startsWith(TAG)) return text;
  const fields = text.slice(TAG.length).split(US);
  return fields.slice(1).join(" ");
}
