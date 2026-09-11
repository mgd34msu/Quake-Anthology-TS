// SPDX-License-Identifier: GPL-2.0-or-later
// ELF gABI: https://gabi.xinuos.com/elf/07-pheader.html and /08-dynamic.html
import type { NativeAbi } from "../../contracts/execution.ts";

export class ElfError extends Error {
  constructor(message: string) { super(`ELF: ${message}`); this.name = "ElfError"; }
}

export interface ElfSegment {
  readonly type: number;
  readonly flags: number;
  readonly offset: number;
  readonly address: bigint;
  readonly fileSize: number;
  readonly memorySize: number;
  readonly alignment: bigint;
}
export interface ElfSection {
  readonly name: string;
  readonly type: number;
  readonly flags: bigint;
  readonly address: bigint;
  readonly offset: number;
  readonly size: number;
  readonly link: number;
  readonly info: number;
  readonly entrySize: number;
}
export interface ElfVersion {
  readonly name: string;
  readonly library: string;
  readonly hidden: boolean;
  readonly weak: boolean;
}
export interface ElfSymbol {
  readonly index: number;
  readonly name: string;
  readonly value: bigint;
  readonly size: number;
  readonly binding: number;
  readonly type: number;
  readonly visibility: number;
  readonly section: number;
  readonly version: ElfVersion | null;
}
export interface ElfRelocation {
  readonly address: bigint;
  readonly type: number;
  readonly symbolIndex: number;
  /** null means the addend lives in the mapped relocation slot. */
  readonly addend: bigint | null;
  readonly table: "rel" | "rela" | "plt-rel" | "plt-rela" | "relr";
}
export interface ElfInspection {
  readonly abi: Extract<NativeAbi, { readonly image: "elf32" | "elf64" }>;
  readonly type: "shared" | "executable";
  readonly entryPoint: bigint;
  readonly segments: readonly ElfSegment[];
  readonly sections: readonly ElfSection[];
  readonly dynamic: ReadonlyMap<number, readonly bigint[]>;
  readonly neededLibraries: readonly string[];
  readonly soname: string | null;
  readonly interpreter: string | null;
  readonly runpath: string | null;
  readonly rpath: string | null;
  readonly symbols: readonly ElfSymbol[];
  readonly relocations: readonly ElfRelocation[];
}

export function checkedNumber(value: bigint, description: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ElfError(`${description} exceeds checked host indexing`);
  return Number(value);
}
export function dynamicValue(dynamic: ElfInspection["dynamic"], tag: number): bigint | null {
  return dynamic.get(tag)?.[0] ?? null;
}

class Reader {
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array) { this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  range(offset: number, size: number): void {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset > this.bytes.length - size) {
      throw new ElfError(`file range ${offset}+${size} exceeds ${this.bytes.length} bytes`);
    }
  }
  u8(offset: number): number { this.range(offset, 1); return this.view.getUint8(offset); }
  u16(offset: number): number { this.range(offset, 2); return this.view.getUint16(offset, true); }
  u32(offset: number): number { this.range(offset, 4); return this.view.getUint32(offset, true); }
  word(offset: number, wide: boolean): bigint { this.range(offset, wide ? 8 : 4); return wide ? this.view.getBigUint64(offset, true) : BigInt(this.view.getUint32(offset, true)); }
  signed(offset: number, wide: boolean): bigint { this.range(offset, wide ? 8 : 4); return wide ? this.view.getBigInt64(offset, true) : BigInt(this.view.getInt32(offset, true)); }
  string(offset: number, maximum: number): string {
    this.range(offset, maximum);
    let end = offset;
    while (end < offset + maximum && this.u8(end) !== 0) end++;
    if (end === offset + maximum) throw new ElfError(`unterminated string at ${offset}`);
    return new TextDecoder().decode(this.bytes.subarray(offset, end));
  }
}

