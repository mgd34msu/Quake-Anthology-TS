/* Source-owned QC word storage and byte-addressed edicts. GPL-2.0-or-later. */
import type { Vec3 } from "../../contracts/math.ts";
import { BinaryReader, BinaryWriter } from "../../core/binary/index.ts";
import { QcProgramError, qcByteString } from "./program.ts";

export class QcWords {
  readonly bytes: Uint8Array;
  readonly view: DataView;
  constructor(bytes: Uint8Array) {
    if (bytes.byteLength % 4 !== 0) throw new RangeError("QC storage must contain whole words");
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  get length(): number { return this.bytes.length / 4; }
  private offset(word: number): number {
    if (!Number.isInteger(word) || word < 0 || word >= this.length) throw new QcProgramError(`word ${word} outside ${this.length}-word storage`);
    return word * 4;
  }
  int(word: number): number { return this.view.getInt32(this.offset(word), true); }
  float(word: number): number { return this.view.getFloat32(this.offset(word), true); }
  setInt(word: number, value: number): void { this.view.setInt32(this.offset(word), value, true); }
  setFloat(word: number, value: number): void { this.view.setFloat32(this.offset(word), value, true); }
  vector(word: number): Vec3 { return { x: this.float(word), y: this.float(word + 1), z: this.float(word + 2) }; }
  setVector(word: number, value: Vec3): void { this.setFloat(word, value.x); this.setFloat(word + 1, value.y); this.setFloat(word + 2, value.z); }
  copyWords(from: QcWords, source: number, destination: number, count: number): void {
    // Sequential stores match the interpreter, including deliberately overlapping words.
    for (let index = 0; index < count; index++) this.setInt(destination + index, from.int(source + index));
  }
}
export interface QcEntityLayout { readonly strideBytes: number; readonly variablesOffsetBytes: number; readonly fieldWords: number; }
export class QcEntityMemory {
  readonly bytes: Uint8Array;
  private readonly fields: QcWords[] = [];
  private currentCount: number;
  constructor(readonly layout: QcEntityLayout, readonly capacity: number, count = 1) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || !Number.isSafeInteger(count) || count < 1 || count > capacity
      || !Number.isSafeInteger(layout.strideBytes) || layout.strideBytes <= 0 || layout.strideBytes % 4 !== 0
      || !Number.isSafeInteger(layout.variablesOffsetBytes) || layout.variablesOffsetBytes < 0 || layout.variablesOffsetBytes % 4 !== 0
      || !Number.isSafeInteger(layout.fieldWords) || layout.fieldWords <= 0
      || layout.variablesOffsetBytes + layout.fieldWords * 4 > layout.strideBytes
      || capacity * layout.strideBytes > 0x7fffffff) throw new RangeError("Invalid QC entity layout/capacity");
    this.bytes = new Uint8Array(capacity * layout.strideBytes);
    this.currentCount = count;
  }
  get count(): number { return this.currentCount; }
  setCount(count: number): void {
    if (!Number.isInteger(count) || count < 1 || count > this.capacity) throw new RangeError("Invalid QC entity count");
    this.currentCount = count;
  }
  reference(slot: number): number { this.checkSlot(slot); return slot * this.layout.strideBytes; }
  slot(reference: number): number {
    if (!Number.isInteger(reference) || reference < 0 || reference % this.layout.strideBytes !== 0) throw new QcProgramError(`invalid entity reference ${reference}`);
    const slot = reference / this.layout.strideBytes;
    this.checkSlot(slot);
    return slot;
  }
  private checkSlot(slot: number): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.currentCount) throw new QcProgramError(`invalid entity slot ${slot}`);
  }
  at(slot: number): QcWords {
    this.checkSlot(slot);
    const existing = this.fields[slot];
    if (existing !== undefined) return existing;
    const offset = slot * this.layout.strideBytes + this.layout.variablesOffsetBytes;
    const fields = new QcWords(this.bytes.subarray(offset, offset + this.layout.fieldWords * 4));
    this.fields[slot] = fields;
    return fields;
  }
  fromReference(reference: number): QcWords { return this.at(this.slot(reference)); }
  pointer(reference: number, field: number): number {
    this.slot(reference);
    if (!Number.isInteger(field) || field < 0 || field >= this.layout.fieldWords) throw new QcProgramError(`invalid field offset ${field}`);
    return reference + this.layout.variablesOffsetBytes + field * 4;
  }
  resolvePointer(pointer: number, words = 1): { readonly fields: QcWords; readonly word: number } {
    if (!Number.isInteger(pointer) || pointer < 0 || pointer % 4 !== 0) throw new QcProgramError(`invalid entity pointer ${pointer}`);
    const slot = Math.floor(pointer / this.layout.strideBytes);
    const word = (pointer % this.layout.strideBytes - this.layout.variablesOffsetBytes) / 4;
    if (word < 0 || word + words > this.layout.fieldWords) throw new QcProgramError(`pointer ${pointer} does not address entity variables`);
    return { fields: this.at(slot), word };
  }
  restore(bytes: Uint8Array, count: number): void {
    if (bytes.byteLength !== this.bytes.byteLength) throw new QcProgramError("entity checkpoint capacity mismatch");
    this.setCount(count);
    this.bytes.set(bytes);
  }
}
interface EngineString { readonly name: string; readonly offset: number; readonly capacity: number; }
/** A byte arena keeps string aliases live. QW engine buffers use the source's negative IDs. */
export class QcStrings {
  private arena: Uint8Array;
  private used: number;
  private engines: EngineString[] = [];
  constructor(programStrings: Uint8Array, readonly quakeworld: boolean) {
    this.arena = new Uint8Array(Math.max(4096, programStrings.length));
    this.arena.set(programStrings);
    this.used = programStrings.length;
  }
  private reserve(length: number): number {
    const offset = this.used;
    const required = offset + length;
    if (!Number.isSafeInteger(required) || required > 0x7fffffff) throw new QcProgramError("string arena overflow");
    if (required > this.arena.length) {
      const grown = new Uint8Array(Math.max(required, this.arena.length * 2));
      grown.set(this.arena);
      this.arena = grown;
    }
    this.used = required;
    return offset;
  }
  private encode(offset: number, capacity: number, text: string): void {
    if (text.length >= capacity) throw new QcProgramError("engine string exceeds its buffer");
    for (let index = 0; index < text.length; index++) {
      const byte = text.charCodeAt(index);
      if (byte > 255 || byte === 0) throw new QcProgramError("QC strings require non-null byte characters");
      this.arena[offset + index] = byte;
    }
    this.arena[offset + text.length] = 0;
  }
  allocate(text: string): number {
    const offset = this.reserve(text.length + 1);
    this.encode(offset, text.length + 1, text);
    return offset;
  }
  setEngine(name: string, text: string, capacity = 128): number {
    let index = this.engines.findIndex(entry => entry.name === name);
    let entry = this.engines[index];
    if (entry === undefined) {
      if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError("Invalid engine string capacity");
      if (this.quakeworld && this.engines.length >= 1023) throw new QcProgramError("MAX_PRSTR");
      entry = { name, offset: this.reserve(capacity), capacity };
      index = this.engines.length;
      this.engines.push(entry);
    }
    this.encode(entry.offset, entry.capacity, text);
    return this.quakeworld ? -index - 1 : entry.offset;
  }
  get(reference: number): string {
    let offset = reference;
    if (reference < 0) {
      const entry = this.quakeworld ? this.engines[-reference - 1] : undefined;
      if (entry === undefined) throw new QcProgramError(`invalid engine string ${reference}`);
      offset = entry.offset;
    }
    return qcByteString(this.arena.subarray(0, this.used), offset);
  }
  snapshot(): Uint8Array {
    const writer = new BinaryWriter(16 + this.used + this.engines.reduce((size, entry) => size + 12 + entry.name.length, 0));
    writer.u32(0x31534351); writer.u32(this.quakeworld ? 1 : 0); writer.u32(this.used); writer.bytes(this.arena.subarray(0, this.used));
    writer.u32(this.engines.length);
    for (const entry of this.engines) {
      writer.u32(entry.offset); writer.u32(entry.capacity); writer.u32(entry.name.length);
      for (let i = 0; i < entry.name.length; i++) writer.u8(entry.name.charCodeAt(i));
    }
    return writer.finish();
  }
  restore(bytes: Uint8Array): void {
    const reader = new BinaryReader(bytes, "QC strings checkpoint");
    if (reader.u32() !== 0x31534351 || reader.u32() !== (this.quakeworld ? 1 : 0)) throw new QcProgramError("incompatible string checkpoint");
    const arena = reader.bytes(reader.u32());
    const count = reader.u32();
    const entries: EngineString[] = [];
    for (let index = 0; index < count; index++) {
      const offset = reader.u32(); const capacity = reader.u32();
      const name = reader.fixedByteString(reader.u32());
      if (capacity < 1 || offset + capacity > arena.length) throw new QcProgramError("invalid engine string checkpoint");
      entries.push({ offset, capacity, name });
    }
    if (reader.remaining !== 0) throw new QcProgramError("trailing string checkpoint bytes");
    this.arena = arena; this.used = arena.length; this.engines = entries;
  }
}
