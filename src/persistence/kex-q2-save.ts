import { gunzipSync } from "node:zlib";
import { BinaryReader } from "../core/binary/index.ts";
import { byteText, readFixed } from "./source-bytes.ts";
import { SaveFormatError } from "./value.ts";

export interface KexQ2SaveInfo {
  readonly comment: string;
  readonly mapCommand: string;
  /** Unix seconds from the save header. */
  readonly timestamp: bigint;
  readonly gameDirectory: string | null;
  /** Server cvars recorded with the save, excluding the terminating empty name. */
  readonly cvars: ReadonlyMap<string, string>;
}

function readLengthString(reader: BinaryReader): string {
  const length = reader.u32();
  if (length > 65536) throw new SaveFormatError("q2-kex", "save string is implausibly long");
  return byteText(reader.bytes(length));
}

/**
 * KEX Quake II `server.ssv`: an `EVAS` header, a kind byte, then
 * length-prefixed comment, a Unix timestamp, the map command and cvar
 * pairs terminated by an empty name. Distinct from q2repro's `SSV2`.
 */
export function decodeKexQ2ServerSave(bytes: Uint8Array): KexQ2SaveInfo {
  const reader = new BinaryReader(bytes, "q2-kex/server.ssv");
  if (readFixed(reader, 4) !== "EVAS") throw new SaveFormatError("q2-kex", "missing EVAS save signature");
  const kind = reader.u8();
  if (kind !== 0 && kind !== 1 && kind !== 2) throw new SaveFormatError("q2-kex", "unknown save type");
  const comment = readLengthString(reader);
  const low = reader.u32(), high = reader.u32();
  const timestamp = (BigInt(high) << 32n) | BigInt(low);
  const mapCommand = readLengthString(reader);
  let gameDirectory: string | null = null;
  const cvars = new Map<string, string>();
  while (reader.remaining > 0) {
    const name = readLengthString(reader);
    if (name === "") break;
    const value = readLengthString(reader);
    cvars.set(name, value);
    if (name === "gamename") gameDirectory = value;
  }
  if (reader.remaining !== 0) throw new SaveFormatError("q2-kex", "trailing server metadata");
  return { comment, mapCommand, timestamp, gameDirectory, cvars };
}

/** Identify a retail KEX Quake II `saveN.pak.gz` without restoring it. */
export async function readKexQ2SaveInfo(path: string): Promise<KexQ2SaveInfo> {
  return (await readKexQ2SaveArchive(path)).info;
}

export interface KexQ2SaveArchive {
  readonly info: KexQ2SaveInfo;
  /** Lowercase entry names in archive order. */
  readonly files: readonly string[];
  /** Parsed `game.ssv` JSON root, bound as unknown before any interpretation. */
  readonly game: unknown;
}

/** Read the whole retail KEX Quake II save archive (server metadata + JSON game state). */
export async function readKexQ2SaveArchive(path: string): Promise<KexQ2SaveArchive> {
  let pak: Uint8Array;
  try { pak = gunzipSync(await Bun.file(path).bytes()); }
  catch (error) { throw new SaveFormatError("q2-kex", `cannot decompress save archive: ${error instanceof Error ? error.message : String(error)}`); }
  const reader = new BinaryReader(pak, "q2-kex/save.pak");
  if (readFixed(reader, 4) !== "PACK") throw new SaveFormatError("q2-kex", "save archive is not a PAK");
  const directoryOffset = reader.u32(), directoryLength = reader.u32();
  if (directoryLength % 64 !== 0 || directoryOffset + directoryLength > pak.length)
    throw new SaveFormatError("q2-kex", "save archive directory is out of bounds");
  reader.seek(directoryOffset);
  const files: string[] = [], entries = new Map<string, Uint8Array>();
  for (let index = 0; index < directoryLength / 64; index++) {
    const name = readFixed(reader, 56).toLowerCase(), offset = reader.u32(), length = reader.u32();
    if (offset + length > pak.length) throw new SaveFormatError("q2-kex", `save entry ${name} is out of bounds`);
    files.push(name); entries.set(name, pak.subarray(offset, offset + length));
  }
  const server = entries.get("server.ssv");
  if (server === undefined) throw new SaveFormatError("q2-kex", "save archive has no server.ssv");
  const gameBytes = entries.get("game.ssv");
  let game: unknown = null;
  if (gameBytes !== undefined) {
    try { const parsed: unknown = JSON.parse(new TextDecoder().decode(gameBytes)); game = parsed; }
    catch { throw new SaveFormatError("q2-kex", "game.ssv is not JSON"); }
  }
  return { info: decodeKexQ2ServerSave(server), files, game };
}

/**
 * A transition-shaped save carries no level or client state beyond the
 * destination map: restoring it is a fresh spawn with the recorded server
 * cvars, exactly like the retail hub autosave. Saves with real client or
 * level records are not restorable yet and stay identified-only.
 */
export function kexQ2SaveRestorable(save: KexQ2SaveArchive): boolean {
  if (!save.files.every(name => name === "server.ssv" || name === "game.ssv")) return false;
  const game: unknown = save.game;
  if (typeof game !== "object" || game === null || Array.isArray(game)) return false;
  const clients: unknown = Reflect.get(game, "clients");
  if (clients === undefined) return true;
  if (!Array.isArray(clients)) return false;
  for (let index = 0; index < clients.length; index++) {
    const client: unknown = clients[index];
    if (typeof client !== "object" || client === null || Array.isArray(client) || Object.keys(client).length !== 0) return false;
  }
  return true;
}
