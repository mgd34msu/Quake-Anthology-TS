// SPDX-License-Identifier: GPL-2.0-or-later
// qsrc/quake-2/game/game.h and q_shared.h, API 3, 32-bit pointers, four-byte alignment.
import type { GuestLayout, GuestValueLayout, NativeCallAbi } from "../../../contracts/execution.ts";
import type { GuestCallSignature } from "../../../guest/core/contracts.ts";

export const CLASSIC_Q2_ABI: NativeCallAbi = { kind: "windows-i386", image: "pe32", pointerBytes: 4, call: "cdecl" };
export const CLASSIC_Q2_FRAME_SECONDS = 0.1;
export const CLASSIC_Q2_EDICT_BYTES = 260;
export const CLASSIC_Q2_PLAYER_STATE_BYTES = 184;
export const CLASSIC_Q2_CLIENT_PREFIX_BYTES = 188;
export const CLASSIC_Q2_USERCMD_BYTES = 16;
export const CLASSIC_Q2_PMOVE_BYTES = 240;
export const CLASSIC_Q2_EXPORT_BYTES = 80;
export const CLASSIC_Q2_IMPORT_BYTES = 176;
export const CLASSIC_Q2_USERCMD_LAYOUT: GuestLayout = {
  id: "q2-classic:usercmd", byteLength: 16, alignment: 2, pointerBytes: 4, byteOrder: "little-endian", fields: [
    { name: "msec", byteOffset: 0, storage: "uint8", count: 1 }, { name: "buttons", byteOffset: 1, storage: "uint8", count: 1 },
    { name: "angles", byteOffset: 2, storage: "int16", count: 3 }, { name: "move", byteOffset: 8, storage: "int16", count: 3 },
    { name: "impulse", byteOffset: 14, storage: "uint8", count: 1 }, { name: "lightlevel", byteOffset: 15, storage: "uint8", count: 1 },
  ],
};
export const CLASSIC_Q2_PLAYER_STATE_LAYOUT: GuestLayout = {
  id: "q2-classic:player-state", byteLength: 184, alignment: 4, pointerBytes: 4, byteOrder: "little-endian", fields: [
    { name: "pmove.pm_type", byteOffset: 0, storage: "int32", count: 1 },
    { name: "pmove.origin", byteOffset: 4, storage: "int16", count: 3 }, { name: "pmove.velocity", byteOffset: 10, storage: "int16", count: 3 },
    { name: "pmove.pm_flags", byteOffset: 16, storage: "uint8", count: 1 }, { name: "pmove.pm_time", byteOffset: 17, storage: "uint8", count: 1 },
    { name: "pmove.gravity", byteOffset: 18, storage: "int16", count: 1 }, { name: "pmove.delta_angles", byteOffset: 20, storage: "int16", count: 3 },
    { name: "viewangles", byteOffset: 28, storage: "float32", count: 3 }, { name: "viewoffset", byteOffset: 40, storage: "float32", count: 3 },
    { name: "kick_angles", byteOffset: 52, storage: "float32", count: 3 }, { name: "gunangles", byteOffset: 64, storage: "float32", count: 3 },
    { name: "gunoffset", byteOffset: 76, storage: "float32", count: 3 }, { name: "gunindex", byteOffset: 88, storage: "int32", count: 1 },
    { name: "gunframe", byteOffset: 92, storage: "int32", count: 1 }, { name: "blend", byteOffset: 96, storage: "float32", count: 4 },
    { name: "fov", byteOffset: 112, storage: "float32", count: 1 }, { name: "rdflags", byteOffset: 116, storage: "int32", count: 1 },
    { name: "stats", byteOffset: 120, storage: "int16", count: 32 },
  ],
};
export const CLASSIC_Q2_EDICT_LAYOUT: GuestLayout = {
  id: "q2-classic:edict-prefix", byteLength: 260, alignment: 4, pointerBytes: 4, byteOrder: "little-endian",
  fields: [
    { name: "s.number", byteOffset: 0, storage: "int32", count: 1 },
    { name: "s.origin", byteOffset: 4, storage: "float32", count: 3 },
    { name: "s.angles", byteOffset: 16, storage: "float32", count: 3 },
    { name: "s.old_origin", byteOffset: 28, storage: "float32", count: 3 },
    { name: "s.modelindex", byteOffset: 40, storage: "int32", count: 4 },
    { name: "s.frame", byteOffset: 56, storage: "int32", count: 1 },
    { name: "s.skinnum", byteOffset: 60, storage: "int32", count: 1 },
    { name: "s.effects", byteOffset: 64, storage: "uint32", count: 1 },
    { name: "s.renderfx", byteOffset: 68, storage: "int32", count: 1 },
    { name: "s.solid", byteOffset: 72, storage: "int32", count: 1 },
    { name: "s.sound", byteOffset: 76, storage: "int32", count: 1 },
    { name: "s.event", byteOffset: 80, storage: "int32", count: 1 },
    { name: "client", byteOffset: 84, storage: "pointer", count: 1 },
    { name: "inuse", byteOffset: 88, storage: "int32", count: 1 },
    { name: "linkcount", byteOffset: 92, storage: "int32", count: 1 },
    { name: "area", byteOffset: 96, storage: "pointer", count: 2 },
    { name: "num_clusters", byteOffset: 104, storage: "int32", count: 1 },
    { name: "clusternums", byteOffset: 108, storage: "int32", count: 16 },
    { name: "headnode", byteOffset: 172, storage: "int32", count: 1 },
    { name: "areanum", byteOffset: 176, storage: "int32", count: 2 },
    { name: "svflags", byteOffset: 184, storage: "int32", count: 1 },
    { name: "mins", byteOffset: 188, storage: "float32", count: 3 },
    { name: "maxs", byteOffset: 200, storage: "float32", count: 3 },
    { name: "absmin", byteOffset: 212, storage: "float32", count: 3 },
    { name: "absmax", byteOffset: 224, storage: "float32", count: 3 },
    { name: "size", byteOffset: 236, storage: "float32", count: 3 },
    { name: "solid", byteOffset: 248, storage: "int32", count: 1 },
    { name: "clipmask", byteOffset: 252, storage: "int32", count: 1 },
    { name: "owner", byteOffset: 256, storage: "pointer", count: 1 },
  ],
};
export const CLASSIC_Q2_TRACE_LAYOUT: GuestLayout = {
  id: "q2-classic:trace", byteLength: 56, alignment: 4, pointerBytes: 4, byteOrder: "little-endian",
  fields: [
    { name: "allsolid", byteOffset: 0, storage: "int32", count: 1 },
    { name: "startsolid", byteOffset: 4, storage: "int32", count: 1 },
    { name: "fraction", byteOffset: 8, storage: "float32", count: 1 },
    { name: "endpos", byteOffset: 12, storage: "float32", count: 3 },
    { name: "plane.normal", byteOffset: 24, storage: "float32", count: 3 },
    { name: "plane.dist", byteOffset: 36, storage: "float32", count: 1 },
    { name: "plane.type", byteOffset: 40, storage: "uint8", count: 1 },
    { name: "plane.signbits", byteOffset: 41, storage: "uint8", count: 1 },
    { name: "plane.pad", byteOffset: 42, storage: "uint8", count: 2 },
    { name: "surface", byteOffset: 44, storage: "pointer", count: 1 },
    { name: "contents", byteOffset: 48, storage: "int32", count: 1 },
    { name: "ent", byteOffset: 52, storage: "pointer", count: 1 },
  ],
};
export const q2Int: GuestValueLayout = { kind: "scalar", storage: "int32" };
export const q2Pointer: GuestValueLayout = { kind: "scalar", storage: "pointer" };
export const q2Float: GuestValueLayout = { kind: "scalar", storage: "float32" };
export const q2Double: GuestValueLayout = { kind: "scalar", storage: "float64" };
export const q2Trace: GuestValueLayout = { kind: "aggregate", layout: CLASSIC_Q2_TRACE_LAYOUT };
export function classicSignature(parameters: readonly GuestValueLayout[], result: GuestValueLayout | "void" = "void", variadic = false): GuestCallSignature {
  return { abi: CLASSIC_Q2_ABI, parameters, result, variadic };
}
export interface ClassicQ2Import { readonly name: string; readonly signature: GuestCallSignature }
export const CLASSIC_Q2_IMPORTS: readonly ClassicQ2Import[] = [
  { name: "bprintf", signature: classicSignature([q2Int, q2Pointer], "void", true) },
  { name: "dprintf", signature: classicSignature([q2Pointer], "void", true) },
  { name: "cprintf", signature: classicSignature([q2Pointer, q2Int, q2Pointer], "void", true) },
  { name: "centerprintf", signature: classicSignature([q2Pointer, q2Pointer], "void", true) },
  { name: "sound", signature: classicSignature([q2Pointer, q2Int, q2Int, q2Float, q2Float, q2Float]) },
  { name: "positioned_sound", signature: classicSignature([q2Pointer, q2Pointer, q2Int, q2Int, q2Float, q2Float, q2Float]) },
  { name: "configstring", signature: classicSignature([q2Int, q2Pointer]) },
  { name: "error", signature: classicSignature([q2Pointer], "void", true) },
  { name: "modelindex", signature: classicSignature([q2Pointer], q2Int) },
  { name: "soundindex", signature: classicSignature([q2Pointer], q2Int) },
  { name: "imageindex", signature: classicSignature([q2Pointer], q2Int) },
  { name: "setmodel", signature: classicSignature([q2Pointer, q2Pointer]) },
  { name: "trace", signature: classicSignature([q2Pointer, q2Pointer, q2Pointer, q2Pointer, q2Pointer, q2Int], q2Trace) },
  { name: "pointcontents", signature: classicSignature([q2Pointer], q2Int) },
  { name: "inPVS", signature: classicSignature([q2Pointer, q2Pointer], q2Int) },
  { name: "inPHS", signature: classicSignature([q2Pointer, q2Pointer], q2Int) },
  { name: "SetAreaPortalState", signature: classicSignature([q2Int, q2Int]) },
  { name: "AreasConnected", signature: classicSignature([q2Int, q2Int], q2Int) },
  { name: "linkentity", signature: classicSignature([q2Pointer]) },
  { name: "unlinkentity", signature: classicSignature([q2Pointer]) },
  { name: "BoxEdicts", signature: classicSignature([q2Pointer, q2Pointer, q2Pointer, q2Int, q2Int], q2Int) },
  { name: "Pmove", signature: classicSignature([q2Pointer]) },
  { name: "multicast", signature: classicSignature([q2Pointer, q2Int]) },
  { name: "unicast", signature: classicSignature([q2Pointer, q2Int]) },
  ...["WriteChar", "WriteByte", "WriteShort", "WriteLong"].map(name => ({ name, signature: classicSignature([q2Int]) })),
  { name: "WriteFloat", signature: classicSignature([q2Float]) },
  ...["WriteString", "WritePosition", "WriteDir"].map(name => ({ name, signature: classicSignature([q2Pointer]) })),
  { name: "WriteAngle", signature: classicSignature([q2Float]) },
  { name: "TagMalloc", signature: classicSignature([q2Int, q2Int], q2Pointer) },
  { name: "TagFree", signature: classicSignature([q2Pointer]) },
  { name: "FreeTags", signature: classicSignature([q2Int]) },
  { name: "cvar", signature: classicSignature([q2Pointer, q2Pointer, q2Int], q2Pointer) },
  { name: "cvar_set", signature: classicSignature([q2Pointer, q2Pointer], q2Pointer) },
  { name: "cvar_forceset", signature: classicSignature([q2Pointer, q2Pointer], q2Pointer) },
  { name: "argc", signature: classicSignature([], q2Int) },
  { name: "argv", signature: classicSignature([q2Int], q2Pointer) },
  { name: "args", signature: classicSignature([], q2Pointer) },
  { name: "AddCommandString", signature: classicSignature([q2Pointer]) },
  { name: "DebugGraph", signature: classicSignature([q2Float, q2Int]) },
];
export const CLASSIC_Q2_EXPORTS: Readonly<Record<string, { readonly offset: number; readonly signature: GuestCallSignature }>> = {
  Init: { offset: 4, signature: classicSignature([]) }, Shutdown: { offset: 8, signature: classicSignature([]) },
  SpawnEntities: { offset: 12, signature: classicSignature([q2Pointer, q2Pointer, q2Pointer]) },
  WriteGame: { offset: 16, signature: classicSignature([q2Pointer, q2Int]) }, ReadGame: { offset: 20, signature: classicSignature([q2Pointer]) },
  WriteLevel: { offset: 24, signature: classicSignature([q2Pointer]) }, ReadLevel: { offset: 28, signature: classicSignature([q2Pointer]) },
  ClientConnect: { offset: 32, signature: classicSignature([q2Pointer, q2Pointer], q2Int) }, ClientBegin: { offset: 36, signature: classicSignature([q2Pointer]) },
  ClientUserinfoChanged: { offset: 40, signature: classicSignature([q2Pointer, q2Pointer]) }, ClientDisconnect: { offset: 44, signature: classicSignature([q2Pointer]) },
  ClientCommand: { offset: 48, signature: classicSignature([q2Pointer]) }, ClientThink: { offset: 52, signature: classicSignature([q2Pointer, q2Pointer]) },
  RunFrame: { offset: 56, signature: classicSignature([]) }, ServerCommand: { offset: 60, signature: classicSignature([]) },
};
