// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createContentDigest } from "../../../src/contracts/content.ts";
import type { GuestAddress, ModuleIdentity } from "../../../src/contracts/execution.ts";
import { createGuestProcessorState, GuestCallbackTable, SparseGuestMemory } from "../../../src/guest/core/index.ts";
import { mapPeImage, resolvePeExport } from "../../../src/guest/pe/index.ts";
import { X64Cpu } from "../../../src/guest/x64/index.ts";
import { canonicalAddress, X64ProcessorFault, X64DecodeCursor } from "../../../src/guest/x64/decoder.ts";

const module: ModuleIdentity = { id: "test:x64", artifactPath: "authored-x64-bytes", revision: "1", digest: createContentDigest("34".repeat(32)) };
const base = 0x10000n;
const stack = 0x30000n;
const returned = 0x40000n;
test("CPUID exposes the interpreted baseline without host AVX or random capabilities", () => {
  const baseline = fixture([0xb8, 1, 0, 0, 0, 0x0f, 0xa2, 0xc3]);
  baseline.state.flags.value = 0x8d7n;
  expect(baseline.run().kind).toBe("return");
  expect(baseline.state.registers.read("rdx", 64)).toBe(0x06008101n);
  expect(baseline.state.registers.read("rcx", 64)).toBe(0n);
  expect(baseline.state.flags.value).toBe(0x8d7n);
  const structured = fixture([0xb8, 7, 0, 0, 0, 0x0f, 0xa2, 0xc3]);
  expect(structured.run().kind).toBe("return");
  expect(structured.state.registers.read("rbx", 64)).toBe(0n);
  const locked = fixture([0xf0, 0x0f, 0xa2]);
  const stopped = locked.run();
  expect(stopped.kind).toBe("exception");
  if (stopped.kind === "exception" && stopped.exception.kind === "processor") expect(stopped.exception.vector).toBe(6);
});
function pointer(memory: SparseGuestMemory, value: bigint): GuestAddress {
  const address = memory.pointer(value);
  if (address === null) throw new Error("Nonnull fixture address required");
  return address;
}
function fixture(bytes: readonly number[], start = base) {
  const memory = new SparseGuestMemory({ module, pointerBytes: 8 });
  memory.map({ base: start, byteLength: bytes.length, permissions: "read-execute", bytes: new Uint8Array(bytes) });
  memory.map({ base: stack - 0x1000n, byteLength: 0x1008, permissions: "read-write" });
  memory.writeUint64(pointer(memory, stack), returned);
  const state = createGuestProcessorState({ architecture: "x86-64", instructionPointer: start, stackPointer: stack, flags: 2n, x87ControlWord: 0x37f, mxcsr: 0x1f80, mxcsrMask: 0xffff });
  const cpu = new X64Cpu({ state, memory });
  const run = (instructionBudget = 100) => cpu.run({ instructionBudget, returnAddress: pointer(memory, returned) });
  return { memory, state, cpu, run };
}

test("decoded instructions observe live operands, writable aliases and mapping retirement", () => {
  const f = fixture([0x8b, 0x43, 4, 0x83, 0xc0, 1, 0xc3]);
  const data = f.memory.map({ base: 0x50000n, byteLength: 16, permissions: "read-write" });
  f.memory.writeUint32(f.memory.offset(data, 4n), 10);
  f.memory.writeUint32(f.memory.offset(data, 8n), 20);
  const run = (offset: bigint) => {
    f.state.instructionPointer = base;
    f.state.registers.write("rsp", 64, stack);
    f.state.registers.write("rbx", 64, data.byteOffset + offset);
    expect(f.run().kind).toBe("return");
    return f.state.registers.read("rax", 32);
  };
  expect(run(0n)).toBe(11n); expect(run(4n)).toBe(21n);
  const code = pointer(f.memory, base);
  const alias = f.memory.mapAlias({ base: 0x60000n, byteLength: 7, permissions: "read-write", source: code });
  // Borrowed host writes bypass store observers; instruction bytes must still be checked.
  f.memory.borrow(alias, 7).setUint8(5, 7);
  expect(run(0n)).toBe(17n);
  f.memory.protect(code, 7, "read"); f.state.instructionPointer = base;
  expect(f.run().kind).toBe("exception");
  f.memory.unmap(code, 7);
  f.memory.map({ base, byteLength: 6, permissions: "execute", bytes: new Uint8Array([0xb8, 99, 0, 0, 0, 0xc3]) });
  expect(run(0n)).toBe(99n);
});

