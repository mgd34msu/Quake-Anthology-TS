// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, GuestCallResult } from "../../../contracts/execution.ts";
import type { CvarRegistry, CvarSnapshot } from "../../../core/cvars/index.ts";
import type { MappedGuestMemory } from "../../../guest/core/contracts.ts";
import { integer, pointer, requiredPointer } from "../../../guest/runtime/common/memory.ts";
import { cvarLayout, fieldOffset } from "./layouts.ts";
import type { RereleaseImportCall } from "./module.ts";
import { guestInt, guestPointer, MissingRereleaseImport } from "./module.ts";

export function readGuestString(memory: MappedGuestMemory, address: GuestAddress, maximum = 1_048_576): string {
  for (let length = 0; length < maximum; length++) if (memory.readUint8(memory.offset(address, BigInt(length))) === 0) return new TextDecoder().decode(memory.copy(address, length));
  throw new RangeError("Q2 guest string has no terminator within its source limit");
}
export interface RereleaseCoreServices {
  readonly cvars: CvarRegistry;
  print(text: string): undefined;
  getConfigstring(index: number): string;
  setConfigstring(index: number, value: string): undefined;
  resourceIndex(kind: "model" | "sound" | "image", name: string): number;
  serverFrame(): number;
  commandArguments(): readonly string[];
  commandTail(): string;
  addCommand(text: string): undefined;
  extension(name: string, api: "game" | "cgame"): GuestAddress | null;
  /** Transport, localization, rendering and optional APIs retain their exact typed ABI call. */
  invoke?(call: RereleaseImportCall): GuestCallResult | undefined;
}
interface Allocation { readonly address: GuestAddress; readonly size: number; readonly tag: number; }
interface GuestCvar { readonly address: GuestAddress; readonly name: string; }
/** Guest cvar records mirror one session registry; tagged bytes remain source-owned. */
export class RereleaseCoreImports {
  readonly #allocations = new Map<bigint, Allocation>();
  readonly #strings = new Map<string, GuestAddress>();
  readonly #cvars = new Map<string, GuestCvar>();
  #lastCvar: GuestAddress | null = null;
  constructor(readonly memory: MappedGuestMemory, readonly services: RereleaseCoreServices) {}
  string(text: string): GuestAddress {
    const previous = this.#strings.get(text);
    if (previous !== undefined) return previous;
    const bytes = new TextEncoder().encode(text);
    const address = this.memory.allocate({ byteLength: bytes.length + 1, label: "Q2 engine string" });
    this.memory.write(address, bytes);
    this.#strings.set(text, address);
    return address;
  }
  refreshCvars(): void {
    for (const record of this.#cvars.values()) { const value = this.services.cvars.get(record.name); if (value !== undefined) this.#writeCvar(record, value); }
  }
  #writeCvar(record: GuestCvar, value: CvarSnapshot): void {
    const at = (name: string) => this.memory.offset(record.address, BigInt(fieldOffset(cvarLayout, name)));
    this.memory.writePointer(at("string"), this.string(value.value));
    this.memory.writePointer(at("latched_string"), value.latchedValue === undefined ? null : this.string(value.latchedValue));
    this.memory.writeUint32(at("flags"), value.flags);
    this.memory.writeInt32(at("modified_count"), value.modificationCount || 1);
    this.memory.writeFloat32(at("value"), value.numericValue);
    this.memory.writeInt32(at("integer"), value.integerValue);
  }
  cvar(value: CvarSnapshot | undefined): GuestAddress | null {
    if (value === undefined) return null;
    let record = this.#cvars.get(value.name);
    if (record === undefined) {
      const address = this.memory.allocate({ byteLength: cvarLayout.byteLength, alignment: 8n, label: `Q2 cvar ${value.name}` });
      record = { name: value.name, address };
      this.memory.writePointer(address, this.string(value.name));
      this.memory.writePointer(this.memory.offset(address, BigInt(fieldOffset(cvarLayout, "next"))), this.#lastCvar);
      this.#lastCvar = address;
      this.#cvars.set(value.name, record);
    }
    this.#writeCvar(record, value);
    return record.address;
  }
  free(address: GuestAddress | null): void {
    if (address === null) return;
    this.memory.check(address, 1, "write");
    const record = this.#allocations.get(address.byteOffset);
    if (record === undefined) throw new Error("Q2 TagFree received an unowned or already freed allocation");
    this.memory.unmap(address, record.size);
    this.#allocations.delete(address.byteOffset);
  }
  invoke(call: RereleaseImportCall): GuestCallResult {
    const supplied = this.services.invoke?.(call);
    if (supplied !== undefined) return supplied;
    const args = call.arguments;
    const text = (index: number) => readGuestString(this.memory, requiredPointer(args, index));
    const number = (index: number) => Number(integer(args, index));
    switch (call.name) {
      case "Com_Print": this.services.print(text(0)); return { kind: "void" };
      case "Com_Error": throw new Error(`Q2 ${call.api}: ${text(0)}`);
      case "get_configstring": return guestPointer(this.string(this.services.getConfigstring(number(0))));
      case "configstring": { const value = pointer(args, 1); this.services.setConfigstring(number(0), value === null ? "" : readGuestString(this.memory, value)); return { kind: "void" }; }
      case "modelindex": return guestInt(this.services.resourceIndex("model", text(0)));
      case "soundindex": return guestInt(this.services.resourceIndex("sound", text(0)));
      case "imageindex": return guestInt(this.services.resourceIndex("image", text(0)));
      case "ServerFrame": return { kind: "uint32", value: this.services.serverFrame() };
      case "argc": return guestInt(this.services.commandArguments().length);
      case "argv": return guestPointer(this.string(this.services.commandArguments()[number(0)] ?? ""));
      case "args": return guestPointer(this.string(this.services.commandTail()));
      case "AddCommandString": this.services.addCommand(text(0)); return { kind: "void" };
      case "GetExtension": return guestPointer(this.services.extension(text(0), call.api));
      case "Info_ValueForKey": {
        // q2repro src/server/game.c PF_Info_ValueForKey delegates to the
        // case-sensitive shared.c reader and Q_strlcpy (full source length).
        const input = requiredPointer(args, 0), key = text(1), maximum = integer(args, 3);
        if (maximum < 0n || maximum > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("Invalid Q2 info output size");
        const value = readGuestString(this.memory, input, 2048);
        let cursor = value.startsWith("\\") ? 1 : 0, found = "";
        while (cursor < value.length) {
          const separator = value.indexOf("\\", cursor);
          if (separator < 0) break;
          const next = value.indexOf("\\", separator + 1), end = next < 0 ? value.length : next;
          if (value.slice(cursor, separator) === key) { found = value.slice(separator + 1, end); break; }
          cursor = end + 1;
        }
        const bytes = new TextEncoder().encode(found);
        if (maximum !== 0n) {
          const output = requiredPointer(args, 2), count = Math.min(bytes.length, Number(maximum) - 1);
          this.memory.check(output, count + 1, "write");
          this.memory.write(output, bytes.subarray(0, count));
          this.memory.writeUint8(this.memory.offset(output, BigInt(count)), 0);
        }
        return { kind: "uint64", value: BigInt(bytes.length) };
      }
      case "cvar": return guestPointer(this.cvar(this.services.cvars.register(text(0), text(1), number(2))));
      case "cvar_set": return guestPointer(this.cvar(this.services.cvars.set(text(0), text(1))));
      case "cvar_forceset": return guestPointer(this.cvar(this.services.cvars.set(text(0), text(1), true)));
      case "TagMalloc": {
        const rawSize = integer(args, 0);
        if (rawSize < 0n || rawSize > 0x1000_0000n) throw new RangeError("Q2 TagMalloc size exceeds mapped-memory allocation limit");
        const size = Math.max(1, Number(rawSize)), tag = number(1);
        const address = this.memory.allocate({ byteLength: size, alignment: 16n, label: `Q2 tag ${tag}` });
        this.#allocations.set(address.byteOffset, { address, size, tag });
        return guestPointer(address);
      }
      case "TagFree": this.free(pointer(args, 0)); return { kind: "void" };
      case "FreeTags": for (const allocation of this.#allocations.values()) if (allocation.tag === number(0)) this.free(allocation.address); return { kind: "void" };
      default: throw new MissingRereleaseImport(call);
    }
  }
}
