// SPDX-License-Identifier: GPL-2.0-or-later
// Engine-written metadata files of the two Quake II save layouts.
//
// Classic: id Quake II 3.20 sv_ccmds.c (SV_WriteServerFile, SV_WriteLevelFile) and qcommon/cmodel.c (CM_WritePortalState).
// Rerelease: the Nightdive engine. Its server.ssv starts with "EVAS" and its level files carry no magic; the layout was
// read from the shipped quake2ex_steam.exe (the level writer at 0x140386750 and reader at 0x140386f70) and checked
// against a real save0.pak.gz.
import { BinaryReader, BinaryWriter } from "../core/binary/index.ts";
import { loadU32LE, storeU32LE } from "../foundation/binary.ts";
import { byteText, readFixed, textBytes, writeFixed } from "./source-bytes.ts";
import { SaveFormatError } from "./value.ts";

export interface SavedCvar {
  readonly name: string;
  readonly value: string;
}
export interface Q2ClassicServerSave {
  readonly comment: string;
  readonly mapCommand: string;
  readonly cvars: readonly SavedCvar[];
}
export interface Q2RereleaseServerSave extends Q2ClassicServerSave {
  /** Unix seconds. */
  readonly timestamp: bigint;
  /** 0 manual, 1 autosave (the retail hub autosave), 2 the third kind the engine defines. */
  readonly kind: 0 | 1 | 2;
}
export interface Q2LevelMetadata {
  readonly configstrings: readonly { readonly index: number; readonly value: string }[];
  /** Classic: the raw `portalopen` array. Rerelease: one byte per area portal. */
  readonly portalBytes: Uint8Array;
}

/** MAX_CONFIGSTRINGS * MAX_QPATH of Quake II 3.20. */
export const Q2_CLASSIC_CONFIGSTRINGS = 2080;
export const Q2_CLASSIC_CONFIGSTRING_WIDTH = 64;
/** MAX_CONFIGSTRINGS and the 96 byte slot of the API 2023 engine. */
export const Q2_RERELEASE_CONFIGSTRINGS = 12448;
export const Q2_RERELEASE_CONFIGSTRING_WIDTH = 96;
/** MAX_MAP_AREAPORTALS of Quake II 3.20; every entry is a 32 bit qboolean. */
export const Q2_CLASSIC_AREA_PORTALS = 1024;

const EVAS = "EVAS";
const MAX_FIELD = 65536;
const LEVEL_END = 0xffffffff;

/**
 * The engine keeps configstrings as one flat array of fixed slots. A string longer than its slot (the status bar)
 * continues through the following slots, so the array, not the individual slot, is what a save file holds.
 */
export function packConfigstrings(entries: readonly { readonly index: number; readonly value: string }[], count: number, width: number): Uint8Array {
  const memory = new Uint8Array(count * width);
  for (const entry of [...entries].sort((left, right) => left.index - right.index)) {
    if (!Number.isInteger(entry.index) || entry.index < 0 || entry.index >= count)
      throw new SaveFormatError("q2.configstring", "configstring index outside the source range");
    if (entry.value.includes("\0")) throw new SaveFormatError("q2.configstring", "configstring contains an interior NUL");
    const bytes = textBytes(entry.value),
      start = entry.index * width;
    if (start + bytes.length >= memory.length) throw new SaveFormatError("q2.configstring", "configstring runs past the configstring array");
    memory.fill(0, start, Math.min(memory.length, start + Math.max(bytes.length + 1, width)));
    memory.set(bytes, start);
  }
  return memory;
}
/** Inverse of `packConfigstrings`: a slot begins a string unless an earlier string's text still covers it. */
export function unpackConfigstrings(memory: Uint8Array, count: number, width: number): { index: number; value: string }[] {
  const entries: { index: number; value: string }[] = [];
  let covered = 0;
  for (let index = 0; index < count; index++) {
    const start = index * width;
    if (memory[start] === 0 || start < covered) continue;
    let end = start;
    while (end < memory.length && memory[end] !== 0) end++;
    entries.push({ index, value: byteText(memory.subarray(start, end)) });
    covered = end + 1;
  }
  return entries;
}

