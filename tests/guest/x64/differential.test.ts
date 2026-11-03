// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createContentDigest } from "../../../src/contracts/content.ts";
import type { ModuleIdentity } from "../../../src/contracts/execution.ts";
import { createGuestProcessorState, createManagedGuestProcessorState, SparseGuestMemory } from "../../../src/guest/core/index.ts";
import { X64Cpu } from "../../../src/guest/x64/index.ts";

const module: ModuleIdentity = {
  id: "test:x64-differential",
  artifactPath: "authored-x64-streams",
  revision: "1",
  digest: createContentDigest("35".repeat(32)),
};
const codeBase = 0x10000n,
  dataBase = 0x20000n,
  stack = 0x30000n,
  returned = 0x40000n;
const destinations = [0, 1, 2, 3, 5, 7];
const sources = [0, 1, 2, 3, 5, 6, 7];

let seed = 0x9e3779b9;
function random(): number {
  seed ^= seed << 13;
  seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed;
}
function pick<T>(values: readonly T[]): T {
  const value = values[random() % values.length];
  if (value === undefined) throw new Error("Cannot pick from an empty list");
  return value;
}
function imm32(value: number): number[] {
  return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
}

/** One random straight-line instruction from the integer subset the managed kernel executes in blocks. */
function instruction(): number[] {
  const wide = random() % 3 !== 0,
    rex = wide ? [0x48] : [];
  const dst = pick(destinations),
    src = pick(sources),
    modrm = 0xc0 | (src << 3) | dst;
  switch (random() % 16) {
    case 0:
      return [...rex, pick([0x01, 0x09, 0x11, 0x19, 0x21, 0x29, 0x31, 0x39, 0x85]), modrm];
    case 1:
      return [...rex, 0x83, 0xc0 | ((random() % 8) << 3) | dst, random() & 255];
    case 2:
      return [0x48, 0xc7, 0xc0 | dst, ...imm32(random())];
    case 3:
      return [...rex, 0xc1, 0xc0 | (pick([0, 1, 4, 5, 7]) << 3) | dst, 1 + (random() % 63)];
    case 4:
      return [0x48, 0x8d, 0x44 | (dst << 3), (pick([0, 1, 2, 3]) << 6) | (pick([0, 1, 2, 3, 5, 7]) << 3) | pick(sources), random() & 127];
    case 5:
      return [...rex, 0x89, 0x46 | (src << 3), (random() % 16) * 8];
    case 6:
      return [...rex, 0x8b, 0x46 | (dst << 3), (random() % 16) * 8];
    case 7:
      return [...rex, 0x0f, 0xaf, 0xc0 | (dst << 3) | src];
    case 8:
      return [...rex, 0xf7, 0xc0 | (pick([2, 3]) << 3) | dst];
    case 9:
      return [...rex, 0xff, 0xc0 | (pick([0, 1]) << 3) | dst];
    case 10:
      return [0x0f, pick([0xb6, 0xb7, 0xbe, 0xbf]), 0xc0 | (dst << 3) | (src & 3)];
    case 11:
      return [0x0f, 0x90 + (random() % 16), 0xc0 | (dst & 3)];
    case 12:
      return [...rex, 0x0f, 0x40 + (random() % 16), modrm];
    case 13:
      return [0x50 + src, 0x58 + dst];
    case 14:
      return [...rex, 0x87, 0xc0 | (pick(destinations) << 3) | dst];
    default:
      return [...rex, 0x01, modrm];
  }
}
/** A compare, a conditional forward branch over one instruction, and that instruction. */
function branch(): number[] {
  const skipped = instruction(),
    compare = [0x48, pick([0x39, 0x3b, 0x85]), 0xc0 | (pick(sources) << 3) | pick(destinations)];
  return [...compare, 0x70 + (random() % 16), skipped.length, ...skipped];
}
function stream(count: number): { readonly bytes: number[]; readonly registers: bigint[] } {
  const bytes: number[] = [];
  for (let index = 0; index < count; index++) bytes.push(...(random() % 6 === 0 ? branch() : instruction()));
  bytes.push(0xc3);
  const registers = Array.from({ length: 16 }, () => ((BigInt(random()) << 32n) | BigInt(random())) >> BigInt(random() % 40));
  return { bytes, registers };
}

