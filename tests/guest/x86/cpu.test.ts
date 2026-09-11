// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createContentDigest } from "../../../src/contracts/content.ts";
import type { GuestAddress, ModuleIdentity } from "../../../src/contracts/execution.ts";
import { createGuestProcessorState, SparseGuestMemory } from "../../../src/guest/core/index.ts";
import { mapPeImage } from "../../../src/guest/pe/index.ts";
import { I386Cpu, guestAddress } from "../../../src/guest/x86/index.ts";

const module: ModuleIdentity = { id: "test:i386", artifactPath: "authored-instructions", revision: "1", digest: createContentDigest("12".repeat(32)) };
function machine(code: readonly number[]) {
  const memory = new SparseGuestMemory({ module, pointerBytes: 4 });
  memory.map({ base: 0x1000n, byteLength: code.length, permissions: "read-execute", bytes: new Uint8Array(code) });
  memory.map({ base: 0x3000n, byteLength: 0x1000, permissions: "read-write" });
  memory.map({ base: 0x8000n, byteLength: 0x2000, permissions: "read-write" });
  const state = createGuestProcessorState({ architecture: "i386", instructionPointer: 0x1000n, stackPointer: 0x9000n,
    flags: 2n, x87ControlWord: 0x37f, mxcsr: 0x1f80, mxcsrMask: 0xffff });
  const returnAddress = guestAddress(memory, 0x7000n);
  memory.writeUint32(guestAddress(memory, 0x9000n), Number(returnAddress.byteOffset));
  const cpu = new I386Cpu({ state, memory });
  return { cpu, state, memory, returnAddress };
}

test("i386 aliases, operand-size override and MOVSX execute on shared registers", () => {
  const { cpu, state, returnAddress } = machine([0xb8, 0x78, 0x56, 0x34, 0x12, 0xb4, 0xab, 0x66, 0xb8, 0xef, 0xbe, 0x0f, 0xbe, 0xc8, 0xc3]);
  expect(cpu.run({ instructionBudget: 20, returnAddress }).kind).toBe("return");
  expect(state.registers.read("rax", 32)).toBe(0x1234beefn);
  expect(state.registers.read("rcx", 32)).toBe(0xffffffefn);
  expect(state.registers.read("rsp", 32)).toBe(0x9004n);
});

test("ADD overflow and INC carry preservation follow integer width", () => {
  const first = machine([0xb0, 0x7f, 0x04, 0x01]);
  expect(first.cpu.run({ instructionBudget: 2, returnAddress: null }).kind).toBe("budget");
  expect(first.state.registers.read("rax", 8)).toBe(0x80n);
  expect(first.state.flags.get("overflow")).toBe(true);
  expect(first.state.flags.get("auxiliary-carry")).toBe(true);
  expect(first.state.flags.get("sign")).toBe(true);
  expect(first.state.flags.get("carry")).toBe(false);
  expect(first.state.flags.get("parity")).toBe(false);
  const second = machine([0xf9, 0xb8, 0xff, 0xff, 0xff, 0xff, 0x40, 0xc3]);
  expect(second.cpu.run({ instructionBudget: 10, returnAddress: second.returnAddress }).kind).toBe("return");
  expect(second.state.registers.read("rax", 32)).toBe(0n);
  expect(second.state.flags.get("carry")).toBe(true);
  expect(second.state.flags.get("zero")).toBe(true);
});

test("rotate counts retain data but update carry, through-carry consumes it, and LOOP branches", () => {
  const run = machine([0xb0, 1, 0xf8, 0xc0, 0xc0, 8, 0xd0, 0xd0, 0xc3]);
  expect(run.cpu.run({ instructionBudget: 3, returnAddress: null }).kind).toBe("budget");
  expect(run.state.registers.read("rax", 8)).toBe(1n);
  expect(run.state.flags.get("carry")).toBe(true);
  expect(run.cpu.run({ instructionBudget: 10, returnAddress: run.returnAddress }).kind).toBe("return");
  expect(run.state.registers.read("rax", 8)).toBe(3n);
  expect(run.state.flags.get("carry")).toBe(false);
  const loop = machine([0xb9, 3, 0, 0, 0, 0xb8, 0, 0, 0, 0, 0x40, 0xe2, 0xfd, 0xc3]);
  expect(loop.cpu.run({ instructionBudget: 20, returnAddress: loop.returnAddress }).kind).toBe("return");
  expect(loop.state.registers.read("rax", 32)).toBe(3n);
  expect(loop.state.registers.read("rcx", 32)).toBe(0n);
  const sar = machine([0x66, 0xb8, 0, 0x80, 0x66, 0xd1, 0xf8, 0xc3]);
  expect(sar.cpu.run({ instructionBudget: 10, returnAddress: sar.returnAddress }).kind).toBe("return");
  expect(sar.state.registers.read("rax", 16)).toBe(0xc000n);
  expect(sar.state.flags.get("overflow")).toBe(false);
  expect(sar.state.flags.get("sign")).toBe(true);
});

