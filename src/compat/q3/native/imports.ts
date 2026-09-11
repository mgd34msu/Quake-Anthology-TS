// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, GuestCallContext, GuestCallResult, GuestCallValue, GuestStorage, NativeAbi } from "../../../contracts/execution.ts";
import type { GuestCallbackTable, MappedGuestMemory } from "../../../guest/core/index.ts";
import type { Q3SourceHost } from "../../../app/bootstrap/simulation/q3/types.ts";
import { integer, pointer, readString, requiredPointer } from "../../../guest/runtime/common/memory.ts";
import { nativeQ3Signature } from "./module.ts";

export interface NativeQ3ServiceCoverage { readonly slot: number; readonly name: string; readonly implemented: boolean; readonly reached: number; }
export class NativeQ3ServiceUnavailable extends Error {
  constructor(readonly slot: number, readonly service: string, readonly context: GuestCallContext) {
    super(`Quake Live game import ${slot} (${service}) is unavailable in the supplied engine host`);
    this.name = "NativeQ3ServiceUnavailable";
  }
}
export class NativeQ3GameError extends Error {
  constructor(message: string, readonly context: GuestCallContext) { super(message); this.name = "NativeQ3GameError"; }
}
export interface NativeQ3EngineServices extends Pick<Q3SourceHost, "engine" | "cvars" | "configstrings"> {
  commandArguments(): readonly string[];
}
type Service = (context: GuestCallContext, args: readonly GuestCallValue[]) => GuestCallResult;

/** Engine service slots from ioquakelive g_public.h, verified on reached guest call sites.
 * Unknown slots trap explicitly. No actor ID is constructed from a guest client number.
 */
