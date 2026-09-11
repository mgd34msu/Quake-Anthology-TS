// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, ModuleIdentity } from "../../contracts/execution.ts";
import type { GuestExport, GuestImage, GuestImport, GuestImportResolver, GuestMapping, GuestPermissions, MappedGuestMemory } from "../core/contracts.ts";
import { checkedNumber, dynamicValue, elfFileOffset, ElfError, inspectElf } from "./parse.ts";
import type { ElfInspection, ElfSymbol } from "./parse.ts";
import { definedSymbolAddress, elfAddress, relocateElf, resolveSymbol } from "./relocate.ts";
import type { ElfRelocationContext, ElfTlsBindings } from "./relocate.ts";
import { readElfUnwind } from "./unwind.ts";

export { ElfError, inspectElf, elfFileOffset } from "./parse.ts";
export type { ElfInspection, ElfRelocation, ElfSegment, ElfSection, ElfSymbol, ElfVersion } from "./parse.ts";
export type { ElfTlsBindings, ElfTlsModule, ElfTlsResolution } from "./relocate.ts";

export interface ElfLoadOptions {
  readonly bytes: Uint8Array;
  readonly module: ModuleIdentity;
  readonly memory: MappedGuestMemory;
  /** Additive ELF load bias. ET_EXEC requires zero. ET_DYN normally uses a nonzero aligned bias. */
  readonly loadBias: bigint;
  readonly resolver: GuestImportResolver;
  /** Names already provided by the guest image graph or TypeScript runtime services. */
  readonly dependencies: ReadonlySet<string>;
  readonly tls?: ElfTlsBindings;
  /** Calls a resolver through the guest CPU; this callback must never use native execution. */
  readonly resolveIndirect?: (resolverAddress: GuestAddress) => GuestAddress;
  /** Required for COPY and external SIZE relocations, which cannot infer the provider's size. */
  readonly resolveSymbolSize?: (import_: GuestImport, requesting: GuestImage) => number | null;
  /** One registry per guest process; GNU-unique definitions/providers must remain loaded. */
  readonly uniqueSymbols?: Map<string, GuestAddress>;
}
export interface ElfGuestImage extends GuestImage {
  readonly elf: ElfInspection;
  readonly loadBias: bigint;
  readonly neededLibraries: readonly string[];
  readonly soname: string | null;
  readonly executableStack: boolean | null;
  readonly preinitializers: readonly GuestAddress[];
  /** STT_TLS values are block offsets, never ordinary image addresses. */
  readonly tlsExports: readonly { readonly symbol: GuestExport["symbol"]; readonly offset: bigint; readonly byteLength: number }[];
}

const PAGE = 4096n;
function down(value: bigint): bigint { return value - value % PAGE; }
function up(value: bigint): bigint { return (value + PAGE - 1n) / PAGE * PAGE; }
function permissions(flags: number): GuestPermissions {
  if ((flags & 2) !== 0) return (flags & 1) !== 0 ? "read-write-execute" : "read-write";
  if ((flags & 1) !== 0) return (flags & 4) !== 0 ? "read-execute" : "execute";
  return (flags & 4) !== 0 ? "read" : "none";
}

