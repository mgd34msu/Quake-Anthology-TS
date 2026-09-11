// SPDX-License-Identifier: GPL-3.0-or-later WITH GCC-exception-3.1
// GNU libstdc++ 4.8 locale_init.cc, locale_facets*.h, and GNU locale members.
import type { GuestAddress, GuestCallValue } from "../../../contracts/execution.ts";
import { integer, requiredPointer, writeUnsigned } from "../common/memory.ts";
import { CxxAbiData } from "./cxx-data.ts";

function mask(value: number): number {
  const upper = value >= 65 && value <= 90, lower = value >= 97 && value <= 122;
  const digit = value >= 48 && value <= 57, print = value >= 32 && value < 127;
  const graph = value > 32 && value < 127, blank = value === 32 || value === 9;
  const space = value === 32 || value >= 9 && value <= 13;
  return (upper ? 0x100 : 0) | (lower ? 0x200 : 0) | (upper || lower ? 0x400 : 0)
    | (digit ? 0x800 : 0) | (digit || value >= 65 && value <= 70 || value >= 97 && value <= 102 ? 0x1000 : 0)
    | (space ? 0x2000 : 0) | (print ? 0x4000 : 0) | (graph ? 0x8000 : 0) | (blank ? 1 : 0)
    | (value >= 0 && value < 32 || value === 127 ? 2 : 0) | (graph && !upper && !lower && !digit ? 4 : 0)
    | (upper || lower || digit ? 8 : 0);
}

