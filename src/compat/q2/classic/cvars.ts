// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress } from "../../../contracts/execution.ts";
import type { CvarRegistry, CvarSnapshot } from "../../../core/cvars/index.ts";
import type { MappedGuestMemory } from "../../../guest/core/contracts.ts";
import { allocateClassicString } from "./records.ts";

/** Native cvar_t is a stable guest view of the engine's existing registry. */
export class ClassicQ2Cvars {
  readonly #records = new Map<string, GuestAddress>();
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
    return this.#records.get(state.name) ?? null;
  }
  private update(state: CvarSnapshot): GuestAddress {
    let address = this.#records.get(state.name);
    if (address === undefined) {
      address = this.memory.allocate({ byteLength: 28, label: `API 3 cvar ${state.name}` });
      this.#records.set(state.name, address);
    }
    this.memory.writePointer(address, this.string(state.name));
    this.memory.writePointer(this.memory.offset(address, 4n), this.string(state.value));
    this.memory.writePointer(this.memory.offset(address, 8n), state.latchedValue === undefined ? null : this.string(state.latchedValue));
    this.memory.writeInt32(this.memory.offset(address, 12n), state.flags);
    this.memory.writeInt32(this.memory.offset(address, 16n), Number(state.modified));
    this.memory.writeFloat32(this.memory.offset(address, 20n), state.numericValue);
    return address;
  }
  refresh(): undefined {
    const pointers = this.registry.snapshots().map(state => this.update(state));
    for (const [index, address] of pointers.entries()) this.memory.writePointer(this.memory.offset(address, 24n), pointers[index + 1] ?? null);
    return undefined;
  }
}