type Mode = "generic" | "managed";
function build(mode: Mode, bytes: readonly number[], registers: readonly bigint[]) {
  const managed = mode === "managed";
  const memory = managed ? SparseGuestMemory.createManaged({ module, pointerBytes: 8 }) : new SparseGuestMemory({ module, pointerBytes: 8 });
  memory.map({ base: codeBase, byteLength: bytes.length, permissions: "read-execute", bytes: new Uint8Array(bytes) });
  const data = memory.map({ base: dataBase, byteLength: 256, permissions: "read-write" });
  memory.map({ base: stack - 0x1000n, byteLength: 0x1008, permissions: "read-write" });
  const returnSlot = memory.pointer(stack),
    target = memory.pointer(returned);
  if (returnSlot === null || target === null) throw new Error("fixture address");
  memory.writeUint64(returnSlot, returned);
  const state = (managed ? createManagedGuestProcessorState : createGuestProcessorState)({
    architecture: "x86-64",
    instructionPointer: codeBase,
    stackPointer: stack,
    flags: 2n,
    x87ControlWord: 0x37f,
    mxcsr: 0x1f80,
    mxcsrMask: 0xffff,
  });
  const names: readonly Parameters<typeof state.registers.write>[0][] = [
    "rax",
    "rcx",
    "rdx",
    "rbx",
    "rsp",
    "rbp",
    "rsi",
    "rdi",
    "r8",
    "r9",
    "r10",
    "r11",
    "r12",
    "r13",
    "r14",
    "r15",
  ];
  const reset = (): void => {
    state.instructionPointer = codeBase;
    state.flags.value = 2n;
    names.forEach((name, index) => state.registers.write(name, 64, registers[index] ?? 0n));
    state.registers.write("rsp", 64, stack);
    state.registers.write("rsi", 64, dataBase);
    memory.write(
      data,
      new Uint8Array(256).map((_, index) => (index * 37 + 11) & 255),
    );
    memory.writeUint64(returnSlot, returned);
  };
  const cpu = new X64Cpu({ state, memory });
  const observe = (budget: number) => {
    const stop = cpu.run({ instructionBudget: budget, returnAddress: target });
    return {
      stop: stop.kind === "exception" ? `exception:${stop.exception.kind}` : stop.kind,
      instructions: "instructions" in stop ? stop.instructions : -1,
      ip: state.instructionPointer,
      flags: state.flags.value,
      registers: [...state.registers.checkpoint()],
      data: [...memory.copy(data, 256)],
    };
  };
  return { reset, observe };
}

test("generic, managed and warm managed block execution agree on random integer streams, including mid-block budget stops", () => {
  for (let round = 0; round < 120; round++) {
    const { bytes, registers } = stream(4 + (random() % 40));
    const generic = build("generic", bytes, registers),
      managed = build("managed", bytes, registers);
    const instructionsInStream = 1 + bytes.length;
    for (const budget of [instructionsInStream * 2, 1, 2, 3, 1 + (random() % 24), 1 + (random() % 24)]) {
      generic.reset();
      managed.reset();
      const expected = generic.observe(budget);
      const cold = managed.observe(budget);
      expect(cold).toEqual(expected);
      managed.reset();
      expect(managed.observe(budget)).toEqual(expected);
    }
  }
});

test("the decode cache is discarded and counted when it reaches its limit, and execution stays correct", () => {
  const count = 262144 + 100;
  const bytes = new Uint8Array(count + 1).fill(0x90);
  bytes[count] = 0xc3;
  const memory = new SparseGuestMemory({ module, pointerBytes: 8 });
  memory.map({ base: 0x100000n, byteLength: bytes.length, permissions: "read-execute", bytes });
  memory.map({ base: stack - 0x1000n, byteLength: 0x1008, permissions: "read-write" });
  const slot = memory.pointer(stack),
    target = memory.pointer(returned);
  if (slot === null || target === null) throw new Error("fixture address");
  memory.writeUint64(slot, returned);
  const state = createGuestProcessorState({
    architecture: "x86-64",
    instructionPointer: 0x100000n,
    stackPointer: stack,
    flags: 2n,
    x87ControlWord: 0x37f,
    mxcsr: 0x1f80,
    mxcsrMask: 0xffff,
  });
  const cpu = new X64Cpu({ state, memory });
  expect(cpu.decodeCacheClears).toBe(0);
  const stop = cpu.run({ instructionBudget: count + 10, returnAddress: target });
  expect(stop.kind).toBe("return");
  expect(cpu.decodeCacheClears).toBe(1);
  expect(state.instructionPointer).toBe(returned);
});
