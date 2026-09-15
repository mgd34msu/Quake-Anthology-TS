// Q_atoi and IN_Impulse from Quake I/II cl_input.c; MSG_WriteByte emits the low byte.
// Copyright (C) id Software. GPL-2.0-or-later.
import type { CommandDialect } from "../contracts/common.ts";

function quakeInteger(text: string): number {
  let offset = text[0] === "-" ? 1 : 0;
  const sign = offset === 1 ? -1 : 1;
  let value = 0;
  if (text[offset] === "0" && (text[offset + 1] === "x" || text[offset + 1] === "X")) {
    offset += 2;
    for (; offset < text.length; offset++) {
      const code = text.charCodeAt(offset);
      if (code >= 48 && code <= 57) value = (value << 4) + code - 48;
      else if (code >= 97 && code <= 102) value = (value << 4) + code - 97 + 10;
      else if (code >= 65 && code <= 70) value = (value << 4) + code - 65 + 10;
      else break;
    }
  } else if (text[offset] === "'") {
    const code = text.charCodeAt(offset + 1);
    value = Number.isNaN(code) ? 0 : code;
  } else {
    for (; offset < text.length; offset++) {
      const code = text.charCodeAt(offset);
      if (code < 48 || code > 57) break;
      value = value * 10 + (code - 48);
    }
  }
  return sign * value;
}

export function parseImpulse(text: string, dialect: CommandDialect): number {
  switch (dialect) {
    case "q1-netquake":
    case "q1-quakeworld": return quakeInteger(text) & 255;
    case "q2-classic": return Number.parseInt(text, 10) & 255;
    case "q2-rerelease":
    case "q3": return Number(text);
  }
}
