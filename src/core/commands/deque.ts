// SPDX-License-Identifier: GPL-2.0-or-later
/** Insertion-ordered queue with cheap front removal and front insertion for pending command chunks. */
export class Deque<T> {
  private items: T[] = [];
  private start = 0;
  get first(): number {
    return 0;
  }
  get live(): number {
    return this.items.length - this.start;
  }
  admit(record: T): void {
    this.items.push(record);
  }
  head(): T | null {
    return this.items[this.start] ?? null;
  }
  at(index: number): T | null {
    return index < 0 ? null : (this.items[this.start + index] ?? null);
  }
  atOffset(index: number): T | null {
    return this.at(index);
  }
  replaceAtOffset(index: number, record: T): void {
    if (index < 0 || index >= this.live) throw new RangeError("Deque offset outside live records");
    this.items[this.start + index] = record;
  }
  removeAtOffset(index: number): void {
    if (index < 0 || index >= this.live) throw new RangeError("Deque offset outside live records");
    if (index === 0) {
      this.shift();
      return;
    }
    this.items.splice(this.start + index, 1);
  }
  shift(): T | null {
    if (this.live === 0) return null;
    const record = this.items[this.start] ?? null;
    this.start++;
    if (this.start === this.items.length) {
      this.items = [];
      this.start = 0;
    } else if (this.start >= 64 && this.start * 2 >= this.items.length) {
      this.items = this.items.slice(this.start);
      this.start = 0;
    }
    return record;
  }
  prepend(records: readonly T[]): void {
    if (records.length === 0) return;
    if (this.start >= records.length) {
      this.start -= records.length;
      for (let i = 0; i < records.length; i++) this.items[this.start + i] = records[i] as T;
    } else {
      this.items = [...records, ...this.items.slice(this.start)];
      this.start = 0;
    }
  }
  snapshot(): T[] {
    return this.items.slice(this.start);
  }
  forEachLive(visit: (record: T) => void): void {
    for (let i = this.start; i < this.items.length; i++) visit(this.items[i] as T);
  }
  someLive(predicate: (record: T) => boolean): boolean {
    for (let i = this.start; i < this.items.length; i++) if (predicate(this.items[i] as T)) return true;
    return false;
  }
  filterLive(predicate: (record: T) => boolean): void {
    this.items = this.items.slice(this.start).filter(predicate);
    this.start = 0;
  }
}
