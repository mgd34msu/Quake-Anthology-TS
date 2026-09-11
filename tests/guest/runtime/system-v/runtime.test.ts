// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { createContentDigest } from "../../../../src/contracts/content.ts";
import type { GuestAddress, GuestCallContext, GuestCallValue, ModuleIdentity } from "../../../../src/contracts/execution.ts";
import { GuestCallRunner } from "../../../../src/guest/abi/index.ts";
import { createGuestProcessorState, GuestCallbackTable, SparseGuestMemory } from "../../../../src/guest/core/index.ts";
import { I386Cpu } from "../../../../src/guest/x86/index.ts";
import { X64Cpu } from "../../../../src/guest/x64/index.ts";
import { SystemVGuestRuntime } from "../../../../src/guest/runtime/system-v/index.ts";
import type { SystemVCapabilities } from "../../../../src/guest/runtime/system-v/index.ts";
import { archivePath, quakeLiveFixture } from "./fixtures.ts";
import { lifecycleElf } from "./lifecycle-fixture.ts";

const authoredModule: ModuleIdentity = { id: "test:system-v", artifactPath: "authored-runtime-code", revision: "1", digest: createContentDigest("37".repeat(32)) };
function setup(width: 4 | 8, module = authoredModule, capabilities: SystemVCapabilities = {}) {
  const memory = new SparseGuestMemory({ module, pointerBytes: width, allocationBase: 0x50000000n });
  memory.map({ base: 0x10000n, byteLength: 65536, permissions: "read-write" });
  const sentinel = memory.map({ base: 0x30000n, byteLength: 4096, permissions: "read-execute", bytes: new Uint8Array([0xcc]) });
  const callbacks = new GuestCallbackTable(memory), runtime = new SystemVGuestRuntime({ memory, callbacks, capabilities: { nowSeconds: () => 123456n, ...capabilities } });
  const state = createGuestProcessorState({ architecture: width === 4 ? "i386" : "x86-64", instructionPointer: sentinel.byteOffset, stackPointer: 0x20000n,
    flags: 2n, x87ControlWord: 0x37f, mxcsr: 0x1f80, mxcsrMask: 0xffff });
  const isHostCall = (address: GuestAddress): boolean => callbacks.resolve(address) !== null;
  const cpu = width === 4 ? new I386Cpu({ state, memory, hostCall: isHostCall }) : new X64Cpu({ state, memory, isHostCall });
  const runner = new GuestCallRunner({ cpu, callbacks, returnAddress: sentinel }); runtime.attachRunner(runner);
  const abi = runtime.signature([], "void").abi;
  const context: GuestCallContext = { module, callback: { kind: "native-guest", module, address: sentinel, abi }, parent: null, self: null, other: null };
  const call = (library: string, name: string, version: string | null, args: readonly GuestCallValue[]) => {
    const address = runtime.resolveAddress(library, name, version);
    if (address === null) throw new Error(`Missing fixture service ${name}`);
    const callback = callbacks.resolve(address);
    if (callback === null) throw new Error("Not a callable service");
    return runner.invoke({ target: address, signature: callback.signature, arguments: args, context, instructionBudget: 1000 });
  };
  return { memory, callbacks, runtime, cpu, runner, context, call };
}

