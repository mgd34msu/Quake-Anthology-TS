/* Q3 cl_cgame.c/cl_ui.c common traps, adapted from quake-3-ts. GPL-2.0-or-later. */
import { CommonError } from "../../core/common-error.ts";
import type { CvarRegistry } from "../../core/cvars/index.ts";
import { QvmCgameImport, QvmUiImport } from "./abi.ts";
import { qvmCvarSyscall } from "./cvar-syscalls.ts";
import type { QvmHostCall, QvmHostResult } from "./syscalls.ts";

interface CommonServices {
  readonly cvars: CvarRegistry;
  print(text: string): void;
  milliseconds(): number;
  arguments(): readonly string[];
}

export type QvmClientCommonServices = CommonServices & (
  | { readonly role: "cgame"; readonly commands: {
    append(text: string): void;
    register(name: string): void;
    remove(name: string): void;
    reliable(text: string): void;
  } }
  | { readonly role: "ui"; readonly commands: {
    executeNow(text: string | null): void | Promise<void>;
    insert(text: string): void;
    append(text: string): void;
  } }
);

/** Null means unhandled; zero remains a completed guest result. */
export function qvmClientCommonSyscall(call: QvmHostCall, services: QvmClientCommonServices): QvmHostResult | null {
  if (call.kind !== "engine" || call.role !== services.role) return null;
  const { words, guest } = call;
  const cvar = qvmCvarSyscall(call.role, words, guest, services.cvars);
  if (cvar !== null) return cvar;
  const trap = call.code;
  const ui = services.role === "ui";
  if (trap === (ui ? QvmUiImport.UI_PRINT : QvmCgameImport.CG_PRINT)) {
    services.print(guest.readString(words.getInt32(4, true))); return 0;
  }
  if (trap === (ui ? QvmUiImport.UI_ERROR : QvmCgameImport.CG_ERROR))
    throw new CommonError("drop", guest.readString(words.getInt32(4, true)).slice(0, 4095));
  if (trap === (ui ? QvmUiImport.UI_MILLISECONDS : QvmCgameImport.CG_MILLISECONDS)) return services.milliseconds() | 0;
  const argv = call.commandArguments ?? services.arguments();
  if (trap === (ui ? QvmUiImport.UI_ARGC : QvmCgameImport.CG_ARGC)) return argv.length;
  if (trap === (ui ? QvmUiImport.UI_ARGV : QvmCgameImport.CG_ARGV)) {
    guest.writeString(words.getInt32(8, true), argv[words.getInt32(4, true)] ?? "", words.getInt32(12, true)); return 0;
  }
  if (services.role === "cgame") {
    switch (trap) {
      case QvmCgameImport.CG_ARGS: {
        const value = argv.slice(1).join(" ");
        if (value.length >= 1024) throw new RangeError("Cmd_Args exceeds its source buffer");
        guest.writeString(words.getInt32(4, true), value, words.getInt32(8, true)); return 0;
      }
      case QvmCgameImport.CG_SENDCONSOLECOMMAND: services.commands.append(guest.readString(words.getInt32(4, true))); return 0;
      case QvmCgameImport.CG_ADDCOMMAND: services.commands.register(guest.readString(words.getInt32(4, true))); return 0;
      case QvmCgameImport.CG_REMOVECOMMAND: services.commands.remove(guest.readString(words.getInt32(4, true))); return 0;
      case QvmCgameImport.CG_SENDCLIENTCOMMAND: services.commands.reliable(guest.readString(words.getInt32(4, true))); return 0;
      default: return null;
    }
  }
  if (trap !== QvmUiImport.UI_CMD_EXECUTETEXT) return null;
  const when = words.getInt32(4, true), pointer = words.getInt32(8, true);
  switch (when) {
    case 0: {
      const pending = services.commands.executeNow(pointer === 0 ? null : guest.readString(pointer));
      return pending === undefined ? 0 : pending.then(() => 0);
    }
    case 1: services.commands.insert(guest.readString(pointer)); return 0;
    case 2: services.commands.append(guest.readString(pointer)); return 0;
    default: throw new CommonError("fatal", "Cbuf_ExecuteText: bad exec_when");
  }
}
