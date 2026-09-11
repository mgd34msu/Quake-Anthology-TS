// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createContentDigest } from "../../../src/contracts/content.ts";
import type { ModuleIdentity } from "../../../src/contracts/execution.ts";
import { SparseGuestMemory } from "../../../src/guest/core/index.ts";
import { bindPeImports, mapPeImage, parsePe, PeError, resolvePeExport } from "../../../src/guest/pe/index.ts";
import { peFixture } from "./fixture.ts";

const module: ModuleIdentity = { id: "test:pe", artifactPath: "authored-pe", revision: "1", digest: createContentDigest("31".repeat(32)) };

for (const width of [4, 8]) {
  if (width !== 4 && width !== 8) throw new Error("Invalid test width");
  test(`PE${width * 8} sections, relocations, TLS and entry point use one guest address space`, () => {
    const bytes = peFixture(width);
    const snapshot = bytes.slice();
    const memory = new SparseGuestMemory({ module, pointerBytes: width });
    const base = width === 4 ? 0x10120000n : 0x1a0000000n;
    const image = mapPeImage({ bytes, memory, base });
    expect(image.abi.image).toBe(width === 4 ? "pe32" : "pe32+");
    expect(image.entryPoint?.byteOffset).toBe(base + 0x1000n);
    expect(image.initializers).toEqual([]);
    expect(image.finalizers).toEqual([]);
    expect(memory.readPointer(memory.offset(image.base, 0x3010n))?.byteOffset).toBe(base + 0x1050n);
    expect(memory.copy(memory.offset(image.base, 0x3200n), 0x200).every(value => value === 0)).toBe(true);
    expect(memory.fetch(memory.offset(image.base, 0x1010n), 1)).toEqual(new Uint8Array([0xc3]));
    expect(() => memory.write(memory.offset(image.base, 0x1010n), new Uint8Array([0x90]))).toThrow();
    expect(() => memory.fetch(memory.offset(image.base, 0x3000n), 1)).toThrow();
    expect(memory.copy(memory.offset(image.base, 0x400n), 4)).toEqual(new Uint8Array(4));
    expect(image.tls?.initialized).toEqual(new Uint8Array([9, 8, 7, 6]));
    expect(image.tls?.zeroFillBytes).toBe(12);
    expect(image.tls?.alignment).toBe(4n);
    expect(image.tls?.callbacks.map(address => address.byteOffset)).toEqual([base + 0x1020n, base + 0x1030n]);
    expect(image.tlsIndexAddress?.byteOffset).toBe(base + 0x3020n);
    expect(image.loadConfiguration?.securityCookieAddress?.byteOffset).toBe(base + 0x3040n);
    expect(image.loadConfiguration?.guardCheckSlot?.byteOffset).toBe(base + 0x3060n);
    expect(image.loadConfiguration?.guardDispatchSlot?.byteOffset).toBe(base + 0x3070n);
    expect(image.loadConfiguration?.guardFlags).toBe(0x100);
    expect(image.unwind.length).toBe(width === 8 ? 1 : 0);
    if (width === 4) {
      expect(memory.readUint16(memory.offset(image.base, 0x3018n))).toBe(0x1134);
      expect(memory.readUint16(memory.offset(image.base, 0x301an))).toBe(0x3344);
      expect(memory.readUint16(memory.offset(image.base, 0x301cn))).toBe(0x2012);
    } else {
      expect(image.unwind[0]?.metadata).toEqual(new Uint8Array([1, 4, 1, 0, 4, 0x32, 0, 0]));
      expect(image.unwind[0]?.start.byteOffset).toBe(base + 0x1000n);
      expect(image.unwind[0]?.end.byteOffset).toBe(base + 0x1040n);
    }
    expect(bytes).toEqual(snapshot);
  });

  test(`PE${width * 8} named/ordinal imports bind atomically and preserve read-only IAT protection`, () => {
    const memory = new SparseGuestMemory({ module, pointerBytes: width });
    const image = mapPeImage({ bytes: peFixture(width), memory });
    const target = memory.map({ base: 0x50000000n, byteLength: 16, permissions: "read-execute", bytes: new Uint8Array([0xc3]) });
    expect(image.imports.map(entry => entry.symbol)).toEqual([{ kind: "name", name: "Target", version: null }, { kind: "ordinal", ordinal: 7 }]);
    const iat = memory.offset(image.base, 0x2160n);
    const original = memory.copy(iat, width * 2);
    const mappings = memory.mappings();
    expect(() => bindPeImports(image, memory, { resolve(import_) {
      return import_.symbol.kind === "name" ? { kind: "guest", address: target, module }
        : { kind: "unresolved", import: import_, detail: "ordinal unavailable" };
    } })).toThrow("ordinal unavailable");
    expect(memory.copy(iat, width * 2)).toEqual(original);
    expect(memory.mappings()).toEqual(mappings);
    expect(bindPeImports(image, memory, { resolve() { return { kind: "guest", address: target, module }; } }).length).toBe(2);
    expect(memory.readPointer(iat)?.byteOffset).toBe(target.byteOffset);
    expect(memory.readPointer(memory.offset(iat, BigInt(width)))?.byteOffset).toBe(target.byteOffset);
    expect(memory.mappings()).toEqual(mappings);
    expect(() => memory.write(iat, new Uint8Array(width))).toThrow();
  });
}

