// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createContentDigest } from "../../../src/contracts/content.ts";
import type { GuestAddress, GuestCallContext, ModuleIdentity } from "../../../src/contracts/execution.ts";
import {
  addGuestPointer, createGuestProcessorState, GuestCallbackTable, GuestMemoryFault, IntegerRegisterFile,
  signedGuestPointer, SparseGuestMemory, wrapGuestPointer,
} from "../../../src/guest/core/index.ts";
import type { GuestHostCallback } from "../../../src/guest/core/index.ts";
import { ProcessorFlags } from "../../../src/guest/core/registers.ts";
import type { GuestFlag } from "../../../src/guest/core/contracts.ts";

test("processor flag masks preserve unrelated and reserved bits", () => {
  const positions: readonly (readonly [GuestFlag, number])[] = [["carry", 0], ["parity", 2], ["auxiliary-carry", 4],
    ["zero", 6], ["sign", 7], ["trap", 8], ["interrupt", 9], ["direction", 10], ["overflow", 11],
    ["resume", 16], ["virtual-8086", 17], ["alignment-check", 18], ["virtual-interrupt", 19],
    ["virtual-interrupt-pending", 20], ["identification", 21]];
  for (const initial of [0n, -1n, 0x123456789abcdef0n, 1n << 80n]) for (const [flag, bit] of positions) {
    const flags = new ProcessorFlags(initial), normalized = BigInt.asUintN(64, initial), mask = 1n << BigInt(bit);
    expect(flags.get(flag)).toBe((normalized & mask) !== 0n);
    flags.set(flag, true); expect(flags.value).toBe(normalized | mask); expect(flags.get(flag)).toBe(true);
    flags.set(flag, false); expect(flags.value).toBe(normalized & ~mask); expect(flags.get(flag)).toBe(false);
    flags.value = initial; expect(flags.value).toBe(normalized);
  }
});

const module: ModuleIdentity = {
  id: "test:guest", artifactPath: "authored-memory-fixture", revision: "1", digest: createContentDigest("12".repeat(32)),
};
function at(memory: SparseGuestMemory, raw: bigint): GuestAddress {
  const address = memory.pointer(raw);
  if (address === null) throw new Error("Test requires a nonnull address");
  return address;
}

test("sparse high 64-bit addresses preserve pointer bytes and overlapping live views", () => {
  const memory = new SparseGuestMemory({ module, pointerBytes: 8 });
  const initial = new Uint8Array([9, 8]);
  const base = memory.map({ base: 0xf123456789abc000n, byteLength: 64, permissions: "read-write", bytes: initial });
  initial[0] = 255;
  expect(memory.readUint8(base)).toBe(9);
  const whole = memory.borrow(base, 64);
  const alias = memory.borrow(memory.offset(base, 4n), 8);
  whole.setUint32(4, 0x3f800000, true);
  expect(alias.getFloat32(0, true)).toBe(1);
  alias.setUint16(2, 0x4000, true);
  expect(memory.readFloat32(memory.offset(base, 4n))).toBe(2);
  const destination = memory.offset(base, 24n);
  const target = memory.offset(base, 63n);
  memory.writePointer(destination, target);
  expect(memory.readPointer(destination)?.byteOffset).toBe(0xf123456789abc03fn);
  memory.writePointer(destination, null);
  expect(memory.readPointer(destination)).toBeNull();
  expect(memory.mappings().reduce((sum, entry) => sum + entry.byteLength, 0)).toBe(64);
});

test("checked accesses cross adjacent mappings and reject the entire write before a fault", () => {
  const memory = new SparseGuestMemory({ module, pointerBytes: 4 });
  const start = memory.map({ base: 0x1000n, byteLength: 3, permissions: "read-write" });
  const tail = memory.map({ base: 0x1003n, byteLength: 3, permissions: "read-write" });
  memory.writeUint32(memory.offset(start, 1n), 0x12345678);
  expect([...memory.copy(start, 6)]).toEqual([0, 0x78, 0x56, 0x34, 0x12, 0]);
  expect(memory.readUint32(memory.offset(start, 1n))).toBe(0x12345678);
  expect(() => memory.borrow(start, 6)).toThrow("contiguous backing");
  memory.protect(tail, 3, "read");
  expect(() => memory.write(start, new Uint8Array(6).fill(99))).toThrow(GuestMemoryFault);
  expect(memory.readUint8(start)).toBe(0);
  expect(() => memory.fetch(start, 1)).toThrow("permits read-write");
  memory.protect(start, 3, "execute");
  expect([...memory.fetch(start, 3)]).toEqual([0, 0x78, 0x56]);
  expect(() => memory.copy(start, 1)).toThrow("permits execute");
});

