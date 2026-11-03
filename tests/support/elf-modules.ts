// SPDX-License-Identifier: GPL-2.0-or-later

/**
 * Builds small sectionless Linux ELF shared objects that carry hand-assembled machine code, so the ELF loader, the System V
 * runtime and the native Q3 module wrappers run end to end without a retail game module. The image is one read-write-execute
 * PT_LOAD with a PT_DYNAMIC table (DT_HASH, DT_SYMTAB, DT_STRTAB and one relative relocation table) and exported functions.
 */
export interface SyntheticElfFunction {
  readonly name: string;
  readonly offset: number;
}
export interface SyntheticElfOptions {
  readonly width: 4 | 8;
  readonly code: Uint8Array;
  /** Exported function symbols, offsets relative to the start of `code`. */
  readonly exports: readonly SyntheticElfFunction[];
  /** Image-relative locations of pointer-sized words that receive the load bias plus the stored addend (R_*_RELATIVE). */
  readonly relative?: readonly { readonly at: number; readonly addend: number }[];
  /** Zero-filled bytes mapped after the image (a .bss). */
  readonly bss?: number;
}

export const SYNTHETIC_ELF = { code: 0x600, data: 0xc00, size: 0x1000 } as const;

export function syntheticElfModule(options: SyntheticElfOptions): Uint8Array {
  const { width, code } = options,
    wide = width === 8;
  const bytes = new Uint8Array(SYNTHETIC_ELF.size),
    view = new DataView(bytes.buffer);
  if (SYNTHETIC_ELF.code + code.length > SYNTHETIC_ELF.data) throw new RangeError("Synthetic ELF code exceeds its segment");
  const word = (offset: number, value: bigint): void => {
    if (wide) view.setBigUint64(offset, BigInt.asUintN(64, value), true);
    else view.setUint32(offset, Number(BigInt.asUintN(32, value)), true);
  };
  view.setUint32(0, 0x464c457f, true);
  bytes[4] = wide ? 2 : 1;
  bytes[5] = 1;
  bytes[6] = 1;
  view.setUint16(16, 3, true);
  view.setUint16(18, wide ? 62 : 3, true);
  view.setUint32(20, 1, true);
  const programTable = wide ? 64 : 52;
  word(wide ? 32 : 28, BigInt(programTable));
  view.setUint16(wide ? 52 : 40, programTable, true);
  view.setUint16(wide ? 54 : 42, wide ? 56 : 32, true);
  view.setUint16(wide ? 56 : 44, 2, true);
  const segment = (index: number, type: number, offset: number, size: number, memorySize: number, alignment: number): void => {
    const p = programTable + index * (wide ? 56 : 32);
    view.setUint32(p, type, true);
    view.setUint32(p + (wide ? 4 : 24), 7, true);
    word(p + (wide ? 8 : 4), BigInt(offset));
    word(p + (wide ? 16 : 8), BigInt(offset));
    word(p + (wide ? 32 : 16), BigInt(size));
    word(p + (wide ? 40 : 20), BigInt(memorySize));
    word(p + (wide ? 48 : 28), BigInt(alignment));
  };
  const dynamicAt = 0x200,
    stringsAt = 0x300,
    symbolsAt = 0x380,
    hashAt = 0x4c0,
    relocationsAt = 0x540;
  const relative = options.relative ?? [];
  const entry = wide ? 24 : 16,
    relocationEntry = wide ? 24 : 8;
  const tags: readonly (readonly [number, number])[] = [
    [4, hashAt],
    [5, stringsAt],
    [10, 0x80],
    [6, symbolsAt],
    [11, entry],
    ...(relative.length === 0
      ? []
      : wide
        ? ([
            [7, relocationsAt],
            [8, relative.length * relocationEntry],
            [9, relocationEntry],
          ] as const)
        : ([
            [17, relocationsAt],
            [18, relative.length * relocationEntry],
            [19, relocationEntry],
          ] as const)),
    [0, 0],
  ];
  segment(0, 1, 0, SYNTHETIC_ELF.size, SYNTHETIC_ELF.size + (options.bss ?? 0), 4096);
  segment(1, 2, dynamicAt, tags.length * width * 2, tags.length * width * 2, width);
  tags.forEach(([tag, value], index) => {
    word(dynamicAt + index * width * 2, BigInt(tag));
    word(dynamicAt + index * width * 2 + width, BigInt(value));
  });
  // Symbol 0 is the mandatory null symbol; every export is a global function defined in section index 1.
  let cursor = 1;
  const names = new Map<string, number>();
  for (const symbol of options.exports) {
    names.set(symbol.name, cursor);
    bytes.set(new TextEncoder().encode(symbol.name), stringsAt + cursor);
    cursor += symbol.name.length + 1;
  }
  if (cursor > 0x80) throw new RangeError("Synthetic ELF string table is full");
  options.exports.forEach((symbol, index) => {
    const p = symbolsAt + (index + 1) * entry,
      nameOffset = names.get(symbol.name);
    if (nameOffset === undefined) throw new Error("Missing symbol name");
    view.setUint32(p, nameOffset, true);
    bytes[p + (wide ? 4 : 12)] = (1 << 4) | 2;
    view.setUint16(p + (wide ? 6 : 14), 1, true);
    word(p + (wide ? 8 : 4), BigInt(SYNTHETIC_ELF.code + symbol.offset));
    word(p + (wide ? 16 : 8), 16n);
  });
  // A single hash bucket whose chain visits every symbol; the loader uses the chain count to bound the table.
  const count = options.exports.length + 1;
  view.setUint32(hashAt, 1, true);
  view.setUint32(hashAt + 4, count, true);
  view.setUint32(hashAt + 8, count - 1, true);
  for (let index = 0; index < count; index++) view.setUint32(hashAt + 12 + index * 4, index === 0 ? 0 : index - 1, true);
  relative.forEach((item, index) => {
    const p = relocationsAt + index * relocationEntry;
    if (wide) {
      word(p, BigInt(item.at));
      word(p + 8, 8n);
      word(p + 16, BigInt(item.addend));
    } else {
      word(p, BigInt(item.at));
      view.setUint32(p + 4, 8, true);
      view.setUint32(item.at, item.addend, true);
    }
  });
  bytes.set(code, SYNTHETIC_ELF.code);
  return bytes;
}

