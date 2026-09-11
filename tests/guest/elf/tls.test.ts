// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createContentDigest } from "../../../src/contracts/content.ts";
import type { GuestAddress, ModuleIdentity } from "../../../src/contracts/execution.ts";
import { SparseGuestMemory } from "../../../src/guest/core/index.ts";
import type { GuestImportResolver } from "../../../src/guest/core/index.ts";
import { loadElf } from "../../../src/guest/elf/index.ts";

const module: ModuleIdentity = { id: "test:elf-tls", artifactPath: "authored-elf-tls", revision: "1", digest: createContentDigest("32".repeat(32)) };
const resolver: GuestImportResolver = { resolve(import_) { return { kind: "unresolved", import: import_, detail: "authored image has no external imports" }; } };

// Sectionless ELF containing a versioned export, PT_TLS, and ordinary/indirect relocations.
function fixture(width: 4 | 8): Uint8Array {
  const bytes = new Uint8Array(4096);
  const view = new DataView(bytes.buffer);
  const wide = width === 8;
  const word = (offset: number, value: bigint): void => {
    if (wide) view.setBigUint64(offset, BigInt.asUintN(64, value), true);
    else view.setUint32(offset, Number(BigInt.asUintN(32, value)), true);
  };
  view.setUint32(0, 0x464c457f, true);
  bytes[4] = wide ? 2 : 1; bytes[5] = 1; bytes[6] = 1;
  view.setUint16(16, 3, true); view.setUint16(18, wide ? 62 : 3, true); view.setUint32(20, 1, true);
  word(wide ? 32 : 28, 64n);
  view.setUint16(wide ? 52 : 40, wide ? 64 : 52, true);
  view.setUint16(wide ? 54 : 42, wide ? 56 : 32, true);
  view.setUint16(wide ? 56 : 44, 3, true);
  const segment = (index: number, type: number, offset: number, fileSize: number, memorySize: number, alignment: number): void => {
    const p = 64 + index * (wide ? 56 : 32);
    view.setUint32(p, type, true); view.setUint32(p + (wide ? 4 : 24), 7, true);
    word(p + (wide ? 8 : 4), BigInt(offset)); word(p + (wide ? 16 : 8), BigInt(offset));
    word(p + (wide ? 32 : 16), BigInt(fileSize)); word(p + (wide ? 40 : 20), BigInt(memorySize));
    word(p + (wide ? 48 : 28), BigInt(alignment));
  };
  const tags: readonly (readonly [number, number])[] = [
    [4, 0x4c0], [5, 0x480], [10, 22], [6, 0x400], [11, wide ? 24 : 16],
    [7, 0x500], [8, width * 3 * 10], [9, width * 3],
    [12, 0x800], [13, 0x810], [25, 0x980], [27, width * 2], [26, 0x9a0], [28, width * 2],
    [0x6ffffffc, 0x680], [0x6ffffffd, 1], [0x6ffffff0, 0x4e0], [0, 0],
  ];
  segment(0, 1, 0, bytes.length, bytes.length + 4096, 4096);
  segment(1, 2, 0x200, tags.length * width * 2, tags.length * width * 2, width);
  segment(2, 7, 0x700, 16, 32, 16);
  for (const [index, [tag, value]] of tags.entries()) { word(0x200 + index * width * 2, BigInt(tag)); word(0x200 + index * width * 2 + width, BigInt(value)); }
  bytes.set(new TextEncoder().encode("\0tls\0entry\0ELF_TEST_1\0"), 0x480);
  view.setUint32(0x4c0, 1, true); view.setUint32(0x4c4, 3, true);
  for (const [index, name, type, value] of [[1, 1, 6, 4], [2, 5, 2, 0x800]]) {
    if (index === undefined || name === undefined || type === undefined || value === undefined) throw new Error("Incomplete authored symbol");
    const p = 0x400 + index * (wide ? 24 : 16);
    view.setUint32(p, name, true); bytes[p + (wide ? 4 : 12)] = 16 + type;
    view.setUint16(p + (wide ? 6 : 14), 1, true); word(p + (wide ? 8 : 4), BigInt(value)); word(p + (wide ? 16 : 8), 4n);
  }
  view.setUint16(0x4e2, 1, true); view.setUint16(0x4e4, 2, true);
  view.setUint16(0x680, 1, true); view.setUint16(0x684, 2, true); view.setUint16(0x686, 1, true);
  view.setUint32(0x68c, 20, true); view.setUint32(0x694, 11, true);
  const relocations: readonly (readonly [number, number, number, number])[] = [
    [0x700, 8, 0, 0x800], [0x900, wide ? 16 : 35, 0, 0], [0x910, wide ? 17 : 36, 1, 7],
    [0x920, wide ? 18 : 14, 1, 3], [0x928, wide ? 23 : 37, 1, 5],
    [0x980, 8, 0, 0x800], [0x980 + width, 8, 0, 0x810], [0x9a0, 8, 0, 0x820], [0x9a0 + width, 8, 0, 0x830],
    [0x930, wide ? 37 : 42, 0, 0x840],
  ];
  for (const [index, [address, type, symbol, addend]] of relocations.entries()) {
    const p = 0x500 + index * width * 3;
    word(p, BigInt(address)); word(p + width, (BigInt(symbol) << BigInt(wide ? 32 : 8)) | BigInt(type)); word(p + width * 2, BigInt(addend));
  }
  bytes.fill(0xc3, 0x800, 0x860);
  return bytes;
}

