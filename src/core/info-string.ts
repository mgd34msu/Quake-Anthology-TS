// Info_ValueForKey/Info_SetValueForKey from id Software's code/game/q_shared.c.
// Info_Print is from code/qcommon/common.c.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.
import { CommonError } from "./common-error.ts";

export function printInfo(text: string, print: (text: string) => void): void {
  let cursor = text.startsWith("\\") ? 1 : 0;
  while (cursor < text.length) {
    const separator = text.indexOf("\\", cursor);
    const key = text.slice(cursor, separator < 0 ? text.length : separator);
    if (key.length >= 512) throw new RangeError("Info_Print would overflow its source key buffer");
    print(key.padEnd(20, " "));
    if (separator < 0) { print("MISSING VALUE\n"); return; }
    const next = text.indexOf("\\", separator + 1);
    const value = text.slice(separator + 1, next < 0 ? text.length : next);
    if (value.length >= 512) throw new RangeError("Info_Print would overflow its source value buffer");
    print(`${value}\n`);
    cursor = next < 0 ? text.length : next + 1;
  }
}

/** C byte strings end at NUL; this reader returns the first ASCII-insensitive key. */
export function infoValueForKey(input: string, wanted: string, maximumLength = 8192): string {
  if (!Number.isInteger(maximumLength) || maximumLength < 1 || maximumLength > 8192) throw new RangeError("Invalid source info-string bound");
  const end = input.indexOf("\0"), keyEnd = wanted.indexOf("\0");
  const text = end < 0 ? input : input.slice(0, end), key = keyEnd < 0 ? wanted : wanted.slice(0, keyEnd);
  if (text.length >= maximumLength) throw new CommonError("drop", "Info_ValueForKey: oversize infostring");
  for (const value of [text, key]) for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 255) throw new RangeError("Info_ValueForKey requires byte characters");
  }
  const fold = (value: string) => value.replace(/[A-Z]/g, character => String.fromCharCode(character.charCodeAt(0) + 32));
  let cursor = text.startsWith("\\") ? 1 : 0;
  while (cursor < text.length) {
    const separator = text.indexOf("\\", cursor);
    if (separator < 0) return "";
    const next = text.indexOf("\\", separator + 1), valueEnd = next < 0 ? text.length : next;
    if (fold(text.slice(cursor, separator)) === fold(key)) return text.slice(separator + 1, valueEnd);
    cursor = valueEnd + 1;
  }
  return "";
}

