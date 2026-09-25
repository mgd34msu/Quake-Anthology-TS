// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createContentDigest } from "../../../src/contracts/content.ts";
import type { GuestCallValue, GuestLayout, GuestValueLayout, ModuleIdentity, NativeCallAbi } from "../../../src/contracts/execution.ts";
import { createGuestProcessorState, SparseGuestMemory } from "../../../src/guest/core/index.ts";
import type { GuestCallSignature, GuestCpu } from "../../../src/guest/core/contracts.ts";
import { classifySystemVAggregate, guestPointer, planGuestCall, X86AbiAdapter } from "../../../src/guest/abi/index.ts";

const module: ModuleIdentity = { id: "test:abi", artifactPath: "authored-abi-fixtures", revision: "1", digest: createContentDigest("ab".repeat(32)) };
const windows32: NativeCallAbi = { kind: "windows-i386", image: "pe32", pointerBytes: 4, call: "cdecl" };
const windows64: NativeCallAbi = { kind: "windows-x86-64", image: "pe32+", pointerBytes: 8, call: "microsoft-x64" };
const linux32: NativeCallAbi = { kind: "linux-i386", image: "elf32", pointerBytes: 4, call: "system-v-i386" };
const linux64: NativeCallAbi = { kind: "linux-x86-64", image: "elf64", pointerBytes: 8, call: "system-v-x86-64" };
const i32: GuestValueLayout = { kind: "scalar", storage: "int32" }, f32: GuestValueLayout = { kind: "scalar", storage: "float32" }, f64: GuestValueLayout = { kind: "scalar", storage: "float64" }, pointer: GuestValueLayout = { kind: "scalar", storage: "pointer" };
function fixture(abi: NativeCallAbi): { cpu: GuestCpu; memory: SparseGuestMemory; adapter: X86AbiAdapter } {
  const memory = new SparseGuestMemory({ module, pointerBytes: abi.pointerBytes });
  memory.map({ base: 0x1000n, byteLength: 4096, permissions: "read-execute", bytes: new Uint8Array([0xc3]) });
  memory.map({ base: 0x10000n, byteLength: 65536, permissions: "read-write" });
  const state = createGuestProcessorState({ architecture: abi.pointerBytes === 4 ? "i386" : "x86-64", instructionPointer: 0x1000n, stackPointer: 0x20000n, flags: 2n, x87ControlWord: 0x37f, mxcsr: 0x1f80, mxcsrMask: 0xffff });
  // These tests inspect calling-convention state directly, without claiming instruction execution.
  const cpu: GuestCpu = { memory, state, run: () => { throw new Error("ABI layout fixture must not execute instructions"); } };
  return { cpu, memory, adapter: new X86AbiAdapter(abi) };
}
function signature(abi: NativeCallAbi, parameters: readonly GuestValueLayout[], result: GuestValueLayout | "void" = i32, variadic = false): GuestCallSignature { return { abi, parameters, result, variadic }; }
function enter(cpu: GuestCpu, adapter: X86AbiAdapter, call: GuestCallSignature, arguments_: readonly GuestCallValue[]): bigint {
  adapter.enter(cpu, guestPointer(cpu.memory, 0x1000n), call, arguments_, guestPointer(cpu.memory, 0x1001n));
  return cpu.state.registers.read("rsp", cpu.memory.pointerBytes === 4 ? 32 : 64);
}
function record(pointerBytes: 4 | 8, byteLength: number, fields: GuestLayout["fields"], alignment: number = pointerBytes): GuestValueLayout {
  return { kind: "aggregate", layout: { id: `test:record-${pointerBytes}-${byteLength}`, byteLength, alignment, pointerBytes, byteOrder: "little-endian", fields } };
}