export class SystemVClassicLocale {
  readonly implementation: GuestAddress;
  readonly cLocale: GuestAddress;
  readonly ctype: readonly [GuestAddress, GuestAddress];
  readonly numPut: readonly [GuestAddress, GuestAddress];
  readonly numGet: readonly [GuestAddress, GuestAddress];
  readonly #facetBase: GuestAddress;
  constructor(readonly abi: CxxAbiData) {
    const host = abi.host, m = host.memory, p = m.pointerBytes;
    this.#facetBase = abi.type("NSt6locale5facetE");
    this.cLocale = host.allocate(29 * p);
    const tables = host.allocate(384 * 10), classification = abi.slot(tables, 128 * 2);
    const lower = abi.slot(tables, 384 * 2 + 128 * 4), upper = abi.slot(tables, 384 * 6 + 128 * 4);
    for (let c = -128; c < 256; c++) {
      const byte = c < 0 && c !== -1 ? c + 256 : c;
      m.writeUint16(abi.slot(classification, c * 2), mask(byte));
      m.writeInt32(abi.slot(lower, c * 4), byte >= 65 && byte <= 90 ? byte + 32 : byte);
      m.writeInt32(abi.slot(upper, c * 4), byte >= 97 && byte <= 122 ? byte - 32 : byte);
    }
    m.writePointer(abi.slot(this.cLocale, 13 * p), classification);
    m.writePointer(abi.slot(this.cLocale, 14 * p), lower); m.writePointer(abi.slot(this.cLocale, 15 * p), upper);
    const cName = abi.bytes("C");
    for (let i = 0; i < 13; i++) m.writePointer(abi.slot(this.cLocale, (16 + i) * p), cName);
    const version = "GLIBC_2.3";
    for (const [name, table] of [["__ctype_b_loc", classification], ["__ctype_tolower_loc", lower], ["__ctype_toupper_loc", upper]] satisfies readonly (readonly [string, GuestAddress])[]) {
      const slot = host.allocate(p); m.writePointer(slot, table);
      host.service("libc.so.6", name, [version, null], [], "pointer", () => ({ kind: "pointer", value: slot }));
    }
    const facets = host.allocate(28 * p), caches = host.allocate(28 * p), names = host.allocate(12 * p);
    m.writePointer(names, cName);
    this.implementation = host.allocate(5 * p);
    m.writeInt32(this.implementation, 2); m.writePointer(abi.slot(this.implementation, p), facets);
    writeUnsigned(m, abi.slot(this.implementation, 2 * p), p, 28n);
    m.writePointer(abi.slot(this.implementation, 3 * p), caches); m.writePointer(abi.slot(this.implementation, 4 * p), names);
    const narrow = this.constructFacets(false, facets, caches, classification, lower, upper);
    const wide = this.constructFacets(true, facets, caches, classification, lower, upper);
    this.ctype = [narrow.ctype, wide.ctype]; this.numPut = [narrow.numPut, wide.numPut]; this.numGet = [narrow.numGet, wide.numGet];
  }
  retain(): GuestAddress {
    const m = this.abi.host.memory;
    m.writeInt32(this.implementation, m.readInt32(this.implementation) + 1); return this.implementation;
  }
  release(implementation: GuestAddress): void {
    const m = this.abi.host.memory;
    const value = m.readInt32(implementation);
    if (value <= 2 && implementation.byteOffset === this.implementation.byteOffset) throw new Error("Released permanent classic locale reference");
    m.writeInt32(implementation, value - 1);
  }
  private facet(name: string, size: number, methods: readonly GuestAddress[] = []): GuestAddress {
    const { abi } = this, m = abi.host.memory, p = m.pointerBytes;
    const address = abi.host.allocate(size), type = abi.type(name, [{ type: this.#facetBase, offset: 0, flags: 2 }]);
    const destructor = abi.unsupported(`__guest_${name}_destructor`), deleting = abi.unsupported(`__guest_${name}_deleting_destructor`);
    m.writePointer(address, abi.vtable(name, type, [destructor, deleting, ...methods]));
    m.writeInt32(abi.slot(address, p), 1); return address;
  }
  private text(value: string, wide: boolean): GuestAddress {
    if (!wide) return this.abi.bytes(value);
    const address = this.abi.host.allocate((value.length + 1) * 4);
    for (let i = 0; i < value.length; i++) this.abi.host.memory.writeUint32(this.abi.slot(address, i * 4), value.charCodeAt(i));
    return address;
  }
  private cache(name: string, wide: boolean, kind: "number" | "money" | "time"): GuestAddress {
    const { abi } = this, m = abi.host.memory, p = m.pointerBytes, width = wide ? 4 : 1;
    const result = this.facet(name, 1024); m.writeInt32(abi.slot(result, p), 2);
    let cursor = 2 * p;
    const align = (n: number): void => { cursor = Math.ceil(cursor / n) * n; };
    const ptr = (value: GuestAddress): void => { align(p); m.writePointer(abi.slot(result, cursor), value); cursor += p; };
    const size = (value: number): void => { align(p); writeUnsigned(m, abi.slot(result, cursor), p, BigInt(value)); cursor += p; };
    const char = (value: number): void => { align(width); writeUnsigned(m, abi.slot(result, cursor), width, BigInt(value)); cursor += width; };
    if (kind === "time") {
      const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      for (const text of ["%m/%d/%y", "%m/%d/%y", "%H:%M:%S", "%H:%M:%S", "", "", "AM", "PM", "", ...days, ...days.map(day => day.slice(0, 3)), ...months, ...months.map(month => month.slice(0, 3))]) ptr(this.text(text, wide));
      return result;
    }
    ptr(abi.bytes("")); size(0); cursor++;
    if (kind === "number") {
      ptr(this.text("true", wide)); size(4); ptr(this.text("false", wide)); size(5); char(46); char(44);
      for (const text of ["-+xX0123456789abcdef0123456789ABCDEF", "-+xX0123456789abcdefABCDEF"]) for (const c of text) char(c.charCodeAt(0));
    } else {
      char(46); char(44);
      for (let i = 0; i < 3; i++) { ptr(this.text("", wide)); size(0); }
      align(4); cursor += 4;
      m.write(abi.slot(result, cursor), new Uint8Array([2, 3, 0, 4, 2, 3, 0, 4])); cursor += 8;
      for (const c of "-0123456789") char(c.charCodeAt(0));
    }
    return result;
  }
  private constructFacets(wide: boolean, facets: GuestAddress, caches: GuestAddress, classification: GuestAddress, lower: GuestAddress, upper: GuestAddress) {
    const { abi } = this, host = abi.host, m = host.memory, p = m.pointerBytes, ch = wide ? "w" : "c";
    const names = [`St5ctypeI${ch}E`, `St7codecvtI${ch}c11__mbstate_tE`, `St8numpunctI${ch}E`,
      `St7num_getI${ch}St19istreambuf_iteratorI${ch}St11char_traitsI${ch}EEE`, `St7num_putI${ch}St19ostreambuf_iteratorI${ch}St11char_traitsI${ch}EEE`,
      `St7collateI${ch}E`, `St10moneypunctI${ch}Lb0EE`, `St10moneypunctI${ch}Lb1EE`,
      `St9money_getI${ch}St19istreambuf_iteratorI${ch}St11char_traitsI${ch}EEE`, `St9money_putI${ch}St19ostreambuf_iteratorI${ch}St11char_traitsI${ch}EEE`,
      `St11__timepunctI${ch}E`, `St8time_getI${ch}St19istreambuf_iteratorI${ch}St11char_traitsI${ch}EEE`, `St8time_putI${ch}St19ostreambuf_iteratorI${ch}St11char_traitsI${ch}EEE`, `St8messagesI${ch}E`];
    const built: GuestAddress[] = [];
    names.forEach((name, index) => {
      const methods = index === 0 ? this.ctypeMethods(wide) : Array.from({ length: 14 }, (_, slot) => abi.unsupported(`__guest_${name}_virtual_${slot}`));
      const size = index === 0 ? wide ? p === 4 ? 1264 : 1344 : Math.ceil((7 * p + 514) / p) * p : index === 10 ? 5 * p : index === 13 ? 4 * p : [1, 2, 5, 6, 7].includes(index) ? 3 * p : 2 * p;
      const facet = this.facet(name, size, methods), id = (wide ? 14 : 0) + index;
      built.push(facet); m.writePointer(abi.slot(facets, id * p), facet); m.writeInt32(abi.slot(facet, p), 2);
      const idSymbol = `_ZN${name}2idE`;
      const idAddress = abi.data(idSymbol, p); writeUnsigned(m, idAddress, p, BigInt(id + 1));
      if (index === 0) {
        m.writePointer(abi.slot(facet, 2 * p), this.cLocale);
        if (!wide) {
          m.writePointer(abi.slot(facet, 4 * p), upper); m.writePointer(abi.slot(facet, 5 * p), lower);
          m.writePointer(abi.slot(facet, 6 * p), classification);
        } else {
          const narrow = 3 * p; m.writeUint8(abi.slot(facet, narrow), 1);
          for (let c = 0; c < 128; c++) m.writeUint8(abi.slot(facet, narrow + 1 + c), c);
          const widen = Math.ceil((narrow + 129) / 4) * 4;
          for (let c = 0; c < 256; c++) m.writeUint32(abi.slot(facet, widen + c * 4), c < 128 ? c : 0xffffffff);
          const masks = Math.ceil((widen + 1056) / p) * p;
          for (let bit = 0; bit < 12; bit++) {
            const flag = bit < 8 ? 1 << (bit + 8) : 1 << (bit - 8);
            m.writeUint16(abi.slot(facet, widen + 1024 + bit * 2), flag);
            // GCC 4.8 _M_convert_to_wmask does not map the C library's blank bit.
            if (bit === 8) continue;
            // GLIBC's three-level wctype bit-table layout, retaining the C-locale ASCII domain.
            const table = host.allocate(56);
            [7, 1, 5, 3, 0, 24].forEach((value, index) => m.writeUint32(abi.slot(table, index * 4), value));
            for (let group = 0; group < 4; group++) {
              m.writeUint32(abi.slot(table, 24 + group * 4), 40 + group * 4);
              let bits = 0;
              for (let offset = 0; offset < 32; offset++) if ((mask(group * 32 + offset) & flag) !== 0) bits |= 1 << offset;
              m.writeUint32(abi.slot(table, 40 + group * 4), bits >>> 0);
            }
            m.writePointer(abi.slot(facet, masks + bit * p), table);
          }
        }
      } else if (index === 2 || index === 6 || index === 7 || index === 10) {
        const cacheName = index === 2 ? `St16__numpunct_cacheI${ch}E` : index === 10 ? `St17__timepunct_cacheI${ch}E` : `St18__moneypunct_cacheI${ch}Lb${index === 7 ? 1 : 0}EE`;
        const cache = this.cache(cacheName, wide, index === 2 ? "number" : index === 10 ? "time" : "money");
        m.writePointer(abi.slot(facet, 2 * p), cache); m.writePointer(abi.slot(caches, id * p), cache);
        if (index === 10) { m.writePointer(abi.slot(facet, 3 * p), this.cLocale); m.writePointer(abi.slot(facet, 4 * p), abi.bytes("C")); }
      } else if (index === 1 || index === 5 || index === 13) {
        m.writePointer(abi.slot(facet, 2 * p), this.cLocale);
        if (index === 13) m.writePointer(abi.slot(facet, 3 * p), abi.bytes("C"));
      }
    });
    const ctype = built[0], numGet = built[3], numPut = built[4];
    if (ctype === undefined || numGet === undefined || numPut === undefined) throw new Error("Missing standard C locale facets");
    return { ctype, numGet, numPut };
  }
  private ctypeMethods(wide: boolean): GuestAddress[] {
    const { abi } = this, m = abi.host.memory, type = wide ? "uint32" : "int32", ch = wide ? "w" : "c", width = wide ? 4 : 1;
    const methods: GuestAddress[] = [];
    const read = (address: GuestAddress): number => wide ? m.readUint32(address) : m.readUint8(address);
    const write = (address: GuestAddress, value: number): void => { if (wide) m.writeUint32(address, value); else m.writeUint8(address, value); };
    const argumentChar = (args: readonly GuestCallValue[], index: number): number => Number(integer(args, index));
    if (wide) {
      methods.push(abi.function(`__guest_ctype_${ch}_is`, ["pointer", "uint32", "uint32"], "int32", (_context, args) => {
        const object = requiredPointer(args, 0), requested = argumentChar(args, 1), value = argumentChar(args, 2);
        const widen = Math.ceil((3 * m.pointerBytes + 129) / 4) * 4, masks = Math.ceil((widen + 1056) / m.pointerBytes) * m.pointerBytes;
        for (let bit = 0; bit < 12; bit++) {
          if ((m.readUint16(abi.slot(object, widen + 1024 + bit * 2)) & requested) === 0) continue;
          const table = m.readPointer(abi.slot(object, masks + bit * m.pointerBytes));
          if (table === null) continue;
          const index1 = value >>> m.readUint32(table);
          if (index1 >= m.readUint32(abi.slot(table, 4))) continue;
          const lookup1 = m.readUint32(abi.slot(table, 20 + index1 * 4)); if (lookup1 === 0) continue;
          const index2 = (value >>> m.readUint32(abi.slot(table, 8))) & m.readUint32(abi.slot(table, 12));
          const lookup2 = m.readUint32(abi.slot(table, lookup1 + index2 * 4)); if (lookup2 === 0) continue;
          const index3 = (value >>> 5) & m.readUint32(abi.slot(table, 16));
          if (((m.readUint32(abi.slot(table, lookup2 + index3 * 4)) >>> (value & 31)) & 1) !== 0) return { kind: "int32", value: 1 };
        }
        return { kind: "int32", value: 0 };
      }));
      for (const operation of ["is_range", "scan_is", "scan_not"]) methods.push(abi.unsupported(`__guest_ctype_${ch}_${operation}`));
    }
    for (const operation of ["toupper", "tolower"]) {
      const convert = (object: GuestAddress, c: number): number => {
        if (wide) return operation === "toupper" ? c >= 97 && c <= 122 ? c - 32 : c : c >= 65 && c <= 90 ? c + 32 : c;
        const table = m.readPointer(abi.slot(object, (operation === "toupper" ? 4 : 5) * m.pointerBytes));
        if (table === null) throw new TypeError("Missing guest ctype conversion table");
        return m.readInt32(abi.slot(table, (c & 255) * 4)) << 24 >> 24;
      };
      methods.push(abi.function(`__guest_ctype_${ch}_${operation}`, ["pointer", type], type, (_context, args) => {
        const value = convert(requiredPointer(args, 0), argumentChar(args, 1)); return wide ? { kind: "uint32", value } : { kind: "int32", value };
      }));
      methods.push(abi.function(`__guest_ctype_${ch}_${operation}_range`, ["pointer", "pointer", "pointer"], "pointer", (_context, args) => {
        let current = requiredPointer(args, 1); const end = requiredPointer(args, 2);
        while (current.byteOffset < end.byteOffset) { write(current, convert(requiredPointer(args, 0), read(current))); current = abi.slot(current, width); }
        return { kind: "pointer", value: end };
      }));
    }
    const widen = (object: GuestAddress, value: number): number => wide
      ? m.readUint32(abi.slot(object, Math.ceil((3 * m.pointerBytes + 129) / 4) * 4 + value * 4)) : value << 24 >> 24;
    methods.push(abi.function(`__guest_ctype_${ch}_widen`, ["pointer", "int32"], type, (_context, args) => {
      const value = widen(requiredPointer(args, 0), Number(integer(args, 1) & 255n));
      return wide ? { kind: "uint32", value } : { kind: "int32", value };
    }));
    methods.push(abi.function(`__guest_ctype_${ch}_widen_range`, ["pointer", "pointer", "pointer", "pointer"], "pointer", (_context, args) => {
      let source = requiredPointer(args, 1), target = requiredPointer(args, 3); const end = requiredPointer(args, 2);
      while (source.byteOffset < end.byteOffset) { write(target, widen(requiredPointer(args, 0), m.readUint8(source))); source = abi.slot(source, 1); target = abi.slot(target, width); }
      return { kind: "pointer", value: end };
    }));
    methods.push(abi.function(`__guest_ctype_${ch}_narrow`, ["pointer", type, "int32"], "int32", (_context, args) => {
      const object = requiredPointer(args, 0), input = argumentChar(args, 1), narrow = 3 * m.pointerBytes;
      const value = wide && input < 128 && m.readUint8(abi.slot(object, narrow)) !== 0
        ? m.readUint8(abi.slot(object, narrow + 1 + input)) : wide && input > 127 ? argumentChar(args, 2) : input;
      return { kind: "int32", value: value << 24 >> 24 };
    }));
    methods.push(abi.unsupported(`__guest_ctype_${ch}_narrow_range`));
    return methods;
  }
}