test("ModRM/SIB, 16-bit addressing, FS override and LEA preserve distinct address rules", () => {
  const run = machine([0x8b, 0x44, 0x8b, 0x10, 0x67, 0x66, 0x8b, 0x52, 0x04, 0x64, 0x8b, 0x35, 0x20, 0, 0, 0, 0xc3]);
  run.state.registers.write("rbx", 32, 0x3000n); run.state.registers.write("rcx", 32, 3n);
  run.state.registers.write("rbp", 32, 0x3000n); run.state.registers.write("rsi", 32, 0x40n);
  run.state.segments.fs.base = 0x3000n;
  run.memory.writeUint32(guestAddress(run.memory, 0x301cn), 0x11223344);
  run.memory.writeUint16(guestAddress(run.memory, 0x3044n), 0xabcd);
  run.memory.writeUint32(guestAddress(run.memory, 0x3020n), 0x55667788);
  expect(run.cpu.run({ instructionBudget: 20, returnAddress: run.returnAddress }).kind).toBe("return");
  expect(run.state.registers.read("rax", 32)).toBe(0x11223344n);
  expect(run.state.registers.read("rdx", 32)).toBe(0xabcdn);
  expect(run.state.registers.read("rsi", 32)).toBe(0x55667788n);
  const lea = machine([0x8d, 0x14, 0x08, 0xc3]);
  expect(lea.cpu.run({ instructionBudget: 10, returnAddress: lea.returnAddress }).kind).toBe("return");
  expect(lea.state.registers.read("rdx", 32)).toBe(0n);
});

test("CALL stops before host fetch and resumes from the same state", () => {
  const run = machine([0xe8, 0xfb, 0x3f, 0, 0, 0x83, 0xc0, 3, 0xc3]);
  const cpu = new I386Cpu({ state: run.state, memory: run.memory, hostCall: address => address.byteOffset === 0x5000n });
  const stop = cpu.run({ instructionBudget: 10, returnAddress: run.returnAddress });
  expect(stop.kind).toBe("host-call");
  expect(run.state.instructionPointer).toBe(0x5000n);
  expect(run.state.registers.read("rsp", 32)).toBe(0x8ffcn);
  const saved = run.memory.readUint32(guestAddress(run.memory, 0x8ffcn));
  expect(saved).toBe(0x1005);
  run.state.registers.write("rax", 32, 39n);
  run.state.registers.write("rsp", 32, 0x9000n);
  run.state.instructionPointer = BigInt(saved);
  expect(cpu.run({ instructionBudget: 10, returnAddress: run.returnAddress }).kind).toBe("return");
  expect(run.state.registers.read("rax", 32)).toBe(42n);
});

test("POP through ESP computes its memory destination after increment", () => {
  const run = machine([0x8f, 0x04, 0x24]);
  run.memory.writeUint32(guestAddress(run.memory, 0x9000n), 0x12345678);
  expect(run.cpu.run({ instructionBudget: 1, returnAddress: null }).kind).toBe("budget");
  expect(run.state.registers.read("rsp", 32)).toBe(0x9004n);
  expect(run.memory.readUint32(guestAddress(run.memory, 0x9004n))).toBe(0x12345678);
});

