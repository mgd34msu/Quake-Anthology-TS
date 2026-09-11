// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress } from "../../../../src/contracts/execution.ts";

export function lifecycleElf(width: 4 | 8, bias: bigint, callback: GuestAddress, counter: GuestAddress): Uint8Array {
  const bytes = new Uint8Array(4096), view = new DataView(bytes.buffer), wide = width === 8;
  const word = (offset: number, value: bigint): void => {
    if (wide) view.setBigUint64(offset, value, true); else view.setUint32(offset, Number(value), true);
  };
  view.setUint32(0, 0x464c457f, true); bytes[4] = wide ? 2 : 1; bytes[5] = 1; bytes[6] = 1;
  view.setUint16(16, 3, true); view.setUint16(18, wide ? 62 : 3, true); view.setUint32(20, 1, true);
  word(wide ? 32 : 28, 64n);
  view.setUint16(wide ? 52 : 40, wide ? 64 : 52, true); view.setUint16(wide ? 54 : 42, wide ? 56 : 32, true); view.setUint16(wide ? 56 : 44, 3, true);
  const segment = (index: number, type: number, offset: number, size: number, memorySize: number, alignment: number): void => {
    const start = 64 + index * (wide ? 56 : 32);
    view.setUint32(start, type, true); view.setUint32(start + (wide ? 4 : 24), 7, true);
    word(start + (wide ? 8 : 4), BigInt(offset)); word(start + (wide ? 16 : 8), BigInt(offset));
    word(start + (wide ? 32 : 16), BigInt(size)); word(start + (wide ? 40 : 20), BigInt(memorySize)); word(start + (wide ? 48 : 28), BigInt(alignment));
  };
  const tags: readonly (readonly [number, number])[] = [[12, 0x800], [13, 0x980], [25, 0x600], [27, width * 2], [26, 0x640], [28, width * 2], [0, 0]];
  segment(0, 1, 0, 4096, 4096, 4096); segment(1, 2, 0x200, tags.length * width * 2, tags.length * width * 2, width); segment(2, 7, 0x700, 4, 32, 32);
  tags.forEach(([tag, value], index) => { word(0x200 + index * width * 2, BigInt(tag)); word(0x200 + index * width * 2 + width, BigInt(value)); });
  word(0x600, bias + 0x880n); word(0x600 + width, bias + 0x900n); word(0x640, bias + 0xa00n); word(0x640 + width, bias + 0xa80n);
  view.setUint32(0x700, 77, true);
  const immediate = (value: bigint): number[] => Array.from({ length: width }, (_, index) => Number(value >> BigInt(index * 8) & 255n));
  for (const [offset, digit] of [[0x800, 1], [0x880, 2], [0x900, 3], [0xa00, 4], [0xa80, 5], [0x980, 6]]) {
    if (offset === undefined || digit === undefined) throw new Error("Incomplete lifecycle fixture");
    bytes.set(wide ? [0x48, 0x83, 0xec, 8, 0x48, 0xbf, ...immediate(counter.byteOffset), 0xbe, digit, 0, 0, 0,
      0x48, 0xb8, ...immediate(callback.byteOffset), 0xff, 0xd0, 0x48, 0x83, 0xc4, 8, 0xc3]
      : [0x83, 0xec, 4, 0x6a, digit, 0x68, ...immediate(counter.byteOffset), 0xb8, ...immediate(callback.byteOffset), 0xff, 0xd0, 0x83, 0xc4, 12, 0xc3], offset);
  }
  return bytes;
}
