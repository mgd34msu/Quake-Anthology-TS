// SPDX-License-Identifier: GPL-2.0-or-later
import { allocateNativeMemory, nativeAllocationBytes } from "../../../guest/runtime/common/memory.ts";
import type { GuestAddress, RawEntityView } from "../../../contracts/execution.ts";
import type { ActorId, OwnedActor, ProviderId } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { MappedGuestMemory } from "../../../guest/core/contracts.ts";
import type { SessionActorRegistry } from "../../../world/actors/registry.ts";
import { CLASSIC_Q2_CLIENT_PREFIX_BYTES, CLASSIC_Q2_EDICT_BYTES, CLASSIC_Q2_EDICT_LAYOUT, CLASSIC_Q2_EXPORT_BYTES } from "./layout.ts";

export function readClassicString(memory: MappedGuestMemory, address: GuestAddress | null, maximum = 65536): string {
  if (address === null) return "";
  let text = "";
  for (let index = 0; index < maximum; index++) {
    const byte = memory.readUint8(memory.offset(address, BigInt(index)));
    if (byte === 0) return text;
    text += String.fromCharCode(byte);
  }
  throw new RangeError(`Unterminated API 3 string at 0x${address.byteOffset.toString(16)}`);
}
export function writeClassicString(memory: MappedGuestMemory, address: GuestAddress, text: string, capacity: number): undefined {
  if (text.length + 1 > capacity || text.includes("\0")) throw new RangeError("API 3 string exceeds its guest allocation");
  const bytes = new Uint8Array(text.length + 1);
  for (let index = 0; index < text.length; index++) {
    const value = text.charCodeAt(index);
    if (value > 255) throw new RangeError("API 3 strings require source byte characters");
    bytes[index] = value;
  }
  return memory.write(address, bytes);
}
export function allocateClassicString(memory: MappedGuestMemory, text: string): GuestAddress {
  // The source MSVC string routines load full words containing the terminator.
  const address = allocateNativeMemory(memory, text.length + 1, "API 3 string");
  writeClassicString(memory, address, text, text.length + 1);
  return address;
}
export function classicStringAllocationBytes(text: string): number { return nativeAllocationBytes(text.length + 1); }
export function readClassicVector(memory: MappedGuestMemory, address: GuestAddress): Vec3 {
  return memory.readFloat32Vector(address);
}
export function writeClassicVector(memory: MappedGuestMemory, address: GuestAddress, vector: Vec3): undefined {
  const bytes = new Uint8Array(12), view = new DataView(bytes.buffer);
  view.setFloat32(0, vector.x, true); view.setFloat32(4, vector.y, true); view.setFloat32(8, vector.z, true);
  return memory.write(address, bytes);
}

export interface ClassicQ2EdictDescriptor { readonly base: GuestAddress; readonly stride: number; readonly count: number; readonly capacity: number }
export interface ClassicQ2ActorProjection {
  project(record: RawEntityView): OwnedActor | null;
  address(actor: ActorId): GuestAddress;
}

