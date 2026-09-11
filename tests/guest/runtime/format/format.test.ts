// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createContentDigest } from "../../../../src/contracts/content.ts";
import type { GuestAddress, GuestCallContext, GuestCallValue, ModuleIdentity } from "../../../../src/contracts/execution.ts";
import { GuestCallbackTable, SparseGuestMemory, createGuestProcessorState } from "../../../../src/guest/core/index.ts";
import { GuestCallRunner } from "../../../../src/guest/abi/index.ts";
import { X64Cpu } from "../../../../src/guest/x64/index.ts";
import { I386Cpu } from "../../../../src/guest/x86/index.ts";
import { WindowsGuestRuntime } from "../../../../src/guest/runtime/windows/index.ts";
import { SystemVGuestRuntime } from "../../../../src/guest/runtime/system-v/index.ts";
import { formatGuestBuffer, GuestFormatFortifyFailure } from "../../../../src/guest/runtime/common/format.ts";
import { readString, stringBytes } from "../../../../src/guest/runtime/common/memory.ts";
import { decodeBinary } from "../../../../src/guest/floating-point/binary.ts";
import { formatFloat } from "../../../../src/guest/runtime/common/format/float.ts";

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

for (const width of [4, 8] satisfies readonly (4 | 8)[]) test(`UCRT ${width * 8}: actual RR numeric save arguments and CRT buffer options`, () => {
  const { memory, callbacks, runner, text, invoke } = fixture(width), runtime = new WindowsGuestRuntime({ memory, callbacks }); runtime.attachRunner(runner);
  const service = runtime.resolveAddress("api-ms-win-crt-stdio-l1-1-0.dll", "__stdio_common_vsprintf");
  const buffer = memory.allocate({ byteLength: 64 }), args = memory.allocate({ byteLength: 32 });
  memory.writeInt32(args, 17); memory.writeFloat64(memory.offset(args, BigInt(width)), 16);
  const call = (options: bigint, capacity: bigint, format: GuestAddress, list: GuestAddress | null = args, destination: GuestAddress | null = buffer) =>
    invoke(service, [{ kind: "uint64", value: options }, ptr(destination), uint(capacity, width), ptr(format), ptr(null), ptr(list)]);
  expect(call(0x26n, 36n, text("%.*g"))).toEqual({ kind: "int32", value: 2 });
  expect(readString(memory, buffer)).toBe("16");
  const literal = text("abcde");
  memory.write(buffer, new Uint8Array(64).fill(0x7f));
  expect(call(2n, 4n, literal, null)).toEqual({ kind: "int32", value: 5 });
  expect(memory.copy(buffer, 6)).toEqual(new Uint8Array([97, 98, 99, 0, 127, 127]));
  expect(call(2n, 0n, literal, null, null)).toEqual({ kind: "int32", value: 5 });
  memory.write(buffer, new Uint8Array(64).fill(0x7f));
  expect(call(1n, 5n, literal, null)).toEqual({ kind: "int32", value: 5 });
  expect(memory.copy(buffer, 6)).toEqual(new Uint8Array([97, 98, 99, 100, 101, 127]));
  expect(call(1n, 4n, literal, null)).toEqual({ kind: "int32", value: -1 });
  expect(call(3n, 4n, literal, null)).toEqual({ kind: "int32", value: -1 });
  expect(call(0n, 5n, literal, null)).toEqual({ kind: "int32", value: -2 });
  expect(readString(memory, buffer)).toBe("abcd");
  expect(call(0n, 0n, text(""), null)).toEqual({ kind: "int32", value: -1 });
  memory.writePointer(args, buffer);
  expect(call(2n, 64n, text("abc%n"))).toEqual({ kind: "int32", value: -1 });
  const errno = invoke(runtime.resolveAddress("ucrtbase.dll", "_errno"), []);
  if (errno.kind !== "pointer" || errno.value === null) throw new Error("Missing CRT errno");
  expect(memory.readInt32(errno.value)).toBe(22);
});

