import { KeyCode } from "../input/key-codes.ts";
export { EditField, type FieldControls, type FieldClipboard } from "./source-field.ts";

/** Native menus and rerelease console edit Unicode by code point; source byte fields remain separate. */
export class ConsoleField {
  private characters: string[] = [];
  cursor = 0;
  scroll = 0;
  overstrike = false;
  constructor(readonly maximumLength = 1023, public widthInChars = 78) {}
  get text(): string { return this.characters.join(""); }
  setText(text: string): void {
    this.characters = [...text.replace(/[\x00-\x1f\x7f]/g, "")].slice(0, this.maximumLength);
    this.cursor = this.characters.length; this.keepVisible();
  }
  clear(): void { this.characters = []; this.cursor = 0; this.scroll = 0; }
  insert(text: string): void {
    for (const character of text) {
      if (character < " " || character === "\x7f") continue;
      if (this.overstrike && this.cursor < this.characters.length) this.characters[this.cursor++] = character;
      else if (this.characters.length < this.maximumLength) this.characters.splice(this.cursor++, 0, character);
    }
    this.keepVisible();
  }
  key(code: number, control: boolean, shift: boolean, clipboard: () => string | null): boolean {
    if ((code === 118 && control) || ((code === KeyCode.Insert || code === KeyCode.KeypadInsert) && shift)) {
      const text = clipboard(); if (text !== null) this.insert(text.split(/[\r\n\0]/, 1)[0] ?? ""); return true;
    }
    if (control) {
      switch (code) {
        case 97: this.cursor = 0; break;
        case 101: this.cursor = this.characters.length; break;
        case 99: case 117: this.clear(); break;
        case 107: this.characters.splice(this.cursor); break;
        case 119: { const start = this.word(-1); this.characters.splice(start, this.cursor - start); this.cursor = start; break; }
        default: return this.navigation(code, true);
      }
      this.keepVisible(); return true;
    }
    return this.navigation(code, false);
  }
  private word(direction: -1 | 1): number {
    let cursor = this.cursor;
    const at = (): string => this.characters[cursor + (direction === -1 ? -1 : 0)] ?? "";
    while (cursor + direction >= 0 && cursor + direction <= this.characters.length && /\s/.test(at())) cursor += direction;
    while (cursor + direction >= 0 && cursor + direction <= this.characters.length && at() !== "" && !/\s/.test(at())) cursor += direction;
    return cursor;
  }
  private navigation(code: number, control: boolean): boolean {
    switch (code) {
      case KeyCode.Backspace: if (this.cursor > 0) this.characters.splice(--this.cursor, 1); break;
      case KeyCode.Delete: this.characters.splice(this.cursor, 1); break;
      case KeyCode.Left: this.cursor = control ? this.word(-1) : Math.max(0, this.cursor - 1); break;
      case KeyCode.Right: this.cursor = control ? this.word(1) : Math.min(this.characters.length, this.cursor + 1); break;
      case KeyCode.Home: this.cursor = 0; break;
      case KeyCode.End: this.cursor = this.characters.length; break;
      case KeyCode.Insert: this.overstrike = !this.overstrike; break;
      default: return false;
    }
    this.keepVisible(); return true;
  }
  private keepVisible(): void {
    this.scroll = Math.max(0, Math.min(this.scroll, this.cursor));
    if (this.cursor >= this.scroll + this.widthInChars) this.scroll = this.cursor - Math.max(1, this.widthInChars) + 1;
  }
}

export interface CompletionResult { readonly text: string; readonly matches: readonly string[]; }
export function completeCommand(text: string, names: readonly string[]): CompletionResult {
  const match = /^([\\/]?)([^\s]*)(.*)$/s.exec(text);
  const marker = match?.[1] ?? "", prefix = match?.[2] ?? "", tail = match?.[3] ?? "";
  if (prefix === "") return { text, matches: [] };
  const fold = (value: string): string => value.replace(/[A-Z]/g, character => character.toLowerCase());
  const matches = [...new Set(names)].filter(name => fold(name).startsWith(fold(prefix)));
  const first = matches[0];
  if (first === undefined) return { text, matches };
  let common = first;
  for (const name of matches) {
    let length = 0;
    while (length < common.length && fold(common.charAt(length)) === fold(name.charAt(length))) length++;
    common = common.slice(0, length);
  }
  return { text: `${marker}${common}${tail || (matches.length === 1 ? " " : "")}`, matches };
}

export class ConsoleHistory {
  private entries: string[] = [];
  private position = 0;
  private draft = "";
  constructor(readonly capacity = 32) {}
  get lines(): readonly string[] { return [...this.entries]; }
  replace(lines: readonly string[]): void { this.entries = lines.filter(line => line.length > 0).slice(-this.capacity); this.position = this.entries.length; }
  add(line: string): void {
    if (line.length === 0) return;
    this.entries.push(line); if (this.entries.length > this.capacity) this.entries.shift();
    this.position = this.entries.length; this.draft = "";
  }
  previous(current: string): string {
    if (this.position === this.entries.length) this.draft = current;
    this.position = Math.max(0, this.position - 1);
    return this.entries[this.position] ?? current;
  }
  next(): string { this.position = Math.min(this.entries.length, this.position + 1); return this.entries[this.position] ?? this.draft; }
}
