/*
 * (string-id, discriminator) hash index over integer values, following the
 * shared C foundation (include/qa/id_index.h): storage is reserved before
 * insertion, hot lookup is a bucket walk over typed arrays with no string
 * keys or per-lookup allocation, and duplicate keys retain admission order.
 * GPL-2.0-or-later.
 */

export interface IdIndexCursor {
  /** Next entry number to visit, or -1 when exhausted. */
  entry: number;
  readonly key: number;
  readonly discriminator: number;
}

const NO_ENTRY = -1;

function hashOf(key: number, discriminator: number, mask: number): number {
  return (Math.imul(key | 0, 0x9e3779b1) ^ Math.imul(discriminator | 0, 0x85ebca6b)) & mask;
}

/** Values are caller indices (nonnegative). Reserve capacity before inserting. */
export class IdIndex {
  private keys = new Uint32Array(0);
  private discriminators = new Uint32Array(0);
  private values: number[] = [];
  private nextEntry = new Int32Array(0);
  private buckets = new Int32Array(0);
  private entryCount = 0;
  private reservedCount = 0;

  get count(): number { return this.entryCount; }
  get capacity(): number { return this.keys.length; }

  /** Grows entry storage and rehashes buckets. Cold path: call at load. */
  reserve(additional: number): void {
    if (!Number.isSafeInteger(additional) || additional < 0) throw new RangeError("Id index reservation must be a nonnegative safe integer");
    const needed = this.entryCount + additional;
    if (needed > this.reservedCount) this.reservedCount = needed;
    if (needed <= this.keys.length && this.buckets.length !== 0) return;
    let capacity = this.keys.length === 0 ? 64 : this.keys.length;
    while (capacity < needed) capacity *= 2;
    const keys = new Uint32Array(capacity);
    const discriminators = new Uint32Array(capacity);
    const nextEntry = new Int32Array(capacity);
    keys.set(this.keys.subarray(0, this.entryCount));
    discriminators.set(this.discriminators.subarray(0, this.entryCount));
    nextEntry.fill(NO_ENTRY);
    let bucketCount = 128;
    while (bucketCount < capacity * 2) bucketCount *= 2;
    const buckets = new Int32Array(bucketCount).fill(NO_ENTRY);
    const mask = bucketCount - 1;
    // Admission order with prepends leaves the newest entry at each bucket
    // head, matching insert(): most recent registration wins after growth too.
    for (let entry = 0; entry < this.entryCount; entry++) {
      const key = keys[entry] ?? 0;
      const discriminator = discriminators[entry] ?? 0;
      const bucket = hashOf(key, discriminator, mask);
      nextEntry[entry] = buckets[bucket] ?? NO_ENTRY;
      buckets[bucket] = entry;
    }
    this.keys = keys;
    this.discriminators = discriminators;
    this.nextEntry = nextEntry;
    this.buckets = buckets;
    this.values.length = capacity;
  }

  /** Inserts one entry. Requires a prior reserve covering the new count. */
  insert(key: number, discriminator: number, value: number): void {
    if (this.entryCount >= this.reservedCount || this.entryCount >= this.keys.length) throw new RangeError("Id index insertion exceeds its reservation; reserve at load");
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("Id index values are nonnegative caller indices");
    const entry = this.entryCount++;
    this.keys[entry] = key >>> 0;
    this.discriminators[entry] = discriminator >>> 0;
    this.values[entry] = value;
    const bucket = hashOf(key, discriminator, this.buckets.length - 1);
    this.nextEntry[entry] = this.buckets[bucket] ?? NO_ENTRY;
    this.buckets[bucket] = entry;
  }

  /** Returns the most recently inserted matching value, or -1. */
  find(key: number, discriminator: number): number {
    if (this.buckets.length === 0) return -1;
    let entry = this.buckets[hashOf(key, discriminator, this.buckets.length - 1)] ?? NO_ENTRY;
    while (entry !== NO_ENTRY) {
      if (this.keys[entry] === (key >>> 0) && this.discriminators[entry] === (discriminator >>> 0)) {
        const value = this.values[entry];
        return value === undefined ? -1 : value;
      }
      entry = this.nextEntry[entry] ?? NO_ENTRY;
    }
    return -1;
  }

  begin(key: number, discriminator: number): IdIndexCursor {
    if (this.buckets.length === 0) return { entry: NO_ENTRY, key: key >>> 0, discriminator: discriminator >>> 0 };
    return {
      entry: this.buckets[hashOf(key, discriminator, this.buckets.length - 1)] ?? NO_ENTRY,
      key: key >>> 0,
      discriminator: discriminator >>> 0,
    };
  }

  /** Advances to the next matching value in reverse admission order, or -1. */
  next(cursor: IdIndexCursor): number {
    let entry = cursor.entry;
    while (entry !== NO_ENTRY) {
      const following = this.nextEntry[entry] ?? NO_ENTRY;
      if (this.keys[entry] === cursor.key && this.discriminators[entry] === cursor.discriminator) {
        cursor.entry = following;
        const value = this.values[entry];
        return value === undefined ? -1 : value;
      }
      entry = following;
    }
    cursor.entry = NO_ENTRY;
    return -1;
  }

  /** Removes matching entries, preserving remaining admission order. Invalidates cursors. */
  remove(key: number, discriminator: number): boolean {
    return this.retain((entryKey, entryDiscriminator) => entryKey !== (key >>> 0) || entryDiscriminator !== (discriminator >>> 0)) > 0;
  }

  removeValue(key: number, discriminator: number, value: number): boolean {
    return this.retain((entryKey, entryDiscriminator, entryValue) =>
      entryKey !== (key >>> 0) || entryDiscriminator !== (discriminator >>> 0) || entryValue !== value) > 0;
  }

  /** Keeps selected entries in admission order, rebuilding buckets once. Returns removals. */
  retain(keep: (key: number, discriminator: number, value: number) => boolean): number {
    let write = 0;
    for (let entry = 0; entry < this.entryCount; entry++) {
      const key = this.keys[entry] ?? 0;
      const discriminator = this.discriminators[entry] ?? 0;
      const value = this.values[entry] ?? -1;
      if (!keep(key, discriminator, value)) continue;
      if (write !== entry) {
        this.keys[write] = key;
        this.discriminators[write] = discriminator;
        this.values[write] = value;
      }
      write++;
    }
    const removed = this.entryCount - write;
    this.entryCount = write;
    this.buckets.fill(NO_ENTRY);
    const mask = this.buckets.length - 1;
    for (let entry = this.entryCount - 1; entry >= 0; entry--) {
      const bucket = hashOf(this.keys[entry] ?? 0, this.discriminators[entry] ?? 0, mask);
      this.nextEntry[entry] = this.buckets[bucket] ?? NO_ENTRY;
      this.buckets[bucket] = entry;
    }
    return removed;
  }

  clear(): void {
    this.entryCount = 0;
    this.buckets.fill(NO_ENTRY);
  }
}
