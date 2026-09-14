import { SaveReader } from "../../../persistence/value.ts";
/*
 * Library variables translated from id Software's botlib/l_libvar.c.
 * Copyright (C) 1999-2005 Id Software, Inc.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { BotMemory } from "./memory.ts";
import type { BotMemoryAllocation } from "./memory.ts";

function sameName(name: Uint8Array, readByte: (index: number) => number): boolean {
  for (let index = 0; index < 99999; index++) {
    const a = name[index], b = readByte(index);
    if (a === undefined || !Number.isInteger(b) || b < 0 || b > 255) throw new RangeError("Source name read requires an allocated byte");
    const left = a >= 97 && a <= 122 ? a - 32 : a;
    const right = b >= 97 && b <= 122 ? b - 32 : b;
    if (left !== right) return false;
    if (a === 0) return true;
  }
  return true;
}

export interface BotLibVar {
  readonly name: string;
  readonly string: string;
  readonly flags: number;
  readonly modified: boolean;
  readonly value: number;
}

// Release32 libvar_t: two pointers, int, qboolean, float, next pointer.
const RECORD_BYTES = 24;
interface VariableRecord {
  readonly allocation: BotMemoryAllocation;
  readonly value: BotLibVar;
}
interface StringPointer {
  readonly allocation: BotMemoryAllocation;
  readonly offset: number;
}

function recordView(record: VariableRecord): DataView {
  const bytes = record.allocation.bytes;
  return new DataView(bytes.buffer, bytes.byteOffset, RECORD_BYTES);
}

function writeText(bytes: Uint8Array, offset: number, text: string): void {
  for (let index = 0; index < text.length; index++) bytes[offset + index] = text.charCodeAt(index);
  bytes[offset + text.length] = 0;
}

function byteCString(text: string): string {
  const terminator = text.indexOf("\0");
  const visible = terminator < 0 ? text : text.slice(0, terminator);
  for (let index = 0; index < visible.length; index++) {
    if (visible.charCodeAt(index) > 0xff) {
      throw new RangeError("Bot library variable text must contain only Latin-1 bytes before NUL");
    }
  }
  return visible;
}

function parseValue(text: string): number {
  let denominator = 0;
  let value = 0;
  for (let index = 0; index < text.length; index++) {
    let byte = text.charCodeAt(index);
    if (byte < 48 || byte > 57) {
      if (denominator !== 0 || byte !== 46) return 0;
      denominator = 10;
      index++;
      if (index === text.length) {
        // Port policy: a terminal dot is nonnumeric; C would read beyond its owned string.
        return 0;
      }
      byte = text.charCodeAt(index);
    }
    if (denominator !== 0) {
      // Native x64 signed-char, binary32 division/addition; the post-dot byte is unchecked in C.
      const signedByte = byte < 128 ? byte : byte - 256;
      value = Math.fround(value + Math.fround((signedByte - 48) / denominator));
      if (denominator * 10 > 2147483647) {
        throw new RangeError("LibVarStringValue: fractional denominator would overflow the source signed int");
      }
      denominator *= 10;
    } else {
      // The source literal 10.0 promotes this expression to double before float assignment.
      value = Math.fround(value * 10 + (byte - 48));
    }
  }
  return value;
}

/** Native x64 binary32/signed-char parsing; terminal-dot undefined inputs use numeric zero. */
export function libVarStringValue(text: string): number {
  return parseValue(byteCString(text));
}

/** One botlib-lifetime owner replaces the source-global linked list. */
export class BotLibVars {
  // Pointer words contain owner-local IDs, not native virtual addresses.
  private readonly records = new Map<number, VariableRecord>();
  private readonly strings = new Map<number, StringPointer>();
  private nextPointer = 1;
  private head = 0;

  constructor(private readonly memory = new BotMemory()) {}

