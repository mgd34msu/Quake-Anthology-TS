// SPDX-License-Identifier: GPL-2.0-or-later
// Format authority: https://learn.microsoft.com/en-us/windows/win32/debug/pe-format
import type { NativeAbi } from "../../contracts/execution.ts";
import type { GuestPermissions } from "../core/contracts.ts";

export class PeError extends Error {
  constructor(readonly stage: "headers" | "mapping" | "relocation" | "imports" | "exports" | "tls" | "unwind" | "load-config", detail: string) {
    super(`PE ${stage}: ${detail}`);
    this.name = "PeError";
  }
}
export interface PeDirectory { readonly rva: number; readonly byteLength: number; }
export interface PeSection {
  readonly name: string;
  readonly rva: number;
  readonly virtualSize: number;
  readonly mappedSize: number;
  readonly rawOffset: number;
  readonly rawSize: number;
  readonly characteristics: number;
  readonly permissions: GuestPermissions;
}
export interface PeFile {
  readonly abi: NativeAbi;
  readonly preferredBase: bigint;
  readonly entryPointRva: number;
  readonly imageSize: number;
  readonly headerSize: number;
  readonly sectionAlignment: number;
  readonly fileAlignment: number;
  readonly characteristics: number;
  readonly dllCharacteristics: number;
  readonly sections: readonly PeSection[];
  readonly directories: readonly PeDirectory[];
}

export function checkedRange(offset: number, length: number, limit: number, stage: PeError["stage"]): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > limit || length > limit - offset) {
    throw new PeError(stage, `range ${offset}+${length} exceeds ${limit}`);
  }
}
export class PeReader {
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array, readonly stage: PeError["stage"]) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  u16(offset: number): number { checkedRange(offset, 2, this.bytes.length, this.stage); return this.view.getUint16(offset, true); }
  u32(offset: number): number { checkedRange(offset, 4, this.bytes.length, this.stage); return this.view.getUint32(offset, true); }
  u64(offset: number): bigint { checkedRange(offset, 8, this.bytes.length, this.stage); return this.view.getBigUint64(offset, true); }
  text(offset: number, limit: number): string {
    checkedRange(offset, limit, this.bytes.length, this.stage);
    let text = "";
    for (let i = offset; i < offset + limit; i++) {
      const value = this.bytes[i];
      if (value === 0) return text;
      if (value === undefined || value > 127) throw new PeError(this.stage, "invalid ASCII string");
      text += String.fromCharCode(value);
    }
    throw new PeError(this.stage, "unterminated ASCII string");
  }
}
function powerOfTwo(value: number): boolean { return value > 0 && Number.isInteger(Math.log2(value)); }
function align(value: number, alignment: number): number { return Math.ceil(value / alignment) * alignment; }
function permissions(flags: number): GuestPermissions {
  const read = (flags & 0x40000000) !== 0;
  const write = (flags & 0x80000000) !== 0;
  const execute = (flags & 0x20000000) !== 0;
  if (write) return execute ? "read-write-execute" : "read-write";
  if (execute) return read ? "read-execute" : "execute";
  return read ? "read" : "none";
}

