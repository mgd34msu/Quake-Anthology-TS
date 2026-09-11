// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress } from "../../contracts/execution.ts";
import type { GuestExport, GuestImport, GuestSymbolName, GuestTlsTemplate } from "../core/contracts.ts";
import { directory, PeError } from "./format.ts";
import { ImageReader } from "./image.ts";
import type { PeLoadConfiguration, PeUnwindRecord } from "./image.ts";

export function readImports(image: ImageReader): GuestImport[] {
  const reader = image.forStage("imports");
  const imports: GuestImport[] = [];
  const slots = new Set<number>();
  const table = directory(reader.pe, 1);
  if (directory(reader.pe, 13).rva !== 0) throw new PeError("imports", "delay-load imports require a guest delay-loader; unsupported");
  if (table.rva === 0) return imports;
  reader.range(table.rva, table.byteLength);
  const width = reader.pe.abi.pointerBytes;
  const ordinalBit = 1n << BigInt(width * 8 - 1);
  for (let at = table.rva; at + 20 <= table.rva + table.byteLength; at += 20) {
    const lookup = reader.u32(at);
    const timestamp = reader.u32(at + 4);
    const forward = reader.u32(at + 8);
    const name = reader.u32(at + 12);
    const iat = reader.u32(at + 16);
    if (lookup === 0 && timestamp === 0 && forward === 0 && name === 0 && iat === 0) return imports;
    if (name === 0 || iat === 0 || iat % width !== 0 || lookup % width !== 0 || (lookup === 0 && timestamp !== 0)) throw new PeError("imports", "invalid descriptor/alignment or bound IAT without original lookup table");
    const library = reader.text(name);
    if (library.length === 0) throw new PeError("imports", "empty import library");
    for (let index = 0; ; index++) {
      const thunk = reader.pointer((lookup || iat) + index * width);
      const slot = iat + index * width;
      reader.range(slot, width);
      if (thunk === 0n) break;
      let symbol: GuestSymbolName;
      if ((thunk & ordinalBit) !== 0n) {
        if ((thunk & ~(ordinalBit | 0xffffn)) !== 0n) throw new PeError("imports", "ordinal thunk has reserved bits");
        symbol = { kind: "ordinal", ordinal: Number(thunk & 0xffffn) };
      } else {
        if (thunk > 0x7fffffffn) throw new PeError("imports", "name thunk is not a valid RVA");
        const rva = Number(thunk);
        reader.u16(rva);
        const name = reader.text(rva + 2);
        if (name.length === 0) throw new PeError("imports", "empty import name");
        symbol = { kind: "name", name, version: null };
      }
      if (slots.has(slot)) throw new PeError("imports", "overlapping import address slots");
      slots.add(slot);
      imports.push({ library, symbol, slot: reader.address(slot, width), weak: false });
    }
  }
  throw new PeError("imports", "unterminated import descriptor table");
}

function forwarded(text: string): GuestExport["target"] {
  const separator = text.lastIndexOf(".");
  if (separator <= 0 || separator === text.length - 1) throw new PeError("exports", `invalid export forwarder ${text}`);
  const library = text.slice(0, separator);
  const name = text.slice(separator + 1);
  if (name.startsWith("#")) {
    if (!/^#[0-9]+$/.test(name)) throw new PeError("exports", "invalid forwarded ordinal");
    const ordinal = Number(name.slice(1));
    if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > 65535) throw new PeError("exports", "forwarded ordinal out of range");
    return { kind: "forward", library, symbol: { kind: "ordinal", ordinal } };
  }
  return { kind: "forward", library, symbol: { kind: "name", name, version: null } };
}

export function readExports(image: ImageReader): GuestExport[] {
  const reader = image.forStage("exports");
  const table = directory(reader.pe, 0);
  if (table.rva === 0) return [];
  if (table.byteLength < 40) throw new PeError("exports", "truncated export directory");
  reader.range(table.rva, table.byteLength);
  const ordinalBase = reader.u32(table.rva + 16);
  const count = reader.u32(table.rva + 20);
  const nameCount = reader.u32(table.rva + 24);
  const addresses = reader.u32(table.rva + 28);
  const names = reader.u32(table.rva + 32);
  const ordinals = reader.u32(table.rva + 36);
  reader.range(addresses, count * 4);
  reader.range(names, nameCount * 4);
  reader.range(ordinals, nameCount * 2);
  if (ordinalBase + count > 0x100000000) throw new PeError("exports", "export ordinal overflow");
  const targets = new Map<number, GuestExport["target"]>();
  const exports: GuestExport[] = [];
  for (let index = 0; index < count; index++) {
    const rva = reader.u32(addresses + index * 4);
    if (rva === 0) continue;
    const target: GuestExport["target"] = rva >= table.rva && rva < table.rva + table.byteLength
      ? forwarded(reader.text(rva, table.rva + table.byteLength)) : { kind: "address", address: reader.address(rva) };
    targets.set(index, target);
    exports.push({ symbol: { kind: "ordinal", ordinal: ordinalBase + index }, target });
  }
  const seen = new Set<string>();
  for (let index = 0; index < nameCount; index++) {
    const name = reader.text(reader.u32(names + index * 4));
    const target = targets.get(reader.u16(ordinals + index * 2));
    if (!name || seen.has(name) || target === undefined) throw new PeError("exports", "duplicate name or invalid export ordinal target");
    seen.add(name);
    exports.push({ symbol: { kind: "name", name, version: null }, target });
  }
  return exports;
}

