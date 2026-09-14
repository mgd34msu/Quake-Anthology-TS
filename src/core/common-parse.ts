import { SaveReader } from "../persistence/value.ts";
/*
 * COM_Parse, COM_ParseExt, COM_Compress, SkipWhitespace and SkipRestOfLine from game/q_shared.c.
 * Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.
 * Uses the source Linux/QVM signed-char byte profile.
 */

import { CommonError } from "./common-error.ts";
import { nativeAtof } from "./numeric.ts";

const MAX_TOKEN_CHARS = 1024;

export class CommonParseCursor {
  readonly source: string;
  private readonly terminator: number;
  private currentOffset: number | null = 0;

  constructor(source: string, readonly end: "terminated" | "uninitialized" = "terminated") {
    for (let index = 0; index < source.length; index++) {
      if (source.charCodeAt(index) > 255) {
        throw new RangeError(`COM_Parse source is not a Latin-1 byte string at ${index}`);
      }
    }
    this.source = source;
    const nul = source.indexOf("\0");
    this.terminator = nul === -1 ? source.length : nul;
  }

  get offset(): number | null {
    return this.currentOffset;
  }

  set offset(value: number | null) {
    if (value !== null && (!Number.isSafeInteger(value) || value < 0 || value > this.terminator)) {
      throw new RangeError("COM_Parse cursor is outside its C byte string");
    }
    this.currentOffset = value;
  }
}

function signedByte(cursor: CommonParseCursor, offset: number): number {
  const source = cursor.source;
  if (offset === source.length) {
    if (cursor.end === "uninitialized") throw new RangeError("COM_Parse reached an uninitialized short-read tail");
    return 0;
  }
  const byte = source.charCodeAt(offset);
  return byte >= 128 ? byte - 256 : byte;
}

/** COM_Compress preserves quoted bytes and coalesces pending whitespace before the next token. */
export function compressCommonText(source: string, end: CommonParseCursor["end"] = "terminated"): string {
  const cursor = new CommonParseCursor(source, end);
  let offset = 0, output = "", newline = false, whitespace = false;
  let byte: number;
  while ((byte = signedByte(cursor, offset)) !== 0) {
    if (byte === 47 && signedByte(cursor, offset + 1) === 47) {
      while ((byte = signedByte(cursor, offset)) !== 0 && byte !== 10) offset++;
    } else if (byte === 47 && signedByte(cursor, offset + 1) === 42) {
      while (signedByte(cursor, offset) !== 0
        && (signedByte(cursor, offset) !== 42 || signedByte(cursor, offset + 1) !== 47)) offset++;
      if (signedByte(cursor, offset) !== 0) offset += 2;
    } else if (byte === 10 || byte === 13) {
      newline = true;
      offset++;
    } else if (byte === 32 || byte === 9) {
      whitespace = true;
      offset++;
    } else {
      if (newline) { output += "\n"; newline = false; whitespace = false; }
      if (whitespace) { output += " "; whitespace = false; }
      output += source.charAt(offset++);
      if (byte === 34) {
        while ((byte = signedByte(cursor, offset)) !== 0 && byte !== 34) output += source.charAt(offset++);
        if (byte === 34) output += source.charAt(offset++);
      }
    }
  }
  return output;
}

export class CommonParseState {
  captureSaveState() { return { token: this.currentToken, line: this.currentLine, name: this.currentName }; }
  restoreSaveState(value: unknown): void {
    const reader = new SaveReader(value, "common.parser");
    const token = reader.field("token").string(), line = reader.field("line").integer(0), name = reader.field("name").string();
    if (token.length >= MAX_TOKEN_CHARS || name.length >= MAX_TOKEN_CHARS) reader.fail("parser string exceeds source storage");
    this.currentToken = token; this.currentLine = line; this.currentName = name;
  }

  private currentToken = "";
  private currentLine = 0;
  private currentName = "";

