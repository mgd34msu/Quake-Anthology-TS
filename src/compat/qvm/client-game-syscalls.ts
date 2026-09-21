/* Q3 server/sv_game.c client imports. GPL-2.0-or-later. */
import type { QvmAbiProfile } from "../../contracts/execution.ts";
import { CommonError } from "../../core/common-error.ts";
import { QvmGameImport } from "./abi.ts";
import { QVM_USER_COMMAND_BYTES, writeQvmUserCommand } from "./client-state-record.ts";
import type { QvmHostCall, QvmHostResult } from "./syscalls.ts";

export interface QvmClientGameServices {
  readonly abiProfile: QvmAbiProfile;
  readonly maxClients: number;
  getUserinfo(slot: number): string;
  setUserinfo(slot: number, value: string): void;
  getUserCommand(slot: number): Parameters<typeof writeQvmUserCommand>[1];
  dropClient(slot: number, reason: string): void | Promise<void>;
  sendServerCommand(slot: number, text: string): void | Promise<void>;
}

function client(slot: number, services: QvmClientGameServices, operation: string): void {
  if (slot < 0 || slot >= services.maxClients) throw new CommonError("drop", operation === "SV_GetUsercmd"
    ? `${operation}: bad clientNum:${slot}` : `${operation}: bad index ${slot}\n`);
}
function complete(result: void | Promise<void>): QvmHostResult { return result === undefined ? 0 : result.then(() => 0); }

export function qvmClientGameSyscall(call: QvmHostCall, services: QvmClientGameServices): QvmHostResult | null {
  if (call.kind !== "engine" || call.role !== "qagame") return null;
  const { guest, words } = call, word = (index: number): number => words.getInt32(index * 4, true);
  switch (call.code) {
    case QvmGameImport.G_DROP_CLIENT: {
      const number = word(1);
      return number < 0 || number >= services.maxClients ? 0 : complete(services.dropClient(number, guest.readString(word(2))));
    }
    case QvmGameImport.G_SEND_SERVER_COMMAND: {
      const number = word(1);
      return number !== -1 && (number < 0 || number >= services.maxClients) ? 0 : complete(services.sendServerCommand(number, guest.readString(word(2))));
    }
    case QvmGameImport.G_GET_USERINFO:
      if (word(3) < 1) throw new CommonError("drop", `SV_GetUserinfo: bufferSize == ${word(3)}`);
      client(word(1), services, "SV_GetUserinfo"); guest.writeString(word(2), services.getUserinfo(word(1)), word(3)); return 0;
    case QvmGameImport.G_SET_USERINFO:
      client(word(1), services, "SV_SetUserinfo"); services.setUserinfo(word(1), word(2) === 0 ? "" : guest.readString(word(2))); return 0;
    case QvmGameImport.G_GET_USERCMD:
      client(word(1), services, "SV_GetUsercmd");
      writeQvmUserCommand(guest.view(word(2), QVM_USER_COMMAND_BYTES), services.getUserCommand(word(1)), services.abiProfile); return 0;
    default: return null;
  }
}