/** Maps and eagerly relocates one image. The caller loads dependencies and executes initializers. */
export function loadElf(options: ElfLoadOptions): ElfGuestImage {
  const bytes = options.bytes.slice();
  const elf = inspectElf(bytes);
  const { memory, module, loadBias } = options;
  if (elf.symbols.some(symbol => symbol.binding === 10) && options.uniqueSymbols === undefined) throw new ElfError("GNU unique symbols require a process-wide symbol registry");
  if (elf.abi.pointerBytes !== memory.pointerBytes) throw new ElfError("image and guest memory have different pointer widths");
  if (loadBias < 0n || elf.type === "executable" && loadBias !== 0n) throw new ElfError("invalid load bias for fixed ELF executable");
  if (loadBias % PAGE !== 0n) throw new ElfError("load bias is not page aligned");
  for (const library of elf.neededLibraries) if (!options.dependencies.has(library)) throw new ElfError(`dependency ${library} has no guest/runtime provider`);
  validateDynamicPolicy(elf);
  const supportedSegments = new Set([0, 1, 2, 3, 4, 6, 7, 0x6474e550, 0x6474e551, 0x6474e552]);
  for (const segment of elf.segments) {
    if (!supportedSegments.has(segment.type)) throw new ElfError(`unsupported program segment 0x${segment.type.toString(16)}`);
    if ((segment.type === 1 || segment.type === 7) && segment.alignment > 1n && loadBias % segment.alignment !== 0n) throw new ElfError("load bias violates segment alignment");
    if (segment.type === 1 && (segment.address - BigInt(segment.offset)) % PAGE !== 0n) throw new ElfError("PT_LOAD is not page congruent");
    if (segment.type === 1 && (segment.flags & ~7) !== 0) throw new ElfError("unsupported PT_LOAD permission flags");
  }
  const loadSegments = elf.segments.filter(segment => segment.type === 1 && segment.memorySize > 0);
  const boundaries = [...new Set(loadSegments.flatMap(segment => [down(segment.address), up(segment.address + BigInt(segment.memorySize))]))].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const first = boundaries[0];
  const last = boundaries[boundaries.length - 1];
  if (first === undefined || last === undefined) throw new ElfError("no image span");
  const span = last - first;
  const planned: GuestMapping[] = [];
  for (let i = 0; i + 1 < boundaries.length; i++) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    if (start === undefined || end === undefined) throw new ElfError("incomplete segment boundaries");
    const overlapping = loadSegments.filter(segment => down(segment.address) <= start && up(segment.address + BigInt(segment.memorySize)) >= end);
    if (overlapping.length === 0) continue;
    const finalSegment = overlapping[overlapping.length - 1];
    if (finalSegment === undefined) throw new ElfError("missing page permission owner");
    const flags = finalSegment.flags;
    planned.push({ base: loadBias + start, byteLength: checkedNumber(end - start, "mapping length"), permissions: permissions(flags), label: `${module.artifactPath}:PT_LOAD` });
  }
  const mapped: GuestMapping[] = [];
  const priorUniqueNames = new Set(options.uniqueSymbols?.keys());
  try {
    for (const mapping of planned) {
      memory.map({ ...mapping, permissions: "read-write-execute" });
      mapped.push(mapping);
    }
    for (const segment of loadSegments) {
      // Linux maps the initial file page, including bytes preceding an unaligned p_vaddr.
      const prefix = checkedNumber(segment.address - down(segment.address), "segment page prefix");
      const fileStart = segment.offset - prefix;
      if (fileStart < 0) throw new ElfError("segment page precedes the input file");
      if (segment.fileSize > 0) {
        const initialized = bytes.subarray(fileStart, segment.offset + segment.fileSize);
        memory.write(elfAddress(memory, loadBias + down(segment.address)), initialized);
      }
      if (segment.memorySize > segment.fileSize) {
        memory.write(elfAddress(memory, loadBias + segment.address + BigInt(segment.fileSize)), new Uint8Array(segment.memorySize - segment.fileSize));
      }
    }
    const imports: GuestImport[] = [];
    const exports: GuestExport[] = [];
    const tlsSegment = elf.segments.find(segment => segment.type === 7);
    for (const symbol of elf.symbols) if (symbol.type === 6 && symbol.section !== 0) {
      if (tlsSegment === undefined || symbol.value + BigInt(symbol.size) > BigInt(tlsSegment.memorySize)) throw new ElfError(`TLS symbol ${symbol.name} exceeds its template`);
    }
    const stack = elf.segments.find(segment => segment.type === 0x6474e551);
    const symbolName = (symbol: ElfSymbol): GuestExport["symbol"] => ({ kind: "name", name: symbol.name, version: symbol.version?.name ?? null });
    const exported = elf.symbols.filter(symbol => symbol.name.length > 0 && symbol.section !== 0 && (symbol.binding === 1 || symbol.binding === 2 || symbol.binding === 10)
      && symbol.visibility !== 1 && symbol.visibility !== 2);
    const appendExport = (symbol: ElfSymbol, address: GuestAddress): void => {
      exports.push({ symbol: symbolName(symbol), target: { kind: "address", address } });
      if (symbol.version !== null && !symbol.version.hidden) exports.push({ symbol: { kind: "name", name: symbol.name, version: null }, target: { kind: "address", address } });
    };
    const addressContext = { loadBias, memory, resolveIndirect: options.resolveIndirect ?? null };
    for (const symbol of exported) {
      if (symbol.type === 6 || symbol.type === 10 || symbol.binding === 10) continue;
      appendExport(symbol, elfAddress(memory, definedSymbolAddress(addressContext, symbol)));
    }
    const image: ElfGuestImage = {
      module, abi: elf.abi, base: elfAddress(memory, loadBias + first), preferredBase: first, byteLength: span,
      entryPoint: elf.entryPoint === 0n ? null : elfAddress(memory, loadBias + elf.entryPoint), mappings: planned, imports, exports,
      tls: tlsSegment === undefined ? null : { image: module, initialized: bytes.slice(tlsSegment.offset, tlsSegment.offset + tlsSegment.fileSize), zeroFillBytes: tlsSegment.memorySize - tlsSegment.fileSize,
        alignment: tlsSegment.alignment > 0n ? tlsSegment.alignment : 1n, callbacks: [] },
      initializers: [], finalizers: [], unwind: [], preinitializers: [], elf, loadBias, neededLibraries: elf.neededLibraries, soname: elf.soname,
      executableStack: stack === undefined ? null : (stack.flags & 1) !== 0,
      tlsExports: exported.filter(symbol => symbol.type === 6).map(symbol => ({ symbol: symbolName(symbol), offset: symbol.value, byteLength: symbol.size })),
    };
    const relocationContext: ElfRelocationContext = { elf, memory, image, loadBias, resolver: options.resolver, tls: options.tls ?? null,
      resolveIndirect: options.resolveIndirect ?? null, resolveSymbolSize: options.resolveSymbolSize ?? null, uniqueSymbols: options.uniqueSymbols ?? null, imports };
    for (const symbol of exported) if (symbol.binding === 10) {
      if (symbol.type !== 0 && symbol.type !== 1) throw new ElfError("GNU unique binding is only supported for data symbols");
      appendExport(symbol, elfAddress(memory, resolveSymbol(relocationContext, symbol, image.base, false)));
    }
    relocateElf(relocationContext);
    for (const symbol of exported) if (symbol.type === 10) appendExport(symbol, elfAddress(memory, definedSymbolAddress(addressContext, symbol)));
    const preinitializers = pointerArray(elf, memory, loadBias, 32, 33);
    const mainExecutable = elf.type === "executable" || elf.interpreter !== null || ((dynamicValue(elf.dynamic, 0x6ffffffb) ?? 0n) & 0x08000000n) !== 0n;
    if (!mainExecutable && preinitializers.length !== 0) throw new ElfError("DT_PREINIT_ARRAY is only valid for the main executable");
    const init = dynamicValue(elf.dynamic, 12);
    const fini = dynamicValue(elf.dynamic, 13);
    const initializers = [...(init === null || init === 0n ? [] : [elfAddress(memory, loadBias + init)]), ...pointerArray(elf, memory, loadBias, 25, 27)];
    const finalizers = [...pointerArray(elf, memory, loadBias, 26, 28).reverse(), ...(fini === null || fini === 0n ? [] : [elfAddress(memory, loadBias + fini)])];
    const unwind = readElfUnwind(elf, bytes, memory, loadBias);
    const tls = image.tls === null || tlsSegment === undefined ? null : {
      ...image.tls, initialized: tlsSegment.fileSize === 0 ? new Uint8Array() : memory.copy(elfAddress(memory, loadBias + tlsSegment.address), tlsSegment.fileSize),
    };
    for (const mapping of planned) memory.protect(elfAddress(memory, mapping.base), mapping.byteLength, mapping.permissions);
    for (const segment of elf.segments) if (segment.type === 0x6474e552) {
      const start = loadBias + down(segment.address);
      const end = loadBias + down(segment.address + BigInt(segment.memorySize));
      for (let address = start; address < end; address += PAGE) {
        if (!planned.some(range => address >= range.base && address + PAGE <= range.base + BigInt(range.byteLength))) throw new ElfError("RELRO exceeds this image's mapped pages");
      }
      if (end > start) memory.protect(elfAddress(memory, start), checkedNumber(end - start, "RELRO length"), "read");
    }
    for (const address of [...preinitializers, ...initializers, ...finalizers, ...(image.entryPoint === null ? [] : [image.entryPoint])]) memory.check(address, 1, "execute");
    const mappings = memory.mappings().filter(mapping => planned.some(range => mapping.base >= range.base && mapping.base + BigInt(mapping.byteLength) <= range.base + BigInt(range.byteLength)));
    return { ...image, mappings, tls, preinitializers, initializers, finalizers, unwind };
  } catch (error) {
    if (options.uniqueSymbols !== undefined) for (const name of options.uniqueSymbols.keys()) {
      if (!priorUniqueNames.has(name)) options.uniqueSymbols.delete(name);
    }
    for (const mapping of mapped) memory.unmap(elfAddress(memory, mapping.base), mapping.byteLength);
    throw error;
  }
}

