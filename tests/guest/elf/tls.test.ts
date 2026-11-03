// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createContentDigest } from "../../../src/contracts/content.ts";
import type { GuestAddress, ModuleIdentity } from "../../../src/contracts/execution.ts";
import { SparseGuestMemory } from "../../../src/guest/core/index.ts";
import type { GuestImportResolver } from "../../../src/guest/core/index.ts";
import { loadElf } from "../../../src/guest/elf/index.ts";
import { elfTlsFixture as fixture } from "../../support/elf-fixtures.ts";

const module: ModuleIdentity = { id: "test:elf-tls", artifactPath: "authored-elf-tls", revision: "1", digest: createContentDigest("32".repeat(32)) };
const resolver: GuestImportResolver = {
  resolve(import_) {
    return { kind: "unresolved", import: import_, detail: "authored image has no external imports" };
  },
};

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
    const tls = {
      current: { moduleId: 7n, threadPointerOffset: -64n },
      resolve() {
        return null;
      },
    };
    expect(() => loadElf({ ...options, tls })).toThrow("requires explicit guest resolver execution");
    expect(memory.mappings()).toHaveLength(0);
    const unsupported = bytes.slice();
    const unsupportedView = new DataView(unsupported.buffer);
    if (width === 8) unsupportedView.setBigUint64(0x508, 0xffffffffn, true);
    else unsupportedView.setUint32(0x504, 0xff, true);
    expect(() => loadElf({ ...options, bytes: unsupported, tls })).toThrow("unsupported");
    expect(memory.mappings()).toHaveLength(0);
    let indirectCalls = 0;
    const image = loadElf({
      ...options,
      tls,
      resolveIndirect(address) {
        expect(address.byteOffset).toBe(loadBias + 0x840n);
        expect(memory.readPointer(at(memory, loadBias + 0x700n))?.byteOffset).toBe(loadBias + 0x800n);
        indirectCalls++;
        return at(memory, loadBias + 0x850n);
      },
    });
    const read = (offset: bigint): bigint =>
      width === 8 ? memory.readUint64(at(memory, loadBias + offset)) : BigInt(memory.readUint32(at(memory, loadBias + offset)));
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
    expect(image.exports.map(item => item.symbol)).toEqual([
      { kind: "name", name: "entry", version: "ELF_TEST_1" },
      { kind: "name", name: "entry", version: null },
    ]);
    expect(image.initializers.map(address => address.byteOffset)).toEqual([0x800n, 0x800n, 0x810n].map(value => loadBias + value));
    expect(image.finalizers.map(address => address.byteOffset)).toEqual([0x830n, 0x820n, 0x810n].map(value => loadBias + value));
  });
}
