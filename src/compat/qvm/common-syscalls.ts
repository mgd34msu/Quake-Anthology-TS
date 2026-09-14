/* Q3 sv_game.c/cl_cgame.c/cl_ui.c common traps, adapted from quake-3-ts. GPL-2.0-or-later. */
import { CommonError } from "../../core/common-error.ts";
import type { CvarRegistry } from "../../core/cvars/index.ts";
import { QvmCgameImport, QvmGameImport, QvmUiImport } from "./abi.ts";
import { qvmCvarSyscall } from "./cvar-syscalls.ts";
import type { QvmHostCall, QvmHostResult } from "./syscalls.ts";

export interface QvmCalendar {
  readonly second: number; readonly minute: number; readonly hour: number; readonly day: number;
  readonly month: number; readonly year: number; readonly weekday: number; readonly yearDay: number; readonly isDst: number;
}

interface CommonServices {
  readonly cvars: CvarRegistry;
  print(text: string): void;
  milliseconds(): number;
  arguments(): readonly string[];
}

interface ConsoleCommands {
  executeNow(text: string | null): void | Promise<void>;
  insert(text: string): void;
  append(text: string): void;
}

export type QvmCommonServices = CommonServices & (
  | { readonly role: "cgame"; readonly commands: {
    append(text: string): void;
    register(name: string): void;
    remove(name: string): void;
    reliable(text: string): void;
  } }
  | { readonly role: "qagame"; readonly realTime: (output: ((calendar: QvmCalendar) => void) | null) => number;
    readonly commands: ConsoleCommands }
  | { readonly role: "ui"; readonly commands: ConsoleCommands }
);

/** Null means unhandled; zero remains a completed guest result. */
export function qvmCommonSyscall(call: QvmHostCall, services: QvmCommonServices): QvmHostResult | null {
  if (call.kind !== "engine" || call.role !== services.role) return null;
  const { words, guest } = call;
  const cvar = qvmCvarSyscall(call.role, words, guest, services.cvars);
  if (cvar !== null) return cvar;
  const trap = call.code;
  const ui = services.role === "ui", game = services.role === "qagame";
  if (trap === (ui ? QvmUiImport.UI_PRINT : game ? QvmGameImport.G_PRINT : QvmCgameImport.CG_PRINT)) {
    services.print(guest.readString(words.getInt32(4, true))); return 0;
  }
  if (trap === (ui ? QvmUiImport.UI_ERROR : game ? QvmGameImport.G_ERROR : QvmCgameImport.CG_ERROR))
    throw new CommonError("drop", guest.readString(words.getInt32(4, true)).slice(0, 4095));
  if (trap === (ui ? QvmUiImport.UI_MILLISECONDS : game ? QvmGameImport.G_MILLISECONDS : QvmCgameImport.CG_MILLISECONDS)) return services.milliseconds() | 0;
  const argv = call.commandArguments ?? services.arguments();
  if (trap === (ui ? QvmUiImport.UI_ARGC : game ? QvmGameImport.G_ARGC : QvmCgameImport.CG_ARGC)) return argv.length;
  if (trap === (ui ? QvmUiImport.UI_ARGV : game ? QvmGameImport.G_ARGV : QvmCgameImport.CG_ARGV)) {
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
  if (services.role === "qagame" && trap === QvmGameImport.G_REAL_TIME) {
    const pointer = words.getInt32(4, true);
    return services.realTime(pointer === 0 ? null : calendar => {
      const output = guest.view(pointer, 36);
      [calendar.second, calendar.minute, calendar.hour, calendar.day, calendar.month, calendar.year,
        calendar.weekday, calendar.yearDay, calendar.isDst].forEach((value, index) => output.setInt32(index * 4, value, true));
    });
  }
  if (trap !== (services.role === "qagame" ? QvmGameImport.G_SEND_CONSOLE_COMMAND : QvmUiImport.UI_CMD_EXECUTETEXT)) return null;
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