/** The `portalopen` array as the original writes it: 1024 little endian ints. */
export function classicPortalBytes(portals: readonly { readonly portal: number; readonly open: boolean }[]): Uint8Array {
  const bytes = new Uint8Array(Q2_CLASSIC_AREA_PORTALS * 4);
  for (const { portal, open } of portals) {
    if (!Number.isInteger(portal) || portal < 0 || portal >= Q2_CLASSIC_AREA_PORTALS)
      throw new SaveFormatError("q2.portals", "area portal outside MAX_MAP_AREAPORTALS");
    storeU32LE(bytes, portal * 4, open ? 1 : 0);
  }
  return bytes;
}
/** Open portals of a classic `portalopen` array; a closed portal is the default and is not listed. */
export function classicPortalsFrom(bytes: Uint8Array): { portal: number; open: boolean }[] {
  if (bytes.length !== Q2_CLASSIC_AREA_PORTALS * 4) throw new SaveFormatError("q2.portals", "classic portal state must hold MAX_MAP_AREAPORTALS ints");
  const portals: { portal: number; open: boolean }[] = [];
  for (let portal = 0; portal < Q2_CLASSIC_AREA_PORTALS; portal++) if (loadU32LE(bytes, portal * 4) !== 0) portals.push({ portal, open: true });
  return portals;
}
/** One byte per portal of the map; the count must be the map's own, which the engine compares on load. */
export function rereleasePortalBytes(portals: readonly { readonly portal: number; readonly open: boolean }[], count: number): Uint8Array {
  if (!Number.isInteger(count) || count < 0 || count > 0xffff) throw new SaveFormatError("q2.portals", "invalid area portal count");
  const bytes = new Uint8Array(count);
  for (const { portal, open } of portals) {
    if (!Number.isInteger(portal) || portal < 0 || portal >= count) throw new SaveFormatError("q2.portals", "area portal outside the map's portal count");
    bytes[portal] = open ? 1 : 0;
  }
  return bytes;
}
export function rereleasePortalsFrom(bytes: Uint8Array): { portal: number; open: boolean }[] {
  const portals: { portal: number; open: boolean }[] = [];
  for (let portal = 0; portal < bytes.length; portal++) if (bytes[portal] !== 0) portals.push({ portal, open: true });
  return portals;
}

export function decodeQ2ClassicServer(bytes: Uint8Array): Q2ClassicServerSave {
  const reader = new BinaryReader(bytes, "q2/server.ssv");
  const comment = readFixed(reader, 32);
  const mapCommand = readFixed(reader, 128);
  const cvars: SavedCvar[] = [];
  while (reader.remaining > 0) cvars.push({ name: readFixed(reader, 128), value: readFixed(reader, 128) });
  return { comment, mapCommand, cvars };
}
export function encodeQ2ClassicServer(save: Q2ClassicServerSave): Uint8Array {
  const writer = new BinaryWriter(160 + save.cvars.length * 256);
  writeFixed(writer, save.comment, 32);
  writeFixed(writer, save.mapCommand, 128);
  for (const cvar of save.cvars) {
    writeFixed(writer, cvar.name, 128);
    writeFixed(writer, cvar.value, 128);
  }
  return writer.finish();
}
export function decodeQ2ClassicLevelMetadata(bytes: Uint8Array): Q2LevelMetadata {
  const size = Q2_CLASSIC_CONFIGSTRINGS * Q2_CLASSIC_CONFIGSTRING_WIDTH;
  if (bytes.length < size) throw new SaveFormatError("q2.sv2", "classic level metadata is shorter than the configstring array");
  return {
    configstrings: unpackConfigstrings(bytes.subarray(0, size), Q2_CLASSIC_CONFIGSTRINGS, Q2_CLASSIC_CONFIGSTRING_WIDTH),
    portalBytes: bytes.slice(size),
  };
}
export function encodeQ2ClassicLevelMetadata(save: Q2LevelMetadata): Uint8Array {
  const memory = packConfigstrings(save.configstrings, Q2_CLASSIC_CONFIGSTRINGS, Q2_CLASSIC_CONFIGSTRING_WIDTH);
  const bytes = new Uint8Array(memory.length + save.portalBytes.length);
  bytes.set(memory, 0);
  bytes.set(save.portalBytes, memory.length);
  return bytes;
}

