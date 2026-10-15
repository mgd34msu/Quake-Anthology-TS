/*
 * One load-sized admitted-output ring with independent consumer cursors,
 * leases and explicit backpressure, following the shared C foundation
 * (include/qa/event_ring.h, THE-870): all slots are allocated at
 * construction, append never grows or overwrites the ring, each consumer
 * advances its own cursor in admission order, retirement frees only the
 * contiguous prefix every cursor has passed, and leases pin records whose
 * lifetime outlives lookup retirement (persistent/display state) without
 * copying them. Draining through a visitor allocates nothing; the array
 * take() form exists for boundaries that already speak in arrays.
 * GPL-2.0-or-later.
 */

/** A consumer position in the ring. Owned by the ring; do not edit directly. */
export interface EventCursor {
  next: number;
}

export interface EventRingStats {
  readonly capacity: number;
  readonly live: number;
  readonly leased: number;
  readonly accepted: number;
  readonly blocked: number;
  readonly retired: number;
  readonly first: number;
  readonly next: number;
}

interface Lease<T> {
  readonly record: T;
  refs: number;
}

export class EventRing<T> {
  private readonly slots: (T | null)[];
  private readonly mask: number;
  private readonly cursors = new Set<EventCursor>();
  private readonly leases = new Map<number, Lease<T>>();
  private firstId = 1;
  private nextId = 1;
  private acceptedCount = 0;
  private blockedCount = 0;
  private retiredCount = 0;

  constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || (capacity & (capacity - 1)) !== 0) {
      throw new RangeError("Event ring capacity must be a positive power of two");
    }
    this.slots = new Array<T | null>(capacity).fill(null);
    this.mask = capacity - 1;
  }

  get capacity(): number { return this.slots.length; }
  get first(): number { return this.firstId; }
  get next(): number { return this.nextId; }
  get live(): number { return this.nextId - this.firstId; }
  get leased(): number { return this.leases.size; }
  get accepted(): number { return this.acceptedCount; }
  get blocked(): number { return this.blockedCount; }

  stats(): EventRingStats {
    return {
      capacity: this.capacity, live: this.live, leased: this.leases.size,
      accepted: this.acceptedCount, blocked: this.blockedCount, retired: this.retiredCount,
      first: this.firstId, next: this.nextId,
    };
  }

  /**
   * Admits one record and returns its id (from 1), or 0 when the ring is
   * full. Full is ordinary backpressure: admitted history is preserved and
   * no error is implied; the producer decides how to react.
   */
  append(record: T): number {
    if (this.live >= this.capacity || this.nextId >= Number.MAX_SAFE_INTEGER) {
      this.blockedCount++;
      return 0;
    }
    const id = this.nextId++;
    this.slots[(id - 1) & this.mask] = record;
    this.acceptedCount++;
    return id;
  }

  /**
   * Admits one record or throws when the ring is full. For queues whose
   * records must never be dropped, exhaustion fails loudly with the
   * capacity named, instead of growing without bound.
   */
  admit(record: T): number {
    const id = this.append(record);
    if (id === 0) throw new RangeError(`Event ring capacity exhausted (${this.capacity} undrained records); drain before admitting more`);
    return id;
  }

  /** admit() for a batch: all records or a capacity error, never a partial batch. */
  admitAll(records: readonly T[]): number {
    const first = this.appendAll(records);
    if (first === 0) throw new RangeError(`Event ring capacity exhausted (${this.capacity} undrained records, batch of ${records.length}); drain before admitting more`);
    return first;
  }

  /** Admits a batch all-or-nothing, like one C ring transaction. Returns the first id, or 0. */
  appendAll(records: readonly T[]): number {
    if (records.length === 0) return this.nextId;
    if (records.length > this.capacity - this.live || this.nextId + records.length > Number.MAX_SAFE_INTEGER) {
      this.blockedCount++;
      return 0;
    }
    const first = this.nextId;
    for (const record of records) this.append(record);
    return first;
  }

  /** The oldest live record, or null when empty. */
  head(): T | null {
    return this.nextId <= this.firstId ? null : this.at(this.firstId);
  }

  /** Live record at an offset from the oldest, or null outside the live range. */
  atOffset(index: number): T | null {
    return index < 0 || index >= this.live ? null : this.at(this.firstId + index);
  }

  /** Replaces the live record at an offset (partial text consumption). */
  replaceAtOffset(index: number, record: T): void {
    if (index < 0 || index >= this.live) throw new RangeError("Event ring offset is outside live records");
    this.slots[(this.firstId + index - 1) & this.mask] = record;
  }

  /**
   * Removes the live record at an offset, preserving the order of the rest.
   * Cold path rebuild (partial text consumption): cursors restart at the
   * oldest survivor, so call only from the single consuming owner.
   */
  removeAtOffset(index: number): void {
    if (index < 0 || index >= this.live) throw new RangeError("Event ring offset is outside live records");
    const retained = this.snapshot();
    retained.splice(index, 1);
    this.reset();
    for (const record of retained) this.admit(record);
  }

  /** The newest live record, or null when empty. */
  newest(): T | null {
    return this.nextId <= this.firstId ? null : this.at(this.nextId - 1);
  }

  at(id: number): T | null {
    if (id < this.firstId || id >= this.nextId) return null;
    return this.slots[(id - 1) & this.mask] ?? null;
  }

  /** Opens a cursor at the oldest live record, or at the tail when `tail` is true. */
  openCursor(tail = false): EventCursor {
    const cursor: EventCursor = { next: tail ? this.nextId : this.firstId };
    this.cursors.add(cursor);
    return cursor;
  }

  closeCursor(cursor: EventCursor): void {
    this.cursors.delete(cursor);
  }

  pending(cursor: EventCursor): number {
    this.assertCursor(cursor);
    return this.nextId - cursor.next;
  }

  peek(cursor: EventCursor): T | null {
    this.assertCursor(cursor);
    return cursor.next >= this.nextId ? null : this.at(cursor.next);
  }

  /** Returns the cursor's next record in admission order, or null when caught up. */
  read(cursor: EventCursor): T | null {
    const record = this.peek(cursor);
    if (record !== null) cursor.next++;
    return record;
  }

  /**
   * Visits every record pending at entry, in admission order, allocating
   * nothing. Records appended by the visitor wait for the next drain.
   */
  drain(cursor: EventCursor, visit: (record: T, id: number) => void): number {
    this.assertCursor(cursor);
    const end = this.nextId;
    const slots = this.slots;
    const mask = this.mask;
    let id = cursor.next;
    let count = 0;
    while (id < end) {
      const record = slots[(id - 1) & mask];
      id++;
      if (record !== null && record !== undefined) {
        visit(record, id - 1);
        count++;
      }
    }
    cursor.next = id;
    return count;
  }

  /** Visits live records in admission order without consuming them or allocating. */
  forEachLive(visit: (record: T, id: number) => void): void {
    for (let id = this.firstId; id < this.nextId; id++) {
      const record = this.slots[(id - 1) & this.mask];
      if (record !== null && record !== undefined) visit(record, id);
    }
  }

  /** Non-consuming copy of live records in admission order, for publication snapshots. */
  snapshot(): T[] {
    const out: T[] = [];
    for (let id = this.firstId; id < this.nextId; id++) {
      const record = this.slots[(id - 1) & this.mask];
      if (record !== null && record !== undefined) out.push(record);
    }
    return out;
  }

  /** Array form of drain for existing array-shaped boundaries. One allocation. */
  take(cursor: EventCursor): T[] {
    const out: T[] = [];
    this.drain(cursor, (record) => { out.push(record); });
    return out;
  }

  /**
   * Retires the contiguous prefix below the minimum cursor. Submission is
   * not consumption: producers never retire past a live cursor here.
   */
  retire(): void {
    if (this.cursors.size === 0) return;
    let minimum = this.nextId;
    for (const cursor of this.cursors) if (cursor.next < minimum) minimum = cursor.next;
    this.retireBefore(minimum);
  }

  /** Explicit retirement bound, for owners that track consumer receipts themselves. */
  retireBefore(id: number): void {
    const target = Math.min(id, this.nextId);
    while (this.firstId < target) {
      this.slots[(this.firstId - 1) & this.mask] = null;
      this.firstId++;
      this.retiredCount++;
    }
  }

  /** Pins a live record beyond lookup retirement. Returns false when the id is gone. */
  retain(id: number): boolean {
    const existing = this.leases.get(id);
    if (existing !== undefined) {
      existing.refs++;
      return true;
    }
    const record = this.at(id);
    if (record === null) return false;
    this.leases.set(id, { record, refs: 1 });
    return true;
  }

  leasedRecord(id: number): T | null {
    return this.leases.get(id)?.record ?? null;
  }

  releaseLease(id: number): boolean {
    const lease = this.leases.get(id);
    if (lease === undefined) return false;
    lease.refs--;
    if (lease.refs <= 0) this.leases.delete(id);
    return true;
  }

  /** Visits every leased record, including ones whose lookup slot has retired. */
  visitRetained(visit: (record: T, id: number) => void): void {
    for (const [id, lease] of this.leases) visit(lease.record, id);
  }

  /** True when any live record matches, scanning in admission order without allocating. */
  someLive(predicate: (record: T) => boolean): boolean {
    for (let id = this.firstId; id < this.nextId; id++) {
      const record = this.slots[(id - 1) & this.mask];
      if (record !== null && record !== undefined && predicate(record)) return true;
    }
    return false;
  }

  /**
   * Pops the oldest live record for a single-consumer FIFO owner that keeps
   * no cursor (per-peer reliable backlogs). Overtakes any cursor: their
   * next read fails loudly instead of skipping records.
   */
  shift(): T | null {
    if (this.firstId >= this.nextId) return null;
    const record = this.at(this.firstId);
    this.retireBefore(this.firstId + 1);
    return record;
  }

  /**
   * Consumes every live record in admission order for a single-consumer
   * owner that keeps no cursor of its own. Overtakes any other cursor:
   * their next read fails loudly instead of skipping records.
   */
  drainAll(): T[] {
    const taken = this.snapshot();
    this.retireBefore(this.nextId);
    return taken;
  }

  /**
   * Requeues records at the front, ahead of everything still live (dispatch
   * that must resume before newer work). Cold path: live records are
   * re-admitted after the given batch and every cursor restarts at the
   * front, so call only when no consumer has partially drained the range.
   */
  prepend(records: readonly T[]): void {
    if (records.length === 0) return;
    if (records.length > this.capacity - this.live) {
      throw new RangeError(`Event ring capacity exhausted (${this.capacity} undrained records, prepend of ${records.length}); drain before requeuing`);
    }
    const live = this.snapshot();
    this.reset();
    for (const record of records) this.admit(record);
    for (const record of live) this.admit(record);
  }

  /**
   * Drops live records rejected by the predicate (owner retirement of
   * undrained output). Cold path: surviving records are re-admitted in
   * order and every cursor restarts at the oldest survivor, so call only
   * when no consumer has partially drained the affected range.
   */
  filterLive(predicate: (record: T) => boolean): void {
    const retained: T[] = [];
    for (let id = this.firstId; id < this.nextId; id++) {
      const record = this.slots[(id - 1) & this.mask];
      if (record !== null && record !== undefined && predicate(record)) retained.push(record);
    }
    this.reset();
    for (const record of retained) this.admit(record);
  }

  /** Cold load/restore only: empties the ring and rewinds every cursor. */
  reset(): void {
    this.slots.fill(null);
    this.leases.clear();
    this.firstId = 1;
    this.nextId = 1;
    this.acceptedCount = 0;
    this.blockedCount = 0;
    this.retiredCount = 0;
    for (const cursor of this.cursors) cursor.next = 1;
  }

  private assertCursor(cursor: EventCursor): void {
    if (!this.cursors.has(cursor)) throw new RangeError("Event cursor does not belong to this ring");
    if (cursor.next < this.firstId) throw new RangeError("Event cursor was overtaken by retirement; its records are gone");
  }
}