/** Reads the DLL's current export descriptor and borrows complete source-owned edicts. */
export class ClassicQ2Edicts {
  readonly #retainedClients = new Set<number>();
  readonly #retiredInputClients = new Set<number>();
  retireInputClient(slot: number): void { this.#retiredInputClients.add(slot); }
  finishInputRetirement(slot: number): void { this.#retiredInputClients.delete(slot); }
  constructor(readonly memory: MappedGuestMemory, readonly exports: GuestAddress, readonly actors: SessionActorRegistry,
    readonly provider: ProviderId, readonly bind: (record: RawEntityView, actor: OwnedActor) => undefined,
    readonly projection?: ClassicQ2ActorProjection) {
    memory.check(exports, CLASSIC_Q2_EXPORT_BYTES, "read");
    if (memory.readInt32(exports) !== 3) throw new RangeError("GetGameAPI returned an API version other than 3");
  }
  descriptor(): ClassicQ2EdictDescriptor {
    const base = this.memory.readPointer(this.memory.offset(this.exports, 64n));
    const stride = this.memory.readInt32(this.memory.offset(this.exports, 68n));
    const count = this.memory.readInt32(this.memory.offset(this.exports, 72n));
    const capacity = this.memory.readInt32(this.memory.offset(this.exports, 76n));
    if (base === null) throw new Error("API 3 edicts are not allocated; Init has not completed");
    if (stride < CLASSIC_Q2_EDICT_BYTES || stride % 4 !== 0 || count < 0 || capacity < count || capacity > 65536) throw new RangeError("Invalid source API 3 edict descriptor");
    this.memory.check(base, stride * capacity, "read");
    return { base, stride, count, capacity };
  }
  at(slot: number): RawEntityView {
    const { base, stride, count } = this.descriptor();
    if (!Number.isInteger(slot) || slot < 0 || slot >= count) throw new RangeError("API 3 edict slot exceeds num_edicts");
    const address = this.memory.offset(base, BigInt(slot * stride));
    const record: RawEntityView = { module: this.memory.module, slot, address, strideBytes: stride, publicLayout: CLASSIC_Q2_EDICT_LAYOUT,
      bytes: this.memory.borrow(address, stride), currentActor: () => this.projection === undefined
        ? this.actors.atSource(this.provider, slot)?.id ?? null : this.projection.project(record)?.id ?? null };
    return record;
  }
  fromPointer(address: GuestAddress): RawEntityView {
    if (address.addressSpace !== this.memory.addressSpace) throw new RangeError("Foreign guest edict address space");
    const descriptor = this.descriptor(), difference = address.byteOffset - descriptor.base.byteOffset;
    if (difference < 0n || difference % BigInt(descriptor.stride) !== 0n) throw new RangeError("Pointer does not identify the start of an API 3 edict");
    return this.at(Number(difference / BigInt(descriptor.stride)));
  }
  /** Primary callers resolve existing authority without reviving a retired input slot. */
  current(record: RawEntityView): OwnedActor | null {
    if (this.#retiredInputClients.has(record.slot)) return null;
    const current = this.at(record.slot);
    if (current.address.byteOffset !== record.address.byteOffset || current.address.addressSpace !== record.address.addressSpace) return null;
    if (current.bytes.getInt32(88, true) === 0 && !this.#retainedClients.has(record.slot)) return null;
    return this.actors.atSource(this.provider, record.slot);
  }
  pointer(actor: ActorId): GuestAddress {
    if (this.projection !== undefined) return this.projection.address(actor);
    const source = this.actors.sourceOf(actor);
    if (source === null || source.provider !== this.provider) throw new Error("Foreign actor requires an explicit native semantic edict adapter");
    return this.at(source.slot).address;
  }
  observe(address: GuestAddress): OwnedActor | null {
    if (this.#retiredInputClients.size !== 0 && this.#retiredInputClients.has(this.fromPointer(address).slot)) return null;
    if (this.projection !== undefined) return this.projection.project(this.fromPointer(address));
    const record = this.fromPointer(address), existing = this.actors.atSource(this.provider, record.slot);
    if (record.bytes.getInt32(88, true) === 0 && !this.#retainedClients.has(record.slot)) {
      if (existing !== null) this.actors.release(existing);
      return null;
    }
    if (existing !== null) return existing;
    const actor = this.actors.allocateAtSource(this.provider, record.slot, "q2-native:edict");
    try { this.bind(record, actor); }
    catch (error) { this.actors.release(actor); throw error; }
    return actor;
  }
  retainClient(slot: number): OwnedActor {
    if (!Number.isInteger(slot) || slot < 1) throw new RangeError("Invalid retained API 3 client slot");
    const record = this.at(slot);
    this.#retainedClients.add(slot);
    const actor = this.observe(record.address);
    if (actor === null) throw new Error("Retained source client has no actor");
    return actor;
  }
  releaseClient(slot: number): undefined {
    this.#retainedClients.delete(slot);
    this.observe(this.at(slot).address);
    return undefined;
  }
  reconcile(): undefined {
    if (this.projection !== undefined) return undefined;
    const descriptor = this.descriptor();
    for (const actor of this.actors.ownedBy(this.provider)) {
      const source = this.actors.sourceOf(actor.id);
      if (source !== null && source.slot >= descriptor.count) this.actors.release(actor);
    }
    for (let slot = 0; slot < descriptor.count; slot++) this.observe(this.at(slot).address);
    return undefined;
  }
  clientPrefix(slot: number): DataView | null {
    const record = this.at(slot), address = this.memory.readPointer(this.memory.offset(record.address, 84n));
    return address === null ? null : this.memory.borrow(address, CLASSIC_Q2_CLIENT_PREFIX_BYTES);
  }
  setClientPing(slot: number, ping: number): undefined {
    const prefix = this.clientPrefix(slot);
    if (prefix === null) throw new RangeError("Edict has no API 3 client prefix");
    prefix.setInt32(184, ping, true);
    return undefined;
  }
}
