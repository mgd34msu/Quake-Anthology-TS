// Quake console word wrapping, carriage-return overwrite, colors and notify times.
// Copyright (C) id Software. GPL-2.0-or-later.
import type { CommandDialect } from "../contracts/common.ts";
export interface ConsoleCell { readonly character: string; readonly color: number; readonly alternate: boolean; }
export interface ConsoleRow { readonly sequence: number; readonly cells: readonly ConsoleCell[]; readonly timeMilliseconds: number | null; }
interface MutableRow { readonly sequence: number; cells: ConsoleCell[]; timeMilliseconds: number | null; }

export class ConsoleBuffer {
  private rows: MutableRow[] = [{ sequence: 0, cells: [], timeMilliseconds: null }];
  private x = 0;
  private nextSequence = 1;
  private backscroll = 0;
  constructor(readonly dialect: CommandDialect, public width = 78, readonly characterCapacity = 32768) {
    if (!Number.isSafeInteger(width) || width < 1 || width > characterCapacity) throw new RangeError("Invalid console width");
  }
  private current(): MutableRow {
    const row = this.rows[this.rows.length - 1];
    if (row === undefined) throw new Error("Console has no current row");
    return row;
  }
  private linefeed(time: number | null): void {
    this.current().timeMilliseconds = time;
    if (this.backscroll !== 0) this.backscroll++;
    this.rows.push({ sequence: this.nextSequence++, cells: [], timeMilliseconds: time }); this.x = 0;
    this.trim();
  }
  private trim(): void {
    const maximum = Math.max(1, Math.floor(this.characterCapacity / this.width));
    if (this.rows.length > maximum) this.rows.splice(0, this.rows.length - maximum);
    this.backscroll = Math.min(this.backscroll, this.rows.length - 1);
  }
  print(text: string, timeMilliseconds: number): void {
    const skipNotify = text.startsWith("[skipnotify]"), time = skipNotify ? null : timeMilliseconds;
    if (skipNotify) text = text.slice(12);
    let alternate = false, color = 7;
    if (this.dialect !== "q3" && (text.startsWith("\x01") || text.startsWith("\x02"))) { alternate = true; text = text.slice(1); }
    const characters = [...text];
    for (let index = 0; index < characters.length; index++) {
      const character = characters[index];
      if (character === undefined) break;
      const next = characters[index + 1];
      if ((this.dialect === "q3" || this.dialect === "q2-rerelease") && character === "^" && next !== undefined && next !== "^" && next >= "0" && next <= "9") {
        color = (next.charCodeAt(0) - 48) & 7; index++; continue;
      }
      if (character === "\n") { this.linefeed(time); continue; }
      if (character === "\r") { this.x = 0; continue; }
      if (character > " ") {
        let length = 0;
        while (length < this.width && (characters[index + length] ?? "") > " ") length++;
        if (length < this.width && this.x + length >= this.width) this.linefeed(time);
      }
      const row = this.current();
      row.cells[this.x++] = { character, color, alternate }; row.timeMilliseconds = time;
      if (this.x >= this.width) this.linefeed(time);
    }
  }
  resize(width: number): void {
    if (!Number.isSafeInteger(width) || width < 1 || width > this.characterCapacity) throw new RangeError("Invalid console width");
    this.width = width;
    for (const row of this.rows) row.cells = row.cells.slice(0, width);
    this.x = Math.min(this.x, width - 1); this.trim(); this.clearNotify();
  }
  clear(): void { this.rows = [{ sequence: this.nextSequence++, cells: [], timeMilliseconds: null }]; this.x = 0; this.backscroll = 0; }
  clearNotify(): void { for (const row of this.rows) row.timeMilliseconds = null; }
  scroll(lines: number): void { this.backscroll = Math.max(0, Math.min(this.rows.length - 1, this.backscroll + Math.trunc(lines))); }
  bottom(): void { this.backscroll = 0; }
  top(): void { this.backscroll = this.rows.length - 1; }
  visible(count: number): readonly ConsoleRow[] {
    const end = this.rows.length - this.backscroll;
    return this.rows.slice(Math.max(0, end - count), end).map(row => ({ ...row, cells: [...row.cells] }));
  }
  notifications(now: number, duration = 3000, count = 4): readonly ConsoleRow[] {
    return this.rows.slice(-count).filter(row => row.timeMilliseconds !== null && now - row.timeMilliseconds <= duration).map(row => ({ ...row, cells: [...row.cells] }));
  }
  dump(): string { return this.rows.map(row => row.cells.map(cell => cell.character).join("").trimEnd()).join("\n") + "\n"; }
}