for (const width of [4, 8] satisfies readonly (4 | 8)[]) test(`GLIBCXX ${width * 8}: real stream objects share FILE bytes, virtual operations and final flushing`, () => {
  const output: { stream: string; text: string }[] = [], flushes: string[] = [];
  let input = new Uint8Array([104, 105]);
  const { memory, callbacks, runtime, context, runner, call } = setup(width, authoredModule, {
    standardInput: () => { const value = input; input = new Uint8Array(); return value; },
    standardOutput: (stream, bytes) => { output.push({ stream, text: new TextDecoder().decode(bytes) }); return bytes.length; },
    standardFlush: stream => { flushes.push(stream); return 0; },
  });
  const object = runtime.allocate(1), argument: GuestCallValue = { kind: "pointer", value: object };
  call("libstdc++.so.6", "_ZNSt8ios_base4InitC1Ev", "GLIBCXX_3.4", [argument]);
  expect(memory.readInt32(runtime.iostreams.refcount)).toBe(2);
  const stream = (name: string) => {
    const value = runtime.iostreams.streams.find(stream => stream.name === name);
    if (value === undefined) throw new Error(`Missing ${name}`); return value;
  };
  const cout = stream("cout"), cin = stream("cin"), cerr = stream("cerr"), clog = stream("clog"), wcerr = stream("wcerr");
  // GCC 4.8 ios_base and basic_ios declarations under the i386/x64 System V layouts.
  const tie = width === 4 ? 112 : 216, flags = width === 4 ? 12 : 24, bufferOffset = width === 4 ? 120 : 232;
  expect(memory.readPointer(memory.offset(cin.ios, BigInt(tie)))).toEqual(cout.address);
  expect(memory.readPointer(memory.offset(cerr.ios, BigInt(tie)))).toEqual(cout.address);
  expect(memory.readUint32(memory.offset(cerr.ios, BigInt(flags)))).toBe(0x3002);
  expect(memory.readUint32(memory.offset(cout.ios, BigInt(flags)))).toBe(0x1002);
  expect(memory.readPointer(memory.offset(cerr.ios, BigInt(bufferOffset)))).toEqual(memory.readPointer(memory.offset(clog.ios, BigInt(bufferOffset))));
  const locale = runtime.iostreams.locale; if (locale === null) throw new Error("Missing C locale");
  expect(memory.readInt32(locale.implementation)).toBe(16);
  const invokeVirtual = (object: GuestAddress, slot: number, args: readonly GuestCallValue[]) => {
    const table = memory.readPointer(object); if (table === null) throw new Error("Missing vtable");
    const target = memory.readPointer(memory.offset(table, BigInt(slot * width))); if (target === null) throw new Error("Missing virtual method");
    const callback = callbacks.resolve(target); if (callback === null) throw new Error("Virtual method is not a guest callback");
    return runner.invoke({ target, signature: callback.signature, arguments: [{ kind: "pointer", value: object }, ...args], context, instructionBudget: 1000 });
  };
  const vcall = (name: string, slot: number, args: readonly GuestCallValue[]) => {
    const object = stream(name), offset = width === 4 ? object.wide ? 124 : 120 : 232;
    const buffer = memory.readPointer(memory.offset(object.ios, BigInt(offset)));
    if (buffer === null) throw new Error("Missing stream buffer");
    return invokeVirtual(buffer, slot, args);
  };
  const upper = memory.readPointer(memory.offset(locale.ctype[0], BigInt(4 * width)));
  if (upper === null) throw new Error("Missing ctype uppercase table");
  expect(invokeVirtual(locale.ctype[0], 2, [{ kind: "int32", value: 97 }])).toEqual({ kind: "int32", value: 65 });
  memory.writeInt32(memory.offset(upper, 97n * 4n), 90);
  expect(invokeVirtual(locale.ctype[0], 2, [{ kind: "int32", value: 97 }])).toEqual({ kind: "int32", value: 90 });
  memory.writeInt32(memory.offset(upper, 97n * 4n), 65);
  expect(invokeVirtual(locale.ctype[1], 2, [{ kind: "uint32", value: 0x2000 }, { kind: "uint32", value: 32 }])).toEqual({ kind: "int32", value: 1 });
  expect(invokeVirtual(locale.ctype[1], 2, [{ kind: "uint32", value: 0x2000 }, { kind: "uint32", value: 65 }])).toEqual({ kind: "int32", value: 0 });
  const widenA = memory.offset(locale.ctype[1], BigInt((width === 4 ? 144 : 156) + 65 * 4));
  memory.writeUint32(widenA, 66);
  expect(invokeVirtual(locale.ctype[1], 10, [{ kind: "int32", value: 65 }])).toEqual({ kind: "uint32", value: 66 });
  memory.writeUint32(widenA, 65);
  const bytes = runtime.allocate(2); memory.write(bytes, new Uint8Array([65, 66]));
  const count: GuestCallValue = width === 4 ? { kind: "int32", value: 2 } : { kind: "int64", value: 2n };
  vcall("cout", 12, [{ kind: "pointer", value: bytes }, count]);
  expect(output).toEqual([]);
  call("libc.so.6", "fputc", null, [{ kind: "int32", value: 67 }, { kind: "pointer", value: runtime.iostreams.stdio.stdout }]);
  call("libstdc++.so.6", "_ZNSo5flushEv", "GLIBCXX_3.4", [{ kind: "pointer", value: cout.address }]);
  expect(output).toEqual([{ stream: "stdout", text: "ABC" }]);
  expect(vcall("cin", 9, [])).toEqual({ kind: "int32", value: 104 });
  expect(vcall("cin", 10, [])).toEqual({ kind: "int32", value: 104 });
  expect(vcall("cin", 10, [])).toEqual({ kind: "int32", value: 105 });
  expect(vcall("cin", 11, [{ kind: "int32", value: -1 }])).toEqual({ kind: "int32", value: 105 });
  expect(vcall("cin", 10, [])).toEqual({ kind: "int32", value: 105 });
  expect(vcall("wcerr", 13, [{ kind: "uint32", value: 90 }])).toEqual({ kind: "uint32", value: 90 });
  expect(output[1]).toEqual({ stream: "stderr", text: "Z" });
  const preserved = memory.readPointer(wcerr.address);
  call("libstdc++.so.6", "_ZNSt8ios_base4InitC1Ev", "GLIBCXX_3.4", [argument]);
  expect(memory.readPointer(wcerr.address)).toEqual(preserved);
  expect(memory.readInt32(locale.implementation)).toBe(16);
  const before = flushes.length;
  call("libstdc++.so.6", "_ZNSt8ios_base4InitD1Ev", "GLIBCXX_3.4", [argument]);
  expect(flushes).toHaveLength(before);
  call("libstdc++.so.6", "_ZNSt8ios_base4InitD1Ev", "GLIBCXX_3.4", [argument]);
  expect(flushes.slice(before)).toEqual(["stdout", "stdout", "stderr", "stderr", "stderr", "stdout", "stdout", "stderr", "stderr", "stderr"]);
  expect(memory.readInt32(runtime.iostreams.refcount)).toBe(1);
});