  checkpoint(memory: import("./memory.ts").BotMemoryCapture) {
    return { nextPointer: this.nextPointer, head: this.head,
      records: [...this.records].map(([pointer, record]) => ({ pointer, allocation: memory.reference(record.allocation) })),
      strings: [...this.strings].map(([pointer, string]) => ({ pointer, allocation: memory.reference(string.allocation), offset: string.offset })) };
  }
  restore(value: unknown, memory: import("./memory.ts").BotMemoryRestore): void {
    const reader = new SaveReader(value, "bot.variables"), image = { nextPointer: reader.field("nextPointer").integer(1), head: reader.field("head").integer(0),
      records: reader.field("records").list(entry => ({ pointer: entry.field("pointer").integer(1), allocation: entry.field("allocation").integer(0) })),
      strings: reader.field("strings").list(entry => ({ pointer: entry.field("pointer").integer(1), allocation: entry.field("allocation").integer(0), offset: entry.field("offset").integer(0) })) };
    if (this.records.size !== 0 || this.strings.size !== 0 || !Number.isSafeInteger(image.nextPointer)
      || image.nextPointer < 1 || image.nextPointer > 0x100000000) throw new Error("Invalid bot library variable restoration");
    const records = new Map<number, VariableRecord>(), strings = new Map<number, StringPointer>();
    const pointers = new Set<number>();
    const admit = (pointer: number): void => {
      if (!Number.isSafeInteger(pointer) || pointer < 1 || pointer >= image.nextPointer || pointers.has(pointer)) throw new Error("Invalid saved bot variable pointer");
      pointers.add(pointer);
    };
    for (const entry of image.strings) {
      admit(entry.pointer);
      const allocation = memory.allocation(entry.allocation);
      if (!Number.isSafeInteger(entry.offset) || entry.offset < 0 || entry.offset >= allocation.bytes.length
        || !allocation.bytes.subarray(entry.offset).includes(0)) throw new Error("Invalid saved bot variable string");
      strings.set(entry.pointer, { allocation, offset: entry.offset });
    }
    for (const entry of image.records) {
      admit(entry.pointer);
      const allocation = memory.allocation(entry.allocation);
      if (allocation.bytes.length < RECORD_BYTES + 1) throw new Error("Saved bot variable record is truncated");
      const record = this.bind(allocation), view = recordView(record);
      if (!strings.has(view.getUint32(0, true)) || !strings.has(view.getUint32(4, true))) throw new Error("Saved bot variable string reference is missing");
      records.set(entry.pointer, record);
    }
    const visited = new Set<number>();
    for (let pointer = image.head; pointer !== 0;) {
      const record = records.get(pointer);
      if (record === undefined || visited.has(pointer)) throw new Error("Invalid saved bot variable list");
      visited.add(pointer); pointer = recordView(record).getUint32(20, true);
    }
    if (visited.size !== records.size) throw new Error("Saved bot variable list has unreachable records");
    for (const [pointer, record] of records) this.records.set(pointer, record);
    for (const [pointer, string] of strings) this.strings.set(pointer, string);
    this.head = image.head; this.nextPointer = image.nextPointer;
  }
  reference(variable: Pick<BotLibVar, "string" | "value">): number {
    for (const [pointer, record] of this.records) if (record.value === variable) return pointer;
    throw new Error("Bot library variable reference belongs to another owner");
  }
  resolve(pointer: number): BotLibVar { return this.record(pointer).value; }

  private pointer(): number {
    if (this.nextPointer > 0xffffffff) throw new RangeError("Bot library variable pointer IDs exhausted");
    return this.nextPointer++;
  }

  private readString(pointer: number): string {
    const reference = this.strings.get(pointer);
    if (reference === undefined) throw new Error("Bot library variable string pointer is null or freed");
    const bytes = reference.allocation.bytes;
    let text = "";
    for (let index = reference.offset; index < bytes.length; index++) {
      const byte = bytes[index];
      if (byte === undefined) throw new RangeError("Bot library variable string index is outside its allocation");
      if (byte === 0) return text;
      text += String.fromCharCode(byte);
    }
    throw new RangeError("Bot library variable string has no allocated terminator");
  }

  private record(pointer: number): VariableRecord {
    const record = this.records.get(pointer);
    if (record === undefined) throw new Error("Bot library variable record pointer is not live");
    return record;
  }

  private bind(allocation: BotMemoryAllocation): VariableRecord {
    const owner = this;
    const record: VariableRecord = { allocation, value: {
      get name(): string { return owner.readString(recordView(record).getUint32(0, true)); },
      get string(): string { return owner.readString(recordView(record).getUint32(4, true)); },
      get flags(): number { return recordView(record).getInt32(8, true); },
      get modified(): boolean { return recordView(record).getInt32(12, true) !== 0; },
      get value(): number { return recordView(record).getFloat32(16, true); },
    } };
    return record;
  }

  private allocate(name: string): VariableRecord {
    const pointer = this.pointer(), namePointer = this.pointer();
    const allocation = this.memory.allocate(RECORD_BYTES + name.length + 1, "heap", false);
    allocation.bytes.fill(0, 0, RECORD_BYTES);
    writeText(allocation.bytes, RECORD_BYTES, name);
    const record = this.bind(allocation), view = recordView(record);
    view.setUint32(0, namePointer, true);
    view.setUint32(20, this.head, true);
    this.strings.set(namePointer, { allocation, offset: RECORD_BYTES });
    this.records.set(pointer, record);
    this.head = pointer;
    return record;
  }