/** Program-header virtual addresses, never section offsets, locate dynamic data. */
export function elfFileOffset(segments: readonly ElfSegment[], address: bigint, size: number): number {
  for (const segment of segments) {
    if (segment.type !== 1 || address < segment.address) continue;
    const displacement = address - segment.address;
    if (displacement + BigInt(size) <= BigInt(segment.fileSize)) return segment.offset + checkedNumber(displacement, "segment displacement");
  }
  throw new ElfError(`virtual file range 0x${address.toString(16)}+${size} has no PT_LOAD backing`);
}

export function inspectElf(bytes: Uint8Array): ElfInspection {
  const r = new Reader(bytes);
  if (r.u32(0) !== 0x464c457f) throw new ElfError("invalid magic");
  const elfClass = r.u8(4);
  if (elfClass !== 1 && elfClass !== 2) throw new ElfError(`unsupported class ${elfClass}`);
  const wide = elfClass === 2;
  if (r.u8(5) !== 1 || r.u8(6) !== 1 || r.u32(20) !== 1) throw new ElfError("only little-endian ELF version 1 is supported");
  if ((r.u8(7) !== 0 && r.u8(7) !== 3) || r.u8(8) !== 0) throw new ElfError("unsupported OS ABI or ABI version");
  const type = r.u16(16);
  if (type !== 2 && type !== 3) throw new ElfError(`expected ET_EXEC or ET_DYN, found ${type}`);
  const machine = r.u16(18);
  if (machine !== (wide ? 62 : 3)) throw new ElfError(`unsupported class/machine combination ${elfClass}/${machine}`);
  if (r.u32(wide ? 48 : 36) !== 0) throw new ElfError("unsupported machine flags");
  if (r.u16(wide ? 52 : 40) !== (wide ? 64 : 52)) throw new ElfError("incorrect ELF header size");
  const phoff = checkedNumber(r.word(wide ? 32 : 28, wide), "program table offset");
  const shoff = checkedNumber(r.word(wide ? 40 : 32, wide), "section table offset");
  const phsize = r.u16(wide ? 54 : 42);
  const shsize = r.u16(wide ? 58 : 46);
  let phnum = r.u16(wide ? 56 : 44);
  let shnum = r.u16(wide ? 60 : 48);
  let namesIndex = r.u16(wide ? 62 : 50);
  if (shoff !== 0) {
    if (shsize !== (wide ? 64 : 40)) throw new ElfError("incorrect section header size");
    r.range(shoff, shsize);
    if (shnum === 0) shnum = checkedNumber(r.word(shoff + (wide ? 32 : 20), wide), "extended section count");
    if (phnum === 0xffff) phnum = r.u32(shoff + (wide ? 44 : 28));
    if (namesIndex === 0xffff) namesIndex = r.u32(shoff + (wide ? 40 : 24));
  } else if (shnum !== 0 || namesIndex !== 0 || phnum === 0xffff) throw new ElfError("missing extended section header");
  if (phsize !== (wide ? 56 : 32) || phnum === 0) throw new ElfError("missing or invalid program table");
  r.range(phoff, phnum * phsize);
  r.range(shoff, shnum * shsize);
  const segments: ElfSegment[] = [];
  for (let i = 0; i < phnum; i++) {
    const p = phoff + i * phsize;
    const segment: ElfSegment = {
      type: r.u32(p), flags: r.u32(p + (wide ? 4 : 24)),
      offset: checkedNumber(r.word(p + (wide ? 8 : 4), wide), "segment offset"),
      address: r.word(p + (wide ? 16 : 8), wide),
      fileSize: checkedNumber(r.word(p + (wide ? 32 : 16), wide), "segment file size"),
      memorySize: checkedNumber(r.word(p + (wide ? 40 : 20), wide), "segment memory size"),
      alignment: r.word(p + (wide ? 48 : 28), wide),
    };
    if (segment.type !== 0) r.range(segment.offset, segment.fileSize);
    if (segment.type === 1 || segment.type === 7) {
      if (segment.fileSize > segment.memorySize) throw new ElfError("segment file size exceeds memory size");
      const alignment = segment.alignment;
      if (alignment > 1n && ((alignment & (alignment - 1n)) !== 0n || (segment.address - BigInt(segment.offset)) % alignment !== 0n)) {
        throw new ElfError("invalid segment alignment or file/address congruence");
      }
      if (segment.address + BigInt(segment.memorySize) > (1n << BigInt(wide ? 64 : 32))) throw new ElfError("segment exceeds ELF address width");
    }
    segments.push(segment);
  }
  if (!segments.some(segment => segment.type === 1 && segment.memorySize !== 0)) throw new ElfError("no loadable image");
  const rawSections: (ElfSection & { readonly nameOffset: number })[] = [];
  for (let i = 0; i < shnum; i++) {
    const p = shoff + i * shsize;
    const section = {
      name: "", nameOffset: r.u32(p), type: r.u32(p + 4), flags: r.word(p + 8, wide),
      address: r.word(p + (wide ? 16 : 12), wide), offset: checkedNumber(r.word(p + (wide ? 24 : 16), wide), "section offset"),
      size: checkedNumber(r.word(p + (wide ? 32 : 20), wide), "section size"), link: r.u32(p + (wide ? 40 : 24)),
      info: r.u32(p + (wide ? 44 : 28)), entrySize: checkedNumber(r.word(p + (wide ? 56 : 36), wide), "section entry size"),
    };
    if (section.type !== 8 && section.type !== 0) r.range(section.offset, section.size);
    rawSections.push(section);
  }
  const names = namesIndex === 0 ? null : rawSections[namesIndex];
  if (namesIndex !== 0 && (names === undefined || names === null || names.type !== 3)) throw new ElfError("invalid section name table");
  const sections: ElfSection[] = rawSections.map(section => {
    if (names === null || names === undefined) return section;
    if (section.nameOffset >= names.size) throw new ElfError("section name exceeds string table");
    return { ...section, name: r.string(names.offset + section.nameOffset, names.size - section.nameOffset) };
  });
  const dynamic = readDynamic(r, segments, wide);
  const strtab = dynamicValue(dynamic, 5);
  const strsize = checkedNumber(dynamicValue(dynamic, 10) ?? 0n, "dynamic string size");
  const stringAt = (index: bigint): string => {
    const offset = checkedNumber(index, "string index");
    if (strtab === null || offset >= strsize) throw new ElfError("dynamic string exceeds DT_STRTAB/DT_STRSZ");
    return r.string(elfFileOffset(segments, strtab + index, strsize - offset), strsize - offset);
  };
  const relocations = readRelocations(r, segments, dynamic, wide);
  const versions = readVersions(r, segments, dynamic, stringAt);
  const symbols = readSymbols(r, segments, sections, dynamic, wide, versions, stringAt);
  for (const relocation of relocations) if (relocation.symbolIndex >= symbols.length && relocation.symbolIndex !== 0) throw new ElfError("relocation symbol index exceeds symbol table");
  const interpreterSegments = segments.filter(segment => segment.type === 3);
  if (interpreterSegments.length > 1 || segments.filter(segment => segment.type === 7).length > 1) throw new ElfError("multiple interpreter or TLS segments");
  const interpreter = interpreterSegments[0];
  const optionalString = (tag: number): string | null => { const value = dynamicValue(dynamic, tag); return value === null ? null : stringAt(value); };
  return {
    abi: wide ? { kind: "linux-x86-64", image: "elf64", pointerBytes: 8, call: "system-v-x86-64" }
      : { kind: "linux-i386", image: "elf32", pointerBytes: 4, call: "system-v-i386" },
    type: type === 3 ? "shared" : "executable", entryPoint: r.word(24, wide), segments, sections, dynamic,
    neededLibraries: (dynamic.get(1) ?? []).map(stringAt), soname: optionalString(14), runpath: optionalString(29), rpath: optionalString(15),
    interpreter: interpreter === undefined ? null : r.string(interpreter.offset, interpreter.fileSize), symbols, relocations,
  };
}