test("immediate decoding retains unsigned widths and exact partial fault bytes", () => {
  for (const width of [1, 2, 4, 8]) {
    const { memory, state } = fixture([0x90, ...new Array<number>(width).fill(255)]);
    const cursor = new X64DecodeCursor(memory, state);
    expect(cursor.readUnsigned(width)).toBe((1n << BigInt(width * 8)) - 1n);
    expect(cursor.nextIP).toBe(base + BigInt(width + 1));
    expect(cursor.bytes).toEqual([0x90, ...new Array<number>(width).fill(255)]);
  }
  const signed = fixture([0x90, 0xff, 0xff, 0xff, 0xff]);
  expect(new X64DecodeCursor(signed.memory, signed.state).readSigned(4)).toBe(-1n);
  const truncated = fixture([0x90, 0x12, 0x34]), partial = new X64DecodeCursor(truncated.memory, truncated.state);
  expect(() => partial.readUnsigned(4)).toThrow(); expect(partial.bytes).toEqual([0x90, 0x12, 0x34]);
  const long = fixture([0x90, ...new Array<number>(15).fill(255)]), limited = new X64DecodeCursor(long.memory, long.state);
  limited.readUnsigned(8); limited.readUnsigned(4);
  expect(() => limited.readUnsigned(4)).toThrow("15 bytes"); expect(limited.bytes.length).toBe(15);
});

test("MOV widths preserve byte/word aliases and zero-extend dword writes", () => {
  const { state, run } = fixture([0x48, 0xb8, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xb4, 0x12, 0x66, 0xb8, 0x34, 0x56, 0xc3]);
  expect(run().kind).toBe("return");
  expect(state.registers.read("rax", 64)).toBe(0xffffffffffff5634n);
  const dword = fixture([0xb8, 0xef, 0xcd, 0xab, 0x89, 0xc3]);
  dword.state.registers.write("rax", 64, 0xffffffffffffffffn);
  expect(dword.run().kind).toBe("return");
  expect(dword.state.registers.read("rax", 64)).toBe(0x89abcdefn);
});

test("REX byte aliases and legacy-prefix order select SPL versus AH", () => {
  const rex = fixture([0x40, 0xb4, 0x80]);
  expect(rex.run(1).kind).toBe("budget");
  expect(rex.state.registers.read("rsp", 64)).toBe(0x30080n);
  const overridden = fixture([0x40, 0x66, 0xb4, 0x12, 0xc3]);
  expect(overridden.run().kind).toBe("return");
  expect(overridden.state.registers.read("rax", 64)).toBe(0x1200n);
});

test("extended registers and SIB addresses retain values beyond Number precision", () => {
  const { memory, state, run } = fixture([0x4f, 0x89, 0x4c, 0xa5, 0xf8, 0x4f, 0x8b, 0x54, 0xa5, 0xf8, 0xc3]);
  const address = 0xffff800000010000n;
  memory.map({ base: address, byteLength: 64, permissions: "read-write" });
  state.registers.write("r13", 64, address);
  state.registers.write("r12", 64, 4n);
  state.registers.write("r9", 64, 0xfedcba9876543210n);
  expect(run().kind).toBe("return");
  expect(memory.readUint64(pointer(memory, address + 8n))).toBe(0xfedcba9876543210n);
  expect(state.registers.read("r10", 64)).toBe(0xfedcba9876543210n);
});

test("RIP-relative store includes its trailing immediate and address override truncates EIP", () => {
  const store = fixture([0xc7, 0x05, 0xf6, 0xff, 0x00, 0x00, 0x78, 0x56, 0x34, 0x12, 0xc3]);
  store.memory.map({ base: 0x20000n, byteLength: 4, permissions: "read-write" });
  expect(store.run().kind).toBe("return");
  expect(store.memory.readUint32(pointer(store.memory, 0x20000n))).toBe(0x12345678);
  const lowEip = fixture([0x67, 0x8b, 0x05, 0xf9, 0xff, 0x00, 0x00, 0xc3], 0x100010000n);
  lowEip.memory.map({ base: 0x20000n, byteLength: 4, permissions: "read-write", bytes: new Uint8Array([42, 0, 0, 0]) });
  expect(lowEip.run().kind).toBe("return");
  expect(lowEip.state.registers.read("rax", 64)).toBe(42n);
});

test("SIB no-base and FS addressing follow long-mode rules; LEA excludes FS", () => {
  const { memory, state, run } = fixture([0x64, 0x48, 0x8b, 0x04, 0x25, 0x08, 0, 0, 0, 0x64, 0x48, 0x8d, 0x0c, 0x25, 0x08, 0, 0, 0, 0xc3]);
  memory.map({ base: 0x50000n, byteLength: 32, permissions: "read-write" });
  state.segments.fs.base = 0x50000n;
  memory.writeUint64(pointer(memory, 0x50008n), 0x123456789abcdef0n);
  expect(run().kind).toBe("return");
  expect(state.registers.read("rax", 64)).toBe(0x123456789abcdef0n);
  expect(state.registers.read("rcx", 64)).toBe(8n);
});

test("64-bit integer flags, carry chains and width masks are exact", () => {
  const { state, run } = fixture([0x48, 0x83, 0xc0, 1, 0x49, 0x83, 0xd0, 0, 0xc3]);
  state.registers.write("rax", 64, 0xffffffffffffffffn);
  expect(run().kind).toBe("return");
  expect(state.registers.read("rax", 64)).toBe(0n);
  expect(state.registers.read("r8", 64)).toBe(1n);
  const overflow = fixture([0x48, 0x83, 0xc0, 1, 0xc3]);
  overflow.state.registers.write("rax", 64, 0x7fffffffffffffffn);
  expect(overflow.run().kind).toBe("return");
  expect(overflow.state.flags.get("overflow")).toBe(true);
  expect(overflow.state.flags.get("carry")).toBe(false);
  expect(overflow.state.flags.get("sign")).toBe(true);
});