for (const width of [4, 8] satisfies readonly (4 | 8)[]) test(`glibc ${width * 8}: independent GP/SSE varargs, stack overflow, fortify and positional conversions`, () => {
  const { memory, callbacks, runner, text, invoke } = fixture(width), runtime = new SystemVGuestRuntime({ memory, callbacks }); runtime.attachRunner(runner);
  const service = runtime.resolveAddress("libc.so.6", "__vsnprintf_chk", "GLIBC_2.3.4"), buffer = memory.allocate({ byteLength: 256 });
  const registers = memory.allocate({ byteLength: 176 }), stack = memory.allocate({ byteLength: 64, alignment: 16n }), descriptor = memory.allocate({ byteLength: 24 });
  const label = text("guest"), count = memory.allocate({ byteLength: 8 });
  const args = width === 8 ? descriptor : stack;
  const reset = (): void => {
    if (width === 8) {
      memory.writeUint32(descriptor, 40); memory.writeUint32(memory.offset(descriptor, 4n), 160);
      memory.writePointer(memory.offset(descriptor, 8n), stack); memory.writePointer(memory.offset(descriptor, 16n), registers);
      memory.writeInt64(memory.offset(registers, 40n), -42n); memory.writeFloat64(memory.offset(registers, 160n), 2.5);
      memory.writePointer(stack, label); memory.writeUint64(memory.offset(stack, 8n), 0xffffffffffffffffn);
      memory.writeFloat64(memory.offset(stack, 16n), 1.25); memory.writePointer(memory.offset(stack, 24n), count);
    } else {
      memory.writeInt32(stack, -42); memory.writeFloat64(memory.offset(stack, 4n), 2.5); memory.writePointer(memory.offset(stack, 12n), label);
      memory.writeUint64(memory.offset(stack, 16n), 0xffffffffffffffffn); memory.writeFloat64(memory.offset(stack, 24n), 1.25);
      memory.writePointer(memory.offset(stack, 32n), count);
    }
  };
  const call = (format: GuestAddress, capacity = 256n, size = 256n, flag = 0) => invoke(service,
    [ptr(buffer), uint(capacity, width), { kind: "int32", value: flag }, uint(size, width), ptr(format), ptr(args)]);
  const literal = text("------- Game Initialization -------\n");
  expect(call(literal)).toEqual({ kind: "int32", value: 36 });
  expect(readString(memory, buffer)).toBe("------- Game Initialization -------\n");
  reset();
  const format = text("%+06d|%.0f|%.3s|%#llx|%.2f%n");
  const expected = "-00042|2|gue|0xffffffffffffffff|1.25";
  expect(call(format)).toEqual({ kind: "int32", value: expected.length });
  expect(readString(memory, buffer)).toBe(expected); expect(memory.readInt32(count)).toBe(expected.length);
  if (width === 8) {
    expect(memory.readUint32(descriptor)).toBe(48); expect(memory.readUint32(memory.offset(descriptor, 4n))).toBe(176);
    expect(memory.readPointer(memory.offset(descriptor, 8n))).toEqual(memory.offset(stack, 32n));
  }
  reset(); expect(call(format, 5n)).toEqual({ kind: "int32", value: expected.length }); expect(readString(memory, buffer)).toBe("-000");
  reset(); expect(() => call(format, 257n)).toThrow(GuestFormatFortifyFailure);
  expect(() => call(format, 256n, 256n, 1)).toThrow(GuestFormatFortifyFailure);
  reset(); memory.protect(format, stringBytes("%+06d|%.0f|%.3s|%#llx|%.2f%n").length, "read");
  expect(call(format, 256n, 256n, 1)).toEqual({ kind: "int32", value: expected.length });
  reset(); expect(call(text("%2$.1f/%1$d/%2$.0f"))).toEqual({ kind: "int32", value: 9 }); expect(readString(memory, buffer)).toBe("2.5/-42/2");
});

test("guest floating conversion rounds binary64 and x87 decimal/hex values without host toFixed semantics", () => {
  const number = (value: number) => { const bytes = new DataView(new ArrayBuffer(8)); bytes.setFloat64(0, value, true); return decodeBinary(bytes.getBigUint64(0, true), 64); };
  const format = (value: number, code: string, precision: number | null, alternate = false) => formatFloat(number(value), code, precision, alternate, "nearest", false, false, 2);
  expect(format(2.5, "f", 0)).toBe("2"); expect(format(3.5, "f", 0)).toBe("4");
  expect(format(2.25, "f", 1)).toBe("2.2");
  expect(formatFloat(number(2.25), "f", 1, false, "legacy-nearest", true, false, 2)).toBe("2.3");
  expect(format(1e21, "f", 1)).toBe("1000000000000000000000.0");
  expect(format(0.1, "f", 20)).toBe("0.10000000000000000555");
  expect(format(999.5, "g", 3)).toBe("1e+03"); expect(format(0.00009999, "g", 3)).toBe("0.0001");
  expect(format(16, "g", 17)).toBe("16"); expect(format(16, "g", 4, true)).toBe("16.00");
  expect(format(1.5, "a", null)).toBe("0x1.8p+0"); expect(format(1.5, "a", 0)).toBe("0x2p+0");
  expect(format(Number.MIN_VALUE, "a", null)).toBe("0x0.0000000000001p-1022");
  expect(formatFloat(number(-2.25), "f", 1, false, "down", false, false, 2)).toBe("2.3");
  const extended = decodeBinary(0x3fff8000000000000001n, 80);
  expect(formatFloat(extended, "g", 21, false, "nearest", false, true, 2)).toBe("1.00000000000000000011");
  expect(formatFloat(extended, "a", null, false, "nearest", false, true, 2)).toBe("0x8.000000000000001p-3");
});

test("integer lengths, dynamic width/precision, pointer dialect and byte-string precision preserve source bytes", () => {
  const { memory, text } = fixture(8), buffer = memory.allocate({ byteLength: 256 }), args = memory.allocate({ byteLength: 64 });
  memory.writeInt32(args, -8); memory.writeInt32(memory.offset(args, 8n), 3); memory.writeInt32(memory.offset(args, 16n), -7);
  memory.writeUint64(memory.offset(args, 24n), 0x12345678ffffffffn); memory.writeUint64(memory.offset(args, 32n), 255n);
  memory.writePointer(memory.offset(args, 40n), text("\xffabc")); memory.writeUint64(memory.offset(args, 48n), 0x1234n);
  const result = formatGuestBuffer({ memory, dialect: "windows", buffer, capacity: 256n, arguments: args, termination: "c99",
    format: text("%*.*d|%ld|%hhd|%.2s|%p") });
  expect(result).toEqual({ result: 34, errno: null });
  expect(readString(memory, buffer)).toBe("-007    |-1|-1|\xffa|0000000000001234");
  expect(formatGuestBuffer({ memory, dialect: "windows", buffer: null, capacity: 0n, arguments: args, termination: "c99", format: text("%2147483647d!") }))
    .toEqual({ result: -1, errno: 132 });
});
