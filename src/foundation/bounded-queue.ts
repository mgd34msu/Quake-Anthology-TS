/*
 * Fixed-capacity drop-oldest history, for the small capped queues the
 * engine retains for presentation (dynamic lights, damage indicators, ping
 * samples, bot chat). Storage is one load-sized ring; push/visit/shift are
 * O(1) with no array shifting or per-push allocation. Authoritative output
 * never uses this type: anything that must not lose records belongs in
 * EventRing, whose admission reports backpressure instead of overwriting.
 * GPL-2.0-or-later.
 */

export class BoundedQueue<T> {
  private readonly slots: (T | null)[];
  private readonly powerOfTwo: boolean;
  private head = 0;
  private count = 0;
  private droppedCount = 0;

  constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError("Bounded queue capacity must be a positive safe integer");
    }
    this.slots = new Array<T | null>(capacity).fill(null);
    this.powerOfTwo = (capacity & (capacity - 1)) === 0;
  }

  private wrap(index: number): number {
    return this.powerOfTwo ? index & (this.slots.length - 1) : index % this.slots.length;
  }

  get capacity(): number { return this.slots.length; }
  get length(): number { return this.count; }
  get dropped(): number { return this.droppedCount; }

  /** Appends one value, discarding the oldest when full. */
  push(value: T): void {
    if (this.count >= this.capacity) {
      this.slots[this.head] = value;
      this.head = this.wrap(this.head + 1);
      this.droppedCount++;
      return;
    }
    this.slots[this.wrap(this.head + this.count)] = value;
    this.count++;
  }

  /** Removes and returns the oldest value, or undefined when empty. */
  shift(): T | undefined {
    if (this.count === 0) return undefined;
    const value = this.slots[this.head] ?? undefined;
    this.slots[this.head] = null;
    this.head = this.wrap(this.head + 1);
    this.count--;
    return value;
  }

  peekOldest(): T | undefined {
    return this.count === 0 ? undefined : this.slots[this.head] ?? undefined;
  }

  peekNewest(): T | undefined {
    return this.count === 0 ? undefined : this.slots[this.wrap(this.head + this.count - 1)] ?? undefined;
  }

  /** Visits retained values oldest first, allocating nothing. */
  forEach(visit: (value: T, index: number) => void): void {
    for (let index = 0; index < this.count; index++) {
      const value = this.slots[this.wrap(this.head + index)];
      if (value !== null && value !== undefined) visit(value, index);
    }
  }

  at(index: number): T | undefined {
    if (index < 0 || index >= this.count) return undefined;
    return this.slots[this.wrap(this.head + index)] ?? undefined;
  }

  findIndex(predicate: (value: T) => boolean): number {
    for (let index = 0; index < this.count; index++) {
      const value = this.slots[this.wrap(this.head + index)];
      if (value !== null && value !== undefined && predicate(value)) return index;
    }
    return -1;
  }

  /** Replaces the value at an index, or appends when index is the length and capacity remains. */
  setAt(index: number, value: T): void {
    if (index === this.count) {
      this.push(value);
      return;
    }
    if (index < 0 || index > this.count) throw new RangeError("Bounded queue index is outside retained values");
    this.slots[this.wrap(this.head + index)] = value;
  }

  /** Removes the first matching retained value, compacting the ring. */
  removeFirst(predicate: (value: T) => boolean): boolean {
    for (let index = 0; index < this.count; index++) {
      const value = this.slots[this.wrap(this.head + index)];
      if (value === null || value === undefined || !predicate(value)) continue;
      for (let move = index; move + 1 < this.count; move++) {
        this.slots[this.wrap(this.head + move)] = this.slots[this.wrap(this.head + move + 1)] ?? null;
      }
      this.slots[this.wrap(this.head + this.count - 1)] = null;
      this.count--;
      return true;
    }
    return false;
  }

  /** Keeps only matching values in their current order, compacting the ring. */
  retain(predicate: (value: T) => boolean): void {
    let write = 0;
    for (let index = 0; index < this.count; index++) {
      const value = this.slots[this.wrap(this.head + index)];
      if (value === null || value === undefined || !predicate(value)) continue;
      this.slots[this.wrap(this.head + write)] = value;
      write++;
    }
    for (let index = write; index < this.count; index++) this.slots[this.wrap(this.head + index)] = null;
    this.count = write;
  }

  /** Removes every retained value oldest first and returns them as an array. */
  takeAll(): T[] {
    const out = this.toArray();
    this.clear();
    return out;
  }

  /** Array copy for boundaries that already speak in arrays. */
  toArray(): T[] {
    const out: T[] = [];
    this.forEach((value) => { out.push(value); });
    return out;
  }

  clear(): void {
    this.slots.fill(null);
    this.head = 0;
    this.count = 0;
  }
}