test("split protections and restored aliases retain the same private bytes", () => {
  const memory = new SparseGuestMemory({ module, pointerBytes: 4 });
  const original = memory.allocate({ byteLength: 64 });
  const alias = memory.mapAlias({ base: 0x20000n, byteLength: 16, permissions: "read-write", source: memory.offset(original, 8n) });
  memory.writeUint32(alias, 0xaabbccdd);
  expect(memory.readUint32(memory.offset(original, 8n))).toBe(0xaabbccdd);
  memory.protect(memory.offset(original, 16n), 16, "read");
  expect(() => memory.borrow(original, 64)).toThrow("permits read");
  memory.protect(memory.offset(original, 16n), 16, "read-write");
  expect(memory.borrow(original, 64).getUint32(8, true)).toBe(0xaabbccdd);
  const restored = SparseGuestMemory.restore(module, memory.checkpoint());
  expect(() => restored.copy(original, 4)).toThrow("another execution owner");
  restored.writeUint16(at(restored, alias.byteOffset + 2n), 0x1234);
  expect(restored.readUint32(at(restored, original.byteOffset + 8n))).toBe(0x1234ccdd);
  expect(memory.readUint32(alias)).toBe(0xaabbccdd);
  memory.unmap(original, 64);
  expect(memory.readUint32(alias)).toBe(0xaabbccdd);
  expect(() => memory.copy(original, 1)).toThrow("unmapped");
});

test("checked address creation and explicit machine wrapping remain distinct", () => {
  const memory = new SparseGuestMemory({ module, pointerBytes: 4 });
  expect(memory.pointer(0n)).toBeNull();
  expect(() => memory.pointer(0x100000000n)).toThrow("32-bit address space");
  const last = memory.map({ base: 0xffffffffn, byteLength: 1, permissions: "read-write" });
  memory.writeUint8(last, 7);
  expect(memory.readUint8(last)).toBe(7);
  expect(() => memory.offset(last, 1n)).toThrow("32-bit address space");
  expect(addGuestPointer(0xffffffffn, 1n, 4)).toBe(0n);
  expect(wrapGuestPointer(-1n, 8)).toBe(0xffffffffffffffffn);
  expect(signedGuestPointer(0xffffffffn, 4)).toBe(-1n);
  const block = memory.allocate({ byteLength: 32, alignment: 32n });
  memory.unmap(block, 32);
  expect(memory.allocate({ byteLength: 32, alignment: 32n }).byteOffset).toBe(block.byteOffset);
});

test("callback addresses survive nested synchronous calls, revocation and restoration", () => {
  const memory = new SparseGuestMemory({ module, pointerBytes: 4 });
  const table = new GuestCallbackTable(memory);
  const state = memory.allocate({ byteLength: 4 });
  const nested: GuestHostCallback = {
    id: "test:nested", signature: { abi: { kind: "windows-i386", image: "pe32", pointerBytes: 4, call: "cdecl" }, parameters: [], result: "void", variadic: false },
    invoke() { memory.writeUint32(state, memory.readUint32(state) + 7); return { kind: "void" }; },
  };
  const nestedAddress = table.bind(nested);
  const context: GuestCallContext = {
    module, callback: { kind: "native-guest", module, address: nestedAddress, abi: nested.signature.abi }, parent: null, self: null, other: null,
  };
  const outer: GuestHostCallback = {
    id: "test:outer", signature: nested.signature,
    invoke(parent) {
      memory.writeUint32(state, 10);
      table.invoke(nestedAddress, { ...context, parent }, []);
      expect(memory.readUint32(state)).toBe(17);
      return { kind: "void" };
    },
  };
  table.invoke(table.bind(outer), context, []);
  table.unbind(nested.id);
  expect(() => table.invoke(nestedAddress, context, [])).toThrow("is unbound");
  expect(table.bind(nested).byteOffset).toBe(nestedAddress.byteOffset);
  table.unbind(outer.id);
  const restoredMemory = SparseGuestMemory.restore(module, memory.checkpoint());
  const restoredNested: GuestHostCallback = { ...nested, invoke() { return { kind: "void" }; } };
  const restoredTable = GuestCallbackTable.restore(restoredMemory, table.checkpoint(), id => id === nested.id ? restoredNested : outer);
  expect(restoredTable.resolve(at(restoredMemory, nestedAddress.byteOffset))).toBe(restoredNested);
  const outerAddress = restoredTable.address(outer.id);
  if (outerAddress === null) throw new Error("Restored outer callback lost its address");
  expect(() => restoredTable.resolve(outerAddress)).toThrow("is unbound");
});