function readDynamic(r: Reader, segments: readonly ElfSegment[], wide: boolean): ReadonlyMap<number, readonly bigint[]> {
  const entries = new Map<number, bigint[]>();
  const tables = segments.filter(segment => segment.type === 2);
  if (tables.length > 1) throw new ElfError("multiple dynamic segments");
  for (const segment of tables) {
    const stride = wide ? 16 : 8;
    let terminated = false;
    for (let offset = 0; offset + stride <= segment.fileSize; offset += stride) {
      const p = segment.offset + offset;
      const tag = checkedNumber(r.word(p, wide), "dynamic tag");
      if (tag === 0) { terminated = true; break; }
      const values = entries.get(tag) ?? [];
      if (values.length !== 0 && tag !== 1) throw new ElfError(`duplicate dynamic tag 0x${tag.toString(16)}`);
      values.push(r.word(p + (wide ? 8 : 4), wide));
      entries.set(tag, values);
    }
    if (!terminated) throw new ElfError("dynamic table lacks DT_NULL");
  }
  return entries;
}

function readRelocations(r: Reader, segments: readonly ElfSegment[], dynamic: ElfInspection["dynamic"], wide: boolean): ElfRelocation[] {
  const relocations: ElfRelocation[] = [];
  const seenTables = new Set<string>();
  const read = (address: bigint, size: bigint, rela: boolean, table: ElfRelocation["table"]): void => {
    const stride = (wide ? 8 : 4) * (rela ? 3 : 2);
    const length = checkedNumber(size, "relocation table size");
    if (length % stride !== 0) throw new ElfError("partial relocation entry");
    const key = `${address}:${length}:${rela}`;
    if (seenTables.has(key)) return;
    seenTables.add(key);
    const start = elfFileOffset(segments, address, length);
    for (let offset = 0; offset < length; offset += stride) {
      const p = start + offset;
      const info = r.word(p + (wide ? 8 : 4), wide);
      relocations.push({ address: r.word(p, wide), type: Number(info & (wide ? 0xffffffffn : 0xffn)),
        symbolIndex: Number(info >> BigInt(wide ? 32 : 8)), addend: rela ? r.signed(p + (wide ? 16 : 8), wide) : null, table });
    }
  };
  for (const rela of [false, true]) {
    const address = dynamicValue(dynamic, rela ? 7 : 17);
    const size = dynamicValue(dynamic, rela ? 8 : 18);
    const entry = dynamicValue(dynamic, rela ? 9 : 19);
    if (address === null && size === null) continue;
    if (address === null || size === null || entry !== BigInt((wide ? 8 : 4) * (rela ? 3 : 2))) throw new ElfError("incomplete REL/RELA dynamic tags");
    read(address, size, rela, rela ? "rela" : "rel");
  }
  const plt = dynamicValue(dynamic, 23);
  if (plt !== null) {
    const kind = dynamicValue(dynamic, 20);
    const size = dynamicValue(dynamic, 2);
    if ((kind !== 7n && kind !== 17n) || size === null) throw new ElfError("incomplete PLT relocation tags");
    read(plt, size, kind === 7n, kind === 7n ? "plt-rela" : "plt-rel");
  }
  const relr = dynamicValue(dynamic, 36);
  if (relr !== null) {
    const width = wide ? 8 : 4;
    const size = dynamicValue(dynamic, 35);
    if (size === null || size % BigInt(width) !== 0n || dynamicValue(dynamic, 37) !== BigInt(width)) throw new ElfError("invalid RELR table");
    const length = checkedNumber(size, "RELR table size");
    const offset = elfFileOffset(segments, relr, length);
    let cursor: bigint | null = null;
    for (let i = 0; i < length; i += width) {
      const entry = r.word(offset + i, wide);
      if ((entry & 1n) === 0n) {
        relocations.push({ address: entry, type: 8, symbolIndex: 0, addend: null, table: "relr" });
        cursor = entry + BigInt(width);
      } else {
        if (cursor === null) throw new ElfError("RELR bitmap precedes address");
        for (let bit = 1; bit < width * 8; bit++) if ((entry & (1n << BigInt(bit))) !== 0n) {
          relocations.push({ address: cursor + BigInt((bit - 1) * width), type: 8, symbolIndex: 0, addend: null, table: "relr" });
        }
        cursor += BigInt((width * 8 - 1) * width);
      }
    }
  }
  return relocations;
}

