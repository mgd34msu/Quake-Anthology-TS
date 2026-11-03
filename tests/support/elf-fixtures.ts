// SPDX-License-Identifier: GPL-2.0-or-later
// Sectionless ELF containing a versioned export, PT_TLS, and ordinary/indirect relocations.
export function elfTlsFixture(width: 4 | 8): Uint8Array {
  const bytes = new Uint8Array(4096);
  const view = new DataView(bytes.buffer);
  const wide = width === 8;
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
  word(wide ? 32 : 28, 64n);
  view.setUint16(wide ? 52 : 40, wide ? 64 : 52, true);
  view.setUint16(wide ? 54 : 42, wide ? 56 : 32, true);
  view.setUint16(wide ? 56 : 44, 3, true);
  const segment = (index: number, type: number, offset: number, fileSize: number, memorySize: number, alignment: number): void => {
    const p = 64 + index * (wide ? 56 : 32);
    view.setUint32(p, type, true);
    view.setUint32(p + (wide ? 4 : 24), 7, true);
    word(p + (wide ? 8 : 4), BigInt(offset));
    word(p + (wide ? 16 : 8), BigInt(offset));
    word(p + (wide ? 32 : 16), BigInt(fileSize));
    word(p + (wide ? 40 : 20), BigInt(memorySize));
    word(p + (wide ? 48 : 28), BigInt(alignment));
  };
  const tags: readonly (readonly [number, number])[] = [
    [4, 0x4c0],
    [5, 0x480],
    [10, 22],
    [6, 0x400],
    [11, wide ? 24 : 16],
    [7, 0x500],
    [8, width * 3 * 10],
    [9, width * 3],
    [12, 0x800],
    [13, 0x810],
    [25, 0x980],
    [27, width * 2],
    [26, 0x9a0],
    [28, width * 2],
    [0x6ffffffc, 0x680],
    [0x6ffffffd, 1],
    [0x6ffffff0, 0x4e0],
    [0, 0],
  ];
  segment(0, 1, 0, bytes.length, bytes.length + 4096, 4096);
  segment(1, 2, 0x200, tags.length * width * 2, tags.length * width * 2, width);
  segment(2, 7, 0x700, 16, 32, 16);
  for (const [index, [tag, value]] of tags.entries()) {
    word(0x200 + index * width * 2, BigInt(tag));
    word(0x200 + index * width * 2 + width, BigInt(value));
  }
  bytes.set(new TextEncoder().encode("\0tls\0entry\0ELF_TEST_1\0"), 0x480);
  view.setUint32(0x4c0, 1, true);
  view.setUint32(0x4c4, 3, true);
  for (const [index, name, type, value] of [
    [1, 1, 6, 4],
    [2, 5, 2, 0x800],
  ]) {
    if (index === undefined || name === undefined || type === undefined || value === undefined) throw new Error("Incomplete authored symbol");
    const p = 0x400 + index * (wide ? 24 : 16);
    view.setUint32(p, name, true);
    bytes[p + (wide ? 4 : 12)] = 16 + type;
    view.setUint16(p + (wide ? 6 : 14), 1, true);
    word(p + (wide ? 8 : 4), BigInt(value));
    word(p + (wide ? 16 : 8), 4n);
  }
  view.setUint16(0x4e2, 1, true);
  view.setUint16(0x4e4, 2, true);
  view.setUint16(0x680, 1, true);
  view.setUint16(0x684, 2, true);
  view.setUint16(0x686, 1, true);
  view.setUint32(0x68c, 20, true);
  view.setUint32(0x694, 11, true);
  const relocations: readonly (readonly [number, number, number, number])[] = [
    [0x700, 8, 0, 0x800],
    [0x900, wide ? 16 : 35, 0, 0],
    [0x910, wide ? 17 : 36, 1, 7],
    [0x920, wide ? 18 : 14, 1, 3],
    [0x928, wide ? 23 : 37, 1, 5],
    [0x980, 8, 0, 0x800],
    [0x980 + width, 8, 0, 0x810],
    [0x9a0, 8, 0, 0x820],
    [0x9a0 + width, 8, 0, 0x830],
    [0x930, wide ? 37 : 42, 0, 0x840],
  ];
  for (const [index, [address, type, symbol, addend]] of relocations.entries()) {
    const p = 0x500 + index * width * 3;
    word(p, BigInt(address));
    word(p + width, (BigInt(symbol) << BigInt(wide ? 32 : 8)) | BigInt(type));
    word(p + width * 2, BigInt(addend));
  }
  bytes.fill(0xc3, 0x800, 0x860);
  return bytes;
}
