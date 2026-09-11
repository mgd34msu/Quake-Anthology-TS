// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress } from "../../contracts/execution.ts";
import type { GuestImage, GuestImport, GuestImportResolver, MappedGuestMemory } from "../core/contracts.ts";
import { dynamicValue, ElfError } from "./parse.ts";
import type { ElfInspection, ElfRelocation, ElfSymbol } from "./parse.ts";

export interface ElfTlsModule {
  readonly moduleId: bigint;
  /** Signed displacement from FS/GS thread pointer to this module's TLS block. */
  readonly threadPointerOffset: bigint | null;
}
export interface ElfTlsResolution extends ElfTlsModule { readonly offset: bigint; }
export interface ElfTlsBindings {
  readonly current: ElfTlsModule;
  resolve(import_: GuestImport, requesting: GuestImage): ElfTlsResolution | null;
}
export interface ElfRelocationContext {
  readonly elf: ElfInspection;
  readonly memory: MappedGuestMemory;
  readonly image: GuestImage;
  readonly loadBias: bigint;
  readonly resolver: GuestImportResolver;
  readonly tls: ElfTlsBindings | null;
  readonly resolveIndirect: ((resolverAddress: GuestAddress) => GuestAddress) | null;
  readonly resolveSymbolSize: ((import_: GuestImport, requesting: GuestImage) => number | null) | null;
  readonly uniqueSymbols: Map<string, GuestAddress> | null;
  readonly imports: GuestImport[];
}

export function elfAddress(memory: MappedGuestMemory, value: bigint): GuestAddress {
  const pointer = memory.pointer(value);
  if (pointer === null) throw new ElfError("required address is null");
  return pointer;
}
export function symbolImport(symbol: ElfSymbol, slot: GuestAddress): GuestImport {
  return { library: symbol.version?.library ?? "", symbol: { kind: "name", name: symbol.name, version: symbol.version?.name ?? null }, slot, weak: symbol.binding === 2 };
}

/** Dynamic binding is eager. No host address or lazy host PLT trampoline is installed. */
export function relocateElf(context: ElfRelocationContext): void {
  const deferred: ElfRelocation[] = [];
  for (const relocation of context.elf.relocations) {
    const symbol = context.elf.symbols[relocation.symbolIndex];
    const indirect = relocation.type === (context.elf.abi.pointerBytes === 8 ? 37 : 42);
    if (indirect || (symbol?.type === 10 && symbol.section !== 0)) deferred.push(relocation);
    else apply(context, relocation);
  }
  for (const relocation of deferred) apply(context, relocation);
}

