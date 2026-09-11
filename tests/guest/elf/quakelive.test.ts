// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openArchive } from "../../../src/content/archive/index.ts";
import { createContentDigest } from "../../../src/contracts/content.ts";
import type { GuestAddress, ModuleIdentity } from "../../../src/contracts/execution.ts";
import { SparseGuestMemory } from "../../../src/guest/core/index.ts";
import type { GuestImportResolver } from "../../../src/guest/core/index.ts";
import { inspectElf, loadElf } from "../../../src/guest/elf/index.ts";

const archivePath = resolve(import.meta.dir, "../../../../qfiles/quakelive/baseq3/bin.pk3");
// Independent readelf -h -l -d -r --dyn-syms -wf observations of these exact archive members.
// Quake Live is external compatibility evidence, separate from official Quake III products.
const witnesses = [
  { name: "qagamei386.so", digest: "7b85cefcdd850092f1499185f745b2e4bad0dc12647ce51f60bbf0bc6f730b68", bias: 0x10000000n,
    symbols: 419, relocations: 2888, frames: 1501, initSlot: 0xcd058n, importSlot: 0xcf0f4n, dllEntry: 0x7e950n,
    initializers: [0xbd20n, 0xd220n, 0xcfb0n, 0xcff0n, 0xd060n, 0xd0a0n, 0xd0e0n], finalizers: [0xd1d0n, 0xa89f8n] },
  { name: "qagamex64.so", digest: "091d568f46a280afbf2deda4a5ba4c8bd5e02ed6d070ef56300b1f47c5f729be", bias: 0x100000000n,
    symbols: 423, relocations: 2890, frames: 1500, initSlot: 0x2cb7d8n, importSlot: 0x2cf1e0n, dllEntry: 0x7f180n,
    initializers: [0x18110n, 0x19560n, 0x19350n, 0x19380n, 0x193e0n, 0x19410n, 0x19440n], finalizers: [0x19520n, 0xa6478n] },
];

function at(memory: SparseGuestMemory, value: bigint): GuestAddress {
  const address = memory.pointer(value);
  if (address === null) throw new Error("Fixture address must be nonnull");
  return address;
}

for (const witness of witnesses) test.skipIf(!existsSync(archivePath))(`supplied Quake Live ${witness.name} maps and relocates in guest memory`, async () => {
  const archive = await openArchive(archivePath);
  try {
    const entry = archive.findEntries(witness.name)[0];
    if (entry === undefined) throw new Error(`Archive lacks ${witness.name}`);
    const bytes = await archive.readEntry(entry);
    const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    expect(hash).toBe(witness.digest);
    const module: ModuleIdentity = { id: "compat:quakelive-qagame", artifactPath: `${archivePath}!${witness.name}`, revision: "supplied-quake-live", digest: createContentDigest(hash) };
    const elf = inspectElf(bytes);
    expect(elf.symbols).toHaveLength(witness.symbols);
    expect(elf.relocations).toHaveLength(witness.relocations);
    expect(elf.neededLibraries).toEqual(["libstdc++.so.6", "libm.so.6", "libgcc_s.so.1", "libc.so.6"]);
    const memory = new SparseGuestMemory({ module, pointerBytes: elf.abi.pointerBytes });
    // These guest addresses only witness relocation. No libc implementation or guest code executes.
    const provider = memory.map({ base: 0x70000000n, byteLength: 4096, permissions: "read-write-execute" });
    const definedNames = new Set(elf.symbols.filter(symbol => symbol.section !== 0).map(symbol => symbol.name));
    const resolver: GuestImportResolver = {
      resolve(import_) {
        if (import_.weak || import_.symbol.kind === "name" && definedNames.has(import_.symbol.name)) {
          return { kind: "unresolved", import: import_, detail: "fixture preserves weak-null and image-local definitions" };
        }
        return { kind: "guest", address: provider, module };
      },
    };
    const uniqueSymbols = new Map<string, GuestAddress>();
    expect(() => loadElf({ bytes, module, memory, loadBias: witness.bias, resolver, uniqueSymbols, dependencies: new Set() })).toThrow("has no guest/runtime provider");
    const image = loadElf({ bytes, module, memory, loadBias: witness.bias, resolver, uniqueSymbols, dependencies: new Set(elf.neededLibraries) });
    expect(uniqueSymbols.get("_ZNSs4_Rep20_S_empty_rep_storageE")).toBe(provider);
    expect(image.module).toBe(module);
    expect(image.imports).toHaveLength(105);
    const optionalProfiling = image.imports.filter(import_ => import_.symbol.kind === "name" && import_.symbol.name === "__gmon_start__");
    expect(optionalProfiling.length).toBeGreaterThan(0);
    for (const import_ of optionalProfiling) {
      expect(import_.weak).toBe(true);
      expect(memory.readPointer(import_.slot)).toBeNull();
    }
    expect(image.imports.some(import_ => import_.library === "libc.so.6" && import_.symbol.kind === "name"
      && import_.symbol.name === "__memcpy_chk" && import_.symbol.version === "GLIBC_2.3.4"
      && import_.slot.byteOffset === witness.bias + witness.importSlot)).toBe(true);
    expect(memory.readPointer(at(memory, witness.bias + witness.importSlot))?.byteOffset).toBe(provider.byteOffset);
    expect(memory.readPointer(at(memory, witness.bias + witness.initSlot))?.byteOffset).toBe(witness.bias + (witness.initializers[1] ?? 0n));
    const exported = image.exports.find(item => item.symbol.kind === "name" && item.symbol.name === "dllEntry");
    expect(exported?.target.kind === "address" ? exported.target.address.byteOffset : null).toBe(witness.bias + witness.dllEntry);
    expect(image.initializers.map(address => address.byteOffset)).toEqual(witness.initializers.map(value => witness.bias + value));
    expect(image.finalizers.map(address => address.byteOffset)).toEqual(witness.finalizers.map(value => witness.bias + value));
    expect(image.unwind).toHaveLength(witness.frames);
    expect(image.unwind.every(region => region.start.byteOffset < region.end.byteOffset && region.metadata.length > 0)).toBe(true);
    expect(image.tls).toBeNull();
    expect(image.executableStack).toBe(false);
    expect(() => memory.writeUint8(at(memory, witness.bias + witness.initSlot), 1)).toThrow("permits read");
    const data = elf.segments.find(segment => segment.type === 1 && segment.memorySize > segment.fileSize);
    if (data === undefined) throw new Error("Fixture lacks BSS");
    const tail = at(memory, witness.bias + data.address + BigInt(data.memorySize) - 32n);
    expect([...memory.copy(tail, 32)]).toEqual(new Array<number>(32).fill(0));
    expect(() => memory.fetch(tail, 1)).toThrow("permits read-write");
    expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(hash);
  } finally { archive.close(); }
});
