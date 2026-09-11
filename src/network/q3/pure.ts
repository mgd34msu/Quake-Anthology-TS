// FS_LoadZipFile checksums and SV_VerifyPaks_f, files.c and sv_client.c.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.
import type { ArchiveHandle } from "../../content/archive/index.ts";
import { blockChecksum, blockChecksumKey } from "../../core/md4.ts";
import { nativeAtoi } from "../../core/numeric.ts";
import type { ServerPak } from "./pak-references.ts";

/** Nonempty entries contribute CRC words in physical central-directory order. */
export function q3ArchiveChecksums(archive: ArchiveHandle, checksumFeed: number): { readonly checksum: number; readonly pureChecksum: number } {
  if (archive.format === "pak") throw new RangeError("Q3 pak checksums require a ZIP/PK3 central directory");
  const entries = archive.entries.filter(entry => entry.byteLength > 0);
  const bytes = new Uint8Array(entries.length * 4), view = new DataView(bytes.buffer);
  for (const [index, entry] of entries.entries()) {
    if (entry.format === "pak") throw new RangeError("Q3 ZIP directory contains a PAK entry");
    view.setUint32(index * 4, entry.crc32, true);
  }
  return { checksum: blockChecksum(bytes), pureChecksum: blockChecksumKey(bytes, checksumFeed) };
}
export interface Q3PureServer {
  readonly enabled: boolean;
  readonly checksumFeed: number;
  readonly checksumFeedServerId: number;
  readonly cgameChecksum: number | undefined;
  readonly uiChecksum: number | undefined;
  readonly loadedPureChecksums: readonly number[];
}
export type Q3PureResult = { readonly kind: "ignored"; readonly reason: "disabled" | "outdated" }
  | { readonly kind: "authentic" }
  | { readonly kind: "rejected"; readonly reason: string };
/** Attests referenced PK3 bytes; executable TS identity is negotiated separately. */
export function verifyQ3PureCommand(server: Q3PureServer, argv: readonly string[]): Q3PureResult {
  if (!server.enabled) return { kind: "ignored", reason: "disabled" };
  if (nativeAtoi(argv[1] ?? "") < server.checksumFeedServerId) return { kind: "ignored", reason: "outdated" };
  const rejected: Q3PureResult = { kind: "rejected", reason: "Unpure client detected. Invalid .PK3 files referenced!" };
  if (server.cgameChecksum === undefined || server.uiChecksum === undefined || argv.length < 6 || argv.length - 5 > 1024) return rejected;
  const cgame = argv[2] ?? "", ui = argv[3] ?? "";
  if (cgame.startsWith("@") || nativeAtoi(cgame) !== (server.cgameChecksum | 0)
    || ui.startsWith("@") || nativeAtoi(ui) !== (server.uiChecksum | 0) || !(argv[4] ?? "").startsWith("@")) return rejected;
  const checksums = argv.slice(5).map(nativeAtoi), referenceCount = checksums.length - 1, unique = new Set<number>();
  for (let index = 0; index < referenceCount; index++) {
    const checksum = checksums[index];
    if (checksum === undefined || unique.has(checksum)) return rejected;
    unique.add(checksum);
  }
  const loaded = new Set(server.loadedPureChecksums.slice(0, 1024).map(value => value | 0));
  let checksum = server.checksumFeed;
  for (const reference of unique) { if (!loaded.has(reference)) return rejected; checksum ^= reference; }
  checksum ^= referenceCount;
  return checksum === checksums[referenceCount] ? { kind: "authentic" } : rejected;
}
export function checkQ3DownloadName(name: string): void {
  if (name.length === 0 || name.length >= 4096 || name.includes("..") || !/^[A-Za-z0-9_+./-]+$/.test(name)
    || name.startsWith("/") || name.split("/").some(component => component === "" || component === ".")
    || !name.toLowerCase().endsWith(".pk3")) throw new RangeError(`Unsafe package download name: ${JSON.stringify(name)}`);
}
export function q3StockPackage(name: string): "baseq3" | "missionpack" | null {
  const normalized = name.replaceAll("\\", "/").replaceAll(":", "/").toLowerCase();
  if (/^baseq3\/pak[0-8](\.pk3)?$/.test(normalized)) return "baseq3";
  if (/^missionpack\/pak[0-8](\.pk3)?$/.test(normalized)) return "missionpack";
  return null;
}
export function compareQ3Packages(referenced: readonly ServerPak[], loadedChecksums: readonly number[], exists: (name: string) => boolean, download: boolean, capacity = 1024): string {
  if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError("Package comparison needs a nonempty buffer");
  const loaded = new Set(loadedChecksums.map(value => value >>> 0));
  let result = "";
  const append = (text: string): void => { result += text.slice(0, Math.max(0, capacity - 1 - result.length)); };
  for (const pack of referenced) {
    if (pack.name === null || pack.name === "" || loaded.has(pack.checksum >>> 0) || q3StockPackage(pack.name) !== null) continue;
    const remote = `${pack.name}.pk3`; checkQ3DownloadName(remote);
    const present = exists(remote);
    if (download) { append(`@${remote}@`); append(present ? `${pack.name}.${(pack.checksum >>> 0).toString(16).padStart(8, "0")}.pk3` : remote); }
    else { append(remote); if (present) append(" (local file exists with wrong checksum)"); append("\n"); }
  }
  return result;
}