function apply(context: ElfRelocationContext, relocation: ElfRelocation): void {
  const { elf, memory, image, loadBias } = context;
  const wide = elf.abi.pointerBytes === 8;
  const type = relocation.type;
  if (type === 0) return;
  const width = wide ? (type === 12 || type === 13 ? 2 : type === 14 || type === 15 ? 1
    : type === 2 || type === 4 || type === 10 || type === 11 || type === 23 || type === 32 ? 4 : 8) : 4;
  const symbol = elf.symbols[relocation.symbolIndex];
  const byteLength = type === 5 && symbol !== undefined ? symbol.size : width;
  if (!elf.segments.some(segment => segment.type === 1 && relocation.address >= segment.address
    && relocation.address + BigInt(byteLength) <= segment.address + BigInt(segment.memorySize))) {
    throw new ElfError(`relocation target 0x${relocation.address.toString(16)} lies outside this image`);
  }
  const slot = elfAddress(memory, loadBias + relocation.address);
  const bytes = memory.copy(slot, byteLength);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const addend = type === 5 ? 0n : relocation.addend ?? (width === 8 ? view.getBigInt64(0, true) : width === 4 ? BigInt(view.getInt32(0, true))
    : width === 2 ? BigInt(view.getInt16(0, true)) : BigInt(view.getInt8(0)));
  const place = slot.byteOffset;
  let result: bigint;
  let signed = false;
  let checked = wide;
  if (type === 8 || wide && type === 38) {
    if (relocation.symbolIndex !== 0) throw new ElfError("relative relocation has a symbol");
    result = loadBias + addend;
  } else if (type === (wide ? 37 : 42)) {
    if (relocation.symbolIndex !== 0 || context.resolveIndirect === null) throw new ElfError("IRELATIVE requires explicit guest resolver execution");
    const address = context.resolveIndirect(elfAddress(memory, loadBias + addend));
    memory.check(address, 1, "execute");
    result = address.byteOffset;
  } else if (wide ? [16, 17, 18, 23].includes(type) : [14, 17, 34, 35, 36, 37].includes(type)) {
    const bindings = context.tls;
    if (bindings === null) throw new ElfError(`TLS relocation ${type} requires a guest thread/module allocation`);
    let target: ElfTlsResolution;
    if (relocation.symbolIndex === 0) target = { ...bindings.current, offset: 0n };
    else if (symbol === undefined || symbol.type !== 6) throw new ElfError("TLS relocation references a non-TLS symbol");
    else {
      const import_ = symbolImport(symbol, slot);
      const local = symbol.section !== 0 && (symbol.binding === 0 || symbol.visibility !== 0 || symbolicBinding(elf));
      const resolved = local ? null : bindings.resolve(import_, image);
      if (resolved !== null) { target = resolved; context.imports.push(import_); }
      else if (symbol.section !== 0) target = { ...bindings.current, offset: symbol.value };
      else throw new ElfError(`unresolved TLS symbol ${symbol.name}`);
    }
    if (target.moduleId <= 0n) throw new ElfError("ELF TLS module IDs begin at one");
    if (type === (wide ? 16 : 35)) result = target.moduleId;
    else if (type === (wide ? 17 : 36)) result = target.offset + (wide ? addend : 0n);
    else {
      if (target.threadPointerOffset === null) throw new ElfError("static TLS relocation has no signed thread-pointer offset");
      const displacement = target.threadPointerOffset + target.offset;
      result = (!wide && (type === 34 || type === 37) ? -displacement : displacement) + addend;
      signed = true;
    }
  } else {
    if (symbol === undefined) throw new ElfError(`relocation ${type} lacks symbol ${relocation.symbolIndex}`);
    const symbolAddress = resolveSymbol(context, symbol, slot, type === 5);
    if (type === 5) {
      if (symbolAddress === 0n) { if (!symbolImport(symbol, slot).weak) throw new ElfError("COPY source is null"); return; }
      if (image.mappings.some(mapping => symbolAddress >= mapping.base && symbolAddress < mapping.base + BigInt(mapping.byteLength))) throw new ElfError("COPY must resolve a definition outside the requesting image");
      const sourceSize = externalSymbolSize(context, symbol, slot);
      memory.write(slot, memory.copy(elfAddress(memory, symbolAddress), Math.min(sourceSize, symbol.size)));
      return;
    }
    switch (type) {
      case 1: result = symbolAddress + addend; break;
      case 2: result = symbolAddress + addend - place; signed = true; break;
      case 4: throw new ElfError("PLT32 relocation requires a link-editor PLT address");
      case 6: case 7: result = symbolAddress; break;
      case 9:
        if (wide) throw new ElfError("dynamic x64 GOTPCREL requires a link-editor GOT slot");
        result = symbolAddress + addend - gotAddress(context); break;
      case 10:
        if (wide) result = symbolAddress + addend;
        else result = gotAddress(context) + addend - place;
        break;
      case 11:
        if (!wide) throw new ElfError("R_386_32PLT requires a link-editor PLT address");
        result = symbolAddress + addend; signed = true; break;
      case 12: case 14:
        if (!wide) throw new ElfError(`unsupported i386 relocation ${type}`);
        result = symbolAddress + addend; break;
      case 13: case 15: case 24:
        if (!wide) throw new ElfError(`unsupported i386 relocation ${type}`);
        result = symbolAddress + addend - place; signed = true; break;
      case 32: case 33: case 38:
        if (wide ? type === 38 : type !== 38) throw new ElfError(`unsupported relocation ${type}`);
        result = BigInt(symbol.section !== 0 && symbolAddress === (symbol.section === 0xfff1 ? symbol.value : loadBias + symbol.value)
          ? symbol.size : externalSymbolSize(context, symbol, slot)) + addend; break;
      default: throw new ElfError(`unsupported ${wide ? "x86-64" : "i386"} relocation ${type} for ${symbol.name}`);
    }
  }
  // x86-32 relocation arithmetic is modulo 2^32. AMD64 narrow forms have ABI overflow checks.
  if (width === 8) checked = false;
  const bits = BigInt(width * 8);
  const lower = signed ? -(1n << (bits - 1n)) : 0n;
  const upper = signed ? (1n << (bits - 1n)) - 1n : (1n << bits) - 1n;
  if (checked && (result < lower || result > upper)) throw new ElfError(`relocation ${type} overflows ${signed ? "signed" : "unsigned"} ${width * 8} bits`);
  const normalized = BigInt.asUintN(width * 8, result);
  if (width === 8) view.setBigUint64(0, normalized, true);
  else if (width === 4) view.setUint32(0, Number(normalized), true);
  else if (width === 2) view.setUint16(0, Number(normalized), true);
  else view.setUint8(0, Number(normalized));
  memory.write(slot, bytes);
}

