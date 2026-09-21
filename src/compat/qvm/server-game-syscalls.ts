/* Q3 server/sv_game.c guest ABI. GPL-2.0-or-later. */
import type { Bounds, Vec3 } from "../../contracts/math.ts";
import type { TraceQuery } from "../../contracts/scene.ts";
import { CommonError } from "../../core/common-error.ts";
import type { CvarRegistry } from "../../core/cvars/index.ts";
import { QvmGameImport } from "./abi.ts";
import type { writeQvmUserCommand } from "./client-state-record.ts";
import { qvmClientGameSyscall } from "./client-game-syscalls.ts";
import type { QvmGameData } from "./game-data.ts";
import type { QvmHostCall, QvmHostResult } from "./syscalls.ts";
import { qvmServerInformationSyscall } from "./server-info-syscalls.ts";
import { qvmEntityTokenSyscall } from "./entity-tokens.ts";
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
    case QvmGameImport.G_DROP_CLIENT:
    case QvmGameImport.G_SEND_SERVER_COMMAND:
    case QvmGameImport.G_GET_USERINFO:
    case QvmGameImport.G_SET_USERINFO:
    case QvmGameImport.G_GET_USERCMD:
      return qvmClientGameSyscall(call, { abiProfile: services.data.abiProfile, maxClients: services.maxClients,
        getUserinfo: slot => services.getUserinfo(slot), setUserinfo: (slot, value) => services.setUserinfo(slot, value),
        getUserCommand: slot => services.getUserCommand(slot), dropClient: (slot, reason) => services.dropClient(slot, reason),
        sendServerCommand: (slot, text) => services.sendServerCommand(slot, text) });
    case QvmGameImport.G_SET_CONFIGSTRING:
    case QvmGameImport.G_GET_CONFIGSTRING:
    case QvmGameImport.G_GET_SERVERINFO:
      return qvmServerInformationSyscall(call, { abiProfile: services.data.abiProfile, cvars: services.cvars, configstrings: services.configstrings });
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
    case QvmGameImport.G_GET_ENTITY_TOKEN: return qvmEntityTokenSyscall(call, services);
    default: return null;
  }
}
