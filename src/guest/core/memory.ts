// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, ModuleIdentity } from "../../contracts/execution.ts";
import type {
  GuestAccess, GuestAllocationOptions, GuestMapOptions, GuestMapping, GuestMemorySnapshot,
  GuestPermissions, GuestPointerBytes, GuestWrittenRange, MappedGuestMemory,
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
  readonly view: DataView;
  readonly end: bigint;
  active: boolean;
}
function mappedBytes(mapping: Omit<Mapping, "view" | "active" | "end">): Mapping {
  return { ...mapping, view: new DataView(mapping.bytes.buffer, mapping.bytes.byteOffset, mapping.bytes.byteLength), end: mapping.base + BigInt(mapping.byteLength), active: true };
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
  #mappingGeneration = 0;
  readonly #allocationHints = new Map<bigint, { readonly base: bigint; readonly byteLength: number }>();
  readonly #recentMappings = new Map<GuestAccess | null, Mapping>();
  readonly #workingSet: Mapping[] = [];
  #nextWorkingMapping = 0;
  readonly #writeObservers = new Set<{ readonly chunks: readonly Chunk[]; readonly notify: (ranges: readonly GuestWrittenRange[]) => void }>();

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
    const hint = this.#allocationHints.get(alignment);
    const start = hint !== undefined && options.byteLength >= hint.byteLength ? hint.base : this.#allocationBase;
    let base = (start + alignment - 1n) & -alignment;
    const length = BigInt(options.byteLength);
    for (let index = this.#firstEndAfter(base); index < this.#mappings.length; index++) {
      const mapping = this.#mappings[index];
      if (mapping === undefined) throw new Error("Guest mapping index is inconsistent");
      if (base + length <= mapping.base) break;
      const end = mapping.end;
      if (base < end) base = (end + alignment - 1n) & -alignment;
    }
    const result = this.map({ base, byteLength: options.byteLength, permissions: options.permissions ?? "read-write", label: options.label ?? "allocation" });
    this.#allocationHints.set(alignment, { base: base + length, byteLength: options.byteLength });
    return result;
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
    if (this.#singleMapping(address, byteLength, access) === null) this.#chunks(address, byteLength, access);
    return undefined;
  }

  /** Trusted host view. Owners must retire it before unmap/protect; DataView cannot revoke access. */
  borrow(address: GuestAddress, byteLength: number): DataView {
    const chunks = this.#chunks(address, byteLength, "write");
    const bytes = this.#contiguous(chunks, address, byteLength);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  copy(address: GuestAddress, byteLength: number): Uint8Array {
    const mapping = this.#singleMapping(address, byteLength, "read");
    if (mapping !== null) {
      const offset = Number(address.byteOffset - mapping.base);
      return mapping.bytes.slice(offset, offset + byteLength);
    }
    return this.#copyChunks(this.#chunks(address, byteLength, "read"), byteLength);
  }

  fetch(address: GuestAddress, byteLength: number): Uint8Array {
    return this.#copyChunks(this.#chunks(address, byteLength, "execute"), byteLength);
  }

  fetchByte(byteOffset: bigint): number {
    const recent = this.#recentMappings.get("execute");
    let mapping: Mapping | undefined;
    if (recent?.active === true && byteOffset >= recent.base && byteOffset < recent.end) mapping = recent;
    else {
      this.#range(byteOffset, 1, "execute");
      mapping = this.#mappings[this.#firstEndAfter(byteOffset)];
      if (mapping === undefined || byteOffset < mapping.base)
        this.#fault("unmapped", byteOffset, 1, "execute", "range includes unmapped bytes");
      this.#remember("execute", mapping);
    }
    if (!allows(mapping.permissions, "execute"))
      this.#fault("permission", byteOffset, 1, "execute", `mapping '${mapping.label}' permits ${mapping.permissions}`);
    const byte = mapping.bytes[Number(byteOffset - mapping.base)];
    if (byte === undefined) throw new Error("Guest mapping backing is inconsistent");
    return byte;
  }


  fetchSequence(byteOffset: bigint): () => number {
    let consumed = 0;
    let generation = -1;
    let mapping: Mapping | undefined;
    let offset = 0;
    return () => {
      if (generation !== this.#mappingGeneration || mapping === undefined || offset >= mapping.byteLength) {
        const address = byteOffset + BigInt(consumed);
        const byte = this.fetchByte(address);
        mapping = this.#recentMappings.get("execute");
        if (mapping === undefined) throw new Error("Guest execute mapping is missing");
        offset = Number(address - mapping.base) + 1;
        generation = this.#mappingGeneration;
        consumed += 1;
        return byte;
      }
      const byte = mapping.bytes[offset];
      if (byte === undefined) throw new Error("Guest mapping backing is inconsistent");
      offset += 1;
      consumed += 1;
      return byte;
    };
  }

  retainExecutableBytes(byteOffset: bigint, bytes: readonly number[]): (() => boolean) | null {
    if (bytes.length === 0 || bytes.length > 15) return null;
    const mapping = this.#mappings[this.#firstEndAfter(byteOffset)];
    if (mapping === undefined || byteOffset < mapping.base || !allows(mapping.permissions, "execute")) return null;
    const offset = Number(byteOffset - mapping.base);
    if (offset + bytes.length > mapping.byteLength) return null;
    const expected = bytes.slice();
    const unchanged = (): boolean => {
      if (!mapping.active) return false;
      for (let index = 0; index < expected.length; index++) if (mapping.bytes[offset + index] !== expected[index]) return false;
      return true;
    };
    return unchanged() ? unchanged : null;
  }


  write(address: GuestAddress, bytes: Uint8Array): undefined {
    const mapping = this.#singleMapping(address, bytes.byteLength, "write");
    if (mapping !== null) {
      const offset = Number(address.byteOffset - mapping.base);
      // TypedArray.set preserves the source when the backing ranges overlap.
      mapping.bytes.set(bytes, offset);
      return this.#writeObservers.size === 0 ? undefined : this.#notifyWrite([{ mapping, offset, byteLength: bytes.byteLength }]);
    }
    const chunks = this.#chunks(address, bytes.byteLength, "write");
    // Source may itself alias guest memory. Take one snapshot before the first store.
    return this.#commitWrite(chunks, bytes.slice());
  }

  #commitWrite(chunks: readonly Chunk[], source: Uint8Array): undefined {
    let consumed = 0;
    for (const chunk of chunks) {
      chunk.mapping.bytes.set(source.subarray(consumed, consumed + chunk.byteLength), chunk.offset);
      consumed += chunk.byteLength;
    }
    return this.#notifyWrite(chunks);
  }

  #notifyWrite(chunks: readonly Chunk[]): undefined {
    if (this.#writeObservers.size === 0) return undefined;
    const errors: unknown[] = [];
    for (const observer of [...this.#writeObservers]) {
      if (!this.#writeObservers.has(observer)) continue;
      const ranges: GuestWrittenRange[] = []; let displacement = 0;
      for (const watched of observer.chunks) {
        for (const written of chunks) {
          const a = watched.mapping.bytes, b = written.mapping.bytes;
          const start = a.byteOffset + watched.offset, other = b.byteOffset + written.offset;
          const first = Math.max(start, other), last = Math.min(start + watched.byteLength, other + written.byteLength);
          if (a.buffer === b.buffer && first < last) ranges.push({ byteOffset: displacement + first - start, byteLength: last - first });
        }
        displacement += watched.byteLength;
      }
      if (ranges.length > 0) { try { observer.notify(ranges); } catch (error) { errors.push(error); } }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Guest write observers failed");
    return undefined;
  }

  observeWrites(address: GuestAddress, byteLength: number, afterWrite: (ranges: readonly GuestWrittenRange[]) => void): () => void {
    const observer = { chunks: this.#chunks(address, byteLength, "read"), notify: afterWrite };
    this.#writeObservers.add(observer);
    return () => { this.#writeObservers.delete(observer); };
  }

  readUint8(address: GuestAddress): number { const field = this.#readView(address, 1); return field.view.getUint8(field.offset); }
  readInt8(address: GuestAddress): number { const field = this.#readView(address, 1); return field.view.getInt8(field.offset); }
  readUint16(address: GuestAddress): number { const field = this.#readView(address, 2); return field.view.getUint16(field.offset, true); }
  readInt16(address: GuestAddress): number { const field = this.#readView(address, 2); return field.view.getInt16(field.offset, true); }
  readUint32(address: GuestAddress): number { const field = this.#readView(address, 4); return field.view.getUint32(field.offset, true); }
  readInt32(address: GuestAddress): number { const field = this.#readView(address, 4); return field.view.getInt32(field.offset, true); }
  readUint64(address: GuestAddress): bigint { const field = this.#readView(address, 8); return field.view.getBigUint64(field.offset, true); }
  readInt64(address: GuestAddress): bigint { const field = this.#readView(address, 8); return field.view.getBigInt64(field.offset, true); }
  readFloat32(address: GuestAddress): number { const field = this.#readView(address, 4); return field.view.getFloat32(field.offset, true); }
  readFloat64(address: GuestAddress): number { const field = this.#readView(address, 8); return field.view.getFloat64(field.offset, true); }
  readPointer(address: GuestAddress): GuestAddress | null {
    return this.pointer(this.pointerBytes === 4 ? BigInt(this.readUint32(address)) : this.readUint64(address));
  }
  writeUint8(address: GuestAddress, value: number): undefined { return this.#writeScalar(address, 1, (view, offset) => view.setUint8(offset, value)); }
  writeInt8(address: GuestAddress, value: number): undefined { return this.#writeScalar(address, 1, (view, offset) => view.setInt8(offset, value)); }
  writeUint16(address: GuestAddress, value: number): undefined { return this.#writeScalar(address, 2, (view, offset) => view.setUint16(offset, value, true)); }
  writeInt16(address: GuestAddress, value: number): undefined { return this.#writeScalar(address, 2, (view, offset) => view.setInt16(offset, value, true)); }
  writeUint32(address: GuestAddress, value: number): undefined { return this.#writeScalar(address, 4, (view, offset) => view.setUint32(offset, value, true)); }
  writeInt32(address: GuestAddress, value: number): undefined { return this.#writeScalar(address, 4, (view, offset) => view.setInt32(offset, value, true)); }
  writeUint64(address: GuestAddress, value: bigint): undefined { return this.#writeScalar(address, 8, (view, offset) => view.setBigUint64(offset, value, true)); }
  writeInt64(address: GuestAddress, value: bigint): undefined { return this.#writeScalar(address, 8, (view, offset) => view.setBigInt64(offset, value, true)); }
  writeFloat32(address: GuestAddress, value: number): undefined { return this.#writeScalar(address, 4, (view, offset) => view.setFloat32(offset, value, true)); }
  writeFloat64(address: GuestAddress, value: number): undefined { return this.#writeScalar(address, 8, (view, offset) => view.setFloat64(offset, value, true)); }
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
    const overlapping = this.#mappings[this.#firstEndAfter(base)];
    if (overlapping !== undefined && overlapping.base < end) {
      this.#fault("overlap", base, byteLength, "map", "mapping overlaps an existing guest range");
    }
    return undefined;
  }
  #insert(mapping: Omit<Mapping, "view" | "active" | "end">): undefined {
    this.#mappingGeneration += 1;
    this.#mappings.splice(this.#firstEndAfter(mapping.base), 0, mappedBytes(mapping));
    return undefined;
  }
  #firstEndAfter(address: bigint): number {
    let low = 0, high = this.#mappings.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const mapping = this.#mappings[middle];
      if (mapping === undefined) throw new Error("Guest mapping index is inconsistent");
      if (mapping.end <= address) low = middle + 1;
      else high = middle;
    }
    return low;
  }
  #chunks(address: GuestAddress, byteLength: number, access: GuestAccess | null): Chunk[] {
    this.#owned(address, byteLength, access ?? "map");
    const recent = this.#recentMappings.get(access);
    if (byteLength > 0 && recent?.active === true && address.byteOffset >= recent.base && address.byteOffset + BigInt(byteLength) <= recent.end) {
      if (access !== null && !allows(recent.permissions, access)) this.#fault("permission", address.byteOffset, byteLength, access, `mapping '${recent.label}' permits ${recent.permissions}`);
      return [{ mapping: recent, offset: Number(address.byteOffset - recent.base), byteLength }];
    }
    const chunks: Chunk[] = [];
    let cursor = address.byteOffset;
    let remaining = byteLength;
    // Mappings are disjoint and sorted. Start at the first range whose end can
    // contain this address, retaining the same forward scan across aliases/holes.
    const low = this.#firstEndAfter(cursor);
    for (let index = low; index < this.#mappings.length; index++) {
      const mapping = this.#mappings[index];
      if (mapping === undefined) throw new Error("Guest mapping index is inconsistent");
      if (remaining === 0) break;
      const end = mapping.end;
      if (cursor >= end) continue;
      if (cursor < mapping.base) break;
      if (access !== null && !allows(mapping.permissions, access)) this.#fault("permission", cursor, remaining, access, `mapping '${mapping.label}' permits ${mapping.permissions}`);
      const offset = Number(cursor - mapping.base);
      const length = Math.min(remaining, mapping.byteLength - offset);
      chunks.push({ mapping, offset, byteLength: length });
      this.#remember(access, mapping);
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
    const first = chunks[0];
    if (chunks.length === 1 && first !== undefined) return first.mapping.bytes.slice(first.offset, first.offset + first.byteLength);
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
    const end = base + BigInt(byteLength), first = this.#firstEndAfter(base);
    const next: Mapping[] = [];
    let last = first;
    for (; last < this.#mappings.length; last++) {
      const mapping = this.#mappings[last];
      if (mapping === undefined) throw new Error("Guest mapping index is inconsistent");
      if (mapping.base >= end) break;
      mapping.active = false;
      const mappingEnd = mapping.end;
      const startOffset = Number((base > mapping.base ? base : mapping.base) - mapping.base);
      const endOffset = Number((end < mappingEnd ? end : mappingEnd) - mapping.base);
      if (startOffset > 0) next.push(mappedBytes({ ...mapping, byteLength: startOffset, bytes: mapping.bytes.subarray(0, startOffset) }));
      if (permissions !== null) next.push(mappedBytes({ ...mapping, base: mapping.base + BigInt(startOffset), byteLength: endOffset - startOffset,
        permissions, bytes: mapping.bytes.subarray(startOffset, endOffset) }));
      if (endOffset < mapping.byteLength) next.push(mappedBytes({ ...mapping, base: mapping.base + BigInt(endOffset), byteLength: mapping.byteLength - endOffset,
        bytes: mapping.bytes.subarray(endOffset) }));
    }
    if (permissions === null) {
      const touched = this.#mappings[first], previous = this.#mappings[first - 1];
      const gapStart = touched !== undefined && touched.base < base ? base
        : previous === undefined ? this.#allocationBase : previous.base + BigInt(previous.byteLength);
      const lowerBound = gapStart < this.#allocationBase ? this.#allocationBase : gapStart;
      for (const [alignment, hint] of this.#allocationHints) if (lowerBound < hint.base)
        this.#allocationHints.set(alignment, { ...hint, base: lowerBound });
    }
    this.#mappingGeneration += 1;
    if (next.length <= 3) this.#mappings.splice(first, last - first, ...next);
    else this.#mappings = this.#mappings.slice(0, first).concat(next, this.#mappings.slice(last));
    return undefined;
  }
  #remember(access: GuestAccess | null, mapping: Mapping): void {
    this.#recentMappings.set(access, mapping);
    this.#workingSet[this.#nextWorkingMapping] = mapping;
    this.#nextWorkingMapping = (this.#nextWorkingMapping + 1) & 7;
  }
  #singleMapping(address: GuestAddress, byteLength: number, access: GuestAccess): Mapping | null {
    const recent = this.#recentMappings.get(access);
    // A contained range inherits the mapping's checked address-space bounds.
    if (address.addressSpace === this.addressSpace && Number.isSafeInteger(byteLength) && byteLength > 0) {
      if (recent?.active === true) {
        const offset = Number(address.byteOffset - recent.base);
        if (offset >= 0 && offset + byteLength <= recent.byteLength) {
          if (!allows(recent.permissions, access)) this.#fault("permission", address.byteOffset, byteLength, access, `mapping '${recent.label}' permits ${recent.permissions}`);
          return recent;
        }
      }
      for (const candidate of this.#workingSet) {
        if (candidate === recent || !candidate.active) continue;
        const offset = Number(address.byteOffset - candidate.base);
        if (offset < 0 || offset + byteLength > candidate.byteLength) continue;
        if (!allows(candidate.permissions, access)) this.#fault("permission", address.byteOffset, byteLength, access, `mapping '${candidate.label}' permits ${candidate.permissions}`);
        this.#recentMappings.set(access, candidate);
        return candidate;
      }
    }
    this.#owned(address, byteLength, access);
    if (byteLength === 0) return null;
    const mapping = this.#mappings[this.#firstEndAfter(address.byteOffset)];
    if (mapping === undefined || address.byteOffset < mapping.base || address.byteOffset + BigInt(byteLength) > mapping.end) return null;
    if (!allows(mapping.permissions, access)) this.#fault("permission", address.byteOffset, byteLength, access, `mapping '${mapping.label}' permits ${mapping.permissions}`);
    this.#remember(access, mapping);
    return mapping;
  }
  #readView(address: GuestAddress, byteLength: number): { readonly view: DataView; readonly offset: number } {
    const mapping = this.#singleMapping(address, byteLength, "read");
    if (mapping !== null) return { view: mapping.view, offset: Number(address.byteOffset - mapping.base) };
    const bytes = this.#copyChunks(this.#chunks(address, byteLength, "read"), byteLength);
    return { view: new DataView(bytes.buffer, bytes.byteOffset, byteLength), offset: 0 };
  }
  #writeScalar(address: GuestAddress, byteLength: number, write: (view: DataView, offset: number) => void): undefined {
    const mapping = this.#singleMapping(address, byteLength, "write");
    if (mapping !== null) {
      const offset = Number(address.byteOffset - mapping.base);
      write(mapping.view, offset);
      return this.#writeObservers.size === 0 ? undefined : this.#notifyWrite([{ mapping, offset, byteLength }]);
    }
    const chunks = this.#chunks(address, byteLength, "write"), bytes = new Uint8Array(byteLength);
    write(new DataView(bytes.buffer), 0);
    return this.#commitWrite(chunks, bytes);
  }
}