function readLengthString(reader: BinaryReader): string {
  const length = reader.u32();
  if (length > MAX_FIELD) throw new SaveFormatError("q2-rerelease", "save string is implausibly long");
  return byteText(reader.bytes(length));
}
function writeLengthString(writer: BinaryWriter, value: string): void {
  const bytes = textBytes(value);
  writer.u32(bytes.length);
  writer.bytes(bytes);
}
export function decodeQ2RereleaseServer(bytes: Uint8Array): Q2RereleaseServerSave {
  const reader = new BinaryReader(bytes, "q2-rerelease/server.ssv");
  if (readFixed(reader, 4) !== EVAS) throw new SaveFormatError("q2-rerelease", "missing EVAS save signature");
  const kind = reader.u8();
  if (kind !== 0 && kind !== 1 && kind !== 2) throw new SaveFormatError("q2-rerelease", "unknown save type");
  const comment = readLengthString(reader);
  const low = reader.u32(),
    high = reader.u32();
  const mapCommand = readLengthString(reader);
  // The latched cvar pairs run to the end of the file; the engine writes no terminator.
  const cvars: SavedCvar[] = [];
  while (reader.remaining > 0) {
    const name = readLengthString(reader);
    if (name === "") break;
    cvars.push({ name, value: readLengthString(reader) });
  }
  if (reader.remaining !== 0) throw new SaveFormatError("q2-rerelease", "trailing server metadata");
  return { timestamp: (BigInt(high) << 32n) | BigInt(low), kind, comment, mapCommand, cvars };
}
export function encodeQ2RereleaseServer(save: Q2RereleaseServerSave): Uint8Array {
  const strings = [save.comment, save.mapCommand, ...save.cvars.flatMap(cvar => [cvar.name, cvar.value])];
  const writer = new BinaryWriter(13 + strings.reduce((total, value) => total + 4 + value.length, 0));
  writer.bytes(textBytes(EVAS));
  writer.u8(save.kind);
  writeLengthString(writer, save.comment);
  writer.u32(Number(BigInt.asUintN(32, save.timestamp)));
  writer.u32(Number(BigInt.asUintN(32, save.timestamp >> 32n)));
  writeLengthString(writer, save.mapCommand);
  for (const cvar of save.cvars) {
    if (cvar.name === "") throw new SaveFormatError("q2-rerelease", "a cvar needs a name");
    writeLengthString(writer, cvar.name);
    writeLengthString(writer, cvar.value);
  }
  return writer.finish();
}
/** `index u32, length u8, text` per non-empty slot, an index of -1, then the portal count (u16) and one byte per portal. */
export function decodeQ2RereleaseLevelMetadata(bytes: Uint8Array): Q2LevelMetadata {
  const reader = new BinaryReader(bytes, "q2-rerelease/level.sv2");
  const memory = new Uint8Array(Q2_RERELEASE_CONFIGSTRINGS * Q2_RERELEASE_CONFIGSTRING_WIDTH);
  for (;;) {
    const index = reader.u32();
    if (index === LEVEL_END) break;
    if (index >= Q2_RERELEASE_CONFIGSTRINGS) throw new SaveFormatError("q2-rerelease", "configstring outside source range");
    const length = reader.u8();
    if (length > Q2_RERELEASE_CONFIGSTRING_WIDTH) throw new SaveFormatError("q2-rerelease", "configstring longer than its slot");
    memory.set(reader.bytes(length), index * Q2_RERELEASE_CONFIGSTRING_WIDTH);
  }
  const portalBytes = reader.bytes(reader.u16());
  if (reader.remaining !== 0) throw new SaveFormatError("q2-rerelease", "trailing level metadata");
  return { configstrings: unpackConfigstrings(memory, Q2_RERELEASE_CONFIGSTRINGS, Q2_RERELEASE_CONFIGSTRING_WIDTH), portalBytes };
}
export function encodeQ2RereleaseLevelMetadata(save: Q2LevelMetadata): Uint8Array {
  const memory = packConfigstrings(save.configstrings, Q2_RERELEASE_CONFIGSTRINGS, Q2_RERELEASE_CONFIGSTRING_WIDTH),
    width = Q2_RERELEASE_CONFIGSTRING_WIDTH;
  const slots: { index: number; length: number }[] = [];
  for (let index = 0; index < Q2_RERELEASE_CONFIGSTRINGS; index++) {
    const start = index * width;
    if (memory[start] === 0) continue;
    let end = start;
    while (end < memory.length && memory[end] !== 0) end++;
    slots.push({ index, length: Math.min(end - start, width) });
  }
  if (save.portalBytes.length > 0xffff) throw new SaveFormatError("q2-rerelease", "too many area portals");
  const writer = new BinaryWriter(6 + save.portalBytes.length + slots.reduce((total, slot) => total + 5 + slot.length, 0));
  for (const slot of slots) {
    writer.u32(slot.index);
    writer.u8(slot.length);
    writer.bytes(memory.subarray(slot.index * width, slot.index * width + slot.length));
  }
  writer.u32(LEVEL_END);
  writer.u16(save.portalBytes.length);
  writer.bytes(save.portalBytes);
  return writer.finish();
}