test("CALL/RET and backward Jcc execute a real integer loop", () => {
  const { state, run } = fixture([0xb9, 3, 0, 0, 0, 0xe8, 1, 0, 0, 0, 0xc3, 0x48, 0x83, 0xc0, 2, 0xff, 0xc9, 0x75, 0xf8, 0xc3]);
  expect(run().kind).toBe("return");
  expect(state.registers.read("rax", 64)).toBe(6n);
  expect(state.registers.read("rsp", 64)).toBe(stack + 8n);
});

test("indirect CALL stops at a host trap with its guest return address on the stack", () => {
  const { memory, state } = fixture([0xff, 0xd0, 0xc3]);
  const host = 0x60000n;
  state.registers.write("rax", 64, host);
  const cpu = new X64Cpu({ state, memory, isHostCall: address => address.byteOffset === host });
  const stopped = cpu.run({ instructionBudget: 10, returnAddress: pointer(memory, returned) });
  expect(stopped.kind).toBe("host-call");
  expect(state.instructionPointer).toBe(host);
  expect(state.registers.read("rsp", 64)).toBe(stack - 8n);
  expect(memory.readUint64(pointer(memory, stack - 8n))).toBe(base + 2n);
});

test("unsigned MUL/DIV retain a 128-bit dividend and IDIV faults without committing registers", () => {
  const multiplied = fixture([0x48, 0xf7, 0xe1, 0x48, 0xf7, 0xf1, 0xc3]);
  multiplied.state.registers.write("rax", 64, 0xffffffffffffffffn);
  multiplied.state.registers.write("rcx", 64, 2n);
  expect(multiplied.run().kind).toBe("return");
  expect(multiplied.state.registers.read("rax", 64)).toBe(0xffffffffffffffffn);
  expect(multiplied.state.registers.read("rdx", 64)).toBe(0n);
  const divided = fixture([0x48, 0xf7, 0xf9]);
  divided.state.registers.write("rax", 64, 0x8000000000000000n);
  divided.state.registers.write("rdx", 64, 0xffffffffffffffffn);
  divided.state.registers.write("rcx", 64, 0xffffffffffffffffn);
  const stopped = divided.run();
  expect(stopped.kind).toBe("exception");
  if (stopped.kind !== "exception" || stopped.exception.kind !== "processor") throw new Error("Expected divide exception");
  expect(stopped.exception.vector).toBe(0);
  expect(divided.state.instructionPointer).toBe(base);
  expect(divided.state.registers.read("rax", 64)).toBe(0x8000000000000000n);
});

test("REP MOVSB handles overlapping sequential copies and resumes its remaining budget", () => {
  const { memory, state, run } = fixture([0xf3, 0xa4, 0xc3]);
  memory.map({ base: 0x50000n, byteLength: 8, permissions: "read-write", bytes: new Uint8Array([1, 2, 3, 4, 5]) });
  state.registers.write("rsi", 64, 0x50000n);
  state.registers.write("rdi", 64, 0x50001n);
  state.registers.write("rcx", 64, 4n);
  expect(run(2).kind).toBe("budget");
  expect(state.instructionPointer).toBe(base);
  expect(state.registers.read("rcx", 64)).toBe(2n);
  expect(run().kind).toBe("return");
  expect([...memory.copy(pointer(memory, 0x50000n), 5)]).toEqual([1, 1, 1, 1, 1]);
});

test("REPE CMPSB stops on mismatch and preserves the first unconsumed positions", () => {
  const { memory, state, run } = fixture([0xf3, 0xa6, 0xc3]);
  memory.map({ base: 0x50000n, byteLength: 16, permissions: "read-write", bytes: new Uint8Array([1, 2, 3, 0, 1, 9, 3]) });
  state.registers.write("rsi", 64, 0x50000n);
  state.registers.write("rdi", 64, 0x50004n);
  state.registers.write("rcx", 64, 3n);
  expect(run().kind).toBe("return");
  expect(state.registers.read("rcx", 64)).toBe(1n);
  expect(state.registers.read("rsi", 64)).toBe(0x50002n);
  expect(state.flags.get("zero")).toBe(false);
});

test("XADD freezes a memory address before exchanging its base register", () => {
  const { memory, state, run } = fixture([0x48, 0x0f, 0xc1, 0x00, 0xc3]);
  memory.map({ base: 0x50000n, byteLength: 8, permissions: "read-write" });
  memory.writeUint64(pointer(memory, 0x50000n), 7n);
  state.registers.write("rax", 64, 0x50000n);
  expect(run().kind).toBe("return");
  expect(state.registers.read("rax", 64)).toBe(7n);
  expect(memory.readUint64(pointer(memory, 0x50000n))).toBe(0x50007n);
});