test("integer register aliases preserve high bits and 32-bit writes clear the x64 upper half", () => {
  const registers = new IntegerRegisterFile("x86-64");
  registers.write("rax", 64, 0x123456789abcdef0n);
  registers.write("rax", 8, 0x11n, true);
  expect(registers.read("rax", 64)).toBe(0x123456789abc11f0n);
  registers.write("rax", 32, 0xfedcba98n);
  expect(registers.read("rax", 64)).toBe(0xfedcba98n);
  registers.write("r15", 64, -1n);
  expect(registers.read("r15", 64)).toBe(0xffffffffffffffffn);
  const restored = new IntegerRegisterFile("x86-64");
  restored.restore(registers.checkpoint());
  expect(restored.read("r15", 64)).toBe(0xffffffffffffffffn);
  expect(() => new IntegerRegisterFile("i386").read("r8", 32)).toThrow("i386");
  expect(() => registers.read("rsp", 8, true)).toThrow("high-byte");
  const cpu = createGuestProcessorState({ architecture: "x86-64", instructionPointer: 0xf123456789abcdefn,
    stackPointer: 0x20000n, flags: 2n, x87ControlWord: 0x37f, mxcsr: 0x1f80, mxcsrMask: 0xffff });
  cpu.flags.set("carry", true);
  expect(cpu.flags.value).toBe(3n);
  expect(cpu.x87.registers.byteLength).toBe(80);
  expect(cpu.simd.xmm.byteLength).toBe(256);
  expect(cpu.registers.read("rsp", 64)).toBe(0x20000n);
});

test("register checkpoint scratch is caller-owned and ordinary snapshots stay independent", () => {
  for (const architecture of ["i386", "x86-64"] satisfies readonly ("i386" | "x86-64")[]) {
    const registers = new IntegerRegisterFile(architecture), destination = new Uint8Array(architecture === "i386" ? 64 : 128);
    registers.write("rax", 32, 7n); const retained = registers.checkpoint();
    expect(registers.checkpoint(destination)).toBe(destination); expect([...destination]).toEqual([...retained]);
    registers.write("rax", 32, 19n); registers.checkpoint(destination);
    expect([...destination]).not.toEqual([...retained]); registers.restore(retained); expect(registers.read("rax", 32)).toBe(7n);
    expect(() => registers.checkpoint(new Uint8Array(1))).toThrow("architecture or length");
    expect(registers.read("rax", 32)).toBe(7n);
  }
});

test("range write observers follow aliases and stop after removal or backing replacement", () => {
  const memory = new SparseGuestMemory({ module, pointerBytes: 8 });
  const base = memory.allocate({ byteLength: 16 }), alias = memory.mapAlias({ source: base, base: 0x200000n, byteLength: 16, permissions: "read-write" });
  const values: number[] = [];
  const remove = memory.observeWrites(base, 4, () => { values.push(memory.readInt32(base)); });
  memory.writeInt32(memory.offset(base, 4n), 9);
  memory.writeInt32(alias, 3);
  expect(values).toEqual([3]);
  let nested = false;
  const removeNested = memory.observeWrites(base, 4, () => { if (!nested) { nested = true; memory.writeInt32(alias, 5); } });
  memory.writeUint8(base, 4);
  expect(values).toEqual([3, 4, 5]);
  removeNested();
  const removeThrow = memory.observeWrites(base, 4, () => { throw new Error("observer failure"); });
  let deliveredAfterThrow = false;
  const removeAfterThrow = memory.observeWrites(base, 4, () => { deliveredAfterThrow = true; });
  try { expect(() => memory.writeInt32(alias, 6)).toThrow("observer failure"); }
  finally { removeThrow(); removeAfterThrow(); }
  expect(deliveredAfterThrow).toBe(true);
  expect(memory.readInt32(base)).toBe(6);
  memory.unmap(base, 16); memory.map({ base: base.byteOffset, byteLength: 16, permissions: "read-write" });
  memory.writeInt32(base, 7);
  expect(values).toEqual([3, 4, 5, 6]);
  remove(); remove(); memory.writeInt32(alias, 8);
  expect(values).toEqual([3, 4, 5, 6]);
  let lateCalls = 0;
  let removeLate = (): void => {};
  const removeFirst = memory.observeWrites(base, 4, () => { removeLate(); });
  removeLate = memory.observeWrites(base, 4, () => { lateCalls++; });
  memory.writeInt32(base, 9); removeFirst();
  expect(lateCalls).toBe(0);
});