test("Microsoft x64 documented mixed arguments use positional XMM and integer registers plus 32-byte shadow space", () => {
  const { cpu, memory, adapter } = fixture(windows64);
  const call = signature(windows64, [i32, f64, i32, f32, i32, f32]);
  const values: GuestCallValue[] = [{ kind: "int32", value: 11 }, { kind: "float64", value: 2.5 }, { kind: "int32", value: 33 }, { kind: "float32", value: 4.5 }, { kind: "int32", value: 55 }, { kind: "float32", value: 6.5 }];
  const sp = enter(cpu, adapter, call, values), xmm = new DataView(cpu.state.simd.xmm.buffer);
  expect((sp + 8n) % 16n).toBe(0n);
  expect(cpu.state.registers.read("rcx", 64)).toBe(11n); expect(cpu.state.registers.read("r8", 64)).toBe(33n);
  expect(xmm.getFloat64(16, true)).toBe(2.5); expect(xmm.getFloat32(48, true)).toBe(4.5);
  expect(memory.copy(guestPointer(memory, sp + 8n), 32)).toEqual(new Uint8Array(32));
  expect(memory.borrow(guestPointer(memory, sp + 40n), 4).getInt32(0, true)).toBe(55);
  expect(memory.borrow(guestPointer(memory, sp + 48n), 4).getFloat32(0, true)).toBe(6.5);
  expect(adapter.arguments(cpu, call)).toEqual(values);
});

test("Microsoft x64 variadic floats are promoted and duplicated in the same-position integer register", () => {
  const { cpu, adapter } = fixture(windows64), call = signature(windows64, [pointer], "void", true);
  enter(cpu, adapter, call, [{ kind: "pointer", value: null }, { kind: "float32", value: 3.25 }]);
  expect(cpu.state.registers.read("rdx", 64)).toBe(0x400a000000000000n);
  expect(new DataView(cpu.state.simd.xmm.buffer).getFloat64(16, true)).toBe(3.25);
  expect(adapter.arguments(cpu, call, [f64])).toEqual([{ kind: "pointer", value: null }, { kind: "float64", value: 3.25 }]);
});

test("System V aggregates merge overlapping classes and roll back register allocation for an indivisible argument", () => {
  const pair = record(8, 16, [{ name: "a", byteOffset: 0, storage: "uint64", count: 2 }]);
  const call = signature(linux64, [i32, i32, i32, i32, i32, pair, i32]);
  const plan = planGuestCall(call);
  expect(plan.arguments[5]?.locations).toEqual([{ kind: "stack", stackOffset: 8, offset: 0, bytes: 16 }]);
  expect(plan.arguments[6]?.locations).toEqual([{ kind: "integer", register: "r9", offset: 0, bytes: 4 }]);
  const mixed = record(8, 16, [{ name: "number", byteOffset: 0, storage: "float64", count: 1 }, { name: "counter", byteOffset: 8, storage: "uint64", count: 1 }]);
  expect(classifySystemVAggregate(mixed)).toEqual(["sse", "integer"]);
  const union = record(8, 8, [{ name: "number", byteOffset: 0, storage: "float64", count: 1 }, { name: "bits", byteOffset: 0, storage: "uint64", count: 1 }]);
  expect(classifySystemVAggregate(union)).toEqual(["integer"]);
  expect(classifySystemVAggregate(record(8, 9, [{ name: "unaligned", byteOffset: 1, storage: "float64", count: 1 }], 1))).toBe("memory");
});

test("System V float aggregate returns use XMM0/XMM1 and preserve raw source bytes", () => {
  const { cpu, adapter } = fixture(linux64);
  const vec3 = record(8, 12, [{ name: "xyz", byteOffset: 0, storage: "float32", count: 3 }], 4);
  if (vec3.kind !== "aggregate") throw new Error("Fixture must be an aggregate");
  const bytes = new Uint8Array(12), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x80000000, true); view.setUint32(4, 0x7fc01234, true); view.setFloat32(8, 7.5, true);
  const call = signature(linux64, [vec3], vec3), value: GuestCallValue = { kind: "aggregate", layout: vec3.layout, bytes };
  enter(cpu, adapter, call, [value]);
  expect(cpu.state.simd.xmm.slice(0, 8)).toEqual(bytes.slice(0, 8)); expect(cpu.state.simd.xmm.slice(16, 20)).toEqual(bytes.slice(8));
  adapter.leave(cpu, call, value);
  expect(adapter.returnValue(cpu, call)).toEqual(value);
});

test("System V variadics set AL to the vector-register count while integer register allocation stays independent", () => {
  const { cpu, adapter } = fixture(linux64), call = signature(linux64, [i32], "void", true);
  enter(cpu, adapter, call, [{ kind: "int32", value: 9 }, { kind: "float32", value: 1.5 }, { kind: "uint64", value: 17n }, { kind: "float64", value: -2 }]);
  expect(cpu.state.registers.read("rax", 8)).toBe(2n); expect(cpu.state.registers.read("rdi", 64)).toBe(9n); expect(cpu.state.registers.read("rsi", 64)).toBe(17n);
  expect(new DataView(cpu.state.simd.xmm.buffer).getFloat64(0, true)).toBe(1.5); expect(new DataView(cpu.state.simd.xmm.buffer).getFloat64(16, true)).toBe(-2);
});