/** Collects machine code with displacements to image offsets, resolved when the code is finished. */
export class CodeBuilder {
  private readonly bytes: number[] = [];
  private readonly fixups: { readonly at: number; readonly target: number; readonly from: "end" | number }[] = [];
  private readonly marks = new Map<string, number>();
  mark(name: string): number {
    this.marks.set(name, this.bytes.length);
    return this.bytes.length;
  }
  offsetOf(name: string): number {
    const value = this.marks.get(name);
    if (value === undefined) throw new Error(`Unknown code mark ${name}`);
    return value;
  }
  raw(...values: number[]): this {
    this.bytes.push(...values);
    return this;
  }
  u32(value: number): this {
    this.bytes.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255);
    return this;
  }
  /** A displacement measured from the end of this 4-byte field to an image offset: the operand of RIP-relative x86-64 addressing or of call/jmp rel32. */
  rip(imageTarget: number): this {
    this.fixups.push({ at: this.bytes.length, target: imageTarget, from: "end" });
    return this.u32(0);
  }
  /** A displacement measured from a code mark to an image offset: the operand after an i386 call/pop program-counter thunk. */
  fromMark(mark: string, imageTarget: number): this {
    this.fixups.push({ at: this.bytes.length, target: imageTarget, from: SYNTHETIC_ELF.code + this.offsetOf(mark) });
    return this.u32(0);
  }
  finish(): Uint8Array {
    const out = Uint8Array.from(this.bytes),
      view = new DataView(out.buffer);
    for (const fixup of this.fixups) view.setInt32(fixup.at, fixup.target - (fixup.from === "end" ? SYNTHETIC_ELF.code + fixup.at + 4 : fixup.from), true);
    return out;
  }
}