test("memory write faults roll back integer state and report exact address", () => {
  const { memory, state, run } = fixture([0x48, 0x83, 0x00, 1]);
  memory.map({ base: 0x50000n, byteLength: 8, permissions: "read", bytes: new Uint8Array([7]) });
  state.registers.write("rax", 64, 0x50000n);
  state.flags.value = 0x803n;
  const stopped = run();
  expect(stopped.kind).toBe("exception");
  if (stopped.kind !== "exception" || stopped.exception.kind !== "memory") throw new Error("Expected memory exception");
  expect(stopped.exception.address.byteOffset).toBe(0x50000n);
  expect(stopped.exception.access).toBe("write");
  expect(state.flags.value).toBe(0x803n);
  expect(state.instructionPointer).toBe(base);
  expect(memory.readUint64(pointer(memory, 0x50000n))).toBe(7n);
});

test("nested CPU runs keep independent rollback snapshots", () => {
  const { memory, state } = fixture([0xb8, 1, 0, 0, 0, 0x90]);
  const nested = base + 0x1000n;
  memory.map({ base: nested, byteLength: 11, permissions: "read-execute", bytes: new Uint8Array([0xb8, 2, 0, 0, 0, 0xbb, 3, 0, 0, 0, 0xf4]) });
  let cpu: X64Cpu | null = null, entered = false;
  cpu = new X64Cpu({ state, memory, isHostCall: address => {
    if (address.byteOffset !== base + 5n || entered) return false;
    entered = true; state.instructionPointer = nested;
    if (cpu === null) throw new Error("Missing recursive CPU");
    expect(cpu.run({ instructionBudget: 2, returnAddress: null }).kind).toBe("budget");
    expect(state.registers.read("rax", 64)).toBe(2n); expect(state.registers.read("rbx", 64)).toBe(3n);
    memory.readUint8(pointer(memory, 0x50000n));
    return false;
  } });
  const stopped = cpu.run({ instructionBudget: 2, returnAddress: null });
  expect(stopped.kind).toBe("exception"); expect(stopped.instructions).toBe(1);
  expect(state.instructionPointer).toBe(base + 5n); expect(state.registers.read("rax", 64)).toBe(1n);
  expect(state.registers.read("rbx", 64)).toBe(0n);
});

test("unsupported opcode and noncanonical access preserve exact failing RIP", () => {
  const invalid = fixture([0x0f, 0x05]);
  const stopped = invalid.run();
  expect(stopped.kind).toBe("unsupported");
  if (stopped.kind !== "unsupported") throw new Error("Expected explicit unsupported opcode");
  expect([...stopped.instruction.bytes]).toEqual([0x0f, 0x05]);
  expect(stopped.instruction.address.byteOffset).toBe(base);
  const noncanonical = fixture([0x48, 0x8b, 0x00]);
  noncanonical.state.registers.write("rax", 64, 0x0000800000000000n);
  const fault = noncanonical.run();
  expect(fault.kind).toBe("exception");
  if (fault.kind !== "exception" || fault.exception.kind !== "processor") throw new Error("Expected noncanonical-address exception");
  expect(fault.exception.vector).toBe(13);
  expect(noncanonical.state.instructionPointer).toBe(base);
});

test("WAIT dispatches shared x87 state and preserves a pending exception at its instruction", () => {
  const normal = fixture([0x9b, 0xc3]);
  expect(normal.run().kind).toBe("return");
  const pending = fixture([0x9b, 0xc3]);
  pending.state.x87.controlWord &= ~1;
  pending.state.x87.statusWord = 1;
  const stopped = pending.run();
  expect(stopped.kind).toBe("exception");
  if (stopped.kind !== "exception" || stopped.exception.kind !== "processor") throw new Error("Expected pending x87 exception");
  expect(stopped.exception.vector).toBe(16);
  expect(pending.state.instructionPointer).toBe(base);
  expect(pending.state.x87.statusWord).toBe(1);
});

const dllPath = new URL("../../../../qfiles/q2/rerelease/baseq2/game_x64.dll", import.meta.url);
test.skipIf(!await Bun.file(dllPath).exists())("actual rerelease DLL .text+0 executes its linked-list initializer", async () => {
  const bytes = new Uint8Array(await Bun.file(dllPath).arrayBuffer());
  expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe("045d49c53722d9b922caf14f168dd28a97d4c514a6e443a3140560f8668baccd");
  const memory = new SparseGuestMemory({ module, pointerBytes: 8 });
  memory.map({ base: 0x180001000n, byteLength: 0x42, permissions: "read-execute", bytes: bytes.subarray(0x400, 0x442) });
  memory.map({ base: 0x1801c0000n, byteLength: 0xb0000, permissions: "read-write" });
  memory.map({ base: stack - 0x1000n, byteLength: 0x1008, permissions: "read-write" });
  memory.writeUint64(pointer(memory, stack), returned);
  memory.writeUint64(pointer(memory, 0x18025ba18n), 0x123456789abcdef0n);
  const state = createGuestProcessorState({ architecture: "x86-64", instructionPointer: 0x180001000n, stackPointer: stack, flags: 2n, x87ControlWord: 0x37f, mxcsr: 0x1f80, mxcsrMask: 0xffff });
  const cpu = new X64Cpu({ state, memory });
  const stopped = cpu.run({ instructionBudget: 32, returnAddress: pointer(memory, returned) });
  expect(stopped.kind).toBe("return");
  expect(memory.readUint64(pointer(memory, 0x1801c93e8n))).toBe(0x123456789abcdef0n);
  expect(memory.readUint64(pointer(memory, 0x18025ba18n))).toBe(0x1801c93d0n);
  expect(state.registers.read("rax", 64)).toBe(0x1801c93d0n);
  expect(state.registers.read("rsp", 64)).toBe(stack + 8n);
});