test("REP MOVSB is restartable at budget boundaries and supports overlapping memory", () => {
  const run = machine([0xf3, 0xa4, 0xc3]);
  run.memory.write(guestAddress(run.memory, 0x3000n), new Uint8Array([7, 8, 9, 10, 11]));
  run.state.registers.write("rsi", 32, 0x3000n); run.state.registers.write("rdi", 32, 0x3001n); run.state.registers.write("rcx", 32, 4n);
  expect(run.cpu.run({ instructionBudget: 2, returnAddress: run.returnAddress }).kind).toBe("budget");
  expect(run.state.instructionPointer).toBe(0x1000n);
  expect(run.state.registers.read("rcx", 32)).toBe(2n);
  expect(run.cpu.run({ instructionBudget: 10, returnAddress: run.returnAddress }).kind).toBe("return");
  expect([...run.memory.copy(guestAddress(run.memory, 0x3000n), 5)]).toEqual([7, 7, 7, 7, 7]);
});

test("REPE CMPSB stops at the first mismatch and DF moves backwards", () => {
  const run = machine([0xfd, 0xf3, 0xa6, 0xc3]);
  run.memory.write(guestAddress(run.memory, 0x3000n), new Uint8Array([1, 2, 3]));
  run.memory.write(guestAddress(run.memory, 0x3010n), new Uint8Array([1, 9, 3]));
  run.state.registers.write("rsi", 32, 0x3002n); run.state.registers.write("rdi", 32, 0x3012n); run.state.registers.write("rcx", 32, 3n);
  expect(run.cpu.run({ instructionBudget: 10, returnAddress: run.returnAddress }).kind).toBe("return");
  expect(run.state.registers.read("rcx", 32)).toBe(1n);
  expect(run.state.registers.read("rsi", 32)).toBe(0x3000n);
  expect(run.state.flags.get("zero")).toBe(false);
});

test("LOCK CMPXCHG and XADD modify one shared memory value", () => {
  const run = machine([0xf0, 0x0f, 0xb1, 0x0b, 0xf0, 0x0f, 0xc1, 0x13, 0xc3]);
  run.state.registers.write("rbx", 32, 0x3000n); run.state.registers.write("rax", 32, 5n);
  run.state.registers.write("rcx", 32, 20n); run.state.registers.write("rdx", 32, 3n);
  run.memory.writeUint32(guestAddress(run.memory, 0x3000n), 5);
  expect(run.cpu.run({ instructionBudget: 10, returnAddress: run.returnAddress }).kind).toBe("return");
  expect(run.memory.readUint32(guestAddress(run.memory, 0x3000n))).toBe(23);
  expect(run.state.registers.read("rdx", 32)).toBe(20n);
});

test("IDIV preserves signed quotient/remainder and divide errors preserve state", () => {
  const run = machine([0xb8, 0xf9, 0xff, 0xff, 0xff, 0x99, 0xb9, 3, 0, 0, 0, 0xf7, 0xf9, 0xc3]);
  expect(run.cpu.run({ instructionBudget: 20, returnAddress: run.returnAddress }).kind).toBe("return");
  expect(run.state.registers.read("rax", 32)).toBe(0xfffffffen);
  expect(run.state.registers.read("rdx", 32)).toBe(0xffffffffn);
  const bad = machine([0xf7, 0xf1]);
  bad.state.registers.write("rax", 32, 17n);
  const result = bad.cpu.run({ instructionBudget: 1, returnAddress: null });
  expect(result.kind).toBe("exception");
  if (result.kind !== "exception" || result.exception.kind !== "processor") throw new Error("Expected processor divide exception");
  expect(result.exception.vector).toBe(0);
  expect(bad.state.instructionPointer).toBe(0x1000n);
  expect(bad.state.registers.read("rax", 32)).toBe(17n);
});

