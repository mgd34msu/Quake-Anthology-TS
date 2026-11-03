// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress } from "../../../contracts/execution.ts";
import type { CvarRegistry, CvarSnapshot } from "../../../core/cvars/index.ts";
import type { MappedGuestMemory } from "../../../guest/core/contracts.ts";
import { Q2CvarFlag } from "../../../core/cvars/index.ts";
import { ReusableGuestString, latin1Bytes } from "../guest-strings.ts";
import { allocateClassicString } from "./records.ts";

interface GuestCvar {
  readonly address: GuestAddress;
  readonly string: GuestAddress; readonly latched: GuestAddress; readonly flags: GuestAddress;
  readonly modified: GuestAddress; readonly value: GuestAddress; readonly next: GuestAddress;
  readonly text: ReusableGuestString; readonly latchedText: ReusableGuestString;
}

/** Native cvar_t is a stable guest view of the engine's existing registry. */
export class ClassicQ2Cvars {
  readonly #records = new Map<string, GuestCvar>();
  readonly #strings = new Map<string, GuestAddress>();
  readonly #applied = new Map<string, CvarSnapshot>();
  readonly #chain: GuestCvar[] = [];
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
        value: this.memory.offset(address, 20n), next: this.memory.offset(address, 24n),
        text: new ReusableGuestString(this.memory, `API 3 cvar ${state.name} value`), latchedText: new ReusableGuestString(this.memory, `API 3 cvar ${state.name} latched`) };
      this.#records.set(state.name, record);
    }
    this.memory.writePointer(record.address, this.string(state.name));
    // Private cvars (rcon passwords) exist for the guest but never reveal their contents.
    const hidden = (state.flags & Q2CvarFlag.Private) !== 0;
    this.memory.writePointer(record.string, record.text.setText(hidden ? "" : state.value, latin1Bytes));
    this.memory.writePointer(record.latched, state.latchedValue === undefined || hidden ? null : record.latchedText.setText(state.latchedValue, latin1Bytes));
    this.memory.writeInt32(record.flags, state.flags);
    this.memory.writeInt32(record.modified, Number(state.modified));
    this.memory.writeFloat32(record.value, hidden ? 0 : state.numericValue);
    return record;
  }
  /** Only cvars whose snapshot changed are rewritten; the chain is relinked when membership or order changes. */
  refresh(): undefined {
    const states = this.registry.snapshots();
    let relink = states.length !== this.#chain.length;
    for (const [index, state] of states.entries()) {
      let record = this.#records.get(state.name);
      if (record === undefined || this.#applied.get(state.name) !== state) { record = this.update(state); this.#applied.set(state.name, state); }
      if (this.#chain[index] !== record) { this.#chain[index] = record; relink = true; }
    }
    this.#chain.length = states.length;
    if (relink) for (const [index, record] of this.#chain.entries()) this.memory.writePointer(record.next, this.#chain[index + 1]?.address ?? null);
    return undefined;
  }
}
