/*
 * Load-sized bump arena over one retained byte buffer, following the shared
 * C foundation (include/qa/arena.h): capacity is reserved at construction,
 * allocations are pointer bumps at fixed offsets until reset, and exhaustion
 * is counted explicitly instead of falling back to per-object allocation.
 * GPL-2.0-or-later.
 */

export class ByteArena {
  private readonly storage: Uint8Array;
  private usedBytes = 0;
  private overflows = 0;
  private isSealed = false;

  constructor(capacityBytes: number) {
    if (!Number.isSafeInteger(capacityBytes) || capacityBytes <= 0) throw new RangeError("Arena capacity must be a positive safe integer");
    this.storage = new Uint8Array(capacityBytes);
  }

  get capacity(): number { return this.storage.length; }
  get used(): number { return this.usedBytes; }
  get overflowCount(): number { return this.overflows; }
  get sealed(): boolean { return this.isSealed; }

  /** Records that no further reservation may occur; layout is already fixed. */
  seal(): void { this.isSealed = true; }

  /**
   * Returns the allocation offset, or -1 when the reserved capacity is
   * exhausted. Size must be positive and alignment a power of two. Bytes are
   * not cleared; previous contents survive reset for the next user to write.
   */
  alloc(size: number, alignment = 1): number {
    if (!Number.isSafeInteger(size) || size <= 0 || !Number.isSafeInteger(alignment) || alignment <= 0 || (alignment & (alignment - 1)) !== 0) {
      throw new RangeError("Arena allocation requires a positive size and power-of-two alignment");
    }
    const padding = (alignment - (this.usedBytes % alignment)) % alignment;
    if (padding > this.storage.length - this.usedBytes || size > this.storage.length - this.usedBytes - padding) {
      if (this.overflows < Number.MAX_SAFE_INTEGER) this.overflows++;
      return -1;
    }
    const offset = this.usedBytes + padding;
    this.usedBytes = offset + size;
    return offset;
  }

  /** A borrowed view of a previously allocated range. Valid until reset. */
  view(offset: number, size: number): Uint8Array {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset > this.usedBytes - size) {
      throw new RangeError("Arena view is outside the allocated range");
    }
    return this.storage.subarray(offset, offset + size);
  }

  /** Copies bytes into the arena; returns the offset or -1 when full. */
  allocCopy(bytes: Uint8Array, alignment = 1): number {
    if (bytes.length === 0) return this.usedBytes;
    const offset = this.alloc(bytes.length, alignment);
    if (offset >= 0) this.storage.set(bytes, offset);
    return offset;
  }

  /** Invalidates every allocation but keeps the buffer and overflow count. */
  reset(): void { this.usedBytes = 0; }
}