export class QuakeLiveGameImports {
  readonly address: GuestAddress;
  private readonly calls = new Map<number, { slot: number; name: string; implemented: boolean; reached: number }>();
  constructor(readonly memory: MappedGuestMemory, readonly callbacks: GuestCallbackTable, readonly abi: NativeAbi, readonly host: NativeQ3EngineServices) {
    this.address = memory.allocate({ byteLength: 206 * abi.pointerBytes, alignment: 8n, label: "Quake Live game imports" });
    for (let slot = 0; slot < 206; slot++) this.bind(slot, `unbound-${slot}`, [], "void", context => { throw new NativeQ3ServiceUnavailable(slot, `unbound-${slot}`, context); }, false);
    const text = (args: readonly GuestCallValue[], index: number): string => readString(memory, requiredPointer(args, index));
    this.bind(0, "SendConsoleCommand", ["pointer"], "void", (_context, args) => { host.engine.appendConsoleCommand(text(args, 0)); return { kind: "void" }; });
    // The shipped G_Printf formats into its own buffer before this call. Its
    // x64 call site passes only the buffer, without a variadic AL argument count.
    this.bind(2, "Printf", ["pointer"], "void", (_context, args) => { host.engine.print(text(args, 0)); return { kind: "void" }; });
    this.bind(11, "Cvar_VariableValue", ["pointer"], "float32", (_context, args) => ({ kind: "float32", value: Math.fround(host.cvars.variableValue(text(args, 0))) }));
    this.bind(12, "Cvar_Update", ["pointer"], "void", (_context, args) => { this.updateCvar(requiredPointer(args, 0)); return { kind: "void" }; });
    this.bind(13, "Cvar_VariableStringBuffer", ["pointer", "pointer", "int32"], "void", (_context, args) => {
      this.writeString(requiredPointer(args, 1), host.cvars.variableString(text(args, 0)), Number(integer(args, 2))); return { kind: "void" };
    });
    this.bind(15, "Cvar_Set", ["pointer", "pointer"], "void", (_context, args) => { host.cvars.set(text(args, 0), text(args, 1), true); return { kind: "void" }; });
    this.bind(17, "Cvar_Register", ["pointer", "pointer", "pointer", "int32"], "void", (_context, args) => {
      const address = pointer(args, 0), handle = host.cvars.bindVm(text(args, 1), text(args, 2), Number(integer(args, 3)));
      if (address !== null) { memory.writeInt32(address, handle); memory.writeInt32(memory.offset(address, 4n), -1); this.updateCvar(address); }
      return { kind: "void" };
    });
    this.bind(18, "Argv", ["int32", "pointer", "int32"], "void", (_context, args) => {
      this.writeString(requiredPointer(args, 1), host.commandArguments()[Number(integer(args, 0))] ?? "", Number(integer(args, 2))); return { kind: "void" };
    });
    this.bind(20, "Argc", [], "int32", () => ({ kind: "int32", value: host.commandArguments().length }));
    this.bind(23, "DropClient", ["int32", "pointer"], "void", (_context, args) => { host.engine.dropClient(Number(integer(args, 0)), text(args, 1)); return { kind: "void" }; });
    this.bind(24, "SendServerCommand", ["int32", "pointer"], "void", (_context, args) => { host.engine.sendServerCommand(Number(integer(args, 0)), text(args, 1)); return { kind: "void" }; });
    this.bind(25, "SetConfigstring", ["int32", "pointer"], "void", (_context, args) => { host.configstrings.set(Number(integer(args, 0)), text(args, 1)); return { kind: "void" }; });
    this.bind(26, "GetConfigstring", ["int32", "pointer", "int32"], "void", (_context, args) => {
      this.writeString(requiredPointer(args, 1), host.configstrings.get(Number(integer(args, 0))), Number(integer(args, 2))); return { kind: "void" };
    });
    this.bind(28, "GetUserinfo", ["int32", "pointer", "int32"], "void", (_context, args) => {
      this.writeString(requiredPointer(args, 1), host.engine.getUserinfo(Number(integer(args, 0))), Number(integer(args, 2))); return { kind: "void" };
    });
    this.bind(29, "SetUserinfo", ["int32", "pointer"], "void", (_context, args) => { host.engine.setUserinfo(Number(integer(args, 0)), text(args, 1)); return { kind: "void" }; });
  }
  get coverage(): readonly NativeQ3ServiceCoverage[] { return [...this.calls.values()]; }
  bind(slot: number, name: string, parameters: readonly GuestStorage[], result: GuestStorage | "void", invoke: Service, implemented = true): GuestAddress {
    if (!Number.isInteger(slot) || slot < 0 || slot >= 206) throw new RangeError("Quake Live import slot outside table");
    const record = { slot, name, implemented, reached: 0 };
    const target = this.callbacks.bind({ id: `native-ql:${this.address.byteOffset}:${slot}:${name}`, signature: nativeQ3Signature(this.abi, parameters, result), invoke: (context, args) => {
      record.reached++; return invoke(context, args);
    } });
    this.memory.writePointer(this.memory.offset(this.address, BigInt(slot * this.abi.pointerBytes)), target);
    this.calls.set(slot, record); return target;
  }
  writeString(address: GuestAddress, value: string, capacity: number): void {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError("Native string output requires positive source capacity");
    this.memory.check(address, capacity, "write");
    const bytes = new Uint8Array(capacity), end = Math.min(value.length, capacity - 1);
    for (let i = 0; i < end; i++) bytes[i] = value.charCodeAt(i) & 255;
    this.memory.write(address, bytes);
  }
  private updateCvar(address: GuestAddress): void {
    const m = this.memory, value = this.host.cvars.readVm(m.readInt32(address));
    if (value === undefined || m.readInt32(m.offset(address, 4n)) === value.modificationCount) return;
    // vmCvar_t has the same int/int/float/int/char[256] ABI on both guest widths.
    m.check(address, 272, "write");
    m.writeInt32(m.offset(address, 4n), value.modificationCount);
    if (value.value.length >= 256) throw new RangeError("Cvar_Update: source value exceeds MAX_CVAR_VALUE_STRING");
    this.writeString(m.offset(address, 16n), value.value, 256);
    m.writeFloat32(m.offset(address, 8n), Math.fround(value.numericValue));
    m.writeInt32(m.offset(address, 12n), value.integerValue);
  }
}
