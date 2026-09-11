// Original Quake II game/g_save.c raw struct records and source-order appended strings.
import { BinaryReader, BinaryWriter } from "../core/binary/index.ts";
import type { ModuleIdentity } from "../contracts/execution.ts";
import { SaveFormatError } from "./value.ts";

export interface Q2ClassicSaveField {
  readonly name: string;
  readonly offset: number;
  readonly kind: "string" | "entity" | "client" | "item" | "function" | "move";
}
export interface Q2ClassicRecordLayout { readonly byteLength: number; readonly fields: readonly Q2ClassicSaveField[]; }
/** Native save structs are build/ABI dependent. The game module supplies its verified layout. */
export interface Q2ClassicSaveLayout {
  readonly module: ModuleIdentity;
  readonly pointerBytes: 4 | 8;
  readonly gameBytes: number;
  readonly clientCountOffset: number;
  readonly client: Q2ClassicRecordLayout;
  readonly level: Q2ClassicRecordLayout;
  readonly entity: Q2ClassicRecordLayout;
}
export interface Q2ClassicString { readonly field: string; readonly bytes: Uint8Array | null; }
export interface Q2ClassicReference { readonly field: string; readonly index: number; }
export interface Q2ClassicRecord { readonly bytes: Uint8Array; readonly strings: readonly Q2ClassicString[]; readonly references: readonly Q2ClassicReference[]; }
export interface Q2ClassicGameSave { readonly buildDate: Uint8Array; readonly game: Uint8Array; readonly clients: readonly Q2ClassicRecord[]; }
export interface Q2ClassicLevelSave { readonly functionBase: bigint; readonly level: Q2ClassicRecord; readonly entities: readonly { readonly slot: number; readonly record: Q2ClassicRecord }[]; }