function at(memory: SparseGuestMemory, value: bigint): GuestAddress {
  const address = memory.pointer(value);
  if (address === null) throw new Error("Fixture address must be nonnull");
  return address;
}

for (const width of [4, 8]) {
  if (width !== 4 && width !== 8) throw new Error("Invalid fixture width");
  test(`ELF${width * 8} TLS relocations use module IDs, signed TP displacements, and relocated templates`, () => {
    const bytes = fixture(width);
    const memory = new SparseGuestMemory({ module, pointerBytes: width });
    const loadBias = 0x20000000n;
    const options = { bytes, module, memory, loadBias, resolver, dependencies: new Set<string>() };
    expect(() => loadElf(options)).toThrow("requires a guest thread/module allocation");
    expect(memory.mappings()).toHaveLength(0);
    const tls = { current: { moduleId: 7n, threadPointerOffset: -64n }, resolve() { return null; } };
    expect(() => loadElf({ ...options, tls })).toThrow("requires explicit guest resolver execution");
    expect(memory.mappings()).toHaveLength(0);
    const unsupported = bytes.slice();
    const unsupportedView = new DataView(unsupported.buffer);
    if (width === 8) unsupportedView.setBigUint64(0x508, 0xffffffffn, true);
    else unsupportedView.setUint32(0x504, 0xff, true);
    expect(() => loadElf({ ...options, bytes: unsupported, tls })).toThrow("unsupported");
    expect(memory.mappings()).toHaveLength(0);
    let indirectCalls = 0;
    const image = loadElf({ ...options, tls,
      resolveIndirect(address) {
        expect(address.byteOffset).toBe(loadBias + 0x840n);
        expect(memory.readPointer(at(memory, loadBias + 0x700n))?.byteOffset).toBe(loadBias + 0x800n);
        indirectCalls++;
        return at(memory, loadBias + 0x850n);
      },
    });
    const read = (offset: bigint): bigint => width === 8 ? memory.readUint64(at(memory, loadBias + offset)) : BigInt(memory.readUint32(at(memory, loadBias + offset)));
    expect(read(0x900n)).toBe(7n);
    expect(read(0x910n)).toBe(width === 8 ? 11n : 4n);
    expect(BigInt.asIntN(width * 8, read(0x920n))).toBe(-57n);
    expect(memory.readInt32(at(memory, loadBias + 0x928n))).toBe(width === 8 ? -55 : 65);
    expect(read(0x930n)).toBe(loadBias + 0x850n);
    expect(indirectCalls).toBe(1);
    if (image.tls === null) throw new Error("TLS template missing");
    const template = new DataView(image.tls.initialized.buffer, image.tls.initialized.byteOffset, image.tls.initialized.byteLength);
    expect(width === 8 ? template.getBigUint64(0, true) : BigInt(template.getUint32(0, true))).toBe(loadBias + 0x800n);
    expect(image.tls.zeroFillBytes).toBe(16);
    expect(image.tls.alignment).toBe(16n);
    expect(image.tlsExports).toEqual([{ symbol: { kind: "name", name: "tls", version: null }, offset: 4n, byteLength: 4 }]);
    expect(image.exports.map(item => item.symbol)).toEqual([{ kind: "name", name: "entry", version: "ELF_TEST_1" }, { kind: "name", name: "entry", version: null }]);
    expect(image.initializers.map(address => address.byteOffset)).toEqual([0x800n, 0x800n, 0x810n].map(value => loadBias + value));
    expect(image.finalizers.map(address => address.byteOffset)).toEqual([0x830n, 0x820n, 0x810n].map(value => loadBias + value));
  });
}
