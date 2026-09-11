// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestCallValue, GuestMemory, GuestStorage, GuestValueLayout } from "../../contracts/execution.ts";

export function storageBytes(storage: GuestStorage, pointerBytes: 4 | 8): number {
  switch (storage) {
    case "int8": case "uint8": return 1;
    case "int16": case "uint16": return 2;
    case "int32": case "uint32": case "float32": return 4;
    case "int64": case "uint64": case "float64": return 8;
    case "pointer": return pointerBytes;
  }
}
export function valueBytes(layout: GuestValueLayout, pointerBytes: 4 | 8): number {
  return layout.kind === "scalar" ? storageBytes(layout.storage, pointerBytes) : layout.layout.byteLength;
}
export function argumentBytes(layout: GuestValueLayout, pointerBytes: 4 | 8): number {
  const bytes = valueBytes(layout, pointerBytes);
  return layout.kind === "scalar" ? Math.max(4, bytes) : bytes;
}
export function valueAlignment(layout: GuestValueLayout, pointerBytes: 4 | 8): number {
  return layout.kind === "aggregate" ? layout.layout.alignment : Math.min(pointerBytes, storageBytes(layout.storage, pointerBytes));
}
export function validateValueLayout(layout: GuestValueLayout, pointerBytes: 4 | 8): void {
  if (layout.kind === "scalar") return;
  const record = layout.layout;
  if (record.pointerBytes !== pointerBytes || record.byteOrder !== "little-endian" || !Number.isSafeInteger(record.byteLength) || record.byteLength <= 0
    || !Number.isSafeInteger(record.alignment) || record.alignment <= 0 || (record.alignment & (record.alignment - 1)) !== 0 || record.alignment > 4096) throw new RangeError("Invalid aggregate ABI layout");
  for (const field of record.fields) {
    if (!Number.isSafeInteger(field.byteOffset) || field.byteOffset < 0 || !Number.isSafeInteger(field.count) || field.count < 0
      || field.byteOffset + field.count * storageBytes(field.storage, pointerBytes) > record.byteLength) throw new RangeError(`Aggregate field ${field.name} exceeds its record`);
  }
}
export function inferredLayout(value: GuestCallValue, promote: boolean): GuestValueLayout {
  if (value.kind === "aggregate") return { kind: "aggregate", layout: value.layout };
  return { kind: "scalar", storage: promote && value.kind === "float32" ? "float64" : value.kind };
}
export function encodeValue(layout: GuestValueLayout, value: GuestCallValue, memory: GuestMemory): Uint8Array {
  validateValueLayout(layout, memory.pointerBytes);
  if (layout.kind === "aggregate") {
    if (value.kind !== "aggregate" || value.layout.id !== layout.layout.id || value.bytes.length !== layout.layout.byteLength
      || value.layout.byteLength !== layout.layout.byteLength || value.layout.pointerBytes !== layout.layout.pointerBytes) throw new TypeError("Aggregate call value differs from its signature");
    return value.bytes.slice();
  }
  const bytes = new Uint8Array(storageBytes(layout.storage, memory.pointerBytes)), view = new DataView(bytes.buffer);
  if (layout.storage === "pointer") {
    if (value.kind !== "pointer") throw new TypeError("Pointer ABI argument requires a guest pointer");
    const raw = value.value === null ? 0n : memory.offset(value.value, 0n).byteOffset;
    if (memory.pointerBytes === 4) view.setUint32(0, Number(raw), true); else view.setBigUint64(0, raw, true);
    return bytes;
  }
  if (layout.storage === "float32" || layout.storage === "float64") {
    if (value.kind !== "float32" && value.kind !== "float64") throw new TypeError("Floating ABI argument requires a floating value");
    if (layout.storage === "float32") view.setFloat32(0, value.value, true); else view.setFloat64(0, value.value, true);
    return bytes;
  }
  if (value.kind !== "int32" && value.kind !== "uint32" && value.kind !== "int64" && value.kind !== "uint64") throw new TypeError("Integer ABI argument requires an integer value");
  if (typeof value.value === "number" && !Number.isSafeInteger(value.value)) throw new RangeError("Integer ABI argument is not an exact integer");
  const raw = BigInt(value.value);
  for (let index = 0; index < bytes.length; index++) bytes[index] = Number(BigInt.asUintN(8, raw >> BigInt(index * 8)));
  return bytes;
}
export function decodeValue(layout: GuestValueLayout, bytes: Uint8Array, memory: GuestMemory): GuestCallValue {
  if (bytes.length !== valueBytes(layout, memory.pointerBytes)) throw new RangeError("ABI value byte length differs from its layout");
  if (layout.kind === "aggregate") return { kind: "aggregate", layout: layout.layout, bytes: bytes.slice() };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  switch (layout.storage) {
    case "int8": return { kind: "int32", value: view.getInt8(0) };
    case "uint8": return { kind: "uint32", value: view.getUint8(0) };
    case "int16": return { kind: "int32", value: view.getInt16(0, true) };
    case "uint16": return { kind: "uint32", value: view.getUint16(0, true) };
    case "int32": return { kind: "int32", value: view.getInt32(0, true) };
    case "uint32": return { kind: "uint32", value: view.getUint32(0, true) };
    case "int64": return { kind: "int64", value: view.getBigInt64(0, true) };
    case "uint64": return { kind: "uint64", value: view.getBigUint64(0, true) };
    case "float32": return { kind: "float32", value: view.getFloat32(0, true) };
    case "float64": return { kind: "float64", value: view.getFloat64(0, true) };
    case "pointer": return { kind: "pointer", value: memory.pointer(memory.pointerBytes === 4 ? BigInt(view.getUint32(0, true)) : view.getBigUint64(0, true)) };
  }
}

export function encodeArgumentValue(layout: GuestValueLayout, value: GuestCallValue, memory: GuestMemory): Uint8Array {
  const bytes = encodeValue(layout, value, memory), size = argumentBytes(layout, memory.pointerBytes);
  if (bytes.length === size) return bytes;
  const last = bytes.at(-1);
  const signed = layout.kind === "scalar" && layout.storage.startsWith("int");
  const extended = new Uint8Array(size).fill(signed && last !== undefined && (last & 0x80) !== 0 ? 255 : 0);
  extended.set(bytes);
  return extended;
}

export function alignUp(value: number, alignment: number): number { return Math.ceil(value / alignment) * alignment; }
export function alignDown(value: bigint, alignment: number): bigint { const step = BigInt(alignment); return value - value % step; }