test.skipIf(!await Bun.file(dllPath).exists())("actual relocated rerelease GetGameAPI returns its API table through integer and SSE execution", async () => {
  const bytes = new Uint8Array(await Bun.file(dllPath).arrayBuffer());
  const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  expect(digest).toBe("045d49c53722d9b922caf14f168dd28a97d4c514a6e443a3140560f8668baccd");
  const module: ModuleIdentity = { id: "q2:rerelease-guest", artifactPath: dllPath.pathname, revision: "retail-2025-10-23", digest: createContentDigest(digest) };
  const memory = new SparseGuestMemory({ module, pointerBytes: 8 });
  const imageBase = 0xffff800018000000n;
  const image = mapPeImage({ bytes, memory, base: imageBase });
  const entry = resolvePeExport(image, { kind: "name", name: "GetGameAPI", version: null }, () => null).address;
  memory.map({ base: stack - 0x1000n, byteLength: 0x1008, permissions: "read-write" });
  memory.writeUint64(pointer(memory, stack), returned);
  const imports = memory.allocate({ byteLength: 576, permissions: "read-write" });
  const expectedImports = new Uint8Array(576);
  for (let index = 0; index < expectedImports.length; index += 1) expectedImports[index] = index % 251;
  const view = new DataView(expectedImports.buffer);
  view.setUint32(0, 40, true);
  view.setFloat32(4, 0.025, true);
  view.setUint32(8, 25, true);
  memory.write(imports, expectedImports);
  const state = createGuestProcessorState({ architecture: "x86-64", instructionPointer: entry.byteOffset, stackPointer: stack, flags: 2n, x87ControlWord: 0x37f, mxcsr: 0x1f80, mxcsrMask: 0xffff });
  state.registers.write("rcx", 64, imports.byteOffset);
  const stopped = new X64Cpu({ state, memory }).run({ instructionBudget: 512, returnAddress: pointer(memory, returned) });
  expect(stopped.kind).toBe("return");
  expect(state.registers.read("rax", 64)).toBe(imageBase + 0x1ea890n);
  expect(memory.readUint32(pointer(memory, imageBase + 0x1ea890n))).toBe(2023);
  expect(memory.readUint64(pointer(memory, imageBase + 0x1ea938n))).toBe(0xe68n);
  expect(memory.readUint64(pointer(memory, imageBase + 0x1ea898n))).toBe(imageBase + 0x6a530n);
  expect(memory.readUint64(pointer(memory, imageBase + 0x1ea878n))).toBe(25n);
  expect(memory.copy(pointer(memory, imageBase + 0x1da620n), 576)).toEqual(expectedImports);
  expect(state.registers.read("rsp", 64)).toBe(stack + 8n);
});


test("canonical address range retains sign, wrap and exact fault boundaries", () => {
  const values = [0n, 1n, -1n, -(1n << 47n), -(1n << 47n) - 1n,
    (1n << 47n) - 1n, 1n << 47n, (1n << 47n) + 1n,
    0xffff7fffffffffffn, 0xffff800000000000n, 0xffff800000000001n,
    (1n << 64n) - 1n, 1n << 64n, (1n << 64n) + 1n, -(1n << 64n), -(1n << 64n) - 1n];
  for (const value of values) for (const offset of [-1n, 0n, 1n]) {
    const input = value + offset, raw = BigInt.asUintN(64, input), high = raw >> 47n;
    if (high === 0n || high === 0x1ffffn) expect(canonicalAddress(input)).toBe(raw);
    else {
      expect(() => canonicalAddress(input)).toThrow(X64ProcessorFault);
      expect(() => canonicalAddress(input)).toThrow(`Noncanonical 48-bit virtual address 0x${raw.toString(16)}`);
    }
  }
});

