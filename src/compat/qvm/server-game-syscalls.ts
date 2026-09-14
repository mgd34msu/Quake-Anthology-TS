/* Q3 server/sv_game.c guest ABI. GPL-2.0-or-later. */
import type { Bounds, Vec3 } from "../../contracts/math.ts";
import type { TraceQuery } from "../../contracts/scene.ts";
import { CommonError } from "../../core/common-error.ts";
import { CvarFlag } from "../../core/cvars/index.ts";
import type { CvarRegistry } from "../../core/cvars/index.ts";
import { QvmGameImport } from "./abi.ts";
import { QVM_USER_COMMAND_BYTES, writeQvmUserCommand } from "./client-state-record.ts";
import type { QvmGameData } from "./game-data.ts";
import type { QvmHostCall, QvmHostResult } from "./syscalls.ts";
import { QVM_TRACE_BYTES, writeQvmTrace } from "./trace-record.ts";
import type { QvmTraceRecord } from "./trace-record.ts";

export interface QvmServerTraceQuery extends Pick<TraceQuery, "start" | "end" | "shape"> {
  readonly passEntityNum: number;
  readonly mask: number;
}
export interface QvmServerSpatialOperations {
  trace(input: QvmServerTraceQuery): QvmTraceRecord;
  pointContents(point: Vec3, passEntityNum: number): number;
  areaEntities(bounds: Bounds, maximum: number): readonly number[];
  entityContact(bounds: Bounds, slot: number, capsule: boolean): boolean;
  setBrushModel(slot: number, name: string): void;
  adjustAreaPortalState(slot: number, open: boolean): void;
  inPvs(first: Vec3, second: Vec3, ignorePortals: boolean): boolean;
  areasConnected(first: number, second: number): boolean;
  link(slot: number): void;
  unlink(slot: number): void;
}
export interface QvmServerGameServices {
  readonly data: QvmGameData;
  readonly cvars: CvarRegistry;
  readonly configstrings: { get(index: number): string; set(index: number, value: string): void | Promise<void> };
  readonly maxClients: number;
  readonly spatial: QvmServerSpatialOperations;
  getUserinfo(slot: number): string;
  setUserinfo(slot: number, value: string): void;
  getUserCommand(slot: number): Parameters<typeof writeQvmUserCommand>[1];
  dropClient(slot: number, reason: string): Promise<void>;
  sendServerCommand(slot: number, text: string): void | Promise<void>;
  entityToken(): { readonly token: string; readonly ended: boolean };
}
function complete(result: void | Promise<void>): QvmHostResult { return result === undefined ? 0 : result.then(() => 0); }
function capacity(size: number, operation: string): void {
  if (size < 1) throw new CommonError("drop", `${operation}: bufferSize == ${size}`);
}
function configIndex(index: number, operation: string): void {
  if (index < 0 || index >= 1024) throw new CommonError("drop", `${operation}: bad index ${index}\n`);
}
function client(slot: number, services: QvmServerGameServices, operation: string): void {
  if (slot < 0 || slot >= services.maxClients) throw new CommonError("drop", operation === "SV_GetUsercmd"
    ? `${operation}: bad clientNum:${slot}` : `${operation}: bad index ${slot}\n`);
}

