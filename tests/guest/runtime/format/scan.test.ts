// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createContentDigest } from "../../../../src/contracts/content.ts";
import type { GuestAddress, GuestCallContext, GuestCallValue, ModuleIdentity } from "../../../../src/contracts/execution.ts";
import { GuestCallbackTable, SparseGuestMemory, createGuestProcessorState } from "../../../../src/guest/core/index.ts";
import { GuestCallRunner } from "../../../../src/guest/abi/index.ts";
import { X64Cpu } from "../../../../src/guest/x64/index.ts";
import { I386Cpu } from "../../../../src/guest/x86/index.ts";
import { WindowsGuestRuntime, UnsupportedWindowsImport } from "../../../../src/guest/runtime/windows/index.ts";
import { stringBytes } from "../../../../src/guest/runtime/common/memory.ts";
const module: ModuleIdentity = { id: "test:guest-format", artifactPath: "authored-format-arguments", revision: "1", digest: createContentDigest("46".repeat(32)) };
const ptr = (value: GuestAddress | null): GuestCallValue => ({ kind: "pointer", value });
const uint = (value: bigint, width: 4 | 8): GuestCallValue => width === 4 ? { kind: "uint32", value: Number(value) } : { kind: "uint64", value };
function fixture(width: 4 | 8) {
  const memory = new SparseGuestMemory({ module, pointerBytes: width }), callbacks = new GuestCallbackTable(memory);
  const stack = memory.allocate({ byteLength: 65536 }), sentinel = memory.allocate({ byteLength: 16, permissions: "read-execute" });
  const state = createGuestProcessorState({ architecture: width === 4 ? "i386" : "x86-64", instructionPointer: sentinel.byteOffset,
    stackPointer: stack.byteOffset + 65536n, flags: 2n, x87ControlWord: 0x37f, mxcsr: 0x1f80, mxcsrMask: 0xffff });
  const isHostCall = (address: GuestAddress): boolean => callbacks.resolve(address) !== null;
  const cpu = width === 4 ? new I386Cpu({ memory, state, hostCall: isHostCall }) : new X64Cpu({ memory, state, isHostCall });
  const runner = new GuestCallRunner({ cpu, callbacks, returnAddress: sentinel });
  const context: GuestCallContext = { module, callback: { kind: "typescript", provider: "test:format", callback: "test:entry" }, self: null, other: null, parent: null };
  const text = (value: string): GuestAddress => { const bytes = stringBytes(value), address = memory.allocate({ byteLength: bytes.length }); memory.write(address, bytes); return address; };
  const invoke = (address: GuestAddress | null, args: readonly GuestCallValue[]) => {
    if (address === null) throw new Error("Missing format service");
    const callback = callbacks.resolve(address); if (callback === null) throw new Error("Missing format callback");
    return runner.invoke({ target: address, signature: callback.signature, arguments: args, context, instructionBudget: 1000 });
  };
  return { memory, callbacks, runner, state, text, invoke };
}