test("Win32 cdecl/stdcall/fastcall/thiscall have distinct registers and callee cleanup", () => {
  const stdcall: NativeCallAbi = { ...windows32, call: "stdcall" }, fastcall: NativeCallAbi = { ...windows32, call: "fastcall" }, thiscall: NativeCallAbi = { ...windows32, call: "thiscall" };
  for (const abi of [windows32, stdcall, fastcall]) {
    const { cpu, memory, adapter } = fixture(abi), call = signature(abi, [i32, i32, i32]);
    const sp = enter(cpu, adapter, call, [1, 2, 3].map(value => ({ kind: "int32", value })));
    expect(memory.borrow(guestPointer(memory, sp + 4n), 4).getInt32(0, true)).toBe(abi.call === "fastcall" ? 3 : 1);
    if (abi.call === "fastcall") { expect(cpu.state.registers.read("rcx", 32)).toBe(1n); expect(cpu.state.registers.read("rdx", 32)).toBe(2n); }
    adapter.leave(cpu, call, { kind: "int32", value: -7 });
    expect(cpu.state.registers.read("rsp", 32)).toBe(sp + BigInt(abi.call === "cdecl" ? 4 : abi.call === "stdcall" ? 16 : 8));
    expect(cpu.state.instructionPointer).toBe(0x1001n); expect(adapter.returnValue(cpu, call)).toEqual({ kind: "int32", value: -7 });
  }
  const { cpu, memory, adapter } = fixture(thiscall), call = signature(thiscall, [pointer, i32]);
  const sp = enter(cpu, adapter, call, [{ kind: "pointer", value: guestPointer(memory, 0x18000n) }, { kind: "int32", value: 21 }]);
  expect(cpu.state.registers.read("rcx", 32)).toBe(0x18000n); expect(memory.borrow(guestPointer(memory, sp + 4n), 4).getInt32(0, true)).toBe(21);
});

test("System V i386 hidden return pointer is callee-popped but explicit arguments remain caller-owned", () => {
  const { cpu, memory, adapter } = fixture(linux32), aggregate = record(4, 12, [{ name: "items", byteOffset: 0, storage: "uint32", count: 3 }]);
  if (aggregate.kind !== "aggregate") throw new Error("Expected aggregate fixture");
  const call = signature(linux32, [i32], aggregate), sp = enter(cpu, adapter, call, [{ kind: "int32", value: 77 }]);
  expect((sp + 4n) % 16n).toBe(0n);
  const destination = memory.borrow(guestPointer(memory, sp + 4n), 4).getUint32(0, true);
  expect(memory.borrow(guestPointer(memory, sp + 8n), 4).getInt32(0, true)).toBe(77);
  const value: GuestCallValue = { kind: "aggregate", layout: aggregate.layout, bytes: new Uint8Array(12).fill(0x5a) };
  adapter.leave(cpu, call, value);
  expect(cpu.state.registers.read("rsp", 32)).toBe(sp + 8n); expect(cpu.state.registers.read("rax", 32)).toBe(BigInt(destination));
  expect(adapter.returnValue(cpu, call)).toEqual(value);
});

test("Microsoft x64 large aggregates use independent 16-byte-aligned guest temporaries and hidden return storage", () => {
  const { cpu, memory, adapter } = fixture(windows64), aggregate = record(8, 24, [{ name: "items", byteOffset: 0, storage: "uint64", count: 3 }]);
  if (aggregate.kind !== "aggregate") throw new Error("Expected aggregate fixture");
  const bytes = new Uint8Array(24).fill(9), value: GuestCallValue = { kind: "aggregate", layout: aggregate.layout, bytes };
  const call = signature(windows64, [aggregate, i32], aggregate);
  enter(cpu, adapter, call, [value, { kind: "int32", value: 31 }]);
  const resultPointer = cpu.state.registers.read("rcx", 64), copyPointer = cpu.state.registers.read("rdx", 64);
  expect(resultPointer % 16n).toBe(0n); expect(copyPointer % 16n).toBe(0n); expect(resultPointer).not.toBe(copyPointer);
  expect(cpu.state.registers.read("r8", 64)).toBe(31n);
  bytes.fill(77); expect(memory.copy(guestPointer(memory, copyPointer), 24)).toEqual(new Uint8Array(24).fill(9));
  adapter.leave(cpu, call, value); expect(cpu.state.registers.read("rax", 64)).toBe(resultPointer); expect(adapter.returnValue(cpu, call)).toEqual(value);
});