for (const width of [4, 8] satisfies readonly (4 | 8)[]) test(`ELF${width * 8} lifecycle executes ordered callbacks and installs real static TLS bytes`, () => {
  const { memory, runtime, context, call, cpu } = setup(width), counter = runtime.allocate(4);
  runtime.service("fixture.so", "record", [null], ["pointer", "int32"], "void", (_context, args) => {
    const address = args[0], digit = args[1];
    if (address?.kind !== "pointer" || address.value === null || digit?.kind !== "int32") throw new TypeError("Incorrect lifecycle callback arguments");
    memory.writeInt32(address.value, memory.readInt32(address.value) * 10 + digit.value);
    return { kind: "void" };
  });
  const callback = runtime.resolveAddress("fixture.so", "record", null);
  if (callback === null) throw new Error("Fixture callback not bound");
  const bias = 0x10000000n, image = runtime.load({ bytes: lifecycleElf(width, bias, callback, counter), module: authoredModule, loadBias: bias });
  const mismatch = runtime.resolve({ library: "libc.so.6", symbol: { kind: "name", name: "malloc", version: "GLIBC_UNIMPLEMENTED" }, slot: counter, weak: false }, image);
  expect(mismatch.kind).toBe("host");
  expect(() => call("libc.so.6", "malloc", "GLIBC_UNIMPLEMENTED", [])).toThrow("exact symbol version");
  const tls = runtime.tlsAddress(1n, 0n);
  expect(memory.readUint32(tls)).toBe(77);
  expect(tls.byteOffset % 32n).toBe(0n);
  expect(memory.copy(memory.offset(tls, 4n), 28)).toEqual(new Uint8Array(28));
  expect(width === 4 ? cpu.state.segments.gs.base : cpu.state.segments.fs.base).toBe(runtime.threadPointer.byteOffset);
  if (width === 8) {
    const index = runtime.allocate(16); memory.writeUint64(index, 1n); memory.writeUint64(memory.offset(index, 8n), 4n);
    expect(call("ld-linux-x86-64.so.2", "__tls_get_addr", "GLIBC_2.3", [{ kind: "pointer", value: index }])).toEqual({ kind: "pointer", value: memory.offset(tls, 4n) });
  }
  runtime.initialize(image, { context, instructionBudget: 1000 });
  expect(memory.readInt32(counter)).toBe(123);
  runtime.initialize(image, { context, instructionBudget: 1000 });
  expect(memory.readInt32(counter)).toBe(123);
  runtime.finalize(image, { context, instructionBudget: 1000 });
  expect(memory.readInt32(counter)).toBe(123546);
  runtime.finalize(image, { context, instructionBudget: 1000 });
  expect(runtime.lifecycleTrace.map(entry => entry.target.byteOffset - bias)).toEqual([0x800n, 0x880n, 0x900n, 0xa80n, 0xa00n, 0x980n]);
});

