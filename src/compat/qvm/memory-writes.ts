export interface QvmWriteRange { readonly byteOffset: number; readonly byteLength: number; }
export interface QvmCommittedBytes { readonly byteOffset: number; readonly before: readonly number[]; readonly after: readonly number[]; }
export interface QvmCommittedWrite { readonly sequence: number; readonly ranges: readonly QvmCommittedBytes[]; }
interface Watch { readonly ranges: readonly QvmWriteRange[]; readonly publish: (event: QvmCommittedWrite) => undefined; active: boolean; }
interface CapturedRange { readonly byteOffset: number; readonly before: readonly number[]; }
interface Capture { readonly watch: Watch; readonly ranges: readonly CapturedRange[]; }
export type QvmWriteCapture = readonly Capture[] | null;

/** One allocation owns publication, including views retained before a watch is installed. */
export class QvmMemoryWrites {
  private watches: readonly Watch[] = [];
  private publishing = false;
  private closed = false;
  private sequence = 0;
  constructor(private readonly bytes: Uint8Array) {}
  get intercepts(): boolean { return this.watches.length !== 0 || this.publishing || this.closed; }
  assertNotPublishing(): void { if (this.publishing) throw new Error("QVM store publication permits bookkeeping only"); }
  assertWritable(): void { this.assertNotPublishing(); if (this.closed) throw new Error("QVM memory has been retired"); }
  range(offset: number, length: number): void {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > this.bytes.length - length)
      throw new RangeError("QVM raw memory range exceeds allocation");
  }
  observe(ranges: readonly QvmWriteRange[], publish: Watch["publish"]): () => undefined {
    if (this.closed) throw new Error("QVM memory has been retired");
    const sorted = ranges.map(range => { this.range(range.byteOffset, range.byteLength); return { ...range }; }).filter(range => range.byteLength !== 0).sort((a, b) => a.byteOffset - b.byteOffset);
    const merged: QvmWriteRange[] = [];
    for (const range of sorted) {
      const previous = merged.at(-1);
      if (previous !== undefined && previous.byteOffset + previous.byteLength >= range.byteOffset)
        merged[merged.length - 1] = { byteOffset: previous.byteOffset, byteLength: Math.max(previous.byteOffset + previous.byteLength, range.byteOffset + range.byteLength) - previous.byteOffset };
      else merged.push(range);
    }
    const watch: Watch = { ranges: merged, publish, active: true }; this.watches = [...this.watches, watch];
    return () => { if (watch.active) { watch.active = false; this.watches = this.watches.filter(entry => entry !== watch); } return undefined; };
  }
  before(offset: number, length: number): QvmWriteCapture {
    this.assertWritable(); this.range(offset, length);
    let captures: Capture[] | null = null;
    for (const watch of this.watches) {
      let ranges: CapturedRange[] | null = null;
      for (const range of watch.ranges) {
        const start = Math.max(offset, range.byteOffset), end = Math.min(offset + length, range.byteOffset + range.byteLength);
        if (start < end) { ranges ??= []; ranges.push({ byteOffset: start, before: Object.freeze(Array.from(this.bytes.subarray(start, end))) }); }
      }
      if (ranges !== null) { captures ??= []; captures.push({ watch, ranges }); }
    }
    return captures;
  }
  after(captures: QvmWriteCapture): void {
    if (captures === null) return;
    const sequence = ++this.sequence;
    const deliveries = captures.map(capture => ({ watch: capture.watch, event: Object.freeze({ sequence, ranges: Object.freeze(capture.ranges.map(range => Object.freeze({
      ...range, after: Object.freeze(Array.from(this.bytes.subarray(range.byteOffset, range.byteOffset + range.before.length))),
    }))) }) }));
    const errors: unknown[] = []; this.publishing = true;
    try { for (const { watch, event } of deliveries) if (watch.active) { try { watch.publish(event); } catch (error) { errors.push(error); } } }
    finally { this.publishing = false; }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "QVM committed store publication failed");
  }
  clear(): void { this.assertNotPublishing(); for (const watch of this.watches) watch.active = false; this.watches = []; }
  close(): void { this.clear(); this.closed = true; }
}