function readVersions(r: Reader, segments: readonly ElfSegment[], dynamic: ElfInspection["dynamic"], stringAt: (index: bigint) => string): Map<number, Omit<ElfVersion, "hidden">> {
  const versions = new Map<number, Omit<ElfVersion, "hidden">>();
  for (const needed of [true, false]) {
    const address = dynamicValue(dynamic, needed ? 0x6ffffffe : 0x6ffffffc);
    const count = checkedNumber(dynamicValue(dynamic, needed ? 0x6fffffff : 0x6ffffffd) ?? 0n, "version count");
    if (address === null) { if (count !== 0) throw new ElfError("missing version table"); continue; }
    if (count === 0) throw new ElfError("version table has no count");
    let current = address;
    for (let i = 0; i < count; i++) {
      const p = elfFileOffset(segments, current, needed ? 16 : 20);
      if (r.u16(p) !== 1) throw new ElfError("unsupported symbol version record");
      const auxCount = r.u16(p + (needed ? 2 : 6));
      let auxiliary = current + BigInt(r.u32(p + (needed ? 8 : 12)));
      if (auxCount === 0) throw new ElfError("version record has no name");
      for (let j = 0; j < auxCount; j++) {
        const a = elfFileOffset(segments, auxiliary, needed ? 16 : 8);
        if (needed || j === 0) {
          const index = needed ? r.u16(a + 6) & 0x7fff : r.u16(p + 4) & 0x7fff;
          const flags = needed ? r.u16(a + 4) : r.u16(p + 2);
          const version = { name: stringAt(BigInt(r.u32(a + (needed ? 8 : 0)))), library: needed ? stringAt(BigInt(r.u32(p + 4))) : "", weak: (flags & 2) !== 0 };
          if (versions.has(index)) throw new ElfError(`duplicate version index ${index}`);
          versions.set(index, version);
        }
        const next = r.u32(a + (needed ? 12 : 4));
        if (j + 1 < auxCount && next === 0) throw new ElfError("truncated version auxiliary chain");
        auxiliary += BigInt(next);
      }
      const next = r.u32(p + (needed ? 12 : 16));
      if (i + 1 < count && next === 0) throw new ElfError("truncated version chain");
      current += BigInt(next);
    }
  }
  return versions;
}

