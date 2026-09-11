// Lossless jsoncpp numeric representation from the Quake II rerelease g_save.cpp format.
import { SaveFormatError } from "./value.ts";

export class SaveNumber {
  constructor(readonly text: string) {
    if (!/^(?:-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|NaN|-?Infinity)$/.test(text)) throw new SaveFormatError("json", "invalid source number");
  }
  number(): number { return Number(this.text); }
  bigint(): bigint { return BigInt(this.text); }
  static from(value: number | bigint): SaveNumber { return new SaveNumber(Object.is(value, -0) ? "-0.0" : String(value)); }
}
export type SaveJson = null | boolean | string | SaveNumber | SaveJson[] | SaveObject;
export interface SaveObject { [key: string]: SaveJson; }

export function parseSourceJson(text: string): SaveJson {
  let offset = 0;
  const fail = (message: string): never => { throw new SaveFormatError(`json:${offset}`, message); };
  const whitespace = (): void => { while (/\s/.test(text.charAt(offset)) && offset < text.length) offset++; };
  const string = (): string => {
    if (text.charAt(offset) !== '"') return fail("expected a string");
    const start = offset++;
    for (;;) {
      const character = text.charAt(offset++);
      if (character === "") return fail("unterminated string");
      if (character === "\\") { offset++; continue; }
      if (character === '"') break;
    }
    const decoded: unknown = JSON.parse(text.slice(start, offset));
    return typeof decoded === "string" ? decoded : fail("invalid string");
  };
  const value = (): SaveJson => {
    whitespace();
    const character = text.charAt(offset);
    if (character === '"') return string();
    if (character === "{" || character === "[") {
      offset++; whitespace();
      const end = character === "{" ? "}" : "]";
      const object: SaveObject = {}; const array: SaveJson[] = [];
      if (text.charAt(offset) !== end) {
        for (;;) {
          if (character === "{") {
            whitespace(); const key = string(); whitespace();
            if (text.charAt(offset++) !== ":") return fail("expected ':'");
            Object.defineProperty(object, key, { value: value(), writable: true, configurable: true, enumerable: true });
          } else array.push(value());
          whitespace();
          if (text.charAt(offset) !== ",") break;
          offset++; whitespace();
        }
      }
      if (text.charAt(offset++) !== end) return fail(`expected '${end}'`);
      return character === "{" ? object : array;
    }
    for (const [literal, parsed] of [["null", null], ["true", true], ["false", false]] satisfies readonly (readonly [string, null | boolean])[]) {
      if (text.startsWith(literal, offset)) { offset += literal.length; return parsed; }
    }
    const match = /^(?:NaN|-?Infinity|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(offset));
    if (match === null) return fail("expected a value");
    offset += match[0].length; return new SaveNumber(match[0]);
  };
  const root = value(); whitespace();
  if (offset !== text.length) fail("trailing save data");
  return root;
}

export function writeSourceJson(value: SaveJson): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (value instanceof SaveNumber) return value.text;
  if (Array.isArray(value)) return `[${value.map(writeSourceJson).join(",")}]`;
  return `{${Object.keys(value).map(key => {
    const field = value[key];
    if (field === undefined) throw new SaveFormatError(key, "undefined source save field");
    return `${JSON.stringify(key)}:${writeSourceJson(field)}`;
  }).join(",")}}`;
}

export function sourceObject(value: SaveJson | undefined, path: string): SaveObject {
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value) || value instanceof SaveNumber) throw new SaveFormatError(path, "expected an object");
  return value;
}
export function sourceNumber(value: SaveJson | undefined, path: string, fallback = 0): number {
  if (value === undefined) return fallback;
  if (!(value instanceof SaveNumber)) throw new SaveFormatError(path, "expected a numeric literal");
  return value.number();
}
