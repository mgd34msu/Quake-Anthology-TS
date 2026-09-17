// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createContentDigest } from "../../../src/contracts/content.ts";
import type { GuestAddress, GuestCallContext, GuestCallResult, ModuleIdentity, NativeCallAbi } from "../../../src/contracts/execution.ts";
import { createGuestProcessorState, GuestCallbackTable, SparseGuestMemory } from "../../../src/guest/core/index.ts";
import type { GuestCpu, GuestHostCallback } from "../../../src/guest/core/contracts.ts";
import { captureAbiProcessorState, GuestCallRunner, GuestCallStopped, guestPointer, restoreAbiProcessorState } from "../../../src/guest/abi/index.ts";
import { I386Cpu } from "../../../src/guest/x86/index.ts";
import { X64Cpu } from "../../../src/guest/x64/index.ts";

const module: ModuleIdentity = { id: "test:nested-abi", artifactPath: "authored-call-machine-code", revision: "1", digest: createContentDigest("cd".repeat(32)) };
const abis: readonly NativeCallAbi[] = [
  { kind: "windows-i386", image: "pe32", pointerBytes: 4, call: "cdecl" },
  { kind: "linux-i386", image: "elf32", pointerBytes: 4, call: "system-v-i386" },
  { kind: "windows-x86-64", image: "pe32+", pointerBytes: 8, call: "microsoft-x64" },
  { kind: "linux-x86-64", image: "elf64", pointerBytes: 8, call: "system-v-x86-64" },
];
function callBytes(abi: NativeCallAbi, callback: GuestAddress, increment: number): Uint8Array {
  const immediate = Array.from({ length: abi.pointerBytes }, (_, index) => Number(callback.byteOffset >> BigInt(index * 8) & 255n));
  if (abi.pointerBytes === 4) return new Uint8Array([
    0x83, 0xec, 8, 0xff, 0x74, 0x24, 12, // sub esp,8; push DWORD PTR [esp+12]
    0xb8, ...immediate, 0xff, 0xd0, // mov eax,callback; call eax
    0x83, 0xc4, 12, 0x83, 0xc0, increment, 0xc3, // add esp,12; add eax,increment; ret
  ]);
  const reserve = abi.kind === "windows-x86-64" ? 40 : 8;
  return new Uint8Array([0x48, 0x83, 0xec, reserve, 0x48, 0xb8, ...immediate, 0xff, 0xd0, 0x48, 0x83, 0xc4, reserve, 0x83, 0xc0, increment, 0xc3]);
}
function stateFor(abi: NativeCallAbi) {
  return createGuestProcessorState({ architecture: abi.pointerBytes === 4 ? "i386" : "x86-64", instructionPointer: 0x1800n, stackPointer: 0x20000n,
    flags: 2n, x87ControlWord: 0x37f, mxcsr: 0x1f80, mxcsrMask: 0xffff });
}
function cpuFor(abi: NativeCallAbi, memory: SparseGuestMemory, state: ReturnType<typeof stateFor>, callback: GuestAddress): GuestCpu {
  const isHostCall = (address: GuestAddress): boolean => address.byteOffset === callback.byteOffset;
  return abi.pointerBytes === 4 ? new I386Cpu({ memory, state, hostCall: isHostCall }) : new X64Cpu({ memory, state, isHostCall });
}