function readSymbols(r: Reader, segments: readonly ElfSegment[], sections: readonly ElfSection[], dynamic: ElfInspection["dynamic"], wide: boolean,
  versions: ReadonlyMap<number, Omit<ElfVersion, "hidden">>, dynamicString: (index: bigint) => string): ElfSymbol[] {
  const symtab = dynamicValue(dynamic, 6);
  const symbolSection = symtab === null ? sections.find(section => section.type === 2) : sections.find(section => section.type === 11 && section.address === symtab);
  const stride = wide ? 24 : 16;
  let count: number;
  let offset: number;
  let stringAt = dynamicString;
  if (symtab === null) {
    if (symbolSection === undefined) return [];
    const strings = sections[symbolSection.link];
    if (strings === undefined || strings.type !== 3) throw new ElfError("symbol table lacks string section");
    stringAt = index => { const i = checkedNumber(index, "symbol name"); if (i >= strings.size) throw new ElfError("symbol name exceeds string table"); return r.string(strings.offset + i, strings.size - i); };
    count = symbolSection.size / stride;
    offset = symbolSection.offset;
  } else {
    if (dynamicValue(dynamic, 11) !== BigInt(stride)) throw new ElfError("incorrect DT_SYMENT");
    const hash = dynamicValue(dynamic, 4);
    const gnuHash = dynamicValue(dynamic, 0x6ffffef5);
    if (hash !== null) count = r.u32(elfFileOffset(segments, hash, 8) + 4);
    else if (gnuHash !== null) count = gnuSymbolCount(r, segments, gnuHash, wide);
    else if (symbolSection !== undefined) count = symbolSection.size / stride;
    else throw new ElfError("cannot bound dynamic symbols without hash or section metadata");
    offset = elfFileOffset(segments, symtab, count * stride);
  }
  if (!Number.isSafeInteger(count) || (symbolSection !== undefined && (symbolSection.entrySize !== stride || symbolSection.size / stride !== count))) throw new ElfError("symbol count or entry size disagrees with section metadata");
  r.range(offset, count * stride);
  const versym = dynamicValue(dynamic, 0x6ffffff0);
  const versionOffset = versym === null ? null : elfFileOffset(segments, versym, count * 2);
  const symbols: ElfSymbol[] = [];
  for (let index = 0; index < count; index++) {
    const p = offset + index * stride;
    const info = r.u8(p + (wide ? 4 : 12));
    const versionWord = versionOffset === null ? 1 : r.u16(versionOffset + index * 2);
    const versionIndex = versionWord & 0x7fff;
    const version = versionIndex > 1 ? versions.get(versionIndex) : undefined;
    if (versionIndex > 1 && version === undefined) throw new ElfError(`undefined version index ${versionIndex}`);
    const section = r.u16(p + (wide ? 6 : 14));
    if (section === 0xffff) throw new ElfError("extended symbol section indices are unsupported");
    symbols.push({ index, name: stringAt(BigInt(r.u32(p))), value: r.word(p + (wide ? 8 : 4), wide),
      size: checkedNumber(r.word(p + (wide ? 16 : 8), wide), "symbol size"), binding: versionIndex === 0 && section !== 0 ? 0 : info >> 4, type: info & 15,
      visibility: r.u8(p + (wide ? 5 : 13)) & 3, section,
      version: version === undefined ? null : { ...version, hidden: (versionWord & 0x8000) !== 0 } });
  }
  return symbols;
}

function gnuSymbolCount(r: Reader, segments: readonly ElfSegment[], address: bigint, wide: boolean): number {
  const header = elfFileOffset(segments, address, 16);
  const buckets = r.u32(header);
  const first = r.u32(header + 4);
  const bloom = r.u32(header + 8);
  if (buckets === 0 || bloom === 0) throw new ElfError("invalid GNU hash table");
  const bucketAddress = address + 16n + BigInt(bloom) * BigInt(wide ? 8 : 4);
  const bucketOffset = elfFileOffset(segments, bucketAddress, buckets * 4);
  const chains = bucketAddress + BigInt(buckets * 4);
  let count = first;
  for (let bucket = 0; bucket < buckets; bucket++) {
    let symbol = r.u32(bucketOffset + bucket * 4);
    if (symbol === 0) continue;
    if (symbol < first) throw new ElfError("GNU hash bucket precedes symbol offset");
    for (;;) {
      const hash = r.u32(elfFileOffset(segments, chains + BigInt(symbol - first) * 4n, 4));
      count = Math.max(count, symbol + 1);
      symbol++;
      if ((hash & 1) !== 0) break;
    }
  }
  return count;
}