function externalSymbolSize(context: ElfRelocationContext, symbol: ElfSymbol, slot: GuestAddress): number {
  const size = context.resolveSymbolSize?.(symbolImport(symbol, slot), context.image);
  if (size === undefined || size === null) throw new ElfError(`COPY/SIZE relocation for ${symbol.name} needs provider symbol size metadata`);
  if (!Number.isSafeInteger(size) || size < 0) throw new ElfError(`invalid provider symbol size for ${symbol.name}`);
  return size;
}

function gotAddress(context: ElfRelocationContext): bigint {
  const got = dynamicValue(context.elf.dynamic, 3);
  if (got === null) throw new ElfError("GOT relocation lacks DT_PLTGOT");
  return context.loadBias + got;
}

export function definedSymbolAddress(context: Pick<ElfRelocationContext, "loadBias" | "memory" | "resolveIndirect">, symbol: ElfSymbol): bigint {
  if (symbol.section === 0xfff2) throw new ElfError(`unallocated COMMON symbol ${symbol.name}`);
  if (symbol.section >= 0xff00 && symbol.section !== 0xfff1) throw new ElfError(`unsupported reserved symbol section for ${symbol.name}`);
  if (symbol.type === 6) throw new ElfError(`TLS symbol ${symbol.name} is an offset, not an image address`);
  const raw = symbol.section === 0xfff1 ? symbol.value : context.loadBias + symbol.value;
  if (symbol.type !== 10) return raw;
  if (context.resolveIndirect === null) throw new ElfError(`GNU IFUNC ${symbol.name} requires guest resolver execution`);
  const resolved = context.resolveIndirect(elfAddress(context.memory, raw));
  context.memory.check(resolved, 1, "execute");
  return resolved.byteOffset;
}

export function resolveSymbol(context: ElfRelocationContext, symbol: ElfSymbol, slot: GuestAddress, copy: boolean): bigint {
  if (symbol.index === 0) return 0n;
  if (symbol.binding !== 0 && symbol.binding !== 1 && symbol.binding !== 2 && symbol.binding !== 10) throw new ElfError(`unsupported symbol binding ${symbol.binding} for ${symbol.name}`);
  const own = symbol.section !== 0;
  const unique = symbol.binding === 10;
  if (unique && context.uniqueSymbols === null) throw new ElfError("GNU unique symbols require a process-wide symbol registry");
  const existing = unique ? context.uniqueSymbols?.get(symbol.name) : undefined;
  if (existing !== undefined) {
    context.memory.check(existing, 1, "read");
    if (!own) context.imports.push(symbolImport(symbol, slot));
    return existing.byteOffset;
  }
  if (!copy && own && (symbol.binding === 0 || symbol.visibility !== 0 || symbolicBinding(context.elf))) return definedSymbolAddress(context, symbol);
  const import_ = symbolImport(symbol, slot);
  const resolution = context.resolver.resolve(import_, context.image);
  if (resolution.kind !== "unresolved") {
    // Every provider shares this guest address space, including host callback trap slots.
    if (resolution.address.addressSpace !== context.memory.addressSpace) throw new ElfError(`symbol ${symbol.name} resolves to another guest address space`);
    context.memory.check(resolution.address, 1, symbol.type === 2 || symbol.type === 10 ? "execute" : "read");
    if (unique) context.uniqueSymbols?.set(symbol.name, resolution.address);
    if (!own || copy) context.imports.push(import_);
    return resolution.address.byteOffset;
  }
  if (!copy && own) {
    const address = definedSymbolAddress(context, symbol);
    if (unique) context.uniqueSymbols?.set(symbol.name, elfAddress(context.memory, address));
    return address;
  }
  context.imports.push(import_);
  if (symbol.binding === 2) return 0n;
  throw new ElfError(`unresolved import ${import_.library || "<global>"}:${symbol.name}${symbol.version === null ? "" : "@" + symbol.version.name}: ${resolution.detail}`);
}

function symbolicBinding(elf: ElfInspection): boolean {
  return elf.dynamic.has(16) || ((dynamicValue(elf.dynamic, 30) ?? 0n) & 2n) !== 0n;
}