test("instruction sequence preserves canonical, wrap and 15-byte fetch fault order", () => {
  for (const start of [0x7fffffffffffn, 0xffffffffffffffffn, 0x1000n]) {
    const memory = new SparseGuestMemory({ module, pointerBytes: 8 });
    memory.map({ base: start, byteLength: 1, permissions: "execute", bytes: new Uint8Array([0xb8]) });
    const state = createGuestProcessorState({ architecture: "x86-64", instructionPointer: start,
      stackPointer: stack, flags: 2n, x87ControlWord: 0x37f, mxcsr: 0x1f80, mxcsrMask: 0xffff });
    const cursor = new X64DecodeCursor(memory, state);
    expect(cursor.opcode).toBe(0xb8);
    expect(cursor.bytes).toEqual([0xb8]);
    expect(() => cursor.readByte()).toThrow(start === 0x7fffffffffffn ? "Noncanonical" : start === 0xffffffffffffffffn ? "null" : "unmapped");
    expect(cursor.bytes).toEqual([0xb8]);
  }
  for (const start of [0x1000n, 0x7ffffffffff1n, 0xfffffffffffffff1n]) {
    const memory = new SparseGuestMemory({ module, pointerBytes: 8 });
    memory.map({ base: start, byteLength: 15, permissions: "execute", bytes: new Uint8Array(15).fill(0x66) });
    const state = createGuestProcessorState({ architecture: "x86-64", instructionPointer: start,
      stackPointer: stack, flags: 2n, x87ControlWord: 0x37f, mxcsr: 0x1f80, mxcsrMask: 0xffff });
    expect(() => new X64DecodeCursor(memory, state)).toThrow("Instruction exceeds 15 bytes");
  }
});


test("instruction cursors remain local when a committed store reenters the same CPU", () => {
  const f = fixture([0x66, 0xc7, 0x03, 0x34, 0x12, 0xb8, 86, 0, 0, 0, 0xc3]);
  const data = f.memory.map({ base: 0x50000n, byteLength: 2, permissions: "read-write" });
  const nested = f.memory.map({ base: 0x70000n, byteLength: 6, permissions: "execute", bytes: new Uint8Array([0xb8, 37, 0, 0, 0, 0xc3]) });
  let calls = 0;
  const release = f.memory.observeWrites(data, 2, () => {
    const ip = f.state.instructionPointer, registers = f.state.registers.checkpoint(), flags = f.state.flags.value;
    try {
      f.state.instructionPointer = nested.byteOffset;
      expect(f.run().kind).toBe("return"); expect(f.state.registers.read("rax", 32)).toBe(37n); calls++;
    } finally {
      f.state.registers.restore(registers); f.state.flags.value = flags; f.state.instructionPointer = ip;
    }
  });
  try {
    for (let iteration = 0; iteration < 2; iteration++) {
      f.state.instructionPointer = base; f.state.registers.write("rsp", 64, stack); f.state.registers.write("rbx", 64, data.byteOffset);
      expect(f.run().kind).toBe("return"); expect(f.state.registers.read("rax", 32)).toBe(86n);
      expect(f.memory.readUint16(data)).toBe(0x1234);
    }
    expect(calls).toBe(2);
  } finally { release(); }
});


test("retained semantic blocks requalify registered entries before the next instruction", () => {
  const f = fixture([0xb8, 1, 0, 0, 0, 0x83, 0xc0, 2, 0x83, 0xc0, 3, 0xc3]);
  const callbacks = new GuestCallbackTable(f.memory), cpu = new X64Cpu({ state: f.state, memory: f.memory, callbacks });
  const run = (budget = 100) => {
    f.state.instructionPointer = base; f.state.registers.write("rsp", 64, stack);
    return cpu.run({ instructionBudget: budget, returnAddress: pointer(f.memory, returned) });
  };
  for (let index = 0; index < 3; index++) { expect(run().kind).toBe("return"); expect(f.state.registers.read("rax", 32)).toBe(6n); }
  let entries = 0;
  const unobserve = callbacks.observeEntry(pointer(f.memory, base + 5n), () => { entries++; f.state.registers.write("rax", 32, 10n); });
  expect(run().kind).toBe("return"); expect(f.state.registers.read("rax", 32)).toBe(15n); expect(entries).toBe(1);
  unobserve(); expect(run().kind).toBe("return"); expect(f.state.registers.read("rax", 32)).toBe(6n); expect(entries).toBe(1);
  let accepts = false;
  const remove = callbacks.bindEntry(pointer(f.memory, base + 5n), { id: "test:plan-hook", signature: { abi: { kind: "windows-x86-64", image: "pe32+", pointerBytes: 8, call: "microsoft-x64" }, parameters: [], result: "void", variadic: false }, invoke: () => ({ kind: "void" }) }, () => accepts);
  expect(run().kind).toBe("return"); expect(f.state.registers.read("rax", 32)).toBe(6n); accepts = true;
  const stopped = run(); expect(stopped.kind).toBe("host-call"); expect(stopped.instructions).toBe(1); expect(f.state.registers.read("rax", 32)).toBe(1n);
  remove(); expect(run(2).kind).toBe("budget"); expect(f.state.registers.read("rax", 32)).toBe(3n); expect(f.state.instructionPointer).toBe(base + 8n);
  expect(cpu.run({ instructionBudget: 2, returnAddress: pointer(f.memory, returned) }).kind).toBe("return"); expect(f.state.registers.read("rax", 32)).toBe(6n);
  const redirected = f.memory.map({ base: 0x70000n, byteLength: 4, permissions: "read-execute", bytes: new Uint8Array([0x31, 0xc0, 0x90, 0xc3]) });
  const restoreEntry = callbacks.observeEntry(pointer(f.memory, base), () => { f.state.instructionPointer = redirected.byteOffset; });
  const redirectedStop = run(); expect(redirectedStop.kind).toBe("return"); expect(redirectedStop.instructions).toBe(3); expect(f.state.registers.read("rax", 32)).toBe(0n);
  restoreEntry(); expect(run().kind).toBe("return"); expect(f.state.registers.read("rax", 32)).toBe(6n);
  let returns = 0;
  const restoreReturn = callbacks.observeEntry(pointer(f.memory, base + 11n), () => { returns++; });
  expect(run().kind).toBe("return"); expect(returns).toBe(1);
  restoreReturn(); expect(run().kind).toBe("return"); expect(returns).toBe(1);
});

