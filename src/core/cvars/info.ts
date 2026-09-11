/* Info_SetValueForKey from QW common.c, Q2 q_shared.c and Q3 q_shared.c.
 * Copyright (C) 1996-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { CommandDialect, CvarInfoTarget } from "../../contracts/common.ts";
import { asciiFold, sourceCommandText } from "../commands/text.ts";

export interface InfoOptions {
  readonly dialect: CommandDialect;
  readonly maximumLength: number;
  readonly target: CvarInfoTarget;
  readonly serverHighCharacters: boolean;
  readonly print: (text: string) => void;
}

export function setInfoValue(input: string, keyInput: string, valueInput: string, options: InfoOptions): string {
  const info = sourceCommandText(input), key = sourceCommandText(keyInput), value = sourceCommandText(valueInput);
  const q3 = options.dialect === "q3", qw = options.dialect === "q1-quakeworld";
  if (info.length >= options.maximumLength) throw new RangeError("Info_SetValueForKey: oversize infostring");
  if (key.includes("\\") || value.includes("\\")) { options.print("Can't use keys or values with a \\\n"); return info; }
  if ((!qw && key.includes(";")) || (q3 && value.includes(";"))) { options.print("Can't use keys or values with a semicolon\n"); return info; }
  if (key.includes('"') || value.includes('"')) { options.print('Can\'t use keys or values with a "\n'); return info; }
  if (qw && key.startsWith("*")) { options.print("Can't set * keys\n"); return info; }
  if (!q3 && (key.length > 63 || value.length > 63)) { options.print("Keys and values must be < 64 characters.\n"); return info; }
  let result = info, cursor = 0;
  while (cursor < info.length) {
    const start = cursor;
    if (info.charAt(cursor) === "\\") cursor++;
    const separator = info.indexOf("\\", cursor);
    if (separator < 0) break;
    const next = info.indexOf("\\", separator + 1), end = next < 0 ? info.length : next;
    if (info.slice(cursor, separator) === key) {
      if (qw && end > separator + 1 && value.length - (end - separator - 1) + info.length > options.maximumLength) {
        options.print("Info string length exceeded\n"); return info;
      }
      result = info.slice(0, start) + info.slice(end); break;
    }
    cursor = end;
  }
  if (value.length === 0) return result;
  let pair = `\\${key}\\${value}`;
  if (q3 && pair.length >= options.maximumLength) pair = pair.slice(0, options.maximumLength - 1);
  if (pair.length + result.length > options.maximumLength) { options.print("Info string length exceeded\n"); return result; }
  if (!q3) {
    let filtered = "";
    for (let index = 0; index < pair.length; index++) {
      let byte = pair.charCodeAt(index);
      if (qw) {
        const strip = options.target === "server-info" ? !options.serverHighCharacters : asciiFold(key) !== "name";
        if (strip) {
          byte &= 127;
          if (byte < 32 || byte > 127) continue;
          if (options.target === "client-userinfo" && asciiFold(key) === "team" && byte >= 65 && byte <= 90) byte += 32;
        }
        if (byte > 13) filtered += String.fromCharCode(byte);
      } else {
        byte &= 127;
        if (byte >= 32 && byte < 127) filtered += String.fromCharCode(byte);
      }
    }
    pair = filtered;
  }
  if (pair.length + result.length === options.maximumLength) throw new RangeError("Info string overflows source terminator");
  return q3 && options.maximumLength !== 8192 ? pair + result : result + pair;
}