test("mapping locality preserves live code, protection splits, holes and remapped backing", () => {
  const memory = new SparseGuestMemory({ module, pointerBytes: 8 });
  const base = memory.map({ base: 0x10000n, byteLength: 32, permissions: "read-write-execute" });
  memory.writeUint8(base, 0x90);
  expect(memory.fetch(base, 1)[0]).toBe(0x90);
  const copied = memory.fetch(base, 1); copied[0] = 0xcc;
  expect(memory.fetch(base, 1)[0]).toBe(0x90);
  memory.writeUint8(base, 0xc3);
  expect(memory.fetch(base, 1)[0]).toBe(0xc3);
  memory.protect(base, 16, "read");
  expect(() => memory.fetch(base, 1)).toThrow(GuestMemoryFault);
  expect(memory.readUint8(base)).toBe(0xc3);
  expect(() => memory.writeUint8(base, 0)).toThrow(GuestMemoryFault);
  const middle = memory.offset(base, 16n);
  memory.writeUint8(middle, 7); expect(memory.readUint8(middle)).toBe(7);
  memory.unmap(middle, 16);
  expect(() => memory.readUint8(middle)).toThrow(GuestMemoryFault);
  expect(() => memory.copy(memory.offset(base, 15n), 2)).toThrow(GuestMemoryFault);
  memory.map({ base: middle.byteOffset, byteLength: 16, permissions: "read-write-execute", bytes: new Uint8Array([9]) });
  expect(memory.fetch(middle, 1)[0]).toBe(9);
  expect(memory.copy(memory.offset(base, 15n), 2)).toEqual(new Uint8Array([0, 9]));
  const foreign = new SparseGuestMemory({ module, pointerBytes: 8 });
  expect(() => memory.fetch(at(foreign, middle.byteOffset), 1)).toThrow(GuestMemoryFault);
});

test("first-fit hints revisit coalesced holes and preserve alignment after range edits", () => {
  const memory = new SparseGuestMemory({ module, pointerBytes: 8 });
  const first = memory.allocate({ byteLength: 8, alignment: 8n });
  const second = memory.allocate({ byteLength: 8, alignment: 8n });
  const third = memory.allocate({ byteLength: 16, alignment: 8n });
  memory.unmap(first, 8);
  const tail = memory.allocate({ byteLength: 16, alignment: 8n });
  expect(tail.byteOffset).toBe(third.byteOffset + 16n);
  memory.unmap(second, 8);
  const merged = memory.allocate({ byteLength: 16, alignment: 8n });
  expect(merged.byteOffset).toBe(first.byteOffset);
  memory.protect(merged, 8, "read");
  memory.unmap(memory.offset(merged, 8n), 8);
  expect(memory.allocate({ byteLength: 8, alignment: 8n }).byteOffset).toBe(first.byteOffset + 8n);
  expect(memory.allocate({ byteLength: 8, alignment: 16n }).byteOffset % 16n).toBe(0n);
  expect(() => memory.map({ base: third.byteOffset + 4n, byteLength: 1, permissions: "read" })).toThrow(GuestMemoryFault);
});

