// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress } from "../../contracts/execution.ts";
import type { MappedGuestMemory } from "../../guest/core/contracts.ts";
import { allocateNativeMemory, nativeAllocationBytes } from "../../guest/runtime/common/memory.ts";

export function latin1Bytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) bytes[index] = text.charCodeAt(index) & 255;
  return bytes;
}

function terminated(bytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(bytes.length + 1);
  result.set(bytes);
  return result;
}

/** One guest string that is rewritten in place and moves only when a value outgrows its pages. */
export class ReusableGuestString {
  #address: GuestAddress | null = null;
  #capacity = 0;
  #text: string | null = null;
  constructor(
    readonly memory: MappedGuestMemory,
    readonly label: string,
  ) {}
  setText(text: string, encode: (text: string) => Uint8Array): GuestAddress {
    if (this.#address !== null && this.#text === text) return this.#address;
    const address = this.set(encode(text));
    this.#text = text;
    return address;
  }
  set(bytes: Uint8Array): GuestAddress {
    this.#text = null;
    if (this.#address === null || bytes.length + 1 > this.#capacity) {
      // The outgrown block stays mapped: a guest may still hold the old pointer, and growth is rare.
      this.#address = allocateNativeMemory(this.memory, bytes.length + 1, this.label, true);
      this.#capacity = nativeAllocationBytes(bytes.length + 1);
    }
    this.memory.write(this.#address, terminated(bytes));
    return this.#address;
  }
}

/**
 * Command text such as argv and args is valid until the next command, as in the engines' static buffers.
 * Strings of the previous command are unmapped when a different command is read.
 */
export class CommandGuestStrings {
  #key: string | null = null;
  readonly #strings = new Map<string, GuestAddress>();
  readonly #blocks: { readonly address: GuestAddress; readonly bytes: number }[] = [];
  constructor(
    readonly memory: MappedGuestMemory,
    readonly label: string,
    readonly encode: (text: string) => Uint8Array,
  ) {}
  get(command: string, text: string): GuestAddress {
    if (command !== this.#key) {
      for (const block of this.#blocks) this.memory.unmap(block.address, block.bytes);
      this.#blocks.length = 0;
      this.#strings.clear();
      this.#key = command;
    }
    const previous = this.#strings.get(text);
    if (previous !== undefined) return previous;
    const bytes = this.encode(text),
      address = allocateNativeMemory(this.memory, bytes.length + 1, this.label, true);
    this.memory.write(address, terminated(bytes));
    this.#blocks.push({ address, bytes: nativeAllocationBytes(bytes.length + 1) });
    this.#strings.set(text, address);
    return address;
  }
}
