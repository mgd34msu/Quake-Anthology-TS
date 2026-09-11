// Engine-owned metadata from Quake II sv_ccmds.c and q2repro src/server/save.c.
import { BinaryReader, BinaryWriter } from "../core/binary/index.ts";
import { readCString, readFixed, writeCString, writeFixed } from "./source-bytes.ts";
import { SaveFormatError } from "./value.ts";

export interface SavedCvar { readonly name: string; readonly value: string; }
export interface Q2ClassicServerSave { readonly comment: string; readonly mapCommand: string; readonly cvars: readonly SavedCvar[]; }
export interface Q2RereleaseServerSave extends Q2ClassicServerSave { readonly timestamp: bigint; readonly kind: 0 | 1 | 2; }
export interface Q2LevelMetadata { readonly configstrings: readonly { readonly index: number; readonly value: string }[]; readonly portalBytes: Uint8Array; }
const SSV2 = 0x32565353;
const SAV2 = 0x32564153;

export function decodeQ2ClassicServer(bytes: Uint8Array): Q2ClassicServerSave {
  const reader = new BinaryReader(bytes, "q2/server.ssv");
  const comment = readFixed(reader, 32); const mapCommand = readFixed(reader, 128); const cvars: SavedCvar[] = [];
  while (reader.remaining > 0) cvars.push({ name: readFixed(reader, 128), value: readFixed(reader, 128) });
  return { comment, mapCommand, cvars };
}
export function encodeQ2ClassicServer(save: Q2ClassicServerSave): Uint8Array {
  const writer = new BinaryWriter(160 + save.cvars.length * 256); writeFixed(writer, save.comment, 32); writeFixed(writer, save.mapCommand, 128);
  for (const cvar of save.cvars) { writeFixed(writer, cvar.name, 128); writeFixed(writer, cvar.value, 128); }
  return writer.finish();
}
export function decodeQ2ClassicLevelMetadata(bytes: Uint8Array, configstringCount = 2080, width = 64): Q2LevelMetadata {
  const reader = new BinaryReader(bytes, "q2/level.sv2");
  const configstrings: { index: number; value: string }[] = [];
  for (let index = 0; index < configstringCount; index++) { const value = readFixed(reader, width); if (value.length !== 0) configstrings.push({ index, value }); }
  return { configstrings, portalBytes: reader.bytes(reader.remaining) };
}
export function encodeQ2ClassicLevelMetadata(save: Q2LevelMetadata, configstringCount = 2080, width = 64): Uint8Array {
  const writer = new BinaryWriter(configstringCount * width + save.portalBytes.length); const values = new Map(save.configstrings.map(entry => [entry.index, entry.value] satisfies [number, string]));
  for (let index = 0; index < configstringCount; index++) writeFixed(writer, values.get(index) ?? "", width);
  writer.bytes(save.portalBytes); return writer.finish();
}
export function decodeQ2RereleaseServer(bytes: Uint8Array): Q2RereleaseServerSave {
  const reader = new BinaryReader(bytes, "q2-rerelease/server.ssv");
  if (reader.u32() !== SSV2 || reader.u32() !== 1) throw new SaveFormatError("q2-rerelease", "unsupported server save version");
  const low = reader.u32(); const high = reader.u32(); const timestamp = (BigInt(high) << 32n) | BigInt(low);
  const kind = reader.u8(); if (kind !== 0 && kind !== 1 && kind !== 2) throw new SaveFormatError("q2-rerelease", "unknown save type");
  const comment = readCString(reader); const mapCommand = readCString(reader); const cvars: SavedCvar[] = [];
  for (;;) { const name = readCString(reader); if (name === "") break; cvars.push({ name, value: readCString(reader) }); }
  if (reader.remaining !== 0) throw new SaveFormatError("q2-rerelease", "trailing server metadata");
  return { timestamp, kind, comment, mapCommand, cvars };
}
export function encodeQ2RereleaseServer(save: Q2RereleaseServerSave): Uint8Array {
  const size = 20 + save.comment.length + save.mapCommand.length + save.cvars.reduce((total, cvar) => total + cvar.name.length + cvar.value.length + 2, 0);
  const writer = new BinaryWriter(size); writer.u32(SSV2); writer.u32(1);
  writer.u32(Number(BigInt.asUintN(32, save.timestamp))); writer.u32(Number(BigInt.asUintN(32, save.timestamp >> 32n))); writer.u8(save.kind);
  writeCString(writer, save.comment); writeCString(writer, save.mapCommand);
  for (const cvar of save.cvars) { writeCString(writer, cvar.name); writeCString(writer, cvar.value); }
  writeCString(writer, ""); return writer.finish();
}
export function decodeQ2RereleaseLevelMetadata(bytes: Uint8Array, configstringEnd: number): Q2LevelMetadata {
  const reader = new BinaryReader(bytes, "q2-rerelease/level.sv2");
  if (reader.u32() !== SAV2 || reader.u32() !== 1) throw new SaveFormatError("q2-rerelease", "unsupported level save version");
  const configstrings: { index: number; value: string }[] = [];
  for (;;) {
    const index = reader.u16(); if (index === configstringEnd) break;
    if (index > configstringEnd) throw new SaveFormatError("q2-rerelease", "configstring outside source range");
    configstrings.push({ index, value: readCString(reader) });
  }
  const portalBytes = reader.bytes(reader.u8());
  if (reader.remaining !== 0) throw new SaveFormatError("q2-rerelease", "trailing level metadata");
  return { configstrings, portalBytes };
}
export function encodeQ2RereleaseLevelMetadata(save: Q2LevelMetadata, configstringEnd: number): Uint8Array {
  const writer = new BinaryWriter(11 + save.portalBytes.length + save.configstrings.reduce((total, entry) => total + entry.value.length + 3, 0)); writer.u32(SAV2); writer.u32(1);
  for (const entry of save.configstrings) {
    if (entry.index < 0 || entry.index >= configstringEnd) throw new SaveFormatError("q2-rerelease", "configstring outside source range");
    writer.u16(entry.index); writeCString(writer, entry.value);
  }
  writer.u16(configstringEnd); writer.u8(save.portalBytes.length); writer.bytes(save.portalBytes); return writer.finish();
}