for (const abi of abis) test(`${abi.kind}: real CALL/RET instructions nest through the same host callback and preserve memory`, () => {
  const memory = new SparseGuestMemory({ module, pointerBytes: abi.pointerBytes, allocationBase: 0x30000n });
  memory.map({ base: 0x1000n, byteLength: 4096, permissions: "read-write" });
  memory.map({ base: 0x10000n, byteLength: 65536, permissions: "read-write" });
  const table = new GuestCallbackTable(memory), state = stateFor(abi);
  const context: GuestCallContext = { module, callback: { kind: "native-guest", module, address: guestPointer(memory, 0x1000n), abi }, parent: null, self: null, other: null };
  let runner: GuestCallRunner | null = null;
  const depths: number[] = [], parents: boolean[] = [];
  const callback: GuestHostCallback = {
    id: "test:nested-host", signature: { abi, parameters: [{ kind: "scalar", storage: "int32" }], result: { kind: "scalar", storage: "int32" }, variadic: false },
    invoke: (callbackContext, arguments_): GuestCallResult => {
      if (runner === null) throw new Error("Fixture runner is not initialized");
      const argument = arguments_[0];
      if (argument?.kind !== "int32") throw new TypeError("Wrong callback argument");
      depths.push(runner.depth);
      parents.push(callbackContext.parent !== null);
      if (argument.value === 41) return runner.invoke({ target: guestPointer(memory, 0x1100n), signature: callback.signature, arguments: [{ kind: "int32", value: 42 }],
        context: { ...callbackContext, callback: { kind: "native-guest", module, address: guestPointer(memory, 0x1100n), abi } }, instructionBudget: 64 });
      expect(callbackContext.parent?.parent?.callback.kind).toBe("native-guest");
      memory.writeUint32(guestPointer(memory, 0x19000n), argument.value * 2);
      return { kind: "int32", value: argument.value * 2 };
    },
  };
  const callbackAddress = table.bind(callback);
  memory.write(guestPointer(memory, 0x1000n), callBytes(abi, callbackAddress, 3));
  memory.write(guestPointer(memory, 0x1100n), callBytes(abi, callbackAddress, 1));
  memory.write(guestPointer(memory, 0x1800n), new Uint8Array([0xcc]));
  memory.protect(guestPointer(memory, 0x1000n), 4096, "read-execute");
  const cpu = cpuFor(abi, memory, state, callbackAddress);
  runner = new GuestCallRunner({ cpu, callbacks: table, returnAddress: guestPointer(memory, 0x1800n) });
  const result = runner.invoke({ target: guestPointer(memory, 0x1000n), signature: callback.signature, arguments: [{ kind: "int32", value: 41 }], context, instructionBudget: 100 });
  expect(result).toEqual({ kind: "int32", value: 88 }); expect(depths).toEqual([1, 2]); expect(parents).toEqual([true, true]);
  expect(memory.readUint32(guestPointer(memory, 0x19000n))).toBe(84);
  expect(state.registers.read("rsp", abi.pointerBytes === 4 ? 32 : 64)).toBe(0x20000n); expect(runner.depth).toBe(0);
  const savedProcessor = captureAbiProcessorState(state);
  state.registers.write("rax", 32, 999n); state.simd.xmm.fill(123); restoreAbiProcessorState(state, savedProcessor);
  expect(state.registers.read("rax", 32)).toBe(88n); expect(state.simd.xmm).toEqual(savedProcessor.simd.xmm);
  table.unbind(callback.id);
  expect(() => runner?.invoke({ target: guestPointer(memory, 0x1000n), signature: callback.signature, arguments: [{ kind: "int32", value: 42 }], context, instructionBudget: 30 })).toThrow("unbound");
  expect(table.bind(callback)).toEqual(callbackAddress);
});

test("a real processor exception preserves its guest frame rather than pretending the call returned", () => {
  const abi: NativeCallAbi = { kind: "windows-x86-64", image: "pe32+", pointerBytes: 8, call: "microsoft-x64" };
  const memory = new SparseGuestMemory({ module, pointerBytes: 8 });
  memory.map({ base: 0x1000n, byteLength: 4096, permissions: "read-execute", bytes: new Uint8Array([0xcc]) });
  memory.map({ base: 0x10000n, byteLength: 65536, permissions: "read-write" });
  const cpu = new X64Cpu({ memory, state: stateFor(abi) }), table = new GuestCallbackTable(memory);
  const runner = new GuestCallRunner({ cpu, callbacks: table, returnAddress: guestPointer(memory, 0x1800n) });
  const context: GuestCallContext = { module, callback: { kind: "native-guest", module, address: guestPointer(memory, 0x1000n), abi }, parent: null, self: null, other: null };
  try {
    runner.invoke({ target: guestPointer(memory, 0x1000n), signature: { abi, parameters: [], result: "void", variadic: false }, arguments: [], context, instructionBudget: 8 });
    throw new Error("Exception fixture unexpectedly returned");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(GuestCallStopped);
    if (!(error instanceof GuestCallStopped)) throw error;
    expect(error.stop.kind).toBe("exception");
  }
  expect(cpu.state.registers.read("rsp", 64)).not.toBe(0x20000n); expect(runner.depth).toBe(0);
});

