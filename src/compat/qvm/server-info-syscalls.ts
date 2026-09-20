/* Q3 server/sv_game.c information traps shared by primary and component modules. GPL-2.0-or-later. */
import type { QvmAbiProfile } from "../../contracts/execution.ts";
import { CommonError } from "../../core/common-error.ts";
import { CvarFlag, type CvarRegistry } from "../../core/cvars/index.ts";
import { QvmGameImport } from "./abi.ts";
import { qvmConfigstring } from "./legacy-presentation.ts";
import type { QvmHostCall, QvmHostResult } from "./syscalls.ts";

export interface QvmServerInformationServices {
  readonly abiProfile: QvmAbiProfile;
  readonly cvars: CvarRegistry;
  readonly configstrings: { get(index: number): string; set(index: number, value: string): void | Promise<void> };
}
function capacity(size: number, operation: string): void {
  if (size < 1) throw new CommonError("drop", `${operation}: bufferSize == ${size}`);
}
function configIndex(index: number, operation: string): void {
  if (index < 0 || index >= 1024) throw new CommonError("drop", `${operation}: bad index ${index}\n`);
}

export function qvmServerInformationSyscall(call: QvmHostCall, services: QvmServerInformationServices): QvmHostResult | null {
  if (call.kind !== "engine" || call.role !== "qagame") return null;
  const { guest, words } = call, word = (index: number): number => words.getInt32(index * 4, true);
  switch (call.code) {
    case QvmGameImport.G_SET_CONFIGSTRING: {
      configIndex(word(1), "SV_SetConfigstring");
      const result = services.configstrings.set(qvmConfigstring(word(1), services.abiProfile), word(2) === 0 ? "" : guest.readString(word(2)));
      return result === undefined ? 0 : result.then(() => 0);
    }
    case QvmGameImport.G_GET_CONFIGSTRING:
      capacity(word(3), "SV_GetConfigstring"); configIndex(word(1), "SV_GetConfigstring");
      guest.writeString(word(2), services.configstrings.get(qvmConfigstring(word(1), services.abiProfile)), word(3)); return 0;
    case QvmGameImport.G_GET_SERVERINFO:
      capacity(word(2), "SV_GetServerinfo");
      guest.writeString(word(1), services.cvars.infoString(CvarFlag.ServerInfo), word(2)); return 0;
    default: return null;
  }
}
