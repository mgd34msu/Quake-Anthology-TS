// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, ModuleIdentity } from "../../contracts/execution.ts";
import type {
  GuestAccess, GuestAllocationOptions, GuestMapOptions, GuestMapping, GuestMemorySnapshot,
  GuestPermissions, GuestPointerBytes, MappedGuestMemory,
} from "./contracts.ts";

export type GuestMemoryFaultReason = "foreign-address-space" | "address-overflow" | "null-address"
  | "invalid-length" | "unmapped" | "permission" | "overlap" | "noncontiguous-borrow";
export class GuestMemoryFault extends Error {
  constructor(
    readonly reason: GuestMemoryFaultReason,
    readonly module: ModuleIdentity,
    readonly address: bigint,
    readonly byteLength: number,
    readonly access: GuestAccess | "map" | "borrow",
    detail: string,
  ) {
    super(`${module.id}: ${access} at 0x${address.toString(16)} (${byteLength} bytes): ${detail}`);
    this.name = "GuestMemoryFault";
  }
}

export function wrapGuestPointer(value: bigint, pointerBytes: GuestPointerBytes): bigint {
  return BigInt.asUintN(pointerBytes * 8, value);
}
export function signedGuestPointer(value: bigint, pointerBytes: GuestPointerBytes): bigint {
  return BigInt.asIntN(pointerBytes * 8, value);
}
export function addGuestPointer(value: bigint, displacement: bigint, pointerBytes: GuestPointerBytes): bigint {
  return wrapGuestPointer(value + displacement, pointerBytes);
}
function allows(permissions: GuestPermissions, access: GuestAccess): boolean {
  switch (access) {
    case "read": return permissions === "read" || permissions === "read-write" || permissions === "read-execute" || permissions === "read-write-execute";
    case "write": return permissions === "read-write" || permissions === "read-write-execute";
    case "execute": return permissions === "execute" || permissions === "read-execute" || permissions === "read-write-execute";
  }
}
interface Mapping extends GuestMapping {
  readonly bytes: Uint8Array;
}
interface Chunk { readonly mapping: Mapping; readonly offset: number; readonly byteLength: number; }
export interface SparseGuestMemoryOptions {
  readonly module: ModuleIdentity;
  readonly pointerBytes: GuestPointerBytes;
  readonly allocationBase?: bigint;
}

/** Only mapped regions allocate host bytes; high guest addresses never become JS indices. */
export class SparseGuestMemory implements MappedGuestMemory {
  readonly module: ModuleIdentity;
  readonly addressSpace: symbol;
  readonly pointerBytes: GuestPointerBytes;
  readonly #limit: bigint;
  readonly #allocationBase: bigint;
  #mappings: Mapping[] = [];

  constructor(options: SparseGuestMemoryOptions) {
    this.module = options.module;
    this.pointerBytes = options.pointerBytes;
    this.addressSpace = Symbol(options.module.id);
    this.#limit = 1n << BigInt(options.pointerBytes * 8);
    this.#allocationBase = options.allocationBase ?? 0x10000n;
    this.#range(this.#allocationBase, 0, "map");
  }

  pointer(rawValue: bigint): GuestAddress | null {
    if (rawValue === 0n) return null;
    this.#range(rawValue, 0, "read");
    return this.#address(rawValue);
  }

  offset(address: GuestAddress, displacement: bigint): GuestAddress {
    this.#owned(address, 0, "read");
    const result = address.byteOffset + displacement;
    this.#range(result, 0, "read");
    return this.#address(result);
  }

  map(options: GuestMapOptions): GuestAddress {
    this.#available(options.base, options.byteLength);
    if (options.bytes !== undefined && options.bytes.byteLength > options.byteLength) {
      throw new RangeError("Initial guest bytes exceed the mapping length");
    }
    const bytes = new Uint8Array(options.byteLength);
    if (options.bytes !== undefined) bytes.set(options.bytes);
    this.#insert({ base: options.base, byteLength: options.byteLength, bytes, permissions: options.permissions, label: options.label ?? "" });
    return this.#address(options.base);
  }

