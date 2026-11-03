// SPDX-License-Identifier: GPL-2.0-or-later
/* Quake III Arena server/sv_game.c SV_GameSystemCalls and game/g_public.h gameImport_t for native i386 modules. */
import type { GuestAddress, GuestCallContext, GuestCallValue } from "../../../contracts/execution.ts";
import type { MappedGuestMemory } from "../../../guest/core/index.ts";
import { integer, pointer, readString, requiredPointer } from "../../../guest/runtime/common/memory.ts";
import { QvmGameImport } from "../../qvm/abi.ts";
import { NativeQ3GameError, type NativeQ3EngineServices } from "./imports.ts";
import { updateGuestCvar, writeGuestString } from "./guest-services.ts";
import type { NativeQ3SyscallBinding } from "./syscall.ts";

export interface NativeQ3GameServices extends NativeQ3EngineServices {
  milliseconds(): number;
}

/** sharedEntity_t and playerState_t arrays registered by G_LOCATE_GAME_DATA; the module owns the memory. */
export class NativeQ3GameData {
  private located: { readonly entities: GuestAddress; readonly count: number; readonly entitySize: number; readonly clients: GuestAddress; readonly clientSize: number } | null = null;
  constructor(readonly memory: MappedGuestMemory) {}
  locate(entities: GuestAddress | null, count: number, entitySize: number, clients: GuestAddress | null, clientSize: number): void {
    if (entities === null || clients === null) throw new RangeError("G_LOCATE_GAME_DATA requires both record arrays");
    if (!Number.isInteger(count) || count < 1 || count > 1024 || !Number.isInteger(entitySize) || entitySize < 4 || entitySize > 65536
      || !Number.isInteger(clientSize) || clientSize < 4 || clientSize > 65536) throw new RangeError("G_LOCATE_GAME_DATA geometry is outside the source limits");
    this.memory.check(entities, count * entitySize, "read"); this.memory.check(clients, clientSize, "read");
    this.located = { entities, count, entitySize, clients, clientSize };
  }
  private get data() { if (this.located === null) throw new Error("The native game has not located its record arrays"); return this.located; }
  get entityCount(): number { return this.data.count; }
  get entityBytes(): number { return this.data.entitySize; }
  get isLocated(): boolean { return this.located !== null; }
  /** SV_NumForGentity: the slot of an entity pointer, which must lie on a record boundary. */
  numberFromPointer(address: GuestAddress): number {
    const { entities, entitySize, count } = this.data, delta = address.byteOffset - entities.byteOffset;
    if (address.addressSpace !== entities.addressSpace || delta < 0n || delta % BigInt(entitySize) !== 0n || delta / BigInt(entitySize) >= BigInt(count)) throw new RangeError("Pointer is not a located entity");
    return Number(delta / BigInt(entitySize));
  }
  /** The first entityState_t word, which the source engine requires to equal the slot. */
  entity(slot: number): DataView {
    const { entities, entitySize, count } = this.data;
    if (!Number.isInteger(slot) || slot < 0 || slot >= count) throw new RangeError("Entity slot is outside the located array");
    return this.memory.borrow(this.memory.offset(entities, BigInt(slot * entitySize)), entitySize);
  }
  /** One playerState_t; the located client array has one record per client slot. */
  client(slot: number): DataView {
    const { clients, clientSize } = this.data;
    if (!Number.isInteger(slot) || slot < 0) throw new RangeError("Client slot is invalid");
    return this.memory.borrow(this.memory.offset(clients, BigInt(slot * clientSize)), clientSize);
  }
}