test("saved raw code and callback identities rebind into a restored address space before real execution", () => {
  const abi: NativeCallAbi = { kind: "windows-x86-64", image: "pe32+", pointerBytes: 8, call: "microsoft-x64" };
  const memory = new SparseGuestMemory({ module, pointerBytes: 8, allocationBase: 0x30000n });
  memory.map({ base: 0x1000n, byteLength: 4096, permissions: "read-write" });
  memory.map({ base: 0x10000n, byteLength: 65536, permissions: "read-write" });
  const table = new GuestCallbackTable(memory), originalState = stateFor(abi);
  const callback: GuestHostCallback = { id: "test:restored-callback", signature: { abi, parameters: [{ kind: "scalar", storage: "int32" }], result: { kind: "scalar", storage: "int32" }, variadic: false },
    invoke: (_context, arguments_) => {
      const value = arguments_[0];
      if (value?.kind !== "int32") throw new TypeError("Restored callback argument differs");
      return { kind: "int32", value: value.value + 1 };
    } };
  const oldCallbackAddress = table.bind(callback);
  memory.write(guestPointer(memory, 0x1000n), callBytes(abi, oldCallbackAddress, 3));
  memory.protect(guestPointer(memory, 0x1000n), 4096, "read-execute");
  const savedMemory = memory.checkpoint(), savedCallbacks = table.checkpoint(), savedProcessor = captureAbiProcessorState(originalState);
  table.unbind(callback.id);
  const restored = SparseGuestMemory.restore(module, savedMemory);
  const rebound = GuestCallbackTable.restore(restored, savedCallbacks, id => id === callback.id ? callback : null);
  const restoredCallbackAddress = rebound.address(callback.id);
  if (restoredCallbackAddress === null) throw new Error("Saved callback identity was not rebound");
  expect(restoredCallbackAddress.byteOffset).toBe(oldCallbackAddress.byteOffset);
  expect(restoredCallbackAddress.addressSpace).not.toBe(oldCallbackAddress.addressSpace);
  const state = stateFor(abi); restoreAbiProcessorState(state, savedProcessor);
  const cpu = cpuFor(abi, restored, state, restoredCallbackAddress);
  const runner = new GuestCallRunner({ cpu, callbacks: rebound, returnAddress: guestPointer(restored, 0x1800n) });
  const context: GuestCallContext = { module, callback: { kind: "native-guest", module, address: guestPointer(restored, 0x1000n), abi }, parent: null, self: null, other: null };
  expect(runner.invoke({ target: guestPointer(restored, 0x1000n), signature: callback.signature, arguments: [{ kind: "int32", value: 5 }], context, instructionBudget: 30 })).toEqual({ kind: "int32", value: 9 });
  expect(() => rebound.resolve(oldCallbackAddress)).toThrow("another execution owner");
});