test("i386 floating returns use ST0 and the host caller consumes the return slot", () => {
  for (const abi of [windows32, linux32]) {
    const { cpu, adapter } = fixture(abi), call = signature(abi, [], f64), initialTop = cpu.state.x87.statusWord >>> 11 & 7;
    enter(cpu, adapter, call, []); adapter.leave(cpu, call, { kind: "float64", value: -0 });
    expect(cpu.state.x87.statusWord >>> 11 & 7).toBe((initialTop + 7) & 7);
    expect(adapter.returnValue(cpu, call)).toEqual({ kind: "float64", value: -0 });
    expect(cpu.state.x87.statusWord >>> 11 & 7).toBe(initialTop); expect(cpu.state.x87.tagWord).toBe(0xffff);
  }
});

test("subword integer call arguments are widened before occupying a 32-bit stack slot", () => {
  const { cpu, memory, adapter } = fixture(windows32);
  const call = signature(windows32, [{ kind: "scalar", storage: "int8" }, { kind: "scalar", storage: "uint16" }]);
  memory.write(guestPointer(memory, 0x1ff00n), new Uint8Array(256).fill(0x5a));
  const sp = enter(cpu, adapter, call, [{ kind: "int32", value: -2 }, { kind: "uint32", value: 0x1234 }]);
  expect(memory.readUint32(guestPointer(memory, sp + 4n))).toBe(0xfffffffe);
  expect(memory.readUint32(guestPointer(memory, sp + 8n))).toBe(0x1234);
  expect(adapter.arguments(cpu, call)).toEqual([{ kind: "int32", value: -2 }, { kind: "uint32", value: 0x1234 }]);
});

test("i386 64-bit integer results return their low/high words through EAX and EDX", () => {
  for (const abi of [windows32, linux32]) {
    const { cpu, adapter } = fixture(abi), call = signature(abi, [], { kind: "scalar", storage: "uint64" });
    enter(cpu, adapter, call, []);
    adapter.leave(cpu, call, { kind: "uint64", value: 0xf123456789abcdefn });
    expect(cpu.state.registers.read("rax", 32)).toBe(0x89abcdefn); expect(cpu.state.registers.read("rdx", 32)).toBe(0xf1234567n);
    expect(adapter.returnValue(cpu, call)).toEqual({ kind: "uint64", value: 0xf123456789abcdefn });
  }
});

test("Win32 thiscall uses a hidden return buffer even for a four-byte POD record", () => {
  const abi: NativeCallAbi = { ...windows32, call: "thiscall" };
  const { cpu, memory, adapter } = fixture(abi);
  const result = record(4, 4, [{ name: "member", byteOffset: 0, storage: "int32", count: 1 }]);
  if (result.kind !== "aggregate") throw new Error("Fixture must be an aggregate");
  const call = signature(abi, [pointer], result);
  const sp = enter(cpu, adapter, call, [{ kind: "pointer", value: guestPointer(memory, 0x19000n) }]);
  expect(cpu.state.registers.read("rcx", 32)).toBe(0x19000n);
  const output = memory.readUint32(guestPointer(memory, sp + 4n));
  expect(output).not.toBe(0);
  const value: GuestCallValue = { kind: "aggregate", layout: result.layout, bytes: new Uint8Array([41, 0, 0, 0]) };
  adapter.leave(cpu, call, value);
  expect(cpu.state.registers.read("rax", 32)).toBe(BigInt(output)); expect(cpu.state.registers.read("rsp", 32)).toBe(sp + 8n);
  expect(adapter.returnValue(cpu, call)).toEqual(value);
});


import { lowerNativeCombatArguments, nativeCombatSignature, nativeRereleaseModLayout, readNativeCombatField, readNativeCombatArguments, stockNativeCombatCall, validateNativeCombatCall, type NativeCombatCall } from "../../../src/compat/q2/native-combat-call.ts";

