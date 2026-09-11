// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createContentDigest } from "../../../../src/contracts/content.ts";
import type { GuestAddress, GuestCallContext, GuestCallResult, GuestCallValue, ModuleIdentity } from "../../../../src/contracts/execution.ts";
import { createGuestProcessorState, GuestCallbackTable, SparseGuestMemory } from "../../../../src/guest/core/index.ts";
import { GuestCallRunner } from "../../../../src/guest/abi/index.ts";
import { X64Cpu } from "../../../../src/guest/x64/index.ts";
import { WindowsGuestRuntime, UnsupportedWindowsImport } from "../../../../src/guest/runtime/windows/index.ts";
import type { WindowsFile } from "../../../../src/guest/runtime/windows/index.ts";
import { mapPeImage } from "../../../../src/guest/pe/index.ts";
import { peFixture } from "../../pe/fixture.ts";

const module: ModuleIdentity = { id: "test:windows-services", artifactPath: "authored-runtime-check", revision: "1", digest: createContentDigest("37".repeat(32)) };
const p = (value: GuestAddress | null): GuestCallValue => ({ kind: "pointer", value });
const u = (value: number): GuestCallValue => ({ kind: "uint32", value });
const s = (value: number): GuestCallValue => ({ kind: "int32", value });
function resultPointer(value: GuestCallResult): GuestAddress {
  if (value.kind !== "pointer" || value.value === null) throw new Error("Expected nonnull guest pointer result"); return value.value;
}

test("Windows heap, TLS and file services expose mutations in authoritative guest memory", () => {
  const memory = new SparseGuestMemory({ module, pointerBytes: 4 });
  const callbacks = new GuestCallbackTable(memory);
  let fileBytes = new Uint8Array([10, 20, 30]); let closed = false;
  const file: WindowsFile = {
    read: (offset, length) => fileBytes.slice(offset, offset + length), size: () => fileBytes.length,
    write(offset, bytes) { const next = new Uint8Array(Math.max(fileBytes.length, offset + bytes.length)); next.set(fileBytes); next.set(bytes, offset); fileBytes = next; return bytes.length; },
    truncate(length) { fileBytes = fileBytes.slice(0, length); }, flush() {}, close() { closed = true; },
  };
  const runtime = new WindowsGuestRuntime({ memory, callbacks, capabilities: { openFile: path => path === "save.sav" ? file : null } });
  const context: GuestCallContext = { module, callback: { kind: "typescript", provider: "test:windows-services", callback: "test:entry" }, self: null, other: null, parent: null };
  const call = (name: string, args: readonly GuestCallValue[]): GuestCallResult => {
    const address = runtime.resolveAddress("kernel32.dll", name); if (address === null) throw new Error(`Missing service ${name}`); return callbacks.invoke(address, context, args);
  };
  const heap = resultPointer(call("HeapCreate", [u(0), u(0), u(0)]));
  const allocation = resultPointer(call("HeapAlloc", [p(heap), u(8), u(16)])); memory.writeUint32(allocation, 0x12345678);
  const enlarged = resultPointer(call("HeapReAlloc", [p(heap), u(8), p(allocation), u(40)]));
  expect(memory.readUint32(enlarged)).toBe(0x12345678); expect(memory.readUint32(memory.offset(enlarged, 20n))).toBe(0);
  expect(() => memory.readUint8(allocation)).toThrow();
  const index = call("TlsAlloc", []); if (index.kind !== "uint32") throw new Error("TLS index required");
  expect(call("TlsSetValue", [index, p(enlarged)])).toEqual({ kind: "int32", value: 1 });
  const slot = memory.offset(runtime.teb, 0xe10n + BigInt(index.value * 4)); expect(memory.readPointer(slot)?.byteOffset).toBe(enlarged.byteOffset);
  memory.writePointer(slot, heap); runtime.lastError = 99;
  expect(call("TlsGetValue", [index])).toEqual({ kind: "pointer", value: heap }); expect(runtime.lastError).toBe(0);
  expect(call("TlsFree", [index])).toEqual({ kind: "int32", value: 1 });
  expect(call("TlsGetValue", [index])).toEqual({ kind: "pointer", value: null }); expect(runtime.lastError).toBe(87);
  const path = memory.allocate({ byteLength: 16 }); memory.write(path, new TextEncoder().encode("save.sav\0"));
  const handle = resultPointer(call("CreateFileA", [p(path), u(0xc0000000), u(0), p(null), u(3), u(0), p(null)]));
  const buffer = memory.allocate({ byteLength: 8 }), transferred = memory.allocate({ byteLength: 4 });
  expect(call("ReadFile", [p(handle), p(buffer), u(2), p(transferred), p(null)])).toEqual({ kind: "int32", value: 1 });
  expect(memory.copy(buffer, 2)).toEqual(new Uint8Array([10, 20])); expect(memory.readUint32(transferred)).toBe(2);
  expect(call("SetFilePointer", [p(handle), s(1), p(null), u(0)])).toEqual({ kind: "uint32", value: 1 });
  memory.write(buffer, new Uint8Array([99, 88])); call("WriteFile", [p(handle), p(buffer), u(2), p(transferred), p(null)]);
  expect(fileBytes).toEqual(new Uint8Array([10, 99, 88])); call("CloseHandle", [p(handle)]); expect(closed).toBe(true);
  expect(call("HeapDestroy", [p(heap)])).toEqual({ kind: "int32", value: 1 }); expect(() => memory.readUint8(enlarged)).toThrow();
});

