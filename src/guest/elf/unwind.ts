// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestUnwindRegion, MappedGuestMemory } from "../core/contracts.ts";
import { checkedNumber, elfFileOffset, ElfError } from "./parse.ts";
import type { ElfInspection } from "./parse.ts";
import { elfAddress } from "./relocate.ts";

interface Cursor { position: number; }
interface Cie { readonly encoding: number; readonly augmentation: boolean; }

class DwarfReader {
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array, readonly address: bigint, readonly pointerBytes: 4 | 8, readonly dataRelativeBase: bigint | null = null) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  require(cursor: Cursor, bytes: number, end = this.bytes.length): number {
    const offset = cursor.position;
    if (bytes < 0 || offset < 0 || offset > end - bytes) throw new ElfError("truncated DWARF unwind record");
    cursor.position += bytes;
    return offset;
  }
  byte(cursor: Cursor): number { return this.view.getUint8(this.require(cursor, 1)); }
  u32(cursor: Cursor): number { return this.view.getUint32(this.require(cursor, 4), true); }
  u64(cursor: Cursor): bigint { return this.view.getBigUint64(this.require(cursor, 8), true); }
  leb(cursor: Cursor, signed: boolean): bigint {
    let value = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      const byte = this.byte(cursor);
      value |= BigInt(byte & 127) << shift;
      if ((byte & 128) === 0) return signed && (byte & 64) !== 0 ? value - (1n << (shift + 7n)) : value;
    }
    throw new ElfError("oversized DWARF LEB128");
  }
  encoded(cursor: Cursor, encoding: number, relative = true): bigint {
    if (encoding === 0xff) throw new ElfError("omitted DWARF pointer used as an address");
    if ((encoding & 0x70) === 0x50) {
      const absolute = this.address + BigInt(cursor.position);
      cursor.position += Number((BigInt(this.pointerBytes) - absolute % BigInt(this.pointerBytes)) % BigInt(this.pointerBytes));
    }
    const address = this.address + BigInt(cursor.position);
    let value: bigint;
    switch (encoding & 15) {
      case 0: value = this.pointerBytes === 8 ? this.u64(cursor) : BigInt(this.u32(cursor)); break;
      case 1: value = this.leb(cursor, false); break;
      case 2: value = BigInt(this.view.getUint16(this.require(cursor, 2), true)); break;
      case 3: value = BigInt(this.u32(cursor)); break;
      case 4: value = this.u64(cursor); break;
      case 9: value = this.leb(cursor, true); break;
      case 10: value = BigInt(this.view.getInt16(this.require(cursor, 2), true)); break;
      case 11: value = BigInt(this.view.getInt32(this.require(cursor, 4), true)); break;
      case 12: value = this.view.getBigInt64(this.require(cursor, 8), true); break;
      default: throw new ElfError(`unsupported DWARF pointer encoding 0x${encoding.toString(16)}`);
    }
    if (relative) {
      switch (encoding & 0x70) {
        case 0: case 0x50: break;
        case 0x10: value += address; break;
        case 0x30:
          if (this.dataRelativeBase === null) throw new ElfError("DWARF data-relative pointer requires an explicit base");
          value += this.dataRelativeBase; break;
        default: throw new ElfError(`unsupported DWARF relative pointer base 0x${encoding.toString(16)}`);
      }
    }
    return value;
  }
}

/** Preserve full CIE/FDE bytes while indexing each function's actual covered PC range. */
export function readElfUnwind(elf: ElfInspection, source: Uint8Array, memory: MappedGuestMemory, loadBias: bigint): GuestUnwindRegion[] {
  const regions: GuestUnwindRegion[] = [];
  const sections = elf.sections.filter(section => section.name === ".eh_frame" || section.name === ".debug_frame");
  for (const section of sections) {
    const allocated = (section.flags & 2n) !== 0n;
    const bytes = allocated ? memory.copy(elfAddress(memory, loadBias + section.address), section.size) : source.slice(section.offset, section.offset + section.size);
    regions.push(...readFrames(bytes, allocated ? loadBias + section.address : section.address, elf, memory, loadBias, section.name === ".debug_frame"));
  }
  if (!sections.some(section => section.name === ".eh_frame")) {
    const header = elf.segments.find(segment => segment.type === 0x6474e550);
    if (header !== undefined) {
      const bytes = memory.copy(elfAddress(memory, loadBias + header.address), header.fileSize);
      const r = new DwarfReader(bytes, loadBias + header.address, elf.abi.pointerBytes, loadBias + header.address);
      const cursor = { position: 0 };
      if (r.byte(cursor) !== 1) throw new ElfError("unsupported GNU EH frame header version");
      const encoding = r.byte(cursor);
      r.byte(cursor); r.byte(cursor);
      if ((encoding & 0x80) !== 0) throw new ElfError("indirect GNU EH frame section pointer is unsupported");
      const address = r.encoded(cursor, encoding);
      const originalAddress = address - loadBias;
      const segment = elf.segments.find(item => item.type === 1 && originalAddress >= item.address && originalAddress < item.address + BigInt(item.fileSize));
      if (segment === undefined) throw new ElfError("GNU EH frame pointer has no load segment");
      const available = segment.fileSize - checkedNumber(originalAddress - segment.address, "EH frame displacement");
      elfFileOffset(elf.segments, originalAddress, available);
      regions.push(...readFrames(memory.copy(elfAddress(memory, address), available), address, elf, memory, loadBias, false));
    }
  }
  return regions;
}