/** The gameImport_t traps a native module can reach in the official 1.32 profile. Everything else traps explicitly through NativeQ3Syscalls. */
export function nativeQ3GameSyscalls(memory: MappedGuestMemory, services: NativeQ3GameServices, data: NativeQ3GameData, argv: () => readonly string[]): NativeQ3SyscallBinding[] {
  const text = (args: readonly GuestCallValue[], index: number): string => readString(memory, requiredPointer(args, index));
  const int = (args: readonly GuestCallValue[], index: number): number => Number(BigInt.asIntN(32, integer(args, index)));
  const bind = (code: QvmGameImport, name: string, parameters: NativeQ3SyscallBinding["parameters"], invoke: (args: readonly GuestCallValue[], context: GuestCallContext) => number | void): NativeQ3SyscallBinding =>
    ({ code, name, parameters, invoke: (context, args) => invoke(args, context) ?? 0 });
  return [
    bind(QvmGameImport.G_PRINT, "G_PRINT", ["pointer"], args => { services.engine.print(text(args, 0)); }),
    bind(QvmGameImport.G_ERROR, "G_ERROR", ["pointer"], (args, context) => { throw new NativeQ3GameError(text(args, 0).slice(0, 4095), context); }),
    bind(QvmGameImport.G_MILLISECONDS, "G_MILLISECONDS", [], () => services.milliseconds() | 0),
    bind(QvmGameImport.G_CVAR_REGISTER, "G_CVAR_REGISTER", ["pointer", "pointer", "pointer", "int32"], args => {
      const address = pointer(args, 0), handle = services.cvars.bindVm(text(args, 1), text(args, 2), int(args, 3));
      if (address !== null) { memory.writeInt32(address, handle); memory.writeInt32(memory.offset(address, 4n), -1); updateGuestCvar(memory, services.cvars, address); }
    }),
    bind(QvmGameImport.G_CVAR_UPDATE, "G_CVAR_UPDATE", ["pointer"], args => { updateGuestCvar(memory, services.cvars, requiredPointer(args, 0)); }),
    bind(QvmGameImport.G_CVAR_SET, "G_CVAR_SET", ["pointer", "pointer"], args => { services.cvars.set(text(args, 0), pointer(args, 1) === null ? "" : text(args, 1), true); }),
    bind(QvmGameImport.G_CVAR_VARIABLE_INTEGER_VALUE, "G_CVAR_VARIABLE_INTEGER_VALUE", ["pointer"], args => Math.trunc(services.cvars.variableValue(text(args, 0))) | 0),
    bind(QvmGameImport.G_CVAR_VARIABLE_STRING_BUFFER, "G_CVAR_VARIABLE_STRING_BUFFER", ["pointer", "pointer", "int32"], args => {
      writeGuestString(memory, requiredPointer(args, 1), services.cvars.variableString(text(args, 0)), int(args, 2));
    }),
    bind(QvmGameImport.G_ARGC, "G_ARGC", [], () => argv().length),
    bind(QvmGameImport.G_ARGV, "G_ARGV", ["int32", "pointer", "int32"], args => { writeGuestString(memory, requiredPointer(args, 1), argv()[int(args, 0)] ?? "", int(args, 2)); }),
    bind(QvmGameImport.G_SEND_CONSOLE_COMMAND, "G_SEND_CONSOLE_COMMAND", ["int32", "pointer"], args => {
      const when = int(args, 0), command = text(args, 1);
      // The unified engine exposes execute-now and append; insert-at-front is appended in order.
      if (when === 0) services.engine.executeConsoleNow(command);
      else if (when === 1 || when === 2) services.engine.appendConsoleCommand(command);
      else throw new RangeError("Cbuf_ExecuteText: bad exec_when");
    }),
    bind(QvmGameImport.G_LOCATE_GAME_DATA, "G_LOCATE_GAME_DATA", ["pointer", "int32", "int32", "pointer", "int32"], args => {
      data.locate(pointer(args, 0), int(args, 1), int(args, 2), pointer(args, 3), int(args, 4));
    }),
    bind(QvmGameImport.G_DROP_CLIENT, "G_DROP_CLIENT", ["int32", "pointer"], args => { services.engine.dropClient(int(args, 0), text(args, 1)); }),
    bind(QvmGameImport.G_SEND_SERVER_COMMAND, "G_SEND_SERVER_COMMAND", ["int32", "pointer"], args => { services.engine.sendServerCommand(int(args, 0), text(args, 1)); }),
    bind(QvmGameImport.G_SET_CONFIGSTRING, "G_SET_CONFIGSTRING", ["int32", "pointer"], args => { services.configstrings.set(int(args, 0), text(args, 1)); }),
    bind(QvmGameImport.G_GET_CONFIGSTRING, "G_GET_CONFIGSTRING", ["int32", "pointer", "int32"], args => {
      writeGuestString(memory, requiredPointer(args, 1), services.configstrings.get(int(args, 0)), int(args, 2));
    }),
    bind(QvmGameImport.G_GET_USERINFO, "G_GET_USERINFO", ["int32", "pointer", "int32"], args => {
      writeGuestString(memory, requiredPointer(args, 1), services.engine.getUserinfo(int(args, 0)), int(args, 2));
    }),
    bind(QvmGameImport.G_SET_USERINFO, "G_SET_USERINFO", ["int32", "pointer"], args => { services.engine.setUserinfo(int(args, 0), text(args, 1)); }),
  ];
}
