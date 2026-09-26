// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress } from "../../../contracts/execution.ts";
import type { CvarRegistry, CvarSnapshot } from "../../../core/cvars/index.ts";
import type { MappedGuestMemory } from "../../../guest/core/contracts.ts";
import { allocateClassicString } from "./records.ts";

interface GuestCvar {
  readonly address: GuestAddress;
  readonly string: GuestAddress; readonly latched: GuestAddress; readonly flags: GuestAddress;
  readonly modified: GuestAddress; readonly value: GuestAddress; readonly next: GuestAddress;
}

/** Native cvar_t is a stable guest view of the engine's existing registry. */
export class ClassicQ2Cvars {
  readonly #records = new Map<string, GuestCvar>();
  readonly #strings = new Map<string, GuestAddress>();
  constructor(readonly memory: MappedGuestMemory, readonly registry: CvarRegistry) {}
  string(value: string): GuestAddress {
    const previous = this.#strings.get(value);
    if (previous !== undefined) return previous;
    const address = allocateClassicString(this.memory, value);
    this.#strings.set(value, address);
    return address;
  }
  pointer(name: string): GuestAddress | null {
    const state = this.registry.find(name);
    if (state === undefined) return null;
    this.refresh();
    return this.#records.get(state.name)?.address ?? null;
  }
  private update(state: CvarSnapshot): GuestCvar {
    let record = this.#records.get(state.name);
    if (record === undefined) {
      const address = this.memory.allocate({ byteLength: 28, label: `API 3 cvar ${state.name}` });
      record = { address, string: this.memory.offset(address, 4n), latched: this.memory.offset(address, 8n),
        flags: this.memory.offset(address, 12n), modified: this.memory.offset(address, 16n),
        value: this.memory.offset(address, 20n), next: this.memory.offset(address, 24n) };
      this.#records.set(state.name, record);
    }
    this.memory.writePointer(record.address, this.string(state.name));
    this.memory.writePointer(record.string, this.string(state.value));
    this.memory.writePointer(record.latched, state.latchedValue === undefined ? null : this.string(state.latchedValue));
    this.memory.writeInt32(record.flags, state.flags);
    this.memory.writeInt32(record.modified, Number(state.modified));
    this.memory.writeFloat32(record.value, state.numericValue);
    return record;
  }
  refresh(): undefined {
    const pointers = this.registry.snapshots().map(state => this.update(state));
    for (const [index, record] of pointers.entries()) this.memory.writePointer(record.next, pointers[index + 1]?.address ?? null);
    return undefined;
  }
}