function recordSize(record: Q2ClassicRecord): number { return record.bytes.length + record.strings.reduce((total, string) => total + (string.bytes?.length ?? 0), 0); }
function fieldView(bytes: Uint8Array, field: Q2ClassicSaveField): DataView {
  if (!Number.isSafeInteger(field.offset) || field.offset < 0 || field.offset + 4 > bytes.length) throw new SaveFormatError(field.name, "save field is outside its native struct");
  return new DataView(bytes.buffer, bytes.byteOffset + field.offset, 4);
}
function readRecord(reader: BinaryReader, layout: Q2ClassicRecordLayout): Q2ClassicRecord {
  const bytes = reader.bytes(layout.byteLength); const strings: Q2ClassicString[] = []; const references: Q2ClassicReference[] = [];
  for (const field of layout.fields) {
    const value = fieldView(bytes, field).getInt32(0, true);
    if (field.kind === "string") {
      const string = value === 0 ? null : reader.bytes(value);
      if (string !== null && string[string.length - 1] !== 0) throw new SaveFormatError(field.name, "source string lacks a NUL terminator");
      strings.push({ field: field.name, bytes: string });
    } else references.push({ field: field.name, index: value });
  }
  return { bytes, strings, references };
}
function writeRecord(writer: BinaryWriter, record: Q2ClassicRecord, layout: Q2ClassicRecordLayout): void {
  if (record.bytes.length !== layout.byteLength) throw new SaveFormatError("q2-record", "native struct size mismatch");
  const bytes = record.bytes.slice(); const tails: Uint8Array[] = [];
  for (const field of layout.fields) {
    if (field.kind === "string") {
      const string = record.strings.find(candidate => candidate.field === field.name);
      if (string === undefined) throw new SaveFormatError(field.name, "missing native saved string");
      const tail = string.bytes;
      if (tail !== null && tail[tail.length - 1] !== 0) throw new SaveFormatError(field.name, "source string lacks a NUL terminator");
      fieldView(bytes, field).setInt32(0, tail?.length ?? 0, true);
      if (tail !== null) tails.push(tail);
    } else {
      const reference = record.references.find(candidate => candidate.field === field.name);
      if (reference === undefined) throw new SaveFormatError(field.name, "missing native saved reference");
      fieldView(bytes, field).setInt32(0, reference.index, true);
    }
  }
  writer.bytes(bytes); for (const tail of tails) writer.bytes(tail);
}
export function decodeQ2ClassicGame(bytes: Uint8Array, layout: Q2ClassicSaveLayout): Q2ClassicGameSave {
  const reader = new BinaryReader(bytes, `${layout.module.id}/game.ssv`);
  const buildDate = reader.bytes(16); const game = reader.bytes(layout.gameBytes);
  const countField: Q2ClassicSaveField = { name: "game.maxclients", offset: layout.clientCountOffset, kind: "client" };
  const count = fieldView(game, countField).getInt32(0, true);
  if (count < 0 || count > Math.floor(reader.remaining / layout.client.byteLength)) throw new SaveFormatError("game.maxclients", "client count exceeds save bytes");
  const clients = Array.from({ length: count }, () => readRecord(reader, layout.client));
  if (reader.remaining !== 0) throw new SaveFormatError("game.ssv", "unconsumed bytes indicate a mismatched native layout");
  return { buildDate, game, clients };
}
export function encodeQ2ClassicGame(save: Q2ClassicGameSave, layout: Q2ClassicSaveLayout): Uint8Array {
  if (save.buildDate.length !== 16 || save.game.length !== layout.gameBytes) throw new SaveFormatError("game.ssv", "native game header size mismatch");
  const game = save.game.slice(); fieldView(game, { name: "game.maxclients", offset: layout.clientCountOffset, kind: "client" }).setInt32(0, save.clients.length, true);
  const writer = new BinaryWriter(16 + game.length + save.clients.reduce((total, record) => total + recordSize(record), 0));
  writer.bytes(save.buildDate); writer.bytes(game); for (const client of save.clients) writeRecord(writer, client, layout.client); return writer.finish();
}
export function decodeQ2ClassicLevel(bytes: Uint8Array, layout: Q2ClassicSaveLayout): Q2ClassicLevelSave {
  const reader = new BinaryReader(bytes, `${layout.module.id}/level.sav`);
  if (reader.i32() !== layout.entity.byteLength) throw new SaveFormatError("level.sav", "native edict size mismatch");
  const low = reader.u32(); const functionBase = BigInt(low) | (layout.pointerBytes === 8 ? BigInt(reader.u32()) << 32n : 0n);
  const level = readRecord(reader, layout.level); const entities: { slot: number; record: Q2ClassicRecord }[] = [];
  for (;;) { const slot = reader.i32(); if (slot === -1) break; if (slot < 0) throw new SaveFormatError("level.sav", "invalid native edict slot"); entities.push({ slot, record: readRecord(reader, layout.entity) }); }
  if (reader.remaining !== 0) throw new SaveFormatError("level.sav", "unconsumed bytes indicate a mismatched native layout");
  return { functionBase, level, entities };
}
export function encodeQ2ClassicLevel(save: Q2ClassicLevelSave, layout: Q2ClassicSaveLayout): Uint8Array {
  const writer = new BinaryWriter(8 + layout.pointerBytes + recordSize(save.level) + save.entities.reduce((total, entity) => total + 4 + recordSize(entity.record), 0));
  writer.i32(layout.entity.byteLength); writer.u32(Number(BigInt.asUintN(32, save.functionBase)));
  if (layout.pointerBytes === 8) writer.u32(Number(BigInt.asUintN(32, save.functionBase >> 32n)));
  writeRecord(writer, save.level, layout.level);
  for (const entity of save.entities) { writer.i32(entity.slot); writeRecord(writer, entity.record, layout.entity); }
  writer.i32(-1); return writer.finish();
}

export interface Q2ClassicRelocations {
  readonly pointerBytes: 4 | 8;
  string(field: string, bytes: Uint8Array | null): bigint;
  reference(field: Q2ClassicSaveField, index: number): bigint;
}
/** Resolves saved indexes/relative offsets into the restoring guest owner's address space. */
export function restoreQ2ClassicRecord(record: Q2ClassicRecord, layout: Q2ClassicRecordLayout, relocations: Q2ClassicRelocations): Uint8Array {
  if (record.bytes.length !== layout.byteLength) throw new SaveFormatError("q2-record", "native struct size mismatch");
  const bytes = record.bytes.slice(); const view = new DataView(bytes.buffer);
  for (const field of layout.fields) {
    let pointer: bigint;
    if (field.kind === "string") {
      const value = record.strings.find(string => string.field === field.name);
      if (value === undefined) throw new SaveFormatError(field.name, "missing source string relocation");
      pointer = relocations.string(field.name, value.bytes);
    } else {
      const value = record.references.find(reference => reference.field === field.name);
      if (value === undefined) throw new SaveFormatError(field.name, "missing source pointer relocation");
      pointer = relocations.reference(field, value.index);
    }
    if (pointer < 0n || pointer >= (1n << BigInt(relocations.pointerBytes * 8))) throw new SaveFormatError(field.name, "restored pointer exceeds guest ABI");
    if (relocations.pointerBytes === 4) view.setUint32(field.offset, Number(pointer), true); else view.setBigUint64(field.offset, pointer, true);
  }
  return bytes;
}