  allocate(options: GuestAllocationOptions): GuestAddress {
    const alignment = options.alignment ?? 16n;
    if (alignment <= 0n || (alignment & (alignment - 1n)) !== 0n) throw new RangeError("Guest allocation alignment must be a positive power of two");
    this.#range(this.#allocationBase, options.byteLength, "map");
    if (options.byteLength === 0) throw new RangeError("Guest allocations must contain at least one byte");
    let base = (this.#allocationBase + alignment - 1n) & -alignment;
    const length = BigInt(options.byteLength);
    for (const mapping of this.#mappings) {
      if (base + length <= mapping.base) break;
      const end = mapping.base + BigInt(mapping.byteLength);
      if (base < end) base = (end + alignment - 1n) & -alignment;
    }
    return this.map({ base, byteLength: options.byteLength, permissions: options.permissions ?? "read-write", label: options.label ?? "allocation" });
  }

  mapAlias(options: Omit<GuestMapOptions, "bytes"> & { readonly source: GuestAddress }): GuestAddress {
    this.#available(options.base, options.byteLength);
    const bytes = this.#contiguous(this.#chunks(options.source, options.byteLength, null), options.source, options.byteLength);
    this.#insert({ base: options.base, byteLength: options.byteLength, bytes, permissions: options.permissions, label: options.label ?? "alias" });
    return this.#address(options.base);
  }

  unmap(address: GuestAddress, byteLength: number): undefined {
    this.#chunks(address, byteLength, null);
    this.#replaceRange(address.byteOffset, byteLength, null);
    return undefined;
  }

  protect(address: GuestAddress, byteLength: number, permissions: GuestPermissions): undefined {
    this.#chunks(address, byteLength, null);
    this.#replaceRange(address.byteOffset, byteLength, permissions);
    return undefined;
  }

  mappings(): readonly GuestMapping[] {
    return this.#mappings.map(({ base, byteLength, permissions, label }) => ({ base, byteLength, permissions, label }));
  }

  check(address: GuestAddress, byteLength: number, access: GuestAccess): undefined {
    this.#chunks(address, byteLength, access);
    return undefined;
  }

  /** Trusted host view. Owners must retire it before unmap/protect; DataView cannot revoke access. */
  borrow(address: GuestAddress, byteLength: number): DataView {
    const chunks = this.#chunks(address, byteLength, "write");
    const bytes = this.#contiguous(chunks, address, byteLength);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  copy(address: GuestAddress, byteLength: number): Uint8Array {
    return this.#copyChunks(this.#chunks(address, byteLength, "read"), byteLength);
  }

  fetch(address: GuestAddress, byteLength: number): Uint8Array {
    return this.#copyChunks(this.#chunks(address, byteLength, "execute"), byteLength);
  }

  write(address: GuestAddress, bytes: Uint8Array): undefined {
    const chunks = this.#chunks(address, bytes.byteLength, "write");
    // Source may itself alias guest memory. Take one snapshot before the first store.
    const source = bytes.slice();
    let consumed = 0;
    for (const chunk of chunks) {
      chunk.mapping.bytes.set(source.subarray(consumed, consumed + chunk.byteLength), chunk.offset);
      consumed += chunk.byteLength;
    }
    return undefined;
  }

  readUint8(address: GuestAddress): number { return this.#readView(address, 1).getUint8(0); }
  readInt8(address: GuestAddress): number { return this.#readView(address, 1).getInt8(0); }
  readUint16(address: GuestAddress): number { return this.#readView(address, 2).getUint16(0, true); }
  readInt16(address: GuestAddress): number { return this.#readView(address, 2).getInt16(0, true); }
  readUint32(address: GuestAddress): number { return this.#readView(address, 4).getUint32(0, true); }
  readInt32(address: GuestAddress): number { return this.#readView(address, 4).getInt32(0, true); }
  readUint64(address: GuestAddress): bigint { return this.#readView(address, 8).getBigUint64(0, true); }
  readInt64(address: GuestAddress): bigint { return this.#readView(address, 8).getBigInt64(0, true); }
  readFloat32(address: GuestAddress): number { return this.#readView(address, 4).getFloat32(0, true); }
  readFloat64(address: GuestAddress): number { return this.#readView(address, 8).getFloat64(0, true); }
  readPointer(address: GuestAddress): GuestAddress | null {
    return this.pointer(this.pointerBytes === 4 ? BigInt(this.readUint32(address)) : this.readUint64(address));
  }
  writeUint8(address: GuestAddress, value: number): undefined { return this.#writeScalar(address, 1, view => view.setUint8(0, value)); }
  writeInt8(address: GuestAddress, value: number): undefined { return this.#writeScalar(address, 1, view => view.setInt8(0, value)); }
  writeUint16(address: GuestAddress, value: number): undefined { return this.#writeScalar(address, 2, view => view.setUint16(0, value, true)); }
  writeInt16(address: GuestAddress, value: number): undefined { return this.#writeScalar(address, 2, view => view.setInt16(0, value, true)); }
  writeUint32(address: GuestAddress, value: number): undefined { return this.#writeScalar(address, 4, view => view.setUint32(0, value, true)); }
  writeInt32(address: GuestAddress, value: number): undefined { return this.#writeScalar(address, 4, view => view.setInt32(0, value, true)); }
  writeUint64(address: GuestAddress, value: bigint): undefined { return this.#writeScalar(address, 8, view => view.setBigUint64(0, value, true)); }
  writeInt64(address: GuestAddress, value: bigint): undefined { return this.#writeScalar(address, 8, view => view.setBigInt64(0, value, true)); }
  writeFloat32(address: GuestAddress, value: number): undefined { return this.#writeScalar(address, 4, view => view.setFloat32(0, value, true)); }
  writeFloat64(address: GuestAddress, value: number): undefined { return this.#writeScalar(address, 8, view => view.setFloat64(0, value, true)); }
  writePointer(address: GuestAddress, value: GuestAddress | null): undefined {
    if (value !== null) this.#owned(value, 0, "write");
    const raw = value?.byteOffset ?? 0n;
    return this.pointerBytes === 4 ? this.writeUint32(address, Number(raw)) : this.writeUint64(address, raw);
  }

  checkpoint(): GuestMemorySnapshot {
    const backings: Uint8Array[] = [];
    const indices = new Map<ArrayBufferLike, number>();
    const mappings = this.#mappings.map(mapping => {
      let backing = indices.get(mapping.bytes.buffer);
      if (backing === undefined) {
        backing = backings.length;
        indices.set(mapping.bytes.buffer, backing);
        backings.push(new Uint8Array(mapping.bytes.buffer).slice());
      }
      return { base: mapping.base, byteLength: mapping.byteLength, permissions: mapping.permissions,
        label: mapping.label, backing, backingOffset: mapping.bytes.byteOffset };
    });
    return { module: this.module, pointerBytes: this.pointerBytes, allocationBase: this.#allocationBase, backings, mappings };
  }

  /** Restored pointers get a fresh addressSpace token; raw offsets and alias relationships survive. */
  static restore(module: ModuleIdentity, snapshot: GuestMemorySnapshot): SparseGuestMemory {
    if (module.id !== snapshot.module.id || module.digest !== snapshot.module.digest || module.revision !== snapshot.module.revision) {
      throw new Error("Guest snapshot belongs to a different module artifact");
    }
    const memory = new SparseGuestMemory({ module, pointerBytes: snapshot.pointerBytes, allocationBase: snapshot.allocationBase });
    const backings = snapshot.backings.map(bytes => bytes.slice());
    for (const mapping of snapshot.mappings) {
      memory.#available(mapping.base, mapping.byteLength);
      const backing = backings[mapping.backing];
      if (!Number.isSafeInteger(mapping.backing) || backing === undefined || !Number.isSafeInteger(mapping.backingOffset)
        || mapping.backingOffset < 0 || mapping.backingOffset + mapping.byteLength > backing.byteLength) {
        throw new RangeError("Invalid guest snapshot backing range");
      }
      memory.#insert({ base: mapping.base, byteLength: mapping.byteLength, permissions: mapping.permissions,
        label: mapping.label, bytes: backing.subarray(mapping.backingOffset, mapping.backingOffset + mapping.byteLength) });
    }
    return memory;
  }

  #address(byteOffset: bigint): GuestAddress {
    return Object.freeze({ kind: "guest-address", addressSpace: this.addressSpace, byteOffset });
  }
  #fault(reason: GuestMemoryFaultReason, address: bigint, length: number, access: GuestAccess | "map" | "borrow", detail: string): never {
    throw new GuestMemoryFault(reason, this.module, address, length, access, detail);
  }
  #range(base: bigint, byteLength: number, access: GuestAccess | "map"): undefined {
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) this.#fault("invalid-length", base, byteLength, access, "length must be a nonnegative safe integer");
    if (base === 0n) this.#fault("null-address", base, byteLength, access, "null is not a mapped address");
    if (base < 0n || base >= this.#limit || base + BigInt(byteLength) > this.#limit) {
      this.#fault("address-overflow", base, byteLength, access, `range exceeds ${this.pointerBytes * 8}-bit address space`);
    }
    return undefined;
  }
  #owned(address: GuestAddress, byteLength: number, access: GuestAccess | "map"): undefined {
    if (address.addressSpace !== this.addressSpace) this.#fault("foreign-address-space", address.byteOffset, byteLength, access, "pointer belongs to another execution owner");
    return this.#range(address.byteOffset, byteLength, access);
  }
  #available(base: bigint, byteLength: number): undefined {
    this.#range(base, byteLength, "map");
    if (byteLength === 0) this.#fault("invalid-length", base, byteLength, "map", "mapping must contain at least one byte");
    const end = base + BigInt(byteLength);
    if (this.#mappings.some(mapping => mapping.base < end && mapping.base + BigInt(mapping.byteLength) > base)) {
      this.#fault("overlap", base, byteLength, "map", "mapping overlaps an existing guest range");
    }
    return undefined;
  }
  #insert(mapping: Mapping): undefined {
    this.#mappings.push(mapping);
    this.#mappings.sort((left, right) => left.base < right.base ? -1 : left.base > right.base ? 1 : 0);
    return undefined;
  }
  #chunks(address: GuestAddress, byteLength: number, access: GuestAccess | null): Chunk[] {
    this.#owned(address, byteLength, access ?? "map");
    const chunks: Chunk[] = [];
    let cursor = address.byteOffset;
    let remaining = byteLength;
    // Mappings are disjoint and sorted. Start at the first range whose end can
    // contain this address, retaining the same forward scan across aliases/holes.
    let low = 0, high = this.#mappings.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const mapping = this.#mappings[middle];
      if (mapping === undefined) throw new Error("Guest mapping index is inconsistent");
      if (mapping.base + BigInt(mapping.byteLength) <= cursor) low = middle + 1;
      else high = middle;
    }
    for (let index = low; index < this.#mappings.length; index++) {
      const mapping = this.#mappings[index];
      if (mapping === undefined) throw new Error("Guest mapping index is inconsistent");
      if (remaining === 0) break;
      const end = mapping.base + BigInt(mapping.byteLength);
      if (cursor >= end) continue;
      if (cursor < mapping.base) break;
      if (access !== null && !allows(mapping.permissions, access)) this.#fault("permission", cursor, remaining, access, `mapping '${mapping.label}' permits ${mapping.permissions}`);
      const offset = Number(cursor - mapping.base);
      const length = Math.min(remaining, mapping.byteLength - offset);
      chunks.push({ mapping, offset, byteLength: length });
      remaining -= length;
      cursor += BigInt(length);
    }
    if (remaining !== 0) this.#fault("unmapped", cursor, remaining, access ?? "map", "range includes unmapped bytes");
    return chunks;
  }
  #contiguous(chunks: readonly Chunk[], address: GuestAddress, byteLength: number): Uint8Array {
    const first = chunks[0];
    if (first === undefined) return new Uint8Array(0);
    const buffer = first.mapping.bytes.buffer;
    const start = first.mapping.bytes.byteOffset + first.offset;
    let consumed = 0;
    for (const chunk of chunks) {
      if (chunk.mapping.bytes.buffer !== buffer || chunk.mapping.bytes.byteOffset + chunk.offset !== start + consumed) {
        this.#fault("noncontiguous-borrow", address.byteOffset, byteLength, "borrow", "a live view requires contiguous backing storage; use checked loads or copy for fragmented ranges");
      }
      consumed += chunk.byteLength;
    }
    return new Uint8Array(buffer, start, byteLength);
  }
  #copyChunks(chunks: readonly Chunk[], byteLength: number): Uint8Array {
    const result = new Uint8Array(byteLength);
    let consumed = 0;
    for (const chunk of chunks) {
      result.set(chunk.mapping.bytes.subarray(chunk.offset, chunk.offset + chunk.byteLength), consumed);
      consumed += chunk.byteLength;
    }
    return result;
  }
  #replaceRange(base: bigint, byteLength: number, permissions: GuestPermissions | null): undefined {
    if (byteLength === 0) return undefined;
    const end = base + BigInt(byteLength);
    const next: Mapping[] = [];
    for (const mapping of this.#mappings) {
      const mappingEnd = mapping.base + BigInt(mapping.byteLength);
      if (mappingEnd <= base || mapping.base >= end) { next.push(mapping); continue; }
      const startOffset = Number((base > mapping.base ? base : mapping.base) - mapping.base);
      const endOffset = Number((end < mappingEnd ? end : mappingEnd) - mapping.base);
      if (startOffset > 0) next.push({ ...mapping, byteLength: startOffset, bytes: mapping.bytes.subarray(0, startOffset) });
      if (permissions !== null) next.push({ ...mapping, base: mapping.base + BigInt(startOffset), byteLength: endOffset - startOffset,
        permissions, bytes: mapping.bytes.subarray(startOffset, endOffset) });
      if (endOffset < mapping.byteLength) next.push({ ...mapping, base: mapping.base + BigInt(endOffset), byteLength: mapping.byteLength - endOffset,
        bytes: mapping.bytes.subarray(endOffset) });
    }
    this.#mappings = next;
    return undefined;
  }
  #readView(address: GuestAddress, byteLength: number): DataView {
    const chunks = this.#chunks(address, byteLength, "read");
    const first = chunks[0];
    if (first !== undefined && chunks.length === 1) {
      return new DataView(first.mapping.bytes.buffer, first.mapping.bytes.byteOffset + first.offset, byteLength);
    }
    const bytes = this.#copyChunks(chunks, byteLength);
    return new DataView(bytes.buffer, bytes.byteOffset, byteLength);
  }
  #writeScalar(address: GuestAddress, byteLength: number, write: (view: DataView) => void): undefined {
    const bytes = new Uint8Array(byteLength);
    write(new DataView(bytes.buffer));
    return this.write(address, bytes);
  }
}