test("declared native combat calls preserve reordered fields and captured extras across the original ABI", () => {
  for (const abi of [windows32, { ...windows32, call: "fastcall" }, windows64] satisfies readonly NativeCallAbi[]) {
    const { cpu, memory, adapter } = fixture(abi), image = guestPointer(memory, 0x10000n), incomingPointer = guestPointer(memory, 0x1a000n);
    memory.writePointer(memory.offset(image, 40n), guestPointer(memory, 0x1b000n));
    const extra = record(abi.pointerBytes, 12, [{ name: "bytes", byteOffset: 0, storage: "uint8", count: 12 }], 4);
    if (extra.kind !== "aggregate") throw new Error("Expected original aggregate");
    const stock = stockNativeCombatCall("damage", abi), call: NativeCombatCall = { convention: abi.kind === "windows-i386" ? abi.call : "microsoft-x64", arguments: [
      { kind: "value", layout: f64, bytes: new Array<number>(8).fill(0) }, ...stock.arguments.slice().reverse(),
      { kind: "value", layout: extra, bytes: new Array<number>(12).fill(0) }, { kind: "address", address: { rva: 32, indirections: [8] } },
    ] };
    validateNativeCombatCall(call, "damage", abi);
    if (abi.pointerBytes === 4) expect(() => validateNativeCombatCall({ ...call, convention: "thiscall" }, "damage", abi)).toThrow("this pointer");
    const pointerValue: GuestCallValue = { kind: "pointer", value: guestPointer(memory, 0x18000n) };
    const cause: GuestCallValue = abi.pointerBytes === 4 ? { kind: "int32", value: 8 } : { kind: "aggregate", layout: nativeRereleaseModLayout, bytes: new Uint8Array([8, 1, 1]) };
    const semantic: GuestCallValue[] = [pointerValue, pointerValue, pointerValue, pointerValue, pointerValue, pointerValue,
      { kind: "int32", value: 21 }, { kind: "int32", value: 17 }, { kind: "int32", value: 4 }, cause];
    const source: GuestCallValue[] = [{ kind: "float64", value: -3.25 }, ...semantic.slice().reverse(),
      { kind: "aggregate", layout: extra.layout, bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) }, { kind: "pointer", value: incomingPointer }];
    const signature = nativeCombatSignature(call, "damage", abi);
    const sp = enter(cpu, adapter, signature, source);
    expect(readNativeCombatField(cpu, call, signature, "target")).toEqual(pointerValue);
    const captured = adapter.arguments(cpu, signature);
    if (abi.pointerBytes === 8) {
      const location = planGuestCall(signature).arguments[11]?.locations[0];
      if (location?.kind !== "stack") throw new Error("Expected aggregate pointer on source stack");
      const slot = guestPointer(memory, sp + BigInt(location.stackOffset)), previous = memory.readPointer(slot);
      memory.writePointer(slot, null);
      expect(readNativeCombatField(cpu, call, signature, "target")).toEqual(pointerValue);
      expect(() => adapter.arguments(cpu, signature)).toThrow("null guest address");
      memory.writePointer(slot, previous);
    }
    expect(readNativeCombatArguments(call, "damage", captured, abi.pointerBytes)).toEqual(semantic);
    const changed = semantic.map((value, index) => index === 6 ? { kind: "int32", value: 99 } satisfies GuestCallValue : value);
    const resumed = lowerNativeCombatArguments(call, "damage", changed, memory, image, captured);
    expect(resumed[0]).toEqual(source[0]); expect(resumed.at(-2)).toEqual(source.at(-2)); expect(resumed.at(-1)).toEqual(source.at(-1));
    expect(readNativeCombatArguments(call, "damage", resumed, abi.pointerBytes)[6]).toEqual({ kind: "int32", value: 99 });
    const initiated = lowerNativeCombatArguments(call, "damage", changed, memory, image);
    expect(initiated[0]).toEqual({ kind: "float64", value: 0 });
    expect(initiated.at(-1)).toEqual({ kind: "pointer", value: guestPointer(memory, 0x1b000n) });
    expect(() => validateNativeCombatCall({ ...call, arguments: [...call.arguments, { kind: "field", field: "target" }] }, "damage", abi)).toThrow("exactly once");
  }
});