  /** COM_BeginParseSession does not clear the shared token. */
  beginSession(name: string, print: (text: string) => undefined): void {
    this.currentLine = 0;
    const cursor = new CommonParseCursor(name);
    const nul = cursor.source.indexOf("\0");
    const text = nul < 0 ? cursor.source : cursor.source.slice(0, nul);
    if (text.length >= 32000) throw new CommonError("fatal", "Com_sprintf: overflowed bigbuffer");
    if (text.length >= MAX_TOKEN_CHARS) print(`Com_sprintf: overflow of ${text.length} in ${MAX_TOKEN_CHARS}\n`);
    this.currentName = text.slice(0, MAX_TOKEN_CHARS - 1);
  }

  parseError(message: string, print: (text: string) => undefined): void {
    this.diagnostic("ERROR", message, print);
  }

  parseWarning(message: string, print: (text: string) => undefined): void {
    this.diagnostic("WARNING", message, print);
  }

  private diagnostic(kind: "ERROR" | "WARNING", message: string, print: (text: string) => undefined): void {
    const nul = message.indexOf("\0");
    print(`${kind}: ${this.currentName}, line ${this.currentLine}: ${nul < 0 ? message : message.slice(0, nul)}\n`);
  }

  matchToken(cursor: CommonParseCursor, match: string): void {
    const token = this.parse(cursor);
    const nul = match.indexOf("\0"), expected = nul < 0 ? match : match.slice(0, nul);
    if (token !== expected) throw new CommonError("drop", `MatchToken: ${token} != ${expected}`);
  }

  skipBracedSection(cursor: CommonParseCursor): void {
    let depth = 0;
    do {
      const token = this.parse(cursor);
      if (token === "{") depth++;
      else if (token === "}") depth--;
    } while (depth !== 0 && cursor.offset !== null);
  }

  /** Parse1DMatrix uses the engine's native atof and writes each reached cell. */
  parse1DMatrix(cursor: CommonParseCursor, x: number, matrix: Float32Array, offset = 0): void {
    this.matchToken(cursor, "(");
    for (let index = 0; index < x; index++) {
      const token = this.parse(cursor);
      const target = offset + index;
      if (!Number.isInteger(target) || target < 0 || target >= matrix.length) {
        throw new RangeError("Parse1DMatrix write exceeds its destination");
      }
      matrix[target] = nativeAtof(token);
    }
    this.matchToken(cursor, ")");
  }

  parse2DMatrix(cursor: CommonParseCursor, y: number, x: number, matrix: Float32Array, offset = 0): void {
    this.matchToken(cursor, "(");
    for (let index = 0; index < y; index++) this.parse1DMatrix(cursor, x, matrix, offset + index * x);
    this.matchToken(cursor, ")");
  }

  parse3DMatrix(cursor: CommonParseCursor, z: number, y: number, x: number, matrix: Float32Array, offset = 0): void {
    this.matchToken(cursor, "(");
    for (let index = 0; index < z; index++) this.parse2DMatrix(cursor, y, x, matrix, offset + index * x * y);
    this.matchToken(cursor, ")");
  }

  get token(): string {
    return this.currentToken;
  }

  /** Callers can write through COM_Parse's shared char pointer without advancing parsing. */
  overwriteToken(text: string): void {
    const nul = text.indexOf("\0"), value = nul < 0 ? text : text.slice(0, nul);
    if (value.length >= MAX_TOKEN_CHARS) throw new RangeError("COM_Parse token write exceeds its source buffer");
    for (let index = 0; index < value.length; index++) {
      if (value.charCodeAt(index) > 255) throw new RangeError("COM_Parse token write requires source bytes");
    }
    this.currentToken = value;
  }

  get line(): number {
    return this.currentLine;
  }

  /** SkipRestOfLine leaves the token untouched and consumes raw bytes through LF. */
  skipRestOfLine(cursor: CommonParseCursor): void {
    let data = cursor.offset;
    if (data === null) throw new RangeError("SkipRestOfLine requires a live source cursor");
    for (;;) {
      const byte = signedByte(cursor, data++);
      if (byte === 0) {
        // C advances past NUL; retain the parser's managed exhaustion convention.
        cursor.offset = null;
        return;
      }
      if (byte === 10) {
        this.currentLine = (this.currentLine + 1) | 0;
        cursor.offset = data;
        return;
      }
    }
  }