export function readTls(image: ImageReader): { readonly tls: GuestTlsTemplate | null; readonly index: GuestAddress | null } {
  const reader = image.forStage("tls");
  const table = directory(reader.pe, 9);
  if (table.rva === 0) return { tls: null, index: null };
  const width = reader.pe.abi.pointerBytes;
  if (table.byteLength < width * 4 + 8) throw new PeError("tls", "truncated TLS directory");
  const start = reader.pointer(table.rva);
  const end = reader.pointer(table.rva + width);
  const index = reader.pointer(table.rva + width * 2);
  const callbackArray = reader.pointer(table.rva + width * 3);
  const zeroFillBytes = reader.u32(table.rva + width * 4);
  const flags = reader.u32(table.rva + width * 4 + 4);
  const alignmentCode = (flags >>> 20) & 15;
  if (end < start || end - start > BigInt(reader.pe.imageSize) || alignmentCode === 15 || index === 0n) throw new PeError("tls", "invalid TLS range, alignment or index address");
  const size = Number(end - start);
  const initialized = start === 0n && end === 0n ? new Uint8Array() : reader.copy(reader.rva(start, size), size);
  const callbacks: GuestAddress[] = [];
  if (callbackArray !== 0n) {
    const array = reader.rva(callbackArray, width);
    for (let at = array; ; at += width) {
      const callback = reader.pointer(at);
      if (callback === 0n) break;
      callbacks.push(reader.executable(reader.rva(callback)));
    }
  }
  return { tls: { image: reader.module, initialized, zeroFillBytes, alignment: alignmentCode === 0 ? 1n : 1n << BigInt(alignmentCode - 1), callbacks },
    index: reader.address(reader.rva(index, 4), 4) };
}

export function readUnwind(image: ImageReader): PeUnwindRecord[] {
  const reader = image.forStage("unwind");
  const table = directory(reader.pe, 3);
  if (table.rva === 0) return [];
  if (reader.pe.abi.pointerBytes !== 8 || table.byteLength % 12 !== 0) throw new PeError("unwind", "unsupported exception directory layout");
  reader.range(table.rva, table.byteLength);
  function entry(beginRva: number, endRva: number, unwindInfoRva: number, ancestors: ReadonlySet<number>): PeUnwindRecord {
    if (beginRva >= endRva || ancestors.has(unwindInfoRva) || ancestors.size > 64) throw new PeError("unwind", "invalid function range or cyclic unwind chain");
    reader.executable(beginRva);
    reader.executable(endRva - 1);
    if (unwindInfoRva % 4 !== 0) throw new PeError("unwind", "unaligned unwind metadata");
    const header = reader.u32(unwindInfoRva);
    const version = header & 7;
    const flags = (header >>> 3) & 31;
    const count = (header >>> 16) & 255;
    if ((version !== 1 && version !== 2) || (flags & ~7) !== 0 || ((flags & 4) !== 0 && (flags & 3) !== 0)) throw new PeError("unwind", `unsupported version/flags ${version}/${flags}`);
    const tail = unwindInfoRva + 4 + Math.ceil(count / 2) * 4;
    let chained: PeUnwindRecord | null = null;
    let handlerRva: number | null = null;
    let handlerDataRva: number | null = null;
    let size = tail - unwindInfoRva;
    if ((flags & 4) !== 0) {
      const next = new Set(ancestors); next.add(unwindInfoRva);
      chained = entry(reader.u32(tail), reader.u32(tail + 4), reader.u32(tail + 8), next);
      size += 12;
    } else if ((flags & 3) !== 0) {
      handlerRva = reader.u32(tail);
      reader.executable(handlerRva);
      handlerDataRva = tail + 4;
      size += 4;
    }
    return { beginRva, endRva, unwindInfoRva, version, flags, handlerRva, handlerDataRva, chained, metadata: reader.copy(unwindInfoRva, size) };
  }
  const result: PeUnwindRecord[] = [];
  let previous = -1;
  for (let at = table.rva; at < table.rva + table.byteLength; at += 12) {
    const begin = reader.u32(at);
    if (begin <= previous) throw new PeError("unwind", "unsorted runtime function table");
    previous = begin;
    result.push(entry(begin, reader.u32(at + 4), reader.u32(at + 8), new Set()));
  }
  return result;
}

export function readLoadConfiguration(image: ImageReader): PeLoadConfiguration | null {
  const reader = image.forStage("load-config");
  const table = directory(reader.pe, 10);
  if (table.rva === 0) return null;
  const size = reader.u32(table.rva);
  if (size < 4 || size > table.byteLength) throw new PeError("load-config", "invalid load configuration size");
  const width = reader.pe.abi.pointerBytes;
  function addressField(offset: number): GuestAddress | null {
    if (offset + width > size) return null;
    const value = reader.pointer(table.rva + offset);
    return value === 0n ? null : reader.address(reader.rva(value, width), width);
  }
  const guardOffset = width === 4 ? 88 : 144;
  return { address: reader.address(table.rva, size), bytes: reader.copy(table.rva, size),
    securityCookieAddress: addressField(width === 4 ? 60 : 88), guardCheckSlot: addressField(width === 4 ? 72 : 112),
    guardDispatchSlot: addressField(width === 4 ? 76 : 120), guardFlags: guardOffset + 4 <= size ? reader.u32(table.rva + guardOffset) : 0 };
}
