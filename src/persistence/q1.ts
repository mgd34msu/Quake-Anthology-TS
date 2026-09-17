// Quake Host_Savegame_f / Host_Loadgame_f, version 5; Ironwail's KEX version 6 header.
import type { QcTextPair } from "../compat/qc/save.ts";
import { byteText, textBytes } from "./source-bytes.ts";
import { SaveFormatError } from "./value.ts";

export interface Q1SaveData {
  readonly format: { readonly version: 5 } | { readonly version: 6; readonly gameDirectories: string };
  readonly comment: string;
  readonly spawnParameters: readonly number[];
  readonly skill: number;
  readonly map: string;
  readonly time: number;
  readonly lightStyles: readonly string[];
  readonly globals: readonly QcTextPair[];
  /** Array order is the original edict number; an empty record is a free slot. */
  readonly entities: readonly (readonly QcTextPair[])[];
  readonly extensionText: string;
}

class QuakeSaveScanner {
  offset = 0;
  constructor(readonly text: string) {}
  skip(): void {
    for (;;) {
      while (this.offset < this.text.length && this.text.charCodeAt(this.offset) <= 32) this.offset++;
      if (!this.text.startsWith("//", this.offset)) return;
      const end = this.text.indexOf("\n", this.offset); this.offset = end < 0 ? this.text.length : end + 1;
    }
  }
  token(): string {
    this.skip();
    if (this.offset >= this.text.length) throw new SaveFormatError(`q1:${this.offset}`, "truncated save");
    const first = this.text.charAt(this.offset++);
    if (first === "{" || first === "}") return first;
    if (first === '"') {
      const end = this.text.indexOf('"', this.offset);
      if (end < 0) throw new SaveFormatError(`q1:${this.offset}`, "unterminated quoted field");
      const token = this.text.slice(this.offset, end); this.offset = end + 1; return token;
    }
    const start = this.offset - 1;
    while (this.offset < this.text.length && this.text.charCodeAt(this.offset) > 32 && this.text.charAt(this.offset) !== "{" && this.text.charAt(this.offset) !== "}") this.offset++;
    return this.text.slice(start, this.offset);
  }
  number(): number {
    const text = this.token(); const value = Number(text);
    if (!Number.isFinite(value)) throw new SaveFormatError(`q1:${this.offset}`, `invalid numeric field ${text}`);
    return value;
  }
  record(): readonly QcTextPair[] {
    if (this.token() !== "{") throw new SaveFormatError(`q1:${this.offset}`, "expected opening brace");
    const pairs: QcTextPair[] = [];
    for (;;) {
      const key = this.token(); if (key === "}") return pairs;
      const value = this.token(); if (value === "}") throw new SaveFormatError(`q1:${this.offset}`, "field has no value");
      pairs.push({ key, value });
    }
  }
}

export function decodeQ1Save(bytes: Uint8Array): Q1SaveData {
  const scanner = new QuakeSaveScanner(byteText(bytes));
  const version = scanner.number();
  let format: Q1SaveData["format"];
  if (version === 5) format = { version };
  else if (version === 6) format = { version, gameDirectories: scanner.token() };
  else throw new SaveFormatError("q1", `unsupported save version ${version}`);
  const comment = scanner.token();
  const spawnParameters = Array.from({ length: 16 }, () => scanner.number());
  const skill = Math.trunc(scanner.number() + 0.1);
  const map = scanner.token(); const time = scanner.number();
  const lightStyles = Array.from({ length: 64 }, () => scanner.token());
  const globals = scanner.record(); const entities: (readonly QcTextPair[])[] = [];
  for (;;) {
    while (scanner.offset < scanner.text.length && scanner.text.charCodeAt(scanner.offset) <= 32) scanner.offset++;
    const extensionStart = scanner.offset;
    scanner.skip();
    if (scanner.text.charAt(scanner.offset) !== "{") { scanner.offset = extensionStart; break; }
    entities.push(scanner.record());
  }
  return { format, comment, spawnParameters, skill, map, time, lightStyles, globals, entities, extensionText: scanner.text.slice(scanner.offset) };
}

export function encodeQ1Save(save: Q1SaveData): Uint8Array {
  if (save.spawnParameters.length !== 16 || save.lightStyles.length !== 64) throw new SaveFormatError("q1", "save requires 16 spawn parameters and 64 light styles");
  const token = (value: string): string => { if (value.length === 0 || /[\s\0"]/.test(value)) throw new SaveFormatError("q1", "invalid save header token"); return value; };
  const decimal = (value: number): string => { if (!Number.isFinite(value)) throw new SaveFormatError("q1", "non-finite header number"); return value.toFixed(6); };
  const lines = [String(save.format.version)];
  if (save.format.version === 6) lines.push(token(save.format.gameDirectories));
  lines.push(token(save.comment), ...save.spawnParameters.map(decimal), String(Math.trunc(save.skill)), token(save.map), decimal(save.time), ...save.lightStyles.map(style => token(style || "m")));
  const record = (pairs: readonly QcTextPair[]): void => {
    lines.push("{");
    for (const pair of pairs) {
      if (/["\0]/.test(pair.key) || /["\0]/.test(pair.value)) throw new SaveFormatError("q1", "source QuakeC save strings cannot contain quotes or NUL");
      lines.push(`"${pair.key}" "${pair.value}"`);
    }
    lines.push("}");
  };
  record(save.globals); for (const entity of save.entities) record(entity);
  return textBytes(`${lines.join("\n")}\n${save.extensionText}`);
}