test("CRT memory and floating services preserve overlap, sign and adjacent binary32 values", () => {
  const memory = new SparseGuestMemory({ module, pointerBytes: 8 }), callbacks = new GuestCallbackTable(memory);
  const runtime = new WindowsGuestRuntime({ memory, callbacks, capabilities: { nowMilliseconds: () => 1700000000123 } });
  const context: GuestCallContext = { module, callback: { kind: "typescript", provider: "test:windows-services", callback: "test:entry" }, self: null, other: null, parent: null };
  const call = (name: string, args: readonly GuestCallValue[]): GuestCallResult => {
    const address = runtime.resolveAddress("ucrtbase.dll", name); if (address === null) throw new Error(`Missing CRT ${name}`); return callbacks.invoke(address, context, args);
  };
  const buffer = memory.allocate({ byteLength: 32 }); memory.write(buffer, new Uint8Array([1, 2, 3, 4, 5, 6]));
  call("memmove", [p(memory.offset(buffer, 1n)), p(buffer), { kind: "uint64", value: 5n }]);
  expect(memory.copy(buffer, 6)).toEqual(new Uint8Array([1, 1, 2, 3, 4, 5]));
  expect(call("nextafterf", [{ kind: "float32", value: 1 }, { kind: "float32", value: 2 }])).toEqual({ kind: "float32", value: 1 + 2 ** -23 });
  const down = call("nextafterf", [{ kind: "float32", value: 0 }, { kind: "float32", value: -1 }]); expect(down).toEqual({ kind: "float32", value: -(2 ** -149) });
  const fraction = call("modf", [{ kind: "float64", value: -2 }, p(buffer)]);
  expect(fraction.kind === "float64" && Object.is(fraction.value, -0)).toBe(true); expect(memory.readFloat64(buffer)).toBe(-2);
  expect(call("_dsign", [{ kind: "float64", value: -0 }])).toEqual({ kind: "int32", value: -32768 });
  const ticks = runtime.resolveAddress("msvcp140.dll", "_Xtime_get_ticks"); if (ticks === null) throw new Error("MSVC clock binding missing");
  expect(callbacks.invoke(ticks, context, [])).toEqual({ kind: "int64", value: 17000000001230000n });
  const text = memory.allocate({ byteLength: 32 }), end = memory.allocate({ byteLength: 8 }); memory.write(text, new TextEncoder().encode("-0x10!\0"));
  expect(call("strtoul", [p(text), p(end), s(0)])).toEqual({ kind: "uint32", value: 0xfffffff0 }); expect(memory.readPointer(end)?.byteOffset).toBe(text.byteOffset + 5n);
  memory.write(text, new TextEncoder().encode("4294967296x\0")); expect(call("strtoul", [p(text), p(end), s(10)])).toEqual({ kind: "uint32", value: 0xffffffff });
  expect(memory.readInt32(resultPointer(call("_errno", [])))).toBe(34);
  let comparisons = 0;
  runtime.service("ucrtbase.dll", "test-sort-compare", ["pointer", "pointer"], "int32", (_context, args) => {
    const left = args[0], right = args[1]; if (left?.kind !== "pointer" || right?.kind !== "pointer" || left.value === null || right.value === null) throw new Error("Comparator pointers missing");
    comparisons++; return { kind: "int32", value: memory.readInt32(left.value) - memory.readInt32(right.value) };
  });
  const comparator = runtime.resolveAddress("ucrtbase.dll", "test-sort-compare"); if (comparator === null) throw new Error("Comparator binding missing");
  const stack = memory.allocate({ byteLength: 4096 }), returnAddress = memory.allocate({ byteLength: 16, permissions: "read-execute" });
  const state = createGuestProcessorState({ architecture: "x86-64", instructionPointer: returnAddress.byteOffset, stackPointer: stack.byteOffset + 4096n, flags: 2n, x87ControlWord: 0x37f, mxcsr: 0x1f80, mxcsrMask: 0xffff });
  const cpu = new X64Cpu({ memory, state, isHostCall: address => callbacks.resolve(address) !== null }); runtime.attachRunner(new GuestCallRunner({ cpu, callbacks, returnAddress }));
  [9, -3, 9, 0, 2].forEach((value, index) => memory.writeInt32(memory.offset(buffer, BigInt(index * 4)), value));
  call("qsort", [p(buffer), { kind: "uint64", value: 5n }, { kind: "uint64", value: 4n }, p(comparator)]);
  expect(Array.from({ length: 5 }, (_, index) => memory.readInt32(memory.offset(buffer, BigInt(index * 4))))).toEqual([-3, 0, 2, 9, 9]); expect(comparisons).toBeGreaterThan(0);
});

test("unimplemented imports retain an explicit reached failure rather than returning success", () => {
  const memory = new SparseGuestMemory({ module, pointerBytes: 4 }), callbacks = new GuestCallbackTable(memory);
  const runtime = new WindowsGuestRuntime({ memory, callbacks }), image = mapPeImage({ bytes: peFixture(4), memory });
  const import_ = { library: "unavailable.dll", symbol: { kind: "name", name: "Missing", version: null }, slot: image.base, weak: false } satisfies Parameters<WindowsGuestRuntime["resolve"]>[0];
  const resolution = runtime.resolve(import_, image); if (resolution.kind !== "host") throw new Error("Expected explicit unsupported host trap");
  const context: GuestCallContext = { module, callback: { kind: "typescript", provider: "test:windows-services", callback: "test:entry" }, self: null, other: null, parent: null };
  expect(() => callbacks.invoke(resolution.address, context, [])).toThrow(UnsupportedWindowsImport);
  expect(runtime.coverage.find(entry => entry.name === "Missing")).toMatchObject({ supported: false, reached: 1, failed: 1 });
});