export function parsePe(bytes: Uint8Array): PeFile {
  const reader = new PeReader(bytes, "headers");
  if (reader.u16(0) !== 0x5a4d) throw new PeError("headers", "missing MZ signature");
  const pe = reader.u32(0x3c);
  if (pe < 64 || reader.u32(pe) !== 0x4550) throw new PeError("headers", "invalid PE signature offset");
  const machine = reader.u16(pe + 4);
  const sectionCount = reader.u16(pe + 6);
  const optionalSize = reader.u16(pe + 20);
  const characteristics = reader.u16(pe + 22);
  if (sectionCount < 1 || sectionCount > 96 || (characteristics & 2) === 0) throw new PeError("headers", "invalid executable section count/characteristics");
  const optional = pe + 24;
  checkedRange(optional, optionalSize, bytes.length, "headers");
  const magic = reader.u16(optional);
  let abi: NativeAbi;
  let directoryOffset: number;
  if (machine === 0x14c && magic === 0x10b) {
    abi = { kind: "windows-i386", image: "pe32", pointerBytes: 4, call: "cdecl" };
    directoryOffset = 96;
  } else if (machine === 0x8664 && magic === 0x20b) {
    abi = { kind: "windows-x86-64", image: "pe32+", pointerBytes: 8, call: "microsoft-x64" };
    directoryOffset = 112;
  } else throw new PeError("headers", `unsupported machine/magic 0x${machine.toString(16)}/0x${magic.toString(16)}`);
  if (optionalSize < directoryOffset) throw new PeError("headers", "truncated optional header");
  const preferredBase = abi.pointerBytes === 4 ? BigInt(reader.u32(optional + 28)) : reader.u64(optional + 24);
  const entryPointRva = reader.u32(optional + 16);
  const sectionAlignment = reader.u32(optional + 32);
  const fileAlignment = reader.u32(optional + 36);
  const imageSize = reader.u32(optional + 56);
  const headerSize = reader.u32(optional + 60);
  if (!powerOfTwo(sectionAlignment) || !powerOfTwo(fileAlignment) || fileAlignment > 65536 || sectionAlignment < fileAlignment ||
      (sectionAlignment < 4096 ? fileAlignment !== sectionAlignment : fileAlignment < 512)) throw new PeError("headers", "invalid section/file alignment");
  if (preferredBase === 0n || preferredBase % 65536n !== 0n || imageSize === 0 || imageSize % sectionAlignment !== 0 ||
      headerSize === 0 || headerSize % fileAlignment !== 0 || headerSize > imageSize || preferredBase + BigInt(imageSize) > (1n << BigInt(abi.pointerBytes * 8))) {
    throw new PeError("headers", "invalid image base/size or header size");
  }
  checkedRange(0, headerSize, bytes.length, "headers");
  const directoryCount = reader.u32(optional + directoryOffset - 4);
  if (directoryCount > 16 || directoryOffset + directoryCount * 8 > optionalSize) throw new PeError("headers", "unsupported/truncated data directory array");
  const directories: PeDirectory[] = [];
  for (let i = 0; i < 16; i++) {
    const rva = i < directoryCount ? reader.u32(optional + directoryOffset + i * 8) : 0;
    const byteLength = i < directoryCount ? reader.u32(optional + directoryOffset + i * 8 + 4) : 0;
    if ((rva === 0) !== (byteLength === 0) && i !== 8) throw new PeError("headers", `inconsistent data directory ${i}`);
    checkedRange(rva, byteLength, i === 4 ? bytes.length : imageSize, "headers");
    directories.push({ rva, byteLength });
  }
  const sections: PeSection[] = [];
  const table = optional + optionalSize;
  checkedRange(table, sectionCount * 40, headerSize, "headers");
  let end = align(headerSize, sectionAlignment);
  for (let i = 0; i < sectionCount; i++) {
    const at = table + i * 40;
    const nameBytes = bytes.slice(at, at + 8);
    const name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes.subarray(0, nameBytes.indexOf(0) < 0 ? 8 : nameBytes.indexOf(0)));
    const virtualSize = reader.u32(at + 8);
    const rva = reader.u32(at + 12);
    const rawSize = reader.u32(at + 16);
    const rawOffset = reader.u32(at + 20);
    const flags = reader.u32(at + 36);
    const mappedSize = align(Math.max(virtualSize, rawSize), sectionAlignment);
    if (rva % sectionAlignment !== 0 || rva < end || (rawSize > 0 && (rawOffset < headerSize || rawOffset % fileAlignment !== 0 || rawSize % fileAlignment !== 0))) {
      throw new PeError("headers", `overlapping/misaligned section ${name}`);
    }
    checkedRange(rawOffset, rawSize, bytes.length, "headers");
    checkedRange(rva, mappedSize, imageSize, "headers");
    end = rva + mappedSize;
    sections.push({ name, rva, virtualSize, mappedSize, rawOffset, rawSize, characteristics: flags, permissions: permissions(flags) });
  }
  return { abi, preferredBase, entryPointRva, imageSize, headerSize, sectionAlignment, fileAlignment, characteristics,
    dllCharacteristics: reader.u16(optional + 70), sections, directories };
}

export function directory(file: PeFile, index: number): PeDirectory {
  const entry = file.directories[index];
  if (entry === undefined) throw new PeError("headers", `invalid directory index ${index}`);
  return entry;
}