test("prepared raw SIMD preserves scalar lanes, overlapping registers and committed store entry changes", () => {
  const f = fixture([
    0xf3, 0x0f, 0x10, 0xc1, 0xf2, 0x0f, 0x10, 0x03,
    0x66, 0x0f, 0x28, 0xd0, 0x66, 0x0f, 0x6f, 0xda,
    0xf3, 0x0f, 0x7f, 0x5b, 17, 0x0f, 0x57, 0xdb,
    0x66, 0x0f, 0xeb, 0xd8, 0x66, 0x0f, 0xdb, 0xda,
    0x0f, 0x55, 0xd8, 0x0f, 0x29, 0x5b, 32, 0xc3,
  ]);
  const data = f.memory.map({ base: 0x50000n, byteLength: 64, permissions: "read-write" });
  const input = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  f.memory.write(data, input);
  const callbacks = new GuestCallbackTable(f.memory), cpu = new X64Cpu({ state: f.state, memory: f.memory, callbacks });
  const expected = new Uint8Array(16); expected.set(input.subarray(0, 8));
  let entries = 0, removeEntry = (): void => {};
  const removeStore = f.memory.observeWrites(f.memory.offset(data, 17n), 16, () => {
    removeEntry(); removeEntry = callbacks.observeEntry(pointer(f.memory, base + 21n), () => { entries++; });
    f.state.simd.xmm.fill(0xcc, 48, 64);
  });
  const step = (budget = 1) => cpu.run({ instructionBudget: budget, returnAddress: pointer(f.memory, returned) });
  try {
    for (let pass = 0; pass < 2; pass++) {
      f.state.instructionPointer = base; f.state.registers.write("rsp", 64, stack); f.state.registers.write("rbx", 64, data.byteOffset);
      f.state.simd.xmm.fill(0xaa, 0, 16); f.state.simd.xmm.fill(0xbb, 16, 32); f.state.flags.value = 0x8d7n; f.state.simd.mxcsr = 0x5fa0;
      expect(step().kind).toBe("budget");
      expect(f.state.simd.xmm.slice(0, 16)).toEqual(new Uint8Array([0xbb, 0xbb, 0xbb, 0xbb, ...new Array<number>(12).fill(0xaa)]));
      expect(step().kind).toBe("budget"); expect(f.state.simd.xmm.slice(0, 16)).toEqual(expected);
      expect(step(3).kind).toBe("budget"); expect(f.memory.copy(f.memory.offset(data, 17n), 16)).toEqual(expected);
      expect(step(6).kind).toBe("return"); expect(f.memory.copy(f.memory.offset(data, 32n), 16)).toEqual(new Uint8Array(16));
      expect(entries).toBe(pass + 1); expect(f.state.flags.value).toBe(0x8d7n); expect(f.state.simd.mxcsr).toBe(0x5fa0);
    }
  } finally { removeStore(); removeEntry(); }
});

test("prepared SIMD retains alignment, fault-before-write and live instruction bytes", () => {
  const f = fixture([0x0f, 0x28, 0x03, 0xc3]);
  const data = f.memory.map({ base: 0x50000n, byteLength: 32, permissions: "read-write", bytes: new Uint8Array(32).fill(0x5a) });
  const run = (offset: bigint) => {
    f.state.instructionPointer = base; f.state.registers.write("rsp", 64, stack); f.state.registers.write("rbx", 64, data.byteOffset + offset);
    return f.run();
  };
  expect(run(0n).kind).toBe("return");
  f.state.simd.xmm.fill(0xab, 0, 16);
  const misaligned = run(1n); expect(misaligned.kind).toBe("exception");
  if (misaligned.kind === "exception" && misaligned.exception.kind === "processor") expect(misaligned.exception.vector).toBe(13);
  expect(f.state.simd.xmm.slice(0, 16)).toEqual(new Uint8Array(16).fill(0xab));
  const alias = f.memory.mapAlias({ base: 0x60000n, byteLength: 4, permissions: "read-write", source: pointer(f.memory, base) });
  f.memory.borrow(alias, 4).setUint8(1, 0x10);
  expect(run(1n).kind).toBe("return"); expect(f.state.simd.xmm.slice(0, 16)).toEqual(new Uint8Array(16).fill(0x5a));
  f.state.simd.xmm.fill(0xcd, 0, 16);
  const missing = run(24n); expect(missing.kind).toBe("exception");
  expect(f.state.simd.xmm.slice(0, 16)).toEqual(new Uint8Array(16).fill(0xcd));
});

