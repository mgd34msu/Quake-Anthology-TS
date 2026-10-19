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
  while (reader.remaining > 0) {
    const name = readLengthString(reader);
    if (name === "") break;
    const value = readLengthString(reader);
    if (name === "gamename") gameDirectory = value;
  }
  if (reader.remaining !== 0) throw new SaveFormatError("q2-kex", "trailing server metadata");
  return { comment, mapCommand, timestamp, gameDirectory };
}

/** Identify a retail KEX Quake II `saveN.pak.gz` without restoring it. */
export async function readKexQ2SaveInfo(path: string): Promise<KexQ2SaveInfo> {
  let pak: Uint8Array;
  try { pak = gunzipSync(await Bun.file(path).bytes()); }
  catch (error) { throw new SaveFormatError("q2-kex", `cannot decompress save archive: ${error instanceof Error ? error.message : String(error)}`); }
  const reader = new BinaryReader(pak, "q2-kex/save.pak");
  if (readFixed(reader, 4) !== "PACK") throw new SaveFormatError("q2-kex", "save archive is not a PAK");
  const directoryOffset = reader.u32(), directoryLength = reader.u32();
  if (directoryLength % 64 !== 0 || directoryOffset + directoryLength > pak.length)
    throw new SaveFormatError("q2-kex", "save archive directory is out of bounds");
  reader.seek(directoryOffset);
  for (let index = 0; index < directoryLength / 64; index++) {
    const name = readFixed(reader, 56), offset = reader.u32(), length = reader.u32();
    if (name.toLowerCase() !== "server.ssv") continue;
    if (offset + length > pak.length) throw new SaveFormatError("q2-kex", "server.ssv is out of bounds");
    return decodeKexQ2ServerSave(pak.subarray(offset, offset + length));
  }
  throw new SaveFormatError("q2-kex", "save archive has no server.ssv");
}
