// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createContentDigest } from "../../../src/contracts/content.ts";
import type { GuestAddress, GuestCallContext, ModuleIdentity } from "../../../src/contracts/execution.ts";
import {
  addGuestPointer, createGuestProcessorState, GuestCallbackTable, GuestMemoryFault, IntegerRegisterFile,
  signedGuestPointer, SparseGuestMemory, wrapGuestPointer,
} from "../../../src/guest/core/index.ts";
import type { GuestHostCallback } from "../../../src/guest/core/index.ts";

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
