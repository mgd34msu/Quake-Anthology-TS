/*
 * Epoch visit marks, following the shared C foundation (include/qa/stamp.h):
 * beginning a query is one epoch increment instead of clearing a Set or a
 * boolean array, and test/mark are single typed-array accesses. Storage is
 * caller-owned and sized before queries begin. GPL-2.0-or-later.
 */

export class StampSet {
  private readonly marks: Uint32Array;
  private currentEpoch = 1;

  constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 0) throw new RangeError("Stamp capacity must be a nonnegative safe integer");
    this.marks = new Uint32Array(capacity);
  }

  get capacity(): number { return this.marks.length; }
  get epoch(): number { return this.currentEpoch; }

  /** Starts a new query. Epoch wrap re-zeroes the marks once. */
  begin(): void {
    this.currentEpoch++;
    if (this.currentEpoch === 0) {
      this.marks.fill(0);
      this.currentEpoch = 1;
    }
  }

  test(index: number): boolean {
    return this.marks[index] === this.currentEpoch;
  }

  /** Returns true the first time an index is marked within this epoch. */
  mark(index: number): boolean {
    if (this.marks[index] === this.currentEpoch) return false;
    this.marks[index] = this.currentEpoch;
    return true;
  }

  value(index: number): number {
    const mark = this.marks[index];
    return mark === undefined ? 0 : mark;
  }

  restoreMark(index: number, value: number): void {
    this.marks[index] = value;
  }
}
