/* Command parsing from Quake common.c, Quake II q_shared.c/cmd.c and
 * Quake III cmd.c; adapted from quake-3-ts/src/core/text.ts.
 * Copyright (C) 1996-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { CommandDialect } from "../../contracts/common.ts";

export function sourceCommandText(input: string): string {
  const nul = input.indexOf("\0"), text = nul < 0 ? input : input.slice(0, nul);
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) > 255) throw new RangeError("Command text requires source bytes");
  }
  return text;
}

export function asciiFold(text: string): string {
  return text.replace(/[A-Z]/g, character => String.fromCharCode(character.charCodeAt(0) + 32));
}

export function isQ1(dialect: CommandDialect): boolean {
  return dialect === "q1-netquake" || dialect === "q1-quakeworld";
}

export function isQ2(dialect: CommandDialect): boolean {
  return dialect === "q2-classic" || dialect === "q2-rerelease";
}

export function commandSeparatorOffset(text: string, dialect: CommandDialect): number {
  let quoted = false, offset = 0;
  while (offset < text.length) {
    const character = text.charAt(offset);
    if (character === '"') quoted = !quoted;
    if ((!quoted && character === ";") || character === "\n" || dialect === "q3" && character === "\r") break;
    offset++;
  }
  return offset;
}

interface ParsedToken { readonly value: string; readonly end: number; }

export type CommandTextMode = "source" | "console";

/** Original signed-char lexers skip high bytes; direct console input keeps extended glyphs. */
function whitespace(text: string, index: number, mode: CommandTextMode): boolean {
  const byte = text.charCodeAt(index);
  return byte <= 32 || mode === "source" && byte >= 128;
}

function parseToken(text: string, start: number, dialect: CommandDialect, mode: CommandTextMode): ParsedToken | undefined {
  let offset = start;
  while (offset < text.length) {
    while (offset < text.length && whitespace(text, offset, mode)) offset++;
    if (text.startsWith("//", offset)) {
      if (dialect === "q3") return undefined;
      while (offset < text.length && text.charAt(offset) !== "\n") offset++;
      continue;
    }
    if (dialect === "q3" && text.startsWith("/*", offset)) {
      const end = text.indexOf("*/", offset + 2);
      offset = end < 0 ? text.length : end + 2;
      continue;
    }
    break;
  }
  if (offset >= text.length) return undefined;
  const quoted = text.charAt(offset) === '"';
  if (quoted) offset++;
  const tokenStart = offset;
  if (quoted) {
    while (offset < text.length && text.charAt(offset) !== '"') offset++;
  } else if (isQ1(dialect) && "{}()':".includes(text.charAt(offset))) {
    offset++;
  } else {
    while (offset < text.length && !whitespace(text, offset, mode)) {
      if (isQ1(dialect) && "{}()':".includes(text.charAt(offset))) break;
      if (dialect === "q3" && (text.charAt(offset) === '"' || text.startsWith("//", offset) || text.startsWith("/*", offset))) break;
      offset++;
    }
  }
  let value = text.slice(tokenStart, offset);
  if (isQ2(dialect) && value.length >= 128) {
    if (quoted) throw new RangeError("Quoted command token overflows source MAX_TOKEN_CHARS");
    value = "";
  } else if (isQ1(dialect) && value.length >= 1024) {
    throw new RangeError("Command token overflows source com_token");
  }
  if (quoted && text.charAt(offset) === '"') offset++;
  return { value, end: offset };
}

/** Q2 expands unquoted $cvars repeatedly and rejects unmatched quotes. */
export function expandCommandMacros(input: string, variable: (name: string) => string, print: (text: string) => void, mode: CommandTextMode = "source"): string | undefined {
  let text = sourceCommandText(input), budgetLength = text.length;
  if (budgetLength >= 1024) { print("Line exceeded 1024 chars, discarded.\n"); return undefined; }
  let quoted = false, count = 0;
  for (let offset = 0; offset < text.length; offset++) {
    if (text.charAt(offset) === '"') quoted = !quoted;
    if (quoted || text.charAt(offset) !== "$") continue;
    const token = parseToken(text, offset + 1, "q2-classic", mode);
    if (token === undefined) continue;
    const value = variable(token.value);
    budgetLength += value.length;
    if (budgetLength >= 1024) { print("Expanded line exceeded 1024 chars, discarded.\n"); return undefined; }
    text = text.slice(0, offset) + value + text.slice(token.end);
    offset--;
    if (++count === 100) { print("Macro expansion loop, discarded.\n"); return undefined; }
  }
  if (quoted) { print("Line has unmatched quote, discarded.\n"); return undefined; }
  return text;
}

export interface CommandTokens {
  readonly argv: readonly string[];
  readonly argsText: string;
}

export function tokenizeCommand(input: string, dialect: CommandDialect, mode: CommandTextMode = "source"): CommandTokens {
  const text = sourceCommandText(input), argv: string[] = [];
  const maximumTokens = dialect === "q3" ? 1024 : 80;
  let offset = 0, argsText = "", storedBytes = 0;
  while (offset < text.length) {
    while (offset < text.length && whitespace(text, offset, mode) && (dialect === "q3" || text.charAt(offset) !== "\n")) offset++;
    if (dialect !== "q3" && text.charAt(offset) === "\n") break;
    if (argv.length === 1) argsText = isQ2(dialect) ? text.slice(offset).replace(/[\x00-\x20]+$/, "") : text.slice(offset);
    const token = parseToken(text, offset, dialect, mode);
    if (token === undefined) break;
    offset = token.end;
    if (argv.length < maximumTokens) {
      storedBytes += token.value.length + 1;
      if (dialect === "q3" && storedBytes > 9216) throw new RangeError("Command tokens overflow source cmd_tokenized");
      argv.push(token.value);
    }
    if (dialect === "q3" && argv.length === maximumTokens) break;
  }
  return { argv: Object.freeze(argv), argsText: dialect === "q3" ? argv.slice(1).join(" ") : argsText };
}
