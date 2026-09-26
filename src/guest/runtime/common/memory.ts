// SPDX-License-Identifier: GPL-2.0-or-later
import { Buffer } from "node:buffer";
import { SparseGuestMemory } from "../../core/memory.ts";
import type { MappedGuestMemory } from "../../core/contracts.ts";
import type { GuestAddress, GuestCallValue, GuestMemory } from "../../../contracts/execution.ts";

export function argument(args: readonly GuestCallValue[], index: number): GuestCallValue {
  const value = args[index];
  if (value === undefined) throw new TypeError(`Missing guest argument ${index}`);
  return value;
}
export function integer(args: readonly GuestCallValue[], index: number): bigint {
  const value = argument(args, index);
  if (value.kind !== "int32" && value.kind !== "uint32" && value.kind !== "int64" && value.kind !== "uint64") throw new TypeError("Guest integer required");
  return BigInt(value.value);
}
export function count(args: readonly GuestCallValue[], index: number): number {
  const value = integer(args, index);
  if (value < 0n || value > 0x10000000n) throw new RangeError("Guest byte count exceeds runtime allocation limit");
  return Number(value);
}
export function pointer(args: readonly GuestCallValue[], index: number): GuestAddress | null {
  const value = argument(args, index);
  if (value.kind !== "pointer") throw new TypeError("Guest pointer required");
  return value.value;
}
export function requiredPointer(args: readonly GuestCallValue[], index: number): GuestAddress {
  const value = pointer(args, index);
  if (value === null) throw new TypeError("Nonnull guest pointer required");
  return value;
}
export function readUnsigned(memory: GuestMemory, address: GuestAddress, width: number): bigint {
  const bytes = memory.copy(address, width);
  let value = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) value = value << 8n | BigInt(bytes[i] ?? 0);
  return value;
}
export function writeUnsigned(memory: GuestMemory, address: GuestAddress, width: number, value: bigint): void {
  const bytes = new Uint8Array(width);
  for (let i = 0; i < width; i++) bytes[i] = Number(value >> BigInt(i * 8) & 255n);
  memory.write(address, bytes);
}
export function readPointer(memory: GuestMemory, address: GuestAddress): GuestAddress | null { return memory.pointer(readUnsigned(memory, address, memory.pointerBytes)); }
export function writePointer(memory: GuestMemory, address: GuestAddress, value: GuestAddress | null): void {
  if (value !== null) memory.offset(value, 0n);
  writeUnsigned(memory, address, memory.pointerBytes, value?.byteOffset ?? 0n);
}
export function readString(memory: GuestMemory, address: GuestAddress, wide = false, maximum = 1048576): string {
  if (!wide && memory instanceof SparseGuestMemory && SparseGuestMemory.managed(memory)) {
    const length = memory.findZero(address, maximum);
    if (length < 0) throw new RangeError("Guest string exceeds checked maximum");
    const bytes = memory.copy(address, length);
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
  }
  const width = wide ? 2 : 1;
  let value = "";
  for (let i = 0; i < maximum; i++) {
    const unit = Number(readUnsigned(memory, memory.offset(address, BigInt(i * width)), width));
    if (unit === 0) return value;
    value += String.fromCharCode(unit);
  }
  throw new RangeError("Guest string exceeds checked maximum");
}
export function stringBytes(value: string, wide = false): Uint8Array {
  const width = wide ? 2 : 1;
  const bytes = new Uint8Array((value.length + 1) * width);
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    bytes[i * width] = code & 255;
    if (wide) bytes[i * width + 1] = code >>> 8;
  }
  return bytes;
}

/** Native CRT routines probe page boundaries, not heap chunk boundaries, before vector reads. */
export function nativeAllocationBytes(logicalBytes: number): number {
  if (!Number.isSafeInteger(logicalBytes) || logicalBytes < 0 || logicalBytes > Number.MAX_SAFE_INTEGER - 4095) throw new RangeError("Invalid native allocation size");
  return Math.max(4096, Math.ceil(logicalBytes / 4096) * 4096);
}

export function allocateNativeMemory(memory: MappedGuestMemory, logicalBytes: number, label: string): GuestAddress {
  return memory.allocate({ byteLength: nativeAllocationBytes(logicalBytes), alignment: 4096n, label });
}