function index(value: number, size: number, length: number): number {
  const result = Number.isNaN(value) ? 0 : Math.trunc(value);
  if (!Number.isSafeInteger(result) || result < 0 || result > length - size) throw new RangeError("Offset is outside the bounds of the DataView");
  return result;
}

/** Scalar setters retain native DataView conversion/endianness and expose only committed stores. */
export class QvmWritableView extends DataView<ArrayBufferLike> {
  constructor(bytes: Uint8Array, private readonly start: number, length: number, private readonly writes: QvmMemoryWrites) {
    super(bytes.buffer, bytes.byteOffset + start, length);
  }
  override setInt8(byteOffset: number, value: number): void {
    if (!this.writes.intercepts) { super.setInt8(byteOffset, value); return; }
    const offset = index(byteOffset, 1, this.byteLength), capture = this.writes.before(this.start + offset, 1);
    super.setInt8(offset, value); this.writes.after(capture);
  }
  override setUint8(byteOffset: number, value: number): void {
    if (!this.writes.intercepts) { super.setUint8(byteOffset, value); return; }
    const offset = index(byteOffset, 1, this.byteLength), capture = this.writes.before(this.start + offset, 1);
    super.setUint8(offset, value); this.writes.after(capture);
  }
  override setInt16(byteOffset: number, value: number, littleEndian?: boolean): void {
    if (!this.writes.intercepts) { super.setInt16(byteOffset, value, littleEndian); return; }
    const offset = index(byteOffset, 2, this.byteLength), capture = this.writes.before(this.start + offset, 2);
    super.setInt16(offset, value, littleEndian); this.writes.after(capture);
  }
  override setUint16(byteOffset: number, value: number, littleEndian?: boolean): void {
    if (!this.writes.intercepts) { super.setUint16(byteOffset, value, littleEndian); return; }
    const offset = index(byteOffset, 2, this.byteLength), capture = this.writes.before(this.start + offset, 2);
    super.setUint16(offset, value, littleEndian); this.writes.after(capture);
  }
  override setInt32(byteOffset: number, value: number, littleEndian?: boolean): void {
    if (!this.writes.intercepts) { super.setInt32(byteOffset, value, littleEndian); return; }
    const offset = index(byteOffset, 4, this.byteLength), capture = this.writes.before(this.start + offset, 4);
    super.setInt32(offset, value, littleEndian); this.writes.after(capture);
  }
  override setUint32(byteOffset: number, value: number, littleEndian?: boolean): void {
    if (!this.writes.intercepts) { super.setUint32(byteOffset, value, littleEndian); return; }
    const offset = index(byteOffset, 4, this.byteLength), capture = this.writes.before(this.start + offset, 4);
    super.setUint32(offset, value, littleEndian); this.writes.after(capture);
  }
  override setFloat32(byteOffset: number, value: number, littleEndian?: boolean): void {
    if (!this.writes.intercepts) { super.setFloat32(byteOffset, value, littleEndian); return; }
    const offset = index(byteOffset, 4, this.byteLength), capture = this.writes.before(this.start + offset, 4);
    super.setFloat32(offset, value, littleEndian); this.writes.after(capture);
  }
  override setFloat64(byteOffset: number, value: number, littleEndian?: boolean): void {
    if (!this.writes.intercepts) { super.setFloat64(byteOffset, value, littleEndian); return; }
    const offset = index(byteOffset, 8, this.byteLength), capture = this.writes.before(this.start + offset, 8);
    super.setFloat64(offset, value, littleEndian); this.writes.after(capture);
  }
  override setBigInt64(byteOffset: number, value: bigint, littleEndian?: boolean): void {
    if (!this.writes.intercepts) { super.setBigInt64(byteOffset, value, littleEndian); return; }
    const offset = index(byteOffset, 8, this.byteLength), capture = this.writes.before(this.start + offset, 8);
    super.setBigInt64(offset, value, littleEndian); this.writes.after(capture);
  }
  override setBigUint64(byteOffset: number, value: bigint, littleEndian?: boolean): void {
    if (!this.writes.intercepts) { super.setBigUint64(byteOffset, value, littleEndian); return; }
    const offset = index(byteOffset, 8, this.byteLength), capture = this.writes.before(this.start + offset, 8);
    super.setBigUint64(offset, value, littleEndian); this.writes.after(capture);
  }
}