test("__cxa_finalize invokes guest destructors once, in reverse registration order, scoped by DSO", () => {
  const { memory, runtime, context, call } = setup(8), counter = runtime.allocate(4), otherDso = runtime.allocate(1);
  runtime.service("fixture.so", "destructor", [null], ["pointer"], "void", (_context, args) => {
    const value = args[0];
    if (value?.kind !== "pointer" || value.value === null) throw new Error("Destructor argument missing");
    memory.writeInt32(counter, memory.readInt32(counter) * 10 + memory.readInt32(value.value));
    return { kind: "void" };
  });
  const target = runtime.resolveAddress("fixture.so", "destructor", null);
  if (target === null) throw new Error("Destructor callback missing");
  for (const digit of [1, 2, 3]) {
    const argument = runtime.allocate(4); memory.writeInt32(argument, digit);
    call("libc.so.6", "__cxa_atexit", null, [{ kind: "pointer", value: target }, { kind: "pointer", value: argument }, { kind: "pointer", value: digit === 2 ? otherDso : counter }]);
  }
  call("libc.so.6", "__cxa_finalize", null, [{ kind: "pointer", value: counter }]);
  expect(memory.readInt32(counter)).toBe(31);
  runtime.finalizeDestructors(context, null);
  expect(memory.readInt32(counter)).toBe(312);
  runtime.finalizeDestructors(context, null);
  expect(memory.readInt32(counter)).toBe(312);
});