test("scalar instruction fetch observes live aliases, permission changes and remapped bytes", () => {
  const memory = new SparseGuestMemory({ module, pointerBytes: 8 });
  const code = memory.map({ base: 0x10000n, byteLength: 2, permissions: "read-write-execute", bytes: new Uint8Array([0x90, 0xc3]) });
  const alias = memory.mapAlias({ base: 0x20000n, byteLength: 2, permissions: "read-write", source: code });
  expect(memory.fetchByte(code.byteOffset)).toBe(0x90);
  memory.writeUint8(alias, 0xcc);
  expect(memory.fetchByte(code.byteOffset)).toBe(0xcc);
  expect(() => memory.fetchByte(alias.byteOffset)).toThrow(GuestMemoryFault);
  memory.protect(code, 1, "read");
  expect(() => memory.fetchByte(code.byteOffset)).toThrow(GuestMemoryFault);
  expect(memory.fetchByte(code.byteOffset + 1n)).toBe(0xc3);
  memory.unmap(code, 2);
  expect(() => memory.fetchByte(code.byteOffset)).toThrow(GuestMemoryFault);
  memory.map({ base: code.byteOffset, byteLength: 1, permissions: "execute", bytes: new Uint8Array([0xf4]) });
  expect(memory.fetchByte(code.byteOffset)).toBe(0xf4);
  expect(() => memory.fetchByte(code.byteOffset + 1n)).toThrow(GuestMemoryFault);
  expect(() => memory.fetchByte(0n)).toThrow(GuestMemoryFault);
  expect(() => memory.fetchByte(1n << 64n)).toThrow(GuestMemoryFault);
});


test("scalar stores preserve encoding and cross-mapping fault atomicity", () => {
  const memory = new SparseGuestMemory({ module, pointerBytes: 8 });
  const base = memory.map({ base: 0x10000n, byteLength: 4, permissions: "read-write" });
  const second = memory.map({ base: 0x10004n, byteLength: 12, permissions: "read-write" });
  const cases: readonly { width: number; store: () => void; encode: (view: DataView) => void }[] = [
    { width: 1, store: () => memory.writeUint8(base, 257), encode: v => v.setUint8(0, 257) },
    { width: 2, store: () => memory.writeInt16(base, -32769), encode: v => v.setInt16(0, -32769, true) },
    { width: 4, store: () => memory.writeUint32(base, -1), encode: v => v.setUint32(0, -1, true) },
    { width: 8, store: () => memory.writeUint64(base, -1n), encode: v => v.setBigUint64(0, -1n, true) },
    { width: 4, store: () => memory.writeFloat32(base, -0), encode: v => v.setFloat32(0, -0, true) },
    { width: 8, store: () => memory.writeFloat64(base, NaN), encode: v => v.setFloat64(0, NaN, true) },
    { width: 8, store: () => memory.writeFloat64(base, Infinity), encode: v => v.setFloat64(0, Infinity, true) },
  ];
  for (const value of cases) {
    const expected = new Uint8Array(value.width); value.encode(new DataView(expected.buffer)); value.store();
    expect([...memory.copy(base, value.width)]).toEqual([...expected]);
  }
  const before = memory.copy(base, 16); let notifications = 0;
  const remove = memory.observeWrites(base, 16, () => { notifications++; });
  memory.protect(second, 12, "read");
  expect(() => memory.writeUint64(base, 42n)).toThrow(GuestMemoryFault);
  expect([...memory.copy(base, 16)]).toEqual([...before]); expect(notifications).toBe(0);
  remove();
});


test("execute sequence reads live aliases and revalidates mapping changes without speculative faults", () => {
  const memory = new SparseGuestMemory({ module, pointerBytes: 8 });
  const base = memory.map({ base: 0x1000n, byteLength: 3, permissions: "read-execute", bytes: new Uint8Array([1, 2, 3]) });
  const alias = memory.mapAlias({ base: 0x2000n, byteLength: 3, permissions: "read-write", source: base });
  const next = memory.fetchSequence(base.byteOffset);
  expect(next()).toBe(1);
  memory.writeUint8(memory.offset(alias, 1n), 9);
  expect(next()).toBe(9);
  memory.protect(base, 3, "read");
  expect(() => next()).toThrow("permits read");
  memory.protect(base, 3, "execute");
  expect(next()).toBe(3);
  expect(() => next()).toThrow("unmapped");
  memory.map({ base: 0x1003n, byteLength: 2, permissions: "execute", bytes: new Uint8Array([4, 5]) });
  expect(next()).toBe(4);
  memory.unmap(at(memory, 0x1004n), 1);
  expect(() => next()).toThrow("unmapped");
  memory.map({ base: 0x1004n, byteLength: 1, permissions: "execute", bytes: new Uint8Array([7]) });
  expect(next()).toBe(7);
  const missing = memory.fetchSequence(0n);
  expect(() => missing()).toThrow("null");
});