test('prepared integer kernels match source ALU flags and exact register halves', async () => {
  const { X64IntegerKernel, prepareX64IntegerPlan } = await import('../../../src/guest/x64/integer-kernel.ts');
  const { executeX64Plan, makeX64Plan } = await import('../../../src/guest/x64/plan.ts');
  const { IntegerRegisterFile } = await import('../../../src/guest/core/registers.ts');
  const operations: readonly import('../../../src/guest/x86/arithmetic.ts').AluOperation[] = ['add', 'adc', 'sub', 'sbb', 'cmp', 'and', 'test', 'or', 'xor'];
  const widths: readonly import('../../../src/guest/core/contracts.ts').GuestIntegerWidth[] = [8, 16, 32, 64];
  const source = fixture([0x90]), compiled = fixture([0x90]);
  const kernel = X64IntegerKernel.create(compiled.state, compiled.memory);
  if (kernel === null) throw new Error('Standard CPU must admit integer kernels');
  expect(X64IntegerKernel.create({ ...compiled.state, registers: new IntegerRegisterFile('i386') }, compiled.memory)).toBeNull();
  const customized = fixture([0x90]), originalRead = customized.state.registers.read.bind(customized.state.registers);
  Object.defineProperty(customized.state.registers, 'read', { value: originalRead });
  expect(X64IntegerKernel.create(customized.state, customized.memory)).toBeNull();
  for (const width of widths) {
    const sign = 1n << BigInt(width - 1), maximum = (1n << BigInt(width)) - 1n;
    const edges: readonly (readonly [bigint, bigint])[] = [[maximum, 1n], [sign - 1n, 1n], [sign, maximum], [0n, 1n], [0x1234567887654321n, 0x8765432112345678n]];
    for (const operation of operations) for (const [left, right] of edges)
      for (const initialFlags of operation === 'adc' || operation === 'sbb' ? [0x98765432abcdefd6n, 0x98765432abcdefd7n] : [0x98765432abcdefd7n]) {
      const plan = makeX64Plan({ kind: 'alu', operation,
        destination: { kind: 'register', register: 'rax', width, highByte: width === 8 },
        source: { kind: 'register', register: 'rbx', width, highByte: false } }, base + 1n, false);
      const prepared = prepareX64IntegerPlan(plan);
      if (prepared === null) throw new Error('Integer plan was not prepared');
      for (const state of [source.state, compiled.state]) {
        state.flags.value = initialFlags;
        state.registers.write('rax', 64, 0xfedcba9876543210n);
        state.registers.write('rax', width, left, width === 8);
        state.registers.write('rbx', 64, right);
      }
      executeX64Plan(plan, source.memory, source.state); kernel.execute(prepared);
      expect(compiled.state.registers.checkpoint()).toEqual(source.state.registers.checkpoint());
      expect(compiled.state.flags.value).toBe(source.state.flags.value);
    }
  }
  const addresses: readonly import('../../../src/guest/x64/decoder.ts').X64MemoryOperand[] = [
    { kind: 'memory', width: 64, base: 'rax', index: 'rbx', scale: 8n, displacement: -17n, ripRelative: false, addressBits: 64, segment: 'fs' },
    { kind: 'memory', width: 32, base: 'rax', index: 'rbx', scale: 4n, displacement: 0x80000000n, ripRelative: false, addressBits: 32, segment: null },
    { kind: 'memory', width: 64, base: null, index: null, scale: 1n, displacement: -0x100000007n, ripRelative: true, addressBits: 64, segment: null },
  ];
  for (const address of addresses) {
    const plan = makeX64Plan({ kind: 'lea', source: address,
      destination: { kind: 'register', register: 'r8', width: address.width, highByte: false } }, base + 7n, false);
    const prepared = prepareX64IntegerPlan(plan);
    if (prepared === null) throw new Error('LEA was not prepared');
    for (const state of [source.state, compiled.state]) {
      state.registers.write('rax', 64, 0xffff800012345678n); state.registers.write('rbx', 64, 0xfffffffffffedcban);
      state.segments.fs.base = 0x1234567890n;
    }
    executeX64Plan(plan, source.memory, source.state); kernel.execute(prepared);
    expect(compiled.state.registers.checkpoint()).toEqual(source.state.registers.checkpoint());
  }
  for (let code = 0; code < 16; code++) for (const flags of [0n, 0x8d5n, 0x881n, 0x44n]) {
    const plan = makeX64Plan({ kind: 'branch', condition: code, displacement: -3n }, base + 7n, false);
    const prepared = prepareX64IntegerPlan(plan);
    if (prepared === null) throw new Error('Branch was not prepared');
    source.state.flags.value = flags; compiled.state.flags.value = flags;
    expect(kernel.execute(prepared)).toEqual(executeX64Plan(plan, source.memory, source.state));
  }
});