  parse(cursor: CommonParseCursor, allowLineBreaks = true): string {
    let data = cursor.offset;
    this.currentToken = "";
    if (data === null) return this.currentToken;

    const source = cursor.source;
    let hasNewLines = false;
    let c: number;
    while (true) {
      // SkipWhitespace counts LF, including the lookahead LF left by a word.
      while ((c = signedByte(cursor, data)) <= 32) {
        if (c === 0) {
          cursor.offset = null;
          return this.currentToken;
        }
        if (c === 10) {
          this.currentLine = (this.currentLine + 1) | 0;
          hasNewLines = true;
        }
        data++;
      }
      if (hasNewLines && !allowLineBreaks) {
        cursor.offset = data;
        return this.currentToken;
      }

      if (c === 47 && signedByte(cursor, data + 1) === 47) {
        data += 2;
        while ((c = signedByte(cursor, data)) !== 0 && c !== 10) data++;
      } else if (c === 47 && signedByte(cursor, data + 1) === 42) {
        data += 2;
        while (signedByte(cursor, data) !== 0
          && (signedByte(cursor, data) !== 42 || signedByte(cursor, data + 1) !== 47)) {
          data++;
        }
        if (signedByte(cursor, data) !== 0) data += 2;
      } else {
        break;
      }
    }

    if (c === 34) {
      data++;
      while (true) {
        c = signedByte(cursor, data);
        data++;
        if (c === 34 || c === 0) {
          // C writes its terminator out of bounds at length 1024. Reject at
          // that write, preserving the prefix and uncommitted caller cursor.
          if (this.currentToken.length === MAX_TOKEN_CHARS) {
            throw new RangeError("COM_Parse quoted token terminator exceeds 1024-byte storage");
          }
          // C advances past NUL on an unterminated quote. Retain its partial
          // token, but represent exhaustion without exposing that unsafe read.
          cursor.offset = c === 0 ? null : data;
          return this.currentToken;
        }
        if (this.currentToken.length < MAX_TOKEN_CHARS) {
          this.currentToken += source.charAt(data - 1);
        }
      }
    }

    do {
      if (this.currentToken.length < MAX_TOKEN_CHARS) {
        this.currentToken += source.charAt(data);
      }
      data++;
      c = signedByte(cursor, data);
      if (c === 10) this.currentLine = (this.currentLine + 1) | 0;
    } while (c > 32);

    if (this.currentToken.length === MAX_TOKEN_CHARS) this.currentToken = "";
    cursor.offset = data;
    return this.currentToken;
  }
}

/*
 * General text parsing from the Quake III TypeScript port.
 * Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.
 */

export const INFO_STRING_MAX = 1024;
export const BIG_INFO_STRING_MAX = 8192;
export const TOKEN_MAX = 1024;
export const COMMAND_TOKEN_MAX = 1024;

export interface Token {
  readonly value: string;
  readonly line: number;
  readonly column: number;
  readonly quoted: boolean;
}

export class TextParseError extends Error {
  readonly sourceName: string;
  readonly line: number;
  readonly column: number;

  constructor(sourceName: string, line: number, column: number, message: string) {
    super(`${sourceName}:${line}:${column}: ${message}`);
    this.name = "TextParseError";
    this.sourceName = sourceName;
    this.line = line;
    this.column = column;
  }
}

function isWhitespace(character: string): boolean {
  const code = character.charCodeAt(0);
  return code <= 32;
}

export class Tokenizer {
  private readonly source: string;
  private readonly sourceName: string;
  private offset = 0;
  private currentLine = 1;
  private currentColumn = 1;

  constructor(source: string, name = "<text>") {
    this.source = source;
    this.sourceName = name;
  }

  get name(): string {
    return this.sourceName;
  }

  get line(): number {
    return this.currentLine;
  }

  get column(): number {
    return this.currentColumn;
  }