test("a real Win32 ret immediate must match stdcall stack cleanup", () => {
  const abi: NativeCallAbi = { kind: "windows-i386", image: "pe32", pointerBytes: 4, call: "stdcall" };
  const memory = new SparseGuestMemory({ module, pointerBytes: 4 });
  memory.map({ base: 0x1000n, byteLength: 4096, permissions: "read-execute", bytes: new Uint8Array([0xb8, 42, 0, 0, 0, 0xc2, 8, 0]) });
  memory.map({ base: 0x10000n, byteLength: 65536, permissions: "read-write" });
  const cpu = new I386Cpu({ memory, state: stateFor(abi) });
  const runner = new GuestCallRunner({ cpu, callbacks: new GuestCallbackTable(memory), returnAddress: guestPointer(memory, 0x1800n) });
  const context: GuestCallContext = { module, callback: { kind: "native-guest", module, address: guestPointer(memory, 0x1000n), abi }, parent: null, self: null, other: null };
  const parameters: readonly [{ readonly kind: "scalar"; readonly storage: "int32" }, { readonly kind: "scalar"; readonly storage: "int32" }] = [{ kind: "scalar", storage: "int32" }, { kind: "scalar", storage: "int32" }];
  const request = { target: guestPointer(memory, 0x1000n), signature: { abi, parameters, result: { kind: "scalar", storage: "int32" }, variadic: false }, arguments: [{ kind: "int32", value: 7 }, { kind: "int32", value: 9 }], context, instructionBudget: 8 } satisfies Parameters<GuestCallRunner["invoke"]>[0];
  expect(runner.invoke(request)).toEqual({ kind: "int32", value: 42 });
  memory.protect(guestPointer(memory, 0x1000n), 4096, "read-write");
  memory.write(guestPointer(memory, 0x1005n), new Uint8Array([0xc3]));
  memory.protect(guestPointer(memory, 0x1000n), 4096, "read-execute");
  expect(() => runner.invoke(request)).toThrow("incorrect ABI stack cleanup");
});

test("an i386 RET that exactly consumes the instruction budget is still a completed call", () => {
  const abi: NativeCallAbi = { kind: "windows-i386", image: "pe32", pointerBytes: 4, call: "cdecl" };
  const memory = new SparseGuestMemory({ module, pointerBytes: 4 });
  memory.map({ base: 0x1000n, byteLength: 4096, permissions: "read-execute", bytes: new Uint8Array([0xc3]) });
  memory.map({ base: 0x10000n, byteLength: 65536, permissions: "read-write" });
  const cpu = new I386Cpu({ memory, state: stateFor(abi) });
  const runner = new GuestCallRunner({ cpu, callbacks: new GuestCallbackTable(memory), returnAddress: guestPointer(memory, 0x1800n) });
  const context: GuestCallContext = { module, callback: { kind: "native-guest", module, address: guestPointer(memory, 0x1000n), abi }, parent: null, self: null, other: null };
  expect(runner.invoke({ target: guestPointer(memory, 0x1000n), signature: { abi, parameters: [], result: "void", variadic: false }, arguments: [], context, instructionBudget: 1 })).toEqual({ kind: "void" });
});

test("loading slices preserve guest state and reject unrelated reentry while suspended", async () => {
  const abi = abis[0];
  if (abi === undefined) throw new Error("Missing i386 ABI");
  const memory = new SparseGuestMemory({ module, pointerBytes: 4, allocationBase: 0x40000n });
  const code = new Uint8Array(20_006).fill(0x90);
  code.set([0xb8, 42, 0, 0, 0, 0xc3], 20_000);
  memory.map({ base: 0x1000n, byteLength: 32768, permissions: "read-execute", bytes: code });
  memory.map({ base: 0x10000n, byteLength: 65536, permissions: "read-write" });
  const callbacks = new GuestCallbackTable(memory), state = stateFor(abi);
  const cpu = new I386Cpu({ memory, state });
  const runner = new GuestCallRunner({ cpu, callbacks, returnAddress: guestPointer(memory, 0x8000n) });
  const target = guestPointer(memory, 0x1000n);
  const context: GuestCallContext = { module, callback: { kind: "native-guest", module, address: target, abi }, parent: null, self: null, other: null };
  const request = { target, signature: { abi, parameters: [], result: { kind: "scalar", storage: "int32" }, variadic: false } satisfies GuestHostCallback["signature"], arguments: [], context, instructionBudget: 30_000 };
  let yields = 0;
  const result = await runner.invokeLoading(request, async () => {
    yields++;
    expect(runner.depth).toBe(1);
    expect(() => runner.invoke(request)).toThrow("suspended");
    await Promise.resolve();
  });
  expect(yields).toBe(1);
  expect(result).toEqual({ kind: "int32", value: 42 });
  expect(runner.instructionsExecuted).toBe(20_002n);
  expect(runner.depth).toBe(0);
  expect(runner.invoke(request)).toEqual(result);
  expect(runner.instructionsExecuted).toBe(40_004n);
});