/** Null delegates to another trap owner; zero means the requested operation completed. */
export function qvmServerGameSyscall(call: QvmHostCall, services: QvmServerGameServices): QvmHostResult | null {
  if (call.kind !== "engine" || call.role !== "qagame") return null;
  const { guest, words } = call;
  const word = (index: number): number => words.getInt32(index * 4, true);
  const vector = (pointer: number): Vec3 => {
    const view = guest.view(pointer, 12);
    return { x: view.getFloat32(0, true), y: view.getFloat32(4, true), z: view.getFloat32(8, true) };
  };
  const bounds = (): Bounds => ({ min: vector(word(1)), max: vector(word(2)) });
  const slot = (index: number): number => services.data.numberFromPointer(word(index));
  switch (call.code) {
    case QvmGameImport.G_DROP_CLIENT: {
      const number = word(1);
      return number < 0 || number >= services.maxClients ? 0 : complete(services.dropClient(number, guest.readString(word(2))));
    }
    case QvmGameImport.G_SEND_SERVER_COMMAND: {
      const number = word(1);
      return number !== -1 && (number < 0 || number >= services.maxClients) ? 0 : complete(services.sendServerCommand(number, guest.readString(word(2))));
    }
    case QvmGameImport.G_SET_CONFIGSTRING:
      configIndex(word(1), "SV_SetConfigstring");
      return complete(services.configstrings.set(word(1), word(2) === 0 ? "" : guest.readString(word(2))));
    case QvmGameImport.G_GET_CONFIGSTRING:
      capacity(word(3), "SV_GetConfigstring"); configIndex(word(1), "SV_GetConfigstring");
      guest.writeString(word(2), services.configstrings.get(word(1)), word(3)); return 0;
    case QvmGameImport.G_GET_USERINFO:
      capacity(word(3), "SV_GetUserinfo"); client(word(1), services, "SV_GetUserinfo");
      guest.writeString(word(2), services.getUserinfo(word(1)), word(3)); return 0;
    case QvmGameImport.G_SET_USERINFO:
      client(word(1), services, "SV_SetUserinfo");
      services.setUserinfo(word(1), word(2) === 0 ? "" : guest.readString(word(2))); return 0;
    case QvmGameImport.G_GET_SERVERINFO:
      capacity(word(2), "SV_GetServerinfo");
      guest.writeString(word(1), services.cvars.infoString(CvarFlag.ServerInfo), word(2)); return 0;
    case QvmGameImport.G_SET_BRUSH_MODEL: {
      if (word(2) === 0) throw new CommonError("drop", "SV_SetBrushModel: NULL");
      const name = guest.readString(word(2));
      if (!name.startsWith("*")) throw new CommonError("drop", `SV_SetBrushModel: ${name} isn't a brush model`);
      services.spatial.setBrushModel(slot(1), name); return 0;
    }
    case QvmGameImport.G_TRACE:
    case QvmGameImport.G_TRACECAPSULE: {
      const zero = { x: 0, y: 0, z: 0 };
      const result = services.spatial.trace({ start: vector(word(2)), end: vector(word(5)),
        shape: { kind: call.code === QvmGameImport.G_TRACECAPSULE ? "capsule" : "box",
          bounds: { min: word(3) === 0 ? zero : vector(word(3)), max: word(4) === 0 ? zero : vector(word(4)) } },
        passEntityNum: word(6), mask: word(7) });
      writeQvmTrace(guest.view(word(1), QVM_TRACE_BYTES), result); return 0;
    }
    case QvmGameImport.G_POINT_CONTENTS: return services.spatial.pointContents(vector(word(1)), word(2));
    case QvmGameImport.G_IN_PVS:
    case QvmGameImport.G_IN_PVS_IGNORE_PORTALS:
      return Number(services.spatial.inPvs(vector(word(1)), vector(word(2)), call.code === QvmGameImport.G_IN_PVS_IGNORE_PORTALS));
    case QvmGameImport.G_ADJUST_AREA_PORTAL_STATE: services.spatial.adjustAreaPortalState(slot(1), word(2) !== 0); return 0;
    case QvmGameImport.G_AREAS_CONNECTED: return Number(services.spatial.areasConnected(word(1), word(2)));
    case QvmGameImport.G_LINKENTITY: services.spatial.link(slot(1)); return 0;
    case QvmGameImport.G_UNLINKENTITY: services.spatial.unlink(slot(1)); return 0;
    case QvmGameImport.G_ENTITIES_IN_BOX: {
      const input = bounds(), maximum = word(4);
      const result = services.spatial.areaEntities(input, maximum);
      if (maximum >= 0 && result.length > maximum) throw new RangeError("Area entity owner exceeded output capacity");
      if (result.length > 0) {
        const output = guest.view(word(3), result.length * 4);
        result.forEach((number, index) => output.setInt32(index * 4, number, true));
      }
      return result.length;
    }
    case QvmGameImport.G_ENTITY_CONTACT:
    case QvmGameImport.G_ENTITY_CONTACTCAPSULE:
      return Number(services.spatial.entityContact(bounds(), slot(3), call.code === QvmGameImport.G_ENTITY_CONTACTCAPSULE));
    case QvmGameImport.G_GET_USERCMD:
      client(word(1), services, "SV_GetUsercmd");
      writeQvmUserCommand(guest.view(word(2), QVM_USER_COMMAND_BYTES), services.getUserCommand(word(1))); return 0;
    case QvmGameImport.G_GET_ENTITY_TOKEN: {
      const result = services.entityToken();
      guest.writeString(word(1), result.token, word(2)); return Number(!result.ended || result.token.length !== 0);
    }
    default: return null;
  }
}