  next(allowLineBreaks = true): Token | undefined {
    let crossedLine = false;

    while (true) {
      while (this.offset < this.source.length) {
        const character = this.source[this.offset];
        if (character === undefined || !isWhitespace(character)) {
          break;
        }
        if (character === "\n" || character === "\r") {
          crossedLine = true;
        }
        this.advance();
      }

      if (this.source.startsWith("//", this.offset)) {
        this.advance();
        this.advance();
        while (this.offset < this.source.length) {
          const character = this.source[this.offset];
          if (character === "\n" || character === "\r") {
            break;
          }
          this.advance();
        }
        continue;
      }

      if (this.source.startsWith("/*", this.offset)) {
        this.advance();
        this.advance();
        while (this.offset < this.source.length && !this.source.startsWith("*/", this.offset)) {
          const character = this.source[this.offset];
          if (character === "\n" || character === "\r") {
            crossedLine = true;
          }
          this.advance();
        }
        if (this.source.startsWith("*/", this.offset)) {
          this.advance();
          this.advance();
        }
        continue;
      }

      break;
    }

    if (!allowLineBreaks && crossedLine) {
      return undefined;
    }
    if (this.offset >= this.source.length) {
      return undefined;
    }

    const line = this.currentLine;
    const column = this.currentColumn;
    const quoted = this.source[this.offset] === '"';
    let value = "";

    if (quoted) {
      this.advance();
      while (this.offset < this.source.length) {
        const character = this.source[this.offset];
        if (character === undefined || character === '"') {
          break;
        }
        value += character;
        this.advance();
      }
      if (this.source[this.offset] === '"') {
        this.advance();
      }
    } else {
      while (this.offset < this.source.length) {
        const character = this.source[this.offset];
        if (character === undefined || isWhitespace(character)) {
          break;
        }
        value += character;
        this.advance();
      }
    }

    if (value.length >= TOKEN_MAX) {
      throw new TextParseError(this.sourceName, line, column, `token is limited to ${TOKEN_MAX - 1} characters`);
    }

    return Object.freeze({ value, line, column, quoted });
  }

  private advance(): void {
    const character = this.source[this.offset];
    if (character === undefined) {
      return;
    }
    if (character === "\r") {
      this.offset++;
      if (this.source[this.offset] === "\n") {
        this.offset++;
      }
      this.currentLine++;
      this.currentColumn = 1;
      return;
    }
    this.offset++;
    if (character === "\n") {
      this.currentLine++;
      this.currentColumn = 1;
    } else {
      this.currentColumn++;
    }
  }
}

function parseError(tokenizer: Tokenizer, message: string, token?: Token): TextParseError {
  if (token === undefined) {
    return new TextParseError(tokenizer.name, tokenizer.line, tokenizer.column, message);
  }
  return new TextParseError(tokenizer.name, token.line, token.column, message);
}

export function parseEntities(text: string, name = "<entities>"): readonly ReadonlyMap<string, string>[] {
  const tokenizer = new Tokenizer(text, name);
  const entities: ReadonlyMap<string, string>[] = [];

  while (true) {
    const opening = tokenizer.next();
    if (opening === undefined) {
      return Object.freeze(entities);
    }
    if (opening.value !== "{") {
      throw parseError(tokenizer, 'expected "{"', opening);
    }

    const entity = new Map<string, string>();
    while (true) {
      const key = tokenizer.next();
      if (key === undefined) {
        throw parseError(tokenizer, 'expected key or "}"');
      }
      if (key.value === "}") {
        entities.push(entity);
        break;
      }
      const value = tokenizer.next(false);
      if (value === undefined) {
        throw parseError(tokenizer, `missing value for entity key "${key.value}"`);
      }
      if (value.value === "}") {
        throw parseError(tokenizer, `missing value for entity key "${key.value}"`, value);
      }
      entity.set(key.value, value.value);
    }
  }
}


/* Q1 common.c and Q2 q_shared.c donor parsers. Id Software, GPL-2.0-or-later. */

export interface LegacyParseState {
  data: string;
  index: number;
}

function byteAt(data: string, i: number): number {
  return i < data.length ? data.charCodeAt(i) & 0xff : 0;
}
function signedByteAt(data: string, i: number): number {
  const b = byteAt(data, i);
  return b >= 128 ? b - 256 : b;
}

const SINGLE_CHAR_TOKENS = new Set([123, 125, 41, 40, 39, 58]); // { } ) ( ' :

