// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, GuestCallContext, GuestCallResult, GuestCallValue, GuestValueLayout } from "../../contracts/execution.ts";
import type { CallbackId } from "../../contracts/identity.ts";
import type { GuestCallSignature, GuestHostCallback, MappedGuestMemory } from "./contracts.ts";

export interface SavedHostCallbackAddress {
  readonly id: CallbackId;
  readonly byteOffset: bigint;
  readonly signature: GuestCallSignature;
  readonly binding: "bound" | "unbound";
}
interface CallbackEntry extends Omit<SavedHostCallbackAddress, "binding"> {
  readonly address: GuestAddress;
  callback: GuestHostCallback | null;
  readonly accepts?: () => boolean;
}

/** Host callbacks have guest-owned trap addresses, never host function pointers. */
export class GuestCallbackTable {
  readonly #byId = new Map<CallbackId, CallbackEntry>();
  readonly #byAddress = new Map<bigint, CallbackEntry>();
  readonly #entryObservers = new Map<bigint, Set<() => void>>();
  constructor(readonly memory: MappedGuestMemory) {}

  /** Host-owned native entry hooks leave the guest instruction bytes untouched. */
  bindEntry(address: GuestAddress, callback: GuestHostCallback, accepts: () => boolean): () => void {
    this.memory.check(address, 1, "execute");
    if (callback.signature.abi.pointerBytes !== this.memory.pointerBytes || this.#byAddress.has(address.byteOffset)) throw new Error("Invalid or occupied native callback entry");
    const entry: CallbackEntry = { id: callback.id, signature: callback.signature, address, byteOffset: address.byteOffset, callback, accepts };
    this.#byAddress.set(address.byteOffset, entry);
    return () => { if (this.#byAddress.get(address.byteOffset) === entry) this.#byAddress.delete(address.byteOffset); };
  }

  observeEntry(address: GuestAddress, before: () => void): () => void {
    this.memory.check(address, 1, "execute");
    let observers = this.#entryObservers.get(address.byteOffset);
    if (observers === undefined) { observers = new Set<() => void>(); this.#entryObservers.set(address.byteOffset, observers); }
    const owned = observers; owned.add(before);
    return () => { owned.delete(before); if (owned.size === 0 && this.#entryObservers.get(address.byteOffset) === owned) this.#entryObservers.delete(address.byteOffset); };
  }

  /** Called once at instruction entry; ABI lookup must not notify observers again. */
  enter(address: GuestAddress): boolean {
    const observers = this.#entryObservers.get(address.byteOffset);
    if (observers !== undefined) for (const observer of [...observers]) if (observers.has(observer)) observer();
    return this.resolve(address) !== null;
  }

  bind(callback: GuestHostCallback): GuestAddress {
    if (callback.signature.abi.pointerBytes !== this.memory.pointerBytes) throw new RangeError("Callback ABI differs from its guest address space");
    const previous = this.#byId.get(callback.id);
    if (previous !== undefined) {
      if (previous.callback !== null && previous.callback !== callback) throw new Error(`Callback ${callback.id} is already bound`);
      if (!sameSignature(previous.signature, callback.signature)) throw new Error(`Callback ${callback.id} changed ABI or signature`);
      previous.callback = callback;
      return previous.address;
    }
    // INT3 is a trap if the CPU misses the table dispatch. No native executable memory is allocated.
    const address = this.memory.allocate({ byteLength: 16, alignment: 16n, permissions: "read-write", label: `callback ${callback.id}` });
    this.memory.write(address, new Uint8Array(16).fill(0xcc));
    this.memory.protect(address, 16, "read-execute");
    const entry: CallbackEntry = { id: callback.id, signature: callback.signature, address, byteOffset: address.byteOffset, callback };
    this.#byId.set(callback.id, entry);
    this.#byAddress.set(address.byteOffset, entry);
    return address;
  }

  unbind(id: CallbackId): undefined {
    const entry = this.#byId.get(id);
    if (entry !== undefined) entry.callback = null;
    return undefined;
  }

  address(id: CallbackId): GuestAddress | null { return this.#byId.get(id)?.address ?? null; }

  resolve(address: GuestAddress): GuestHostCallback | null {
    this.memory.check(address, 1, "execute");
    const entry = this.#byAddress.get(address.byteOffset);
    if (entry === undefined) return null;
    if (entry.accepts !== undefined && !entry.accepts()) return null;
    if (entry.callback === null) throw new Error(`Guest callback ${entry.id} at 0x${entry.byteOffset.toString(16)} is unbound`);
    return entry.callback;
  }

  invoke(address: GuestAddress, context: GuestCallContext, arguments_: readonly GuestCallValue[]): GuestCallResult {
    const callback = this.resolve(address);
    if (callback === null) throw new Error(`No host callback at guest address 0x${address.byteOffset.toString(16)}`);
    return callback.invoke(context, arguments_);
  }

  checkpoint(): readonly SavedHostCallbackAddress[] {
    return [...this.#byId.values()].map(({ id, byteOffset, signature, callback }) => ({ id, byteOffset, signature, binding: callback === null ? "unbound" : "bound" }));
  }

  static restore(memory: MappedGuestMemory, saved: readonly SavedHostCallbackAddress[], resolve: (id: CallbackId) => GuestHostCallback | null): GuestCallbackTable {
    const table = new GuestCallbackTable(memory);
    for (const record of saved) {
      if (table.#byId.has(record.id) || table.#byAddress.has(record.byteOffset)) throw new Error("Duplicate restored guest callback identity or address");
      const address = memory.pointer(record.byteOffset);
      if (address === null) throw new Error("Guest callback cannot have a null address");
      memory.check(address, 16, "execute");
      if (record.signature.abi.pointerBytes !== memory.pointerBytes) throw new Error("Saved callback ABI differs from the restored address space");
      const callback = record.binding === "bound" ? resolve(record.id) : null;
      if (record.binding === "bound" && callback === null) throw new Error(`Missing restored host callback ${record.id}`);
      if (callback !== null && (callback.id !== record.id || !sameSignature(callback.signature, record.signature))) {
        throw new Error(`Restored callback ${record.id} has a different identity or signature`);
      }
      const entry: CallbackEntry = { ...record, address, callback };
      table.#byId.set(record.id, entry);
      table.#byAddress.set(record.byteOffset, entry);
    }
    return table;
  }
}

function sameSignature(left: GuestCallSignature, right: GuestCallSignature): boolean {
  return left.abi.kind === right.abi.kind && left.abi.call === right.abi.call && left.variadic === right.variadic
    && left.parameters.length === right.parameters.length && left.parameters.every((value, index) => {
      const other = right.parameters[index];
      return other !== undefined && sameValueLayout(value, other);
    }) && (left.result === "void" ? right.result === "void" : right.result !== "void" && sameValueLayout(left.result, right.result));
}
function sameValueLayout(left: GuestValueLayout, right: GuestValueLayout): boolean {
  if (left.kind === "scalar") return right.kind === "scalar" && left.storage === right.storage;
  if (right.kind !== "aggregate") return false;
  const a = left.layout;
  const b = right.layout;
  return a.id === b.id && a.byteLength === b.byteLength && a.alignment === b.alignment && a.pointerBytes === b.pointerBytes
    && a.byteOrder === b.byteOrder && a.fields.length === b.fields.length && a.fields.every((field, index) => {
      const other = b.fields[index];
      return other !== undefined && field.name === other.name && field.byteOffset === other.byteOffset && field.storage === other.storage && field.count === other.count;
    });
}