function readFrames(bytes: Uint8Array, address: bigint, elf: ElfInspection, memory: MappedGuestMemory, loadBias: bigint, debug: boolean): GuestUnwindRegion[] {
  const reader = new DwarfReader(bytes, address, elf.abi.pointerBytes);
  const cursor = { position: 0 };
  const cies = new Map<number, Cie>();
  const regions: GuestUnwindRegion[] = [];
  while (cursor.position < bytes.length) {
    const start = cursor.position;
    if (bytes.length - start < 4 && bytes.subarray(start).every(value => value === 0)) break;
    const initial = reader.u32(cursor);
    if (initial === 0) break;
    const wideLength = initial === 0xffffffff;
    const length = wideLength ? checkedNumber(reader.u64(cursor), "DWARF record length") : initial;
    const end = cursor.position + length;
    if (end > bytes.length || length < (wideLength ? 8 : 4)) throw new ElfError("invalid DWARF record length");
    const idPosition = cursor.position;
    const id = wideLength ? reader.u64(cursor) : BigInt(reader.u32(cursor));
    const isCie = debug ? id === (wideLength ? 0xffffffffffffffffn : 0xffffffffn) : id === 0n;
    if (isCie) {
      const version = reader.byte(cursor);
      if (version !== 1 && version !== 3 && version !== 4) throw new ElfError(`unsupported CIE version ${version}`);
      let augmentation = "";
      for (;;) { const c = reader.byte(cursor); if (c === 0) break; augmentation += String.fromCharCode(c); }
      if (version === 4 && (reader.byte(cursor) !== elf.abi.pointerBytes || reader.byte(cursor) !== 0)) throw new ElfError("unsupported CIE address or segment size");
      reader.leb(cursor, false); reader.leb(cursor, true);
      if (version === 1) reader.byte(cursor); else reader.leb(cursor, false);
      let encoding = 0;
      const hasAugmentation = augmentation.startsWith("z");
      if (hasAugmentation) {
        const size = checkedNumber(reader.leb(cursor, false), "CIE augmentation size");
        const augmentationEnd = cursor.position + size;
        if (augmentationEnd > end) throw new ElfError("CIE augmentation exceeds record");
        for (const code of augmentation.slice(1)) {
          switch (code) {
            case "R": encoding = reader.byte(cursor); break;
            case "L": reader.byte(cursor); break;
            case "P": { const personalityEncoding = reader.byte(cursor); reader.encoded(cursor, personalityEncoding, false); break; }
            case "S": break;
            default: throw new ElfError(`unsupported CIE augmentation ${code}`);
          }
        }
        if (cursor.position > augmentationEnd) throw new ElfError("CIE fields exceed augmentation size");
        cursor.position = augmentationEnd;
      } else if (augmentation !== "") throw new ElfError(`unsupported CIE augmentation ${augmentation}`);
      cies.set(start, { encoding, augmentation: hasAugmentation });
    } else {
      const ciePosition = debug ? checkedNumber(id, "debug CIE offset") : idPosition - checkedNumber(id, "CIE displacement");
      const cie = cies.get(ciePosition);
      if (cie === undefined) throw new ElfError("FDE references an unavailable CIE");
      let pc = reader.encoded(cursor, cie.encoding);
      if ((cie.encoding & 0x80) !== 0) {
        const slot = memory.copy(elfAddress(memory, pc), elf.abi.pointerBytes);
        const view = new DataView(slot.buffer, slot.byteOffset, slot.byteLength);
        pc = elf.abi.pointerBytes === 8 ? view.getBigUint64(0, true) : BigInt(view.getUint32(0, true));
      }
      const range = reader.encoded(cursor, cie.encoding & 15, false);
      if (debug) pc += loadBias;
      if (cie.augmentation) { const size = checkedNumber(reader.leb(cursor, false), "FDE augmentation size"); reader.require(cursor, size, end); }
      if (range < 0n) throw new ElfError("negative FDE PC range");
      if (range !== 0n) regions.push({ start: elfAddress(memory, pc), end: elfAddress(memory, pc + range), format: debug ? "elf-debug-frame" : "elf-eh-frame", metadata: bytes });
    }
    if (cursor.position > end) throw new ElfError("unwind fields exceed record");
    cursor.position = end;
  }
  return regions;
}