/** Q1 donor COM_Parse; NetQuake separates punctuation while QuakeWorld does not. */
export function parseQ1Token(ps: LegacyParseState, dialect: "netquake" | "quakeworld" = "netquake"): string | null {
  const data = ps.data;
  let i = ps.index;

  for (;;) {
    // skip whitespace
    let c = signedByteAt(data, i);
    while (c <= 32) {
      if (c === 0) {
        ps.index = i;
        return null; // end of file
      }
      i++;
      c = signedByteAt(data, i);
    }

    // skip // comments
    if (byteAt(data, i) === 47 && byteAt(data, i + 1) === 47) {
      while (byteAt(data, i) !== 0 && byteAt(data, i) !== 10) i++;
      continue; // goto skipwhite
    }

    break;
  }

  const c0 = byteAt(data, i);

  // handle quoted strings specially
  if (c0 === 34 /* '"' */) {
    i++;
    let token = "";
    for (;;) {
      const c = byteAt(data, i);
      i++;
      if (c === 34 || c === 0) {
        ps.index = i;
        return token;
      }
      token += String.fromCharCode(c);
    }
  }

  // QW/client/common.c has no single-character punctuation branch.
  if (dialect !== "quakeworld" && SINGLE_CHAR_TOKENS.has(c0)) {
    ps.index = i + 1;
    return String.fromCharCode(c0);
  }

  // parse a regular word
  let token = "";
  let c = c0;
  do {
    token += String.fromCharCode(c);
    i++;
    c = byteAt(data, i);
    if (dialect !== "quakeworld" && SINGLE_CHAR_TOKENS.has(c)) break;
  } while (signedByteAt(data, i) > 32);

  ps.index = i;
  return token;
}


function charAt(s: string, idx: number): number {
  // mirrors reading a C null-terminated string: past the end reads as 0
  return idx < s.length ? s.charCodeAt(idx) : 0;
}

/**
 * q_shared.h:70 `#define MAX_TOKEN_CHARS 128 // max length of an individual
 * token`. This is vanilla 3.21's value and stays the default here, so every
 * existing caller keeps vanilla's truncation exactly.
 *
 * The re-release raised it: game.h:122 `constexpr size_t MAX_TOKEN_CHARS =
 * 512;`, and its q_std.cpp COM_ParseEx falls back to a
 * `static char com_token[MAX_TOKEN_CHARS]` of that size whenever the caller
 * passes no buffer -- which is every call in the re-release game code,
 * ED_ParseEdict's key/value parse included. src/kexgame/ passes that 512
 * through the `maxTokenChars` parameter below (see src/kexgame/q_std.ts);
 * src/game/ does not, because 128 is the number vanilla actually used.
 */
export const Q2_TOKEN_MAX = 128;

/*
==============
COM_Parse

Parse a token out of a string
==============
*/
export function parseQ2Token(state: LegacyParseState, maxTokenChars: number = Q2_TOKEN_MAX): string {
  const s = state.data;
  let idx = state.index;
  let len = 0;
  let token = "";

  for (;;) {
    // skip whitespace
    let c = charAt(s, idx);
    while (c <= 32) {
      if (c === 0) {
        state.index = idx;
        return "";
      }
      idx++;
      c = charAt(s, idx);
    }

    // skip // comments
    if (c === 47 /* '/' */ && charAt(s, idx + 1) === 47) {
      while (charAt(s, idx) !== 0 && charAt(s, idx) !== 10 /* '\n' */) idx++;
      continue; // goto skipwhite
    }
    break;
  }

  let c = charAt(s, idx);

  // handle quoted strings specially
  if (c === 34 /* '"' */) {
    idx++;
    for (;;) {
      c = charAt(s, idx);
      idx++;
      if (c === 34 || c === 0) {
        state.index = idx;
        return token;
      }
      if (len < maxTokenChars) {
        token += String.fromCharCode(c);
        len++;
      }
    }
  }

  // parse a regular word
  do {
    if (len < maxTokenChars) {
      token += String.fromCharCode(c);
      len++;
    }
    idx++;
    c = charAt(s, idx);
  } while (c > 32);

  if (len === maxTokenChars) {
    token = "";
  }

  state.index = idx;
  return token;
}