test("named exports and ordinal forwarders resolve within the guest graph and reject cycles", () => {
  const memory = new SparseGuestMemory({ module, pointerBytes: 4 });
  const image = mapPeImage({ bytes: peFixture(4), memory });
  const other = mapPeImage({ bytes: peFixture(4), memory, base: 0x20000000n });
  const requested = { kind: "name", name: "Forward", version: null } satisfies Parameters<typeof resolvePeExport>[1];
  expect(resolvePeExport(image, requested, library => library === "other" ? other : null).address.byteOffset).toBe(0x20001010n);
  expect(resolvePeExport(image, { kind: "name", name: "GetGameAPI", version: null }, () => null).address.byteOffset).toBe(0x10001010n);
  expect(() => resolvePeExport(image, requested, () => null)).toThrow("unresolved forwarded library");
  const cyclic = peFixture(4);
  cyclic.set(new TextEncoder().encode("other.Forward\0"), 0x680);
  const cycle = mapPeImage({ bytes: cyclic, memory, base: 0x30000000n });
  expect(() => resolvePeExport(cycle, requested, () => cycle)).toThrow("cyclic export forwarder");
  const foreign = mapPeImage({ bytes: peFixture(4), memory: new SparseGuestMemory({ module, pointerBytes: 4 }) });
  expect(() => resolvePeExport(image, requested, () => foreign)).toThrow("another guest address space");
});

test("x64 unwind chains and language handler locations remain available to the guest runtime", () => {
  const bytes = peFixture(8);
  const view = new DataView(bytes.buffer);
  bytes.set([0x21, 0, 0, 0], 0x9a0);
  view.setUint32(0x9a4, 0x1000, true); view.setUint32(0x9a8, 0x1040, true); view.setUint32(0x9ac, 0x23b0, true);
  bytes.set([9, 0, 0, 0], 0x9b0); view.setUint32(0x9b4, 0x1050, true); view.setUint32(0x9b8, 0x12345678, true);
  const memory = new SparseGuestMemory({ module, pointerBytes: 8 });
  const image = mapPeImage({ bytes, memory });
  expect(image.unwindRecords[0]?.chained?.handlerRva).toBe(0x1050);
  expect(image.unwindRecords[0]?.chained?.handlerDataRva).toBe(0x23b8);
  expect(memory.readUint32(memory.offset(image.base, 0x23b8n))).toBe(0x12345678);
  view.setUint32(0x9ac, 0x23a0, true);
  expect(() => mapPeImage({ bytes, memory: new SparseGuestMemory({ module, pointerBytes: 8 }) })).toThrow("cyclic unwind chain");
});

test("truncated, overlapping and unsupported input fails before mapping guest memory", () => {
  const cases: { readonly label: string; readonly mutate: (bytes: Uint8Array) => Uint8Array }[] = [
    { label: "truncated", mutate: bytes => bytes.subarray(0, 96) },
    { label: "section overlap", mutate(bytes) { new DataView(bytes.buffer).setUint32(0x1ac, 0x1000, true); return bytes; } },
    { label: "unsupported relocation", mutate(bytes) { new DataView(bytes.buffer).setUint16(0x1008, 0x7200, true); return bytes; } },
    { label: "missing relocation", mutate(bytes) { const view = new DataView(bytes.buffer); view.setUint32(0x120, 0, true); view.setUint32(0x124, 0, true); return bytes; } },
    { label: "delay imports", mutate(bytes) { const view = new DataView(bytes.buffer); view.setUint32(0x160, 0x2100, true); view.setUint32(0x164, 40, true); return bytes; } },
    { label: "bad TLS callback", mutate(bytes) { new DataView(bytes.buffer).setUint32(0x840, 0x10003000, true); return bytes; } },
    { label: "unterminated import descriptors", mutate(bytes) { new DataView(bytes.buffer).setUint32(0x104, 20, true); return bytes; } },
  ];
  for (const entry of cases) {
    const memory = new SparseGuestMemory({ module, pointerBytes: 4 });
    const sentinel = memory.map({ base: 0x10000n, byteLength: 8, permissions: "read", bytes: new Uint8Array([17]) });
    const prior = memory.mappings();
    expect(() => mapPeImage({ bytes: entry.mutate(peFixture(4)), memory, base: 0x20000000n }), entry.label).toThrow(PeError);
    expect(memory.mappings()).toEqual(prior);
    expect(memory.copy(sentinel, 1)).toEqual(new Uint8Array([17]));
  }
  expect(() => parsePe(peFixture(8).subarray(0, 0x1100))).toThrow(PeError);
  expect(() => mapPeImage({ bytes: peFixture(8), memory: new SparseGuestMemory({ module, pointerBytes: 4 }) })).toThrow("pointer width");
});