test("faults and unsupported instructions report exact guest instruction bytes", () => {
  const invalid = machine([0xf0, 0x01, 0xc0]);
  const lock = invalid.cpu.run({ instructionBudget: 10, returnAddress: null });
  expect(lock.kind).toBe("exception");
  if (lock.kind !== "exception" || lock.exception.kind !== "processor") throw new Error("Expected invalid LOCK exception");
  expect(lock.exception.vector).toBe(6);
  const unsupported = machine([0x90, 0x0f, 0xa2]);
  const result = unsupported.cpu.run({ instructionBudget: 10, returnAddress: null });
  if (result.kind !== "unsupported") throw new Error("Expected unsupported CPUID stop");
  expect(result.instructions).toBe(1);
  expect(result.instruction.address.byteOffset).toBe(0x1001n);
  expect([...result.instruction.bytes]).toEqual([0x0f, 0xa2]);
  const fault = machine([0x83, 0x03, 0x01]);
  fault.state.registers.write("rbx", 32, 0x1000n);
  const flags = fault.state.flags.value, before = fault.state.registers.checkpoint();
  expect(fault.cpu.run({ instructionBudget: 1, returnAddress: null }).kind).toBe("exception");
  expect(fault.state.registers.checkpoint()).toEqual(before);
  expect(fault.state.flags.value).toBe(flags);
  expect(fault.state.instructionPointer).toBe(0x1000n);
});

test("decoded x87 instructions use the shared numeric state", () => {
  const run = machine([0xd9, 0xe8, 0xd9, 0xe8, 0xde, 0xc1, 0xd9, 0x1b, 0xc3]);
  run.state.registers.write("rbx", 32, 0x3000n);
  expect(run.cpu.run({ instructionBudget: 10, returnAddress: run.returnAddress }).kind).toBe("return");
  expect(run.memory.readFloat32(guestAddress(run.memory, 0x3000n))).toBe(2);
  expect(run.state.x87.tagWord).toBe(0xffff);
});

const retailPath = resolve(import.meta.dir, "../../../../qfiles/q2/lmctf/gamex86.dll");
test.skipIf(!existsSync(retailPath))("actual LMCTF GetGameAPI executes from the PE image and returns its export table", async () => {
  const bytes = await readFile(retailPath), hash = createHash("sha256").update(bytes).digest("hex");
  expect(hash).toBe("31cbb29f90429706986dbd855d0a3a2529b7fbd4340694901af5c5052cbdcbe6");
  const identity: ModuleIdentity = { id: "fixture:lmctf", artifactPath: retailPath, revision: "1999-03-22", digest: createContentDigest(hash) };
  const memory = new SparseGuestMemory({ module: identity, pointerBytes: 4 });
  const image = mapPeImage({ bytes, memory });
  const exported = image.exports.find(item => item.symbol.kind === "name" && item.symbol.name === "GetGameAPI");
  if (exported === undefined || exported.target.kind !== "address") throw new Error("Real LMCTF DLL is missing GetGameAPI");
  const entry = exported.target.address;
  expect(entry.byteOffset).toBe(0x20013330n);
  memory.map({ base: 0x10000n, byteLength: 0x1000, permissions: "read-write" });
  const importBytes = new Uint8Array(44 * 4);
  for (let index = 0; index < importBytes.length; index++) importBytes[index] = (index * 7 + 11) & 255;
  const imports = memory.allocate({ byteLength: importBytes.length }); memory.write(imports, importBytes);
  const returnAddress: GuestAddress = guestAddress(memory, 0x7000n);
  const state = createGuestProcessorState({ architecture: "i386", instructionPointer: entry.byteOffset, stackPointer: 0x10800n,
    flags: 2n, x87ControlWord: 0x37f, mxcsr: 0x1f80, mxcsrMask: 0xffff });
  memory.writeUint32(guestAddress(memory, 0x10800n), Number(returnAddress.byteOffset));
  memory.writeUint32(guestAddress(memory, 0x10804n), Number(imports.byteOffset));
  state.registers.write("rsi", 32, 0xabcdef01n); state.registers.write("rdi", 32, 0x12345678n);
  const cpu = new I386Cpu({ state, memory });
  expect(cpu.run({ instructionBudget: 1000, returnAddress }).kind).toBe("return");
  expect(state.registers.read("rax", 32)).toBe(0x20089820n);
  expect(state.registers.read("rsi", 32)).toBe(0xabcdef01n);
  expect(state.registers.read("rdi", 32)).toBe(0x12345678n);
  expect(memory.copy(guestAddress(memory, 0x20092680n), importBytes.length)).toEqual(importBytes);
  expect(memory.readUint32(guestAddress(memory, 0x20089820n))).toBe(3);
  expect(memory.readUint32(guestAddress(memory, 0x20089824n))).toBe(0x200218c0);
  expect(memory.readUint32(guestAddress(memory, 0x20089864n))).toBe(0x3bc);
});