  private assign(record: VariableRecord, text: string, numericValue: number): void {
    const pointer = this.pointer();
    const allocation = this.memory.allocate(text.length + 1, "heap", false);
    this.strings.set(pointer, { allocation, offset: 0 });
    const view = recordView(record);
    this.strings.delete(view.getUint32(4, true));
    view.setUint32(4, pointer, true);
    writeText(allocation.bytes, 0, text);
    view.setFloat32(16, numericValue, true);
    view.setInt32(12, 1, true);
  }

  private freeString(record: VariableRecord): void {
    const pointer = recordView(record).getUint32(4, true);
    const reference = this.strings.get(pointer);
    if (reference === undefined) throw new Error("Bot library variable string pointer is not owned");
    this.memory.free(reference.allocation);
    // Allocation failure retains the source dangling pointer. A subsequent
    // access or source deallocation reaches BotMemory's freed-allocation guard.
  }

  get(name: string): BotLibVar | null {
    const visible = byteCString(name);
    return this.getByNameBytes(index => index < visible.length ? visible.charCodeAt(index) : 0)?.value ?? null;
  }

  getString(name: string): string {
    return this.get(name)?.string ?? "";
  }

  /** LibVarGetString/Q_stricmp: read a borrowed name only while candidates still match. */
  getStringByNameBytes(readByte: ((index: number) => number) | null): string {
    return this.getByNameBytes(readByte)?.value.string ?? "";
  }

  private getByNameBytes(readByte: ((index: number) => number) | null): VariableRecord | null {
    if (readByte === null) return null;
    // LibVarAlloc prepends new variables; updating an existing variable leaves its position alone.
    for (let pointer = this.head; pointer !== 0;) {
      const variable = this.record(pointer);
      if (sameName(variable.allocation.bytes.subarray(RECORD_BYTES), readByte)) return variable;
      pointer = recordView(variable).getUint32(20, true);
    }
    return null;
  }

  getValue(name: string): number {
    return this.get(name)?.value ?? 0;
  }

  getOrCreate(name: string, defaultValue: string): BotLibVar {
    const visibleName = byteCString(name);
    const existing = this.get(visibleName);
    if (existing !== null) return existing;
    const text = byteCString(defaultValue);
    const numericValue = parseValue(text);
    const variable = this.allocate(visibleName);
    this.assign(variable, text, numericValue);
    return variable.value;
  }

  string(name: string, defaultValue: string): string {
    return this.getOrCreate(name, defaultValue).string;
  }

  value(name: string, defaultValue: string): number {
    return this.getOrCreate(name, defaultValue).value;
  }

  set(name: string, value: string): void {
    const visibleName = byteCString(name);
    const text = byteCString(value);
    const numericValue = parseValue(text);
    const existing = this.getByNameBytes(index => index < visibleName.length ? visibleName.charCodeAt(index) : 0);
    if (existing !== null) this.freeString(existing);
    const variable = existing ?? this.allocate(visibleName);
    this.assign(variable, text, numericValue);
  }

  /** LibVarSet consumes a full borrowed name only when LibVarAlloc needs a new variable. */
  setByNameBytes(
    readByte: ((index: number) => number) | null, readName: () => string, readValue: () => string,
  ): void {
    const existing = this.getByNameBytes(readByte);
    const name = existing === null ? readName() : existing.value.name;
    this.set(name, readValue());
  }

  changed(name: string): boolean {
    return this.get(name)?.modified ?? false;
  }

  setNotModified(name: string): void {
    const visible = byteCString(name);
    const variable = this.getByNameBytes(index => index < visible.length ? visible.charCodeAt(index) : 0);
    if (variable !== null) recordView(variable).setInt32(12, 0, true);
  }

  /** LibVarDeAllocAll. Retained handles belong to the old botlib lifetime. */
  clear(): void {
    while (this.head !== 0) {
      const pointer = this.head;
      const variable = this.record(pointer);
      const view = recordView(variable);
      this.head = view.getUint32(20, true);
      if (view.getUint32(4, true) !== 0) this.freeString(variable);
      this.strings.delete(view.getUint32(4, true));
      this.strings.delete(view.getUint32(0, true));
      this.memory.free(variable.allocation);
      this.records.delete(pointer);
    }
  }
}