for (const width of [4, 8] satisfies readonly (4 | 8)[]) test(`System V ${width * 8}: heap, checked copying, guard state and nested qsort comparator use guest bytes`, () => {
  const { memory, runtime, call } = setup(width);
  const size = (value: number): GuestCallValue => width === 4 ? { kind: "uint32", value } : { kind: "uint64", value: BigInt(value) };
  const result = call("libc.so.6", "malloc", null, [size(16)]);
  if (result.kind !== "pointer" || result.value === null) throw new Error("malloc returned no guest allocation");
  const allocation = result.value;
  memory.write(allocation, new Uint8Array([7, 0, 0, 0, 2, 0, 0, 0, 9, 0, 0, 0, 1, 0, 0, 0]));
  const code = width === 8 ? new Uint8Array([0x8b, 0x07, 0x2b, 0x06, 0xc3]) : new Uint8Array([0x8b, 0x44, 0x24, 4, 0x8b, 0x00, 0x8b, 0x54, 0x24, 8, 0x2b, 0x02, 0xc3]);
  const comparator = memory.map({ base: 0x40000n, byteLength: 4096, permissions: "read-execute", bytes: code });
  call("libc.so.6", "qsort", null, [{ kind: "pointer", value: allocation }, size(4), size(4), { kind: "pointer", value: comparator }]);
  expect([0n, 4n, 8n, 12n].map(offset => memory.readInt32(memory.offset(allocation, offset)))).toEqual([1, 2, 7, 9]);
  expect(runtime.coverage.find(entry => entry.name === "qsort" && entry.version === null)?.reached).toBe(1);
  expect(() => call("libc.so.6", "__memcpy_chk", null, [{ kind: "pointer", value: allocation }, { kind: "pointer", value: allocation }, size(16), size(8)])).toThrow("buffer overflow");
  const guard = runtime.allocate(8);
  expect(call("libstdc++.so.6", "__cxa_guard_acquire", null, [{ kind: "pointer", value: guard }])).toEqual({ kind: "int32", value: 1 });
  expect(() => call("libstdc++.so.6", "__cxa_guard_acquire", null, [{ kind: "pointer", value: guard }])).toThrow("recursive local static");
  call("libstdc++.so.6", "__cxa_guard_release", null, [{ kind: "pointer", value: guard }]);
  expect(memory.readUint8(guard)).toBe(1);
  expect(call("libstdc++.so.6", "__cxa_guard_acquire", null, [{ kind: "pointer", value: guard }])).toEqual({ kind: "int32", value: 0 });
  call("libc.so.6", "free", null, [{ kind: "pointer", value: allocation }]);
  expect(() => memory.copy(allocation, 1)).toThrow();
});

for (const name of ["qagamei386.so", "qagamex64.so"] satisfies readonly ("qagamei386.so" | "qagamex64.so")[]) test.skipIf(!existsSync(archivePath))(`real ${name} completes all ELF initializers and finalizers`, async () => {
  const fixture = await quakeLiveFixture(name), width = fixture.elf.abi.pointerBytes;
  const { runtime, memory, context, cpu } = setup(width, fixture.module);
  const loadBias = width === 4 ? 0x10000000n : 0x100000000n;
  const image = runtime.load({ bytes: fixture.bytes, module: fixture.module, loadBias });
  expect(image.imports).toHaveLength(105);
  expect(runtime.uniqueSymbols.get("_ZNSs4_Rep20_S_empty_rep_storageE")).toEqual(runtime.emptyStringRepresentation);
  expect(image.initializers).toHaveLength(7);
  const weak = image.imports.filter(entry => entry.symbol.kind === "name" && entry.symbol.name === "__gmon_start__");
  expect(weak.length).toBeGreaterThan(0);
  expect(weak.every(entry => memory.readPointer(entry.slot) === null)).toBe(true);
  const first = image.initializers[0];
  if (first === undefined) throw new Error("Missing real ELF initializer");
  runtime.initialize(image, { context, instructionBudget: 20000 });
  expect(runtime.lifecycleTrace.map(entry => entry.target)).toEqual([...image.initializers]);
  expect(runtime.coverage.find(entry => entry.name === "_ZNSt8ios_base4InitC1Ev" && entry.version === "GLIBCXX_3.4")?.reached).toBe(4);
  expect(memory.readInt32(runtime.iostreams.refcount)).toBe(5);
  expect(cpu.state.instructionPointer).not.toBe(first.byteOffset);
  expect(runtime.coverage.some(entry => entry.support === "unsupported-data")).toBe(true);
  runtime.finalize(image, { context, instructionBudget: 20000 });
  expect(runtime.lifecycleTrace.filter(entry => entry.phase === "finalize").map(entry => entry.target)).toEqual([...image.finalizers]);
  expect(memory.readInt32(runtime.iostreams.refcount)).toBe(1);
  expect(runtime.coverage.filter(entry => entry.reached > 0).every(entry => entry.support === "implemented")).toBe(true);
});
