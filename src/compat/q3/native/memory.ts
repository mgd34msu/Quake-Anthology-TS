// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress } from "../../../contracts/execution.ts";
import { CommonError } from "../../../core/common-error.ts";
import { GuestMemoryFault } from "../../../guest/core/index.ts";
import type { MappedGuestMemory } from "../../../guest/core/index.ts";
import { readString } from "../../../guest/runtime/common/memory.ts";
import type { Q3GameMemory } from "../../qvm/game-memory.ts";

const writers = ["setInt8", "setUint8", "setInt16", "setUint16", "setInt32", "setUint32", "setFloat32", "setFloat64", "setBigInt64", "setBigUint64"] as const;

/** A view of a copy of bytes the module mapped read-only. Reads see them; a store through it faults, as a store to those pages does in the module's own process. */
function readOnlyView(buffer: ArrayBufferLike, byteOffset: number, byteLength: number): DataView {
  const view = new DataView(buffer, byteOffset, byteLength);
  for (const name of writers) Object.defineProperty(view, name, { value: () => { throw new RangeError("Native module memory is read-only"); } });
  return view;
}

/**
 * Pointer arguments of a native i386 game module: absolute 32-bit addresses in its guest process, not offsets into one allocation.
 * Regions in read-only mappings are copies that refuse stores.
 */
export class NativeGameMemory implements Q3GameMemory {
  private readonly readOnly = new WeakSet<Uint8Array>();
  constructor(readonly memory: MappedGuestMemory) {
    if (memory.pointerBytes !== 4) throw new RangeError("Q3 game pointer arguments are 32-bit words; later intptr_t profiles need their own memory");
  }

  private at(word: number): GuestAddress | null {
    if (!Number.isInteger(word) || word < -0x80000000 || word > 0xffffffff) throw new RangeError("Native game pointer must be a 32-bit word");
    return this.memory.pointer(BigInt(word >>> 0));
  }
  private required(word: number): GuestAddress {
    const address = this.at(word);
    if (address === null) throw new RangeError("Native game memory span requires a nonnull pointer");
    return address;
  }
  private bytes(address: GuestAddress, length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0) throw new RangeError("Native game memory length is invalid");
    try {
      const view = this.memory.borrow(address, length);
      return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    } catch (error) {
      if (!(error instanceof GuestMemoryFault) || error.reason !== "permission") throw error;
      const copy = this.memory.copy(address, length);
      this.readOnly.add(copy);
      return copy;
    }
  }
  private writable(region: Uint8Array): Uint8Array {
    if (this.readOnly.has(region)) throw new RangeError("Native module memory is read-only");
    return region;
  }

  address(word: number): number | null {
    const address = this.at(word);
    return address === null ? null : Number(address.byteOffset);
  }
  pointerWord(address: number | null): number { return address === null ? 0 : address | 0; }
  viewAt(address: number, length: number): DataView {
    const pointer = this.required(address | 0), bytes = this.bytes(pointer, length);
    return this.readOnly.has(bytes) ? readOnlyView(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  pointer(word: number): Uint8Array | null {
    const address = this.at(word);
    if (address === null) return null;
    const mapping = this.memory.mappings().find(candidate => candidate.base <= address.byteOffset && address.byteOffset < candidate.base + BigInt(candidate.byteLength));
    if (mapping === undefined) throw new RangeError("Native game pointer is not mapped");
    return this.bytes(address, Number(mapping.base + BigInt(mapping.byteLength) - address.byteOffset));
  }
  span(word: number, length: number, relativeOffset = 0): Uint8Array {
    const base = this.required(word);
    return this.bytes(relativeOffset === 0 ? base : this.memory.offset(base, BigInt(relativeOffset)), length);
  }
  view(word: number, length: number, relativeOffset = 0): DataView {
    const base = this.required(word), address = relativeOffset === 0 ? base : this.memory.offset(base, BigInt(relativeOffset));
    return this.viewAt(Number(address.byteOffset), length);
  }
  readString(word: number): string {
    const address = this.at(word);
    if (address === null) throw new RangeError("Native game string requires a nonnull pointer");
    return readString(this.memory, address);
  }
  /** Q_strncpyz into guest memory: at most capacity - 1 characters and a terminator, the rest of the capacity zeroed. */
  writeString(word: number, text: string, capacity: number): void {
    const address = this.at(word);
    if (address === null) throw new CommonError("fatal", "Q_strncpyz: NULL dest");
    if (!Number.isInteger(capacity) || capacity < 1) throw new CommonError("fatal", "Q_strncpyz: destsize < 1");
    const bytes = this.writable(this.bytes(address, capacity)), end = Math.min(text.length, capacity - 1);
    bytes.fill(0);
    for (let index = 0; index < end; index++) bytes[index] = text.charCodeAt(index) & 255;
  }

  regionView(region: Uint8Array, offset = 0, length = region.byteLength - offset): DataView {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > region.byteLength) throw new RangeError("Native game region view exceeds its region");
    return this.readOnly.has(region) ? readOnlyView(region.buffer, region.byteOffset + offset, length) : new DataView(region.buffer, region.byteOffset + offset, length);
  }
  regionWrite(region: Uint8Array, bytes: Uint8Array): void { this.writable(region).set(bytes); }
  regionFill(region: Uint8Array, start: number, length: number, value: number): void {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0 || start + length > region.byteLength) throw new RangeError("Native game region fill exceeds its region");
    this.writable(region).fill(value & 255, start, start + length);
  }
}