for (const width of [4, 8] satisfies readonly (4 | 8)[]) test(`UCRT ${width * 8}: numeric scanner ABI, destination precision and assignment counts`, () => {
  const { memory, callbacks, runner, text, invoke } = fixture(width), runtime = new WindowsGuestRuntime({ memory, callbacks }); runtime.attachRunner(runner);
  const service = runtime.resolveAddress("api-ms-win-crt-stdio-l1-1-0.dll", "__stdio_common_vsscanf");
  const destinations = memory.allocate({ byteLength: 32 }), args = memory.allocate({ byteLength: width * 3 });
  for (let index = 0; index < 3; index++) memory.writePointer(memory.offset(args, BigInt(index * width)), memory.offset(destinations, BigInt(index * 8)));
  const scan = (input: string, format: string, capacity = (1n << BigInt(width * 8)) - 1n, options = 2n, locale: GuestAddress | null = null) => {
    return invoke(service, [{ kind: "uint64", value: options }, ptr(text(input)), uint(capacity, width), ptr(text(format)), ptr(locale), ptr(args)]);
  };
  expect(scan("-1768.0", "%lf")).toEqual({ kind: "int32", value: 1 });
  expect(memory.readFloat64(destinations)).toBe(-1768);
  expect(scan(" -12.5 010", "%f %i")).toEqual({ kind: "int32", value: 2 });
  expect(memory.readFloat32(destinations)).toBe(-12.5); expect(memory.readInt32(memory.offset(destinations, 8n))).toBe(8);
  expect(scan("+0x2a", "%i")).toEqual({ kind: "int32", value: 1 }); expect(memory.readInt32(destinations)).toBe(42);
  expect(scan("010", "%d")).toEqual({ kind: "int32", value: 1 }); expect(memory.readInt32(destinations)).toBe(10);
  expect(scan("( 12.75%, -20)", "( %*5lf%%, %d)")).toEqual({ kind: "int32", value: 1 }); expect(memory.readInt32(destinations)).toBe(-20);
  expect(scan("12345", "%3d%d")).toEqual({ kind: "int32", value: 2 });
  expect(memory.readInt32(destinations)).toBe(123); expect(memory.readInt32(memory.offset(destinations, 8n))).toBe(45);
  expect(scan("12.75", "%lf", 2n)).toEqual({ kind: "int32", value: 1 }); expect(memory.readFloat64(destinations)).toBe(12);
  const unterminated = memory.allocate({ byteLength: 3 }); memory.write(unterminated, new Uint8Array([49, 46, 53]));
  expect(invoke(service, [{ kind: "uint64", value: 2n }, ptr(unterminated), uint(3n, width), ptr(text("%lf")), ptr(null), ptr(args)]))
    .toEqual({ kind: "int32", value: 1 }); expect(memory.readFloat64(destinations)).toBe(1.5);
  memory.write(destinations, new Uint8Array(32).fill(0x7f));
  for (const input of ["", " \t\n"]) expect(scan(input, "%lf")).toEqual({ kind: "int32", value: -1 });
  for (const input of ["x", "invalid", "no", "+", ".", "1e+"]) expect(scan(input, "%lf")).toEqual({ kind: "int32", value: 0 });
  expect(memory.copy(destinations, 32)).toEqual(new Uint8Array(32).fill(0x7f));
  expect(scan("1", "%*d %d")).toEqual({ kind: "int32", value: 0 });
  expect(scan("1", "%d %d")).toEqual({ kind: "int32", value: 1 });
  expect(scan("a", "b%lf")).toEqual({ kind: "int32", value: 0 });
  expect(scan("", "a%lf")).toEqual({ kind: "int32", value: -1 });
  expect(scan("", " ")).toEqual({ kind: "int32", value: 0 });
  for (const format of ["%s", "%n", "%lld", "%[a]", "%0f", "%Lf", "%a"]) expect(() => scan("1", format)).toThrow(UnsupportedWindowsImport);
  expect(() => scan("1", "%lf", 1n, 1n)).toThrow(UnsupportedWindowsImport);
  expect(() => scan("1", "%lf", 1n, 2n, destinations)).toThrow(UnsupportedWindowsImport);
  expect(() => scan("0x1p0", "%lf")).toThrow(UnsupportedWindowsImport);
  expect(() => scan("inf", "%lf")).toThrow(UnsupportedWindowsImport);
  expect(scan("-0", "%lf")).toEqual({ kind: "int32", value: 1 }); expect(memory.readUint64(destinations)).toBe(0x8000000000000000n);
  expect(scan("1.00000005960464477539062500000000001", "%f")).toEqual({ kind: "int32", value: 1 }); expect(memory.readUint32(destinations)).toBe(0x3f800001);
  expect(scan("1.000000059604644775390625", "%f")).toEqual({ kind: "int32", value: 1 }); expect(memory.readUint32(destinations)).toBe(0x3f800000);
  expect(scan("4.9406564584124654e-324", "%lf")).toEqual({ kind: "int32", value: 1 }); expect(memory.readUint64(destinations)).toBe(1n);
  expect(scan("1e9999", "%lf")).toEqual({ kind: "int32", value: 1 }); expect(memory.readFloat64(destinations)).toBe(Infinity);
  expect(scan("-1e-9999", "%lf")).toEqual({ kind: "int32", value: 1 }); expect(memory.readUint64(destinations)).toBe(0x8000000000000000n);
});
