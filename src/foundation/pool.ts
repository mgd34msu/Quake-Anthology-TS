/*
 * Fixed slot pool, following the shared C foundation (include/qa/pool.h):
 * every value is created once at construction (load), take/release are O(1)
 * free-list operations with no allocation, and exhaustion is counted rather
 * than extended. Slot numbers are the lease; payloads survive release and
 * must be reinitialized by the next taker. GPL-2.0-or-later.
 */

const SLOT_FREE_END = -1;
const SLOT_USED = -2;

export class FixedPool<T> {
  private readonly values: T[];
  private readonly next: Int32Array;
  private head: number;
  private activeCount = 0;
  private peakCount = 0;
  private overflows = 0;

  constructor(capacity: number, create: (slot: number) => T) {
    if (!Number.isSafeInteger(capacity) || capacity < 0 || capacity > 0x7fffffff) throw new RangeError("Pool capacity must fit a signed slot index");
    this.values = [];
    this.next = new Int32Array(capacity);
    for (let slot = 0; slot < capacity; slot++) {
      this.values.push(create(slot));
      this.next[slot] = slot + 1 < capacity ? slot + 1 : SLOT_FREE_END;
    }
    this.head = capacity === 0 ? SLOT_FREE_END : 0;
  }

  get capacity(): number { return this.values.length; }
  get active(): number { return this.activeCount; }
  get peak(): number { return this.peakCount; }
  get overflowCount(): number { return this.overflows; }

  /** O(1), no allocation. Returns the leased slot, or -1 when exhausted. */
  takeSlot(): number {
    const slot = this.head;
    if (slot === SLOT_FREE_END) {
      if (this.overflows < Number.MAX_SAFE_INTEGER) this.overflows++;
      return -1;
    }
    const next = this.next[slot];
    this.head = next === undefined ? SLOT_FREE_END : next;
    this.next[slot] = SLOT_USED;
    this.activeCount++;
    if (this.activeCount > this.peakCount) this.peakCount = this.activeCount;
    return slot;
  }

  at(slot: number): T {
    const value = this.values[slot];
    if (value === undefined || this.next[slot] !== SLOT_USED) throw new RangeError(`Pool slot is not leased: ${slot}`);
    return value;
  }

  isLeased(slot: number): boolean {
    return this.next[slot] === SLOT_USED;
  }

  release(slot: number): void {
    if (this.next[slot] !== SLOT_USED) throw new RangeError(`Pool slot is not leased: ${slot}`);
    this.next[slot] = this.head;
    this.head = slot;
    this.activeCount--;
  }

  /** At a drained owner boundary, invalidates all leases and retains payloads. */
  reset(): void {
    for (let slot = 0; slot < this.next.length; slot++) this.next[slot] = slot + 1 < this.next.length ? slot + 1 : SLOT_FREE_END;
    this.head = this.next.length === 0 ? SLOT_FREE_END : 0;
    this.activeCount = 0;
  }
}
