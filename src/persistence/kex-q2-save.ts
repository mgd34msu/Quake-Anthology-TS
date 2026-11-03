// SPDX-License-Identifier: GPL-2.0-or-later
import { gunzipSync, gzipSync } from "node:zlib";
import { BinaryReader, BinaryWriter } from "../core/binary/index.ts";
import { decodeQ2RereleaseServer, type Q2RereleaseServerSave } from "./q2-containers.ts";
import { readFixed, textBytes } from "./source-bytes.ts";
import { SaveFormatError } from "./value.ts";

export interface KexQ2SaveInfo {
  readonly comment: string;
  readonly mapCommand: string;
  /** Unix seconds from the save header. */
  readonly timestamp: bigint;
  /** 0 manual, 1 autosave. */
  readonly kind: 0 | 1 | 2;
  readonly gameDirectory: string | null;
  /** Server cvars recorded with the save, excluding the terminating empty name. */
  readonly cvars: ReadonlyMap<string, string>;
}

/**
 * KEX Quake II `server.ssv`: an `EVAS` header, a kind byte, a length-prefixed comment, a Unix timestamp, the map
 * command and the latched cvar pairs terminated by an empty name.
 */
export function decodeKexQ2ServerSave(bytes: Uint8Array): KexQ2SaveInfo {
  return serverInfo(decodeQ2RereleaseServer(bytes));
}
function serverInfo(server: Q2RereleaseServerSave): KexQ2SaveInfo {
  const cvars = new Map(server.cvars.map(cvar => [cvar.name, cvar.value] satisfies [string, string]));
  return {
    comment: server.comment,
    mapCommand: server.mapCommand,
    timestamp: server.timestamp,
    kind: server.kind,
    gameDirectory: cvars.get("gamename") ?? null,
    cvars,
  };
}

/** Identify a retail KEX Quake II `saveN.pak.gz` without restoring it. */
export async function readKexQ2SaveInfo(path: string): Promise<KexQ2SaveInfo> {
  return (await readKexQ2SaveArchive(path)).info;
}

export interface KexQ2SaveArchive {
  readonly info: KexQ2SaveInfo;
  readonly server: Q2RereleaseServerSave;
  /** Lowercase entry names in archive order. */
  readonly files: readonly string[];
  /** Every entry by lowercase name. */
  readonly entries: ReadonlyMap<string, Uint8Array>;
  /** Parsed `game.ssv` JSON root, bound as unknown before any interpretation. */
  readonly game: unknown;
}

/** Retail saves are a few MB; the bound stops a gzip bomb dropped into a scanned save directory. */
const MAX_KEX_SAVE_BYTES = 256 * 1024 * 1024;
const PAK_NAME_BYTES = 56;
const PAK_ENTRY_BYTES = 64;

/** Read the whole retail KEX Quake II save archive (server metadata, JSON game state and the per-level files). */
export async function readKexQ2SaveArchive(path: string): Promise<KexQ2SaveArchive> {
  return parseKexQ2SaveArchive(await Bun.file(path).bytes());
}
export function parseKexQ2SaveArchive(compressed: Uint8Array): KexQ2SaveArchive {
  let pak: Uint8Array;
  try {
    pak = new Uint8Array(gunzipSync(compressed, { maxOutputLength: MAX_KEX_SAVE_BYTES }));
  } catch (error) {
    throw new SaveFormatError("q2-kex", `cannot decompress save archive: ${error instanceof Error ? error.message : String(error)}`);
  }
  const reader = new BinaryReader(pak, "q2-kex/save.pak");
  if (readFixed(reader, 4) !== "PACK") throw new SaveFormatError("q2-kex", "save archive is not a PAK");
  const directoryOffset = reader.u32(),
    directoryLength = reader.u32();
  if (directoryLength % PAK_ENTRY_BYTES !== 0 || directoryOffset + directoryLength > pak.length)
    throw new SaveFormatError("q2-kex", "save archive directory is out of bounds");
  reader.seek(directoryOffset);
  const files: string[] = [],
    entries = new Map<string, Uint8Array>();
  for (let index = 0; index < directoryLength / PAK_ENTRY_BYTES; index++) {
    const name = readFixed(reader, PAK_NAME_BYTES).toLowerCase(),
      offset = reader.u32(),
      length = reader.u32();
    if (offset + length > pak.length) throw new SaveFormatError("q2-kex", `save entry ${name} is out of bounds`);
    if (entries.has(name)) throw new SaveFormatError("q2-kex", `save archive repeats ${name}`);
    files.push(name);
    entries.set(name, pak.subarray(offset, offset + length));
  }
  const serverBytes = entries.get("server.ssv");
  if (serverBytes === undefined) throw new SaveFormatError("q2-kex", "save archive has no server.ssv");
  const gameBytes = entries.get("game.ssv");
  let game: unknown = null;
  if (gameBytes !== undefined) {
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(gameBytes));
      game = parsed;
    } catch {
      throw new SaveFormatError("q2-kex", "game.ssv is not JSON");
    }
  }
  const server = decodeQ2RereleaseServer(serverBytes);
  return { info: serverInfo(server), server, files, entries, game };
}

/**
 * The archive layout the engine writes: `PACK`, the directory offset and length, the directory first and the file
 * data after it in directory order, gzip compressed. Re-packing the entries of a retail save reproduces its pak.
 */
export function packKexQ2SaveArchive(entries: readonly (readonly [string, Uint8Array])[]): Uint8Array {
  const names = new Set<string>();
  for (const [name] of entries) {
    if (name.length === 0 || name.length >= PAK_NAME_BYTES || /[\\/]/.test(name)) throw new SaveFormatError("q2-kex", `invalid save entry name ${name}`);
    if (names.has(name.toLowerCase())) throw new SaveFormatError("q2-kex", `save archive repeats ${name}`);
    names.add(name.toLowerCase());
  }
  const directoryLength = entries.length * PAK_ENTRY_BYTES,
    dataStart = 12 + directoryLength;
  const writer = new BinaryWriter(dataStart + entries.reduce((total, [, bytes]) => total + bytes.length, 0));
  writer.bytes(textBytes("PACK"));
  writer.u32(12);
  writer.u32(directoryLength);
  let offset = dataStart;
  for (const [name, bytes] of entries) {
    const field = new Uint8Array(PAK_NAME_BYTES);
    field.set(textBytes(name));
    writer.bytes(field);
    writer.u32(offset);
    writer.u32(bytes.length);
    offset += bytes.length;
  }
  for (const [, bytes] of entries) writer.bytes(bytes);
  return new Uint8Array(gzipSync(writer.finish()));
}