function pointerArray(elf: ElfInspection, memory: MappedGuestMemory, loadBias: bigint, addressTag: number, sizeTag: number): GuestAddress[] {
  const address = dynamicValue(elf.dynamic, addressTag);
  const size = dynamicValue(elf.dynamic, sizeTag);
  if (address === null && size === null) return [];
  if (address === null || size === null || size % BigInt(elf.abi.pointerBytes) !== 0n) throw new ElfError("incomplete initializer/finalizer array");
  const length = checkedNumber(size, "function array length");
  if (length === 0) return [];
  elfFileOffset(elf.segments, address, length);
  const bytes = memory.copy(elfAddress(memory, loadBias + address), length);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result: GuestAddress[] = [];
  const sentinel = (1n << BigInt(elf.abi.pointerBytes * 8)) - 1n;
  for (let offset = 0; offset < length; offset += elf.abi.pointerBytes) {
    const value = elf.abi.pointerBytes === 8 ? view.getBigUint64(offset, true) : BigInt(view.getUint32(offset, true));
    if (value !== 0n && value !== sentinel) result.push(elfAddress(memory, value));
  }
  return result;
}

function validateDynamicPolicy(elf: ElfInspection): void {
  for (const tag of [0x7fffffff, 0x7ffffffd, 0x6ffffefb, 0x6ffffefc]) {
    if (elf.dynamic.has(tag)) throw new ElfError(`dynamic filter/audit dependency tag 0x${tag.toString(16)} is unsupported`);
  }
  const supported = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
    24, 25, 26, 27, 28, 29, 30, 32, 33, 35, 36, 37, 0x6ffffef5, 0x6ffffff0, 0x6ffffff9, 0x6ffffffa,
    0x6ffffffb, 0x6ffffffc, 0x6ffffffd, 0x6ffffffe, 0x6fffffff]);
  for (const tag of elf.dynamic.keys()) if (!supported.has(tag)) throw new ElfError(`unsupported dynamic tag 0x${tag.toString(16)}`);
  const flags = dynamicValue(elf.dynamic, 30) ?? 0n;
  if ((flags & ~31n) !== 0n) throw new ElfError(`unsupported DT_FLAGS 0x${flags.toString(16)}`);
  const flags1 = dynamicValue(elf.dynamic, 0x6ffffffb) ?? 0n;
  // NOW is satisfied by eager binding; PIE identifies the executable's placement model.
  if ((flags1 & ~(1n | 0x08000000n)) !== 0n) throw new ElfError(`unsupported DT_FLAGS_1 0x${flags1.toString(16)}`);
}
