/*
 * Text parsing translated from Quake III Arena's q_shared.c and cmd.c.
 * Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.
 */

export const TOKEN_MAX = 1024;

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
