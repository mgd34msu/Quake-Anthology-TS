/*
 * VM_ArgPtr from qcommon/vm.c and Q_strncpyz from game/q_shared.c.
 * Copyright (C) 1999-2005 Id Software, Inc.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { CommonError } from "../../core/common-error.ts";
import { QvmMemoryWrites, QvmWritableView } from "./memory-writes.ts";
import type { QvmCommittedWrite, QvmWriteRange } from "./memory-writes.ts";
export type { QvmCommittedWrite, QvmWriteRange, QvmCommittedBytes } from "./memory-writes.ts";

function qStrncpyz(destination: Uint8Array | null, source: string, size: number): void {
  if (destination === null) throw new CommonError("fatal", "Q_strncpyz: NULL dest");
  if (size < 1) throw new CommonError("fatal", "Q_strncpyz: destsize < 1");
  if (!Number.isInteger(size) || size > destination.length) throw new RangeError("Q_strncpyz destination exceeds its allocation");
  let index = 0;
  for (; index < size - 1; index++) {
    const byte = index < source.length ? source.charCodeAt(index) & 255 : 0;
    destination[index] = byte;
    if (byte === 0) break;
  }
  destination.fill(0, index, size);
}

/** Borrows an interpreter allocation; pointer masking applies only to its start. */
export class QvmMemory {
  private readonly writes: QvmMemoryWrites;
  constructor(readonly bytes: Uint8Array) {
    const length = bytes.byteLength;
    if (length === 0 || length > 0x40000000 || (length & (length - 1)) !== 0) {
      throw new RangeError("QVM memory allocation must be a nonzero power of two at most 2^30 bytes");
    }
    this.writes = new QvmMemoryWrites(bytes);
  }
  observeWrites(ranges: readonly QvmWriteRange[], publish: (event: QvmCommittedWrite) => undefined): () => undefined { return this.writes.observe(ranges, publish); }
  get observesWrites(): boolean { return this.writes.intercepts; }
  assertLive(): void { this.writes.assertLive(); }
  assertNotPublishing(): void { this.writes.assertNotPublishing(); }
  clearWriteObservers(): void { this.writes.clear(); }
  close(): void { this.writes.close(); }
  dataView(byteOffset: number, byteLength: number): DataView { this.writes.range(byteOffset, byteLength); return new QvmWritableView(this.bytes, byteOffset, byteLength, this.writes); }
  writeBytes(byteOffset: number, bytes: Uint8Array): void {
    this.writes.assertWritable(); this.writes.range(byteOffset, bytes.length);
    const capture = this.writes.intercepts ? this.writes.before(byteOffset, bytes.length) : null;
    this.bytes.set(bytes, byteOffset); this.writes.after(capture);
  }
  fillBytes(byteOffset: number, byteLength: number, value: number): void {
    this.writes.assertWritable(); this.writes.range(byteOffset, byteLength);
    const capture = this.writes.intercepts ? this.writes.before(byteOffset, byteLength) : null;
    this.bytes.fill(value, byteOffset, byteOffset + byteLength); this.writes.after(capture);
  }
  copyBytes(destinationOffset: number, sourceOffset: number, byteLength: number): void {
    this.writes.assertWritable(); this.writes.range(destinationOffset, byteLength); this.writes.range(sourceOffset, byteLength);
    const capture = this.writes.intercepts ? this.writes.before(destinationOffset, byteLength) : null;
    this.bytes.copyWithin(destinationOffset, sourceOffset, sourceOffset + byteLength); this.writes.after(capture);
  }

  pointer(word: number): Uint8Array | null {
    if (!Number.isInteger(word) || word < -0x80000000 || word > 0x7fffffff) {
      throw new RangeError("QVM pointer must be a signed 32-bit word");
    }
    return word === 0 ? null : this.bytes.subarray(word & (this.bytes.byteLength - 1));
  }

  span(word: number, length: number, relativeOffset = 0): Uint8Array {
    const pointer = this.pointer(word);
    if (pointer === null) throw new RangeError("QVM memory span requires a nonnull pointer");
    const start = pointer.byteOffset - this.bytes.byteOffset + relativeOffset;
    if (!Number.isSafeInteger(relativeOffset) || !Number.isSafeInteger(length) || length < 0
      || start < 0 || start > this.bytes.byteLength || length > this.bytes.byteLength - start) {
      throw new RangeError("QVM memory span exceeds allocation or has an invalid length");
    }
    return this.bytes.subarray(start, start + length);
  }

  view(word: number, length: number, relativeOffset = 0): DataView {
    const span = this.span(word, length, relativeOffset);
    return this.dataView(span.byteOffset - this.bytes.byteOffset, span.byteLength);
  }

  readString(word: number): string {
    const pointer = this.pointer(word);
    if (pointer === null) throw new RangeError("QVM string requires a nonnull pointer");
    const terminator = pointer.indexOf(0);
    if (terminator < 0) throw new RangeError("QVM string has no terminator before the allocation ends");
    let text = "";
    for (const byte of pointer.subarray(0, terminator)) text += String.fromCharCode(byte);
    return text;
  }

  /** Q_strncpyz pads within capacity and leaves bytes beyond capacity untouched. */
  writeString(word: number, text: string, capacity: number): void {
    const pointer = this.pointer(word);
    if (pointer !== null && (!Number.isInteger(capacity) || capacity > pointer.length)) {
      throw new RangeError("Q_strncpyz destination exceeds QVM allocation");
    }
    if (pointer === null) { qStrncpyz(pointer, text, capacity); return; }
    const offset = pointer.byteOffset - this.bytes.byteOffset;
    this.writes.assertWritable();
    if (!Number.isInteger(capacity) || capacity < 1) { qStrncpyz(pointer, text, capacity); return; }
    const capture = this.writes.intercepts ? this.writes.before(offset, capacity) : null;
    qStrncpyz(pointer, text, capacity); this.writes.after(capture);
  }

  /** Raw strncpy(size - 1) plus NUL has no source Com_Error for invalid pointers or sizes. */
  writeBoundedString(word: number, text: string, capacity: number): void {
    const pointer = this.pointer(word);
    if (pointer === null || !Number.isSafeInteger(capacity) || capacity < 1 || capacity > pointer.length) {
      throw new RangeError("Bounded string copy exceeds QVM allocation");
    }
    this.writes.assertWritable();
    const capture = this.writes.intercepts ? this.writes.before(pointer.byteOffset - this.bytes.byteOffset, capacity) : null;
    qStrncpyz(pointer, text, capacity); this.writes.after(capture);
  }
}
