// Q3 cl_cgame.c client-state traps. GPL-2.0-or-later.
import type { SnapshotSource } from "../../content/q3/presentation/snapshots.ts";
import type { Q3ClientConnection } from "../../network/q3/client.ts";
import { QvmCgameImport, QvmUiImport } from "./abi.ts";
import { QVM_GAME_STATE_BYTES, QVM_SNAPSHOT_BYTES, QVM_USER_COMMAND_BYTES, writeQvmGameState, writeQvmSnapshot, writeQvmUserCommand } from "./client-state-record.ts";
import type { QvmHostCall, QvmHostResult } from "./syscalls.ts";

export interface QvmClientStateServices {
  readonly connection: Q3ClientConnection;
  readonly snapshots: SnapshotSource;
  snapshotPing(number: number): number | null;
  /** Execute only on this trap, installing returned argv in the common command owner before resolving. */
  getServerCommand(number: number): Promise<readonly string[] | null>;
  setUserCommandValue(weapon: number, sensitivity: number): void;
}

export function qvmClientStateSyscall(call: QvmHostCall, services: QvmClientStateServices): QvmHostResult | null {
  if (call.kind !== "engine") return null;
  const { words, guest } = call;
  if (call.role === "ui" && call.code === QvmUiImport.UI_GETCONFIGSTRING) {
    const index = words.getInt32(4, true), pointer = words.getInt32(8, true), size = words.getInt32(12, true);
    if (index < 0 || index >= 1024) return 0;
    const value = services.connection.gameState.get(index);
    if (value === null) { if (size !== 0) guest.view(pointer, 1).setUint8(0, 0); return 0; }
    guest.writeString(pointer, value, size); return 1;
  }
  if (call.role !== "cgame") return null;
  switch (call.code) {
    case QvmCgameImport.CG_GETGAMESTATE:
      writeQvmGameState(guest.view(words.getInt32(4, true), QVM_GAME_STATE_BYTES), services.connection.gameState.copySourceRecord()); return 0;
    case QvmCgameImport.CG_GETCURRENTSNAPSHOTNUMBER: {
      const number = guest.view(words.getInt32(4, true), 4), time = guest.view(words.getInt32(8, true), 4);
      const current = services.snapshots.current(); number.setInt32(0, current.number, true); time.setInt32(0, current.serverTime, true); return 0;
    }
    case QvmCgameImport.CG_GETSNAPSHOT: {
      const number = words.getInt32(4, true), pointer = words.getInt32(8, true), snapshot = services.snapshots.read(number);
      if (snapshot === null) return 0;
      const ping = services.snapshotPing(number);
      if (ping === null) throw new Error("Retained snapshot has no source ping");
      writeQvmSnapshot(guest.view(pointer, QVM_SNAPSHOT_BYTES), snapshot, ping); return 1;
    }
    case QvmCgameImport.CG_GETSERVERCOMMAND:
      return services.getServerCommand(words.getInt32(4, true)).then(argv => Number(argv !== null));
    case QvmCgameImport.CG_GETCURRENTCMDNUMBER: return services.connection.commands.currentNumber;
    case QvmCgameImport.CG_GETUSERCMD: {
      const number = words.getInt32(4, true), pointer = words.getInt32(8, true), command = services.connection.commands.read(number);
      if (command === null) return 0;
      writeQvmUserCommand(guest.view(pointer, QVM_USER_COMMAND_BYTES), command); return 1;
    }
    case QvmCgameImport.CG_SETUSERCMDVALUE: {
      const weapon = words.getInt32(4, true), sensitivity = words.getFloat32(8, true);
      services.setUserCommandValue(weapon, sensitivity); return 0;
    }
    default: return null;
  }
}
