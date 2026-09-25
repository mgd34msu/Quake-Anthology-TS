// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createContentDigest } from "../../../src/contracts/content.ts";
import type { ModuleIdentity } from "../../../src/contracts/execution.ts";
import { createGuestProcessorState, SparseGuestMemory } from "../../../src/guest/core/index.ts";
import { executeNumericInstruction, readX87Register, writeX87Return, readX87Return } from "../../../src/guest/floating-point/index.ts";
import type { NumericInstruction } from "../../../src/guest/floating-point/index.ts";
import { arithmetic, binary32, binary64, binary80, decodeBinary, decodeBinary32, encodeBinary, fromInteger, readBits, squareRoot, writeBits } from "../../../src/guest/floating-point/binary.ts";

const module: ModuleIdentity = { id: "test:floating-point", artifactPath: "authored-instruction-vectors", revision: "1", digest: createContentDigest("34".repeat(32)) };
function fixture() {
  const state = createGuestProcessorState({ architecture: "x86-64", instructionPointer: 0x1000n, stackPointer: 0x3000n, flags: 0n, x87ControlWord: 0x37f, mxcsr: 0x1f80, mxcsrMask: 0xffff });
  const memory = new SparseGuestMemory({ module, pointerBytes: 8 });
  const address = memory.map({ base: 0x2000n, byteLength: 256, permissions: "read-write" });
  function run(opcode: number, modrm: number, secondaryOpcode: number | null = null, prefix: NumericInstruction["prefix"] = "none", immediate: number | null = null) {
    const instruction: NumericInstruction = { opcode, secondaryOpcode, modrm, registerIndex: (modrm >> 3) & 7,
      operand: modrm >= 0xc0 ? { kind: "register", index: modrm & 7 } : { kind: "memory", address }, prefix, operandBits: 32, immediate };
    return executeNumericInstruction({ state, memory, instruction });
  }
  function setXmm(index: number, bits: bigint, bytes = 16): void { state.simd.xmm.set(writeBits(bits, bytes), index * 16); }
  function getXmm(index: number, bytes = 16): bigint { return readBits(state.simd.xmm.subarray(index * 16, index * 16 + bytes)); }
  return { state, memory, address, run, setXmm, getXmm };
}

test("integer arithmetic preserves x87 64-bit significand beyond JavaScript double", () => {
  const { state, memory, address, run } = fixture();
  memory.write(address, writeBits(1n << 53n, 8));
  expect(run(0xdf, 0x28)).toEqual({ kind: "executed" });
  expect(run(0xd9, 0xe8)).toEqual({ kind: "executed" });
  expect(run(0xde, 0xc1)).toEqual({ kind: "executed" });
  expect(encodeBinary(readX87Register(state.x87), 80)).toBe(0x40348000000000000400n);
  memory.write(address, writeBits(0x4340000000000000n, 8));
  expect(run(0xdc, 0x20)).toEqual({ kind: "executed" });
  expect(readX87Return(state.x87, "float64")).toBe(1);
});

test("precision control clears low significand bits only at arithmetic", () => {
  for (const [control, expected, flags] of [[0x37f, 16777217, 0], [0x7f, 16777216, 32], [0x87f, 16777218, 32]]) {
    if (control === undefined || expected === undefined || flags === undefined) throw new Error("Incomplete fixture");
    const { state, run } = fixture();
    state.x87.controlWord = control;
    writeX87Return(state.x87, 16777216, "float64");
    expect(run(0xd9, 0xe8).kind).toBe("executed");
    expect(run(0xde, 0xc1).kind).toBe("executed");
    expect(readX87Return(state.x87, "float64")).toBe(expected);
    expect(state.x87.statusWord & 32).toBe(flags);
  }
});

test("x87 float stores round midpoint under all four modes and preserve negative zero", () => {
  for (const [mode, expected] of [[0, 0x3f800000], [1, 0x3f800000], [2, 0x3f800001], [3, 0x3f800000]]) {
    if (mode === undefined || expected === undefined) throw new Error("Incomplete fixture");
    const { state, memory, address, run } = fixture();
    state.x87.controlWord = 0x37f | (mode << 10);
    writeX87Return(state.x87, 1 + 2 ** -24, "float64");
    expect(run(0xd9, 0x18).kind).toBe("executed");
    expect(readBits(memory.copy(address, 4))).toBe(BigInt(expected));
    expect(state.x87.tagWord).toBe(0xffff);
  }
  const { state, run } = fixture();
  writeX87Return(state.x87, -0, "float64");
  expect(run(0xd9, 0xfa).kind).toBe("executed");
  expect(Object.is(readX87Return(state.x87, "float64"), -0)).toBe(true);
});

test("x87 raw80 load/store preserves signaling NaN payload without arithmetic", () => {
  const { state, memory, address, run } = fixture();
  const bits = 0xffff8000000000000123n;
  memory.write(address, writeBits(bits, 10));
  expect(run(0xdb, 0x28).kind).toBe("executed");
  expect(state.x87.statusWord & 1).toBe(0);
  expect(run(0xdb, 0x38).kind).toBe("executed");
  expect(readBits(memory.copy(address, 10))).toBe(bits);
});

test("x87 raw80 transfer also preserves noncanonical encodings", () => {
  for (const bits of [0x00008000000000000001n, 0x40000000000000000123n]) {
    const { memory, address, run } = fixture();
    memory.write(address, writeBits(bits, 10));
    expect(run(0xdb, 0x28).kind).toBe("executed");
    expect(run(0xdb, 0x38).kind).toBe("executed");
    expect(readBits(memory.copy(address, 10))).toBe(bits);
  }
});

test("unmasked x87 range exceptions wrap register exponents and defer notification", () => {
  for (const [input, mask, group, expected] of [
    [0x7ffe8000000000000000n, 8n, 0x08n, 0x1fff8000000000000000n],
    [0x00018000000000000000n, 16n, 0x30n, 0x60008000000000000000n],
  ]) {
    if (input === undefined || mask === undefined || group === undefined || expected === undefined) throw new Error("Incomplete fixture");
    const { state, memory, address, run } = fixture();
    state.x87.controlWord &= ~Number(mask);
    memory.write(address, writeBits(input, 10));
    expect(run(0xdb, 0x28).kind).toBe("executed");
    memory.write(address, writeBits(0x40000000n, 4));
    expect(run(0xd8, Number(group)).kind).toBe("executed");
    expect(encodeBinary(readX87Register(state.x87), 80)).toBe(expected);
    expect(state.x87.statusWord & (0x8080 | Number(mask) | 32)).toBe(0x8080 | Number(mask));
  }
});

test("unmasked x87 store overflow leaves memory and TOP unchanged without reporting precision", () => {
  const { state, memory, address, run } = fixture();
  writeX87Return(state.x87, 2 ** 128, "float64");
  state.x87.controlWord &= ~8;
  memory.write(address, writeBits(0x12345678n, 4));
  const top = state.x87.statusWord & 0x3800;
  expect(run(0xd9, 0x18).kind).toBe("executed");
  expect(memory.readUint32(address)).toBe(0x12345678);
  expect(state.x87.statusWord & 0x3800).toBe(top);
  expect(state.x87.statusWord & (8 | 32 | 0x200)).toBe(8);
});

test("x87 stack fault is deferred until a waiting instruction", () => {
  const { state, memory } = fixture();
  state.x87.controlWord &= ~1;
  const before = state.x87.registers.slice();
  const instruction: NumericInstruction = { opcode: 0xd8, secondaryOpcode: null, modrm: 0xc1, registerIndex: 0, operand: { kind: "register", index: 1 }, prefix: "none", operandBits: 32, immediate: null };
  expect(executeNumericInstruction({ state, memory, instruction }).kind).toBe("executed");
  expect(state.x87.statusWord & 0x80c1).toBe(0x80c1);
  expect(state.x87.registers).toEqual(before);
  expect(state.x87.tagWord).toBe(0xffff);
  expect(executeNumericInstruction({ state, memory, instruction: { ...instruction, opcode: 0x9b, modrm: null, operand: null } })).toEqual({ kind: "exception", vector: 16, detail: "Pending x87 floating-point exception" });
});

test("exact divide and square root produce correctly rounded binary64", () => {
  const one = fromInteger(1n); const three = fromInteger(3n);
  expect(encodeBinary(arithmetic("divide", one, three, binary64, "nearest").value, 64)).toBe(0x3fd5555555555555n);
  expect(encodeBinary(squareRoot(fromInteger(2n), binary64, "nearest").value, 64)).toBe(0x3ff6a09e667f3bcdn);
  const extended = arithmetic("add", fromInteger(1n << 63n), one, binary80, "nearest");
  expect(encodeBinary(extended.value, 80)).toBe(0x403e8000000000000001n);
});

test("SSE scalar register move retains upper lanes while memory load clears them", () => {
  const { setXmm, getXmm, memory, address, run } = fixture();
  setXmm(0, 0xaaaaaaaaaaaaaaaabbbbbbbbccccccccn);
  setXmm(1, 0x1111111122222222333333333f800000n);
  expect(run(0x0f, 0xc1, 0x10, "f3").kind).toBe("executed");
  expect(getXmm(0)).toBe(0xaaaaaaaaaaaaaaaabbbbbbbb3f800000n);
  memory.write(address, writeBits(0x80000000n, 4));
  expect(run(0x0f, 0x00, 0x10, "f3").kind).toBe("executed");
  expect(getXmm(0)).toBe(0x80000000n);
});

test("SSE unaligned MOVUPS works while MOVAPS faults before changing destination", () => {
  const { state, memory, address, getXmm } = fixture();
  const unaligned = memory.offset(address, 1n);
  memory.write(unaligned, new Uint8Array(16).fill(0xab));
  const instruction: NumericInstruction = { opcode: 0x0f, secondaryOpcode: 0x10, modrm: 0, registerIndex: 0, operand: { kind: "memory", address: unaligned }, prefix: "none", operandBits: 32, immediate: null };
  expect(executeNumericInstruction({ state, memory, instruction }).kind).toBe("executed");
  expect(getXmm(0)).toBe(0xababababababababababababababababn);
  expect(executeNumericInstruction({ state, memory, instruction: { ...instruction, secondaryOpcode: 0x28 } }).kind).toBe("exception");
  expect(getXmm(0)).toBe(0xababababababababababababababababn);
});

test("SSE uses MXCSR rounding and preserves first-source NaN payload", () => {
  const { state, setXmm, getXmm, run } = fixture();
  state.simd.mxcsr = 0x5f80;
  setXmm(0, 0x3f800000n); setXmm(1, 0x33800000n);
  expect(run(0x0f, 0xc1, 0x58, "f3").kind).toBe("executed");
  expect(getXmm(0, 4)).toBe(0x3f800001n);
  expect(state.simd.mxcsr & 32).toBe(32);
  setXmm(0, 0xffc12345n); setXmm(1, 0x7fc54321n);
  expect(run(0x0f, 0xc1, 0x58, "f3").kind).toBe("executed");
  expect(getXmm(0, 4)).toBe(0xffc12345n);
});

test("SSE exceptions aggregate before packed destination changes", () => {
  const { state, setXmm, getXmm, run } = fixture();
  setXmm(0, 0x3f8000003f8000003f8000003f800000n); setXmm(1, 0x3f8000003f800000000000003f800000n);
  state.simd.mxcsr &= ~(1 << 9);
  const before = getXmm(0);
  expect(run(0x0f, 0xc1, 0x5e)).toEqual({ kind: "exception", vector: 19, detail: "Unmasked SIMD floating-point exception" });
  expect(getXmm(0)).toBe(before);
  expect(state.simd.mxcsr & 4).toBe(4);
});

test("SSE DAZ turns a signed denormal source into signed zero", () => {
  const { state, setXmm, getXmm, run } = fixture();
  state.simd.mxcsr |= 64;
  setXmm(0, 0x80000001n); setXmm(1, 0x3f800000n);
  expect(run(0x0f, 0xc1, 0x59, "f3").kind).toBe("executed");
  expect(getXmm(0, 4)).toBe(0x80000000n);
  expect(state.simd.mxcsr & 2).toBe(0);
});

test("SSE integer conversion truncates and returns indefinite on invalid range", () => {
  const { state, setXmm, run } = fixture();
  setXmm(1, 0xbff3333333333333n);
  expect(run(0x0f, 0xc1, 0x2c, "f2").kind).toBe("executed");
  expect(state.registers.read("rax", 32)).toBe(0xffffffffn);
  setXmm(1, 0x7ff0000000000000n);
  expect(run(0x0f, 0xc1, 0x2c, "f2").kind).toBe("executed");
  expect(state.registers.read("rax", 32)).toBe(0x80000000n);
  expect(state.simd.mxcsr & 1).toBe(1);
});

test("packed integer lanes wrap independently and comparison yields lane masks", () => {
  const { setXmm, getXmm, run } = fixture();
  setXmm(0, 0x7fffffff00000000ffffffffffffffffn); setXmm(1, 0x00000001000000010000000100000001n);
  expect(run(0x0f, 0xc1, 0xfe, "66").kind).toBe("executed");
  expect(getXmm(0)).toBe(0x80000000000000010000000000000000n);
  expect(run(0x0f, 0xc1, 0x76, "66").kind).toBe("executed");
  expect(getXmm(0)).toBe(0x00000000ffffffff0000000000000000n);
});

test("binary32 arithmetic keeps exact subnormals and signs for cancellation", () => {
  const smallest = decodeBinary(1n, 32);
  const sum = arithmetic("add", smallest, smallest, binary32, "nearest", "sse");
  expect(encodeBinary(sum.value, 32)).toBe(2n);
  expect(sum.flags).toBe(2);
  const cancelled = arithmetic("subtract", fromInteger(1n), fromInteger(1n), binary80, "down");
  expect(encodeBinary(cancelled.value, 80)).toBe(1n << 79n);
});


test("binary32 word decoding matches exact significands, signs and NaN payloads", () => {
  for (const bits of [0, 1, 0x007fffff, 0x00800000, 0x3f7fffff, 0x3f800000, 0x3f800001, 0x7f7fffff,
    0x7f800000, 0x7f800001, 0x7fbfffff, 0x7fc00000, 0x7fc12345, 0x7fffffff]) {
    for (const sign of [0, 0x80000000]) {
      const word = (bits | sign) >>> 0;
      expect(decodeBinary32(word)).toEqual(decodeBinary(BigInt(word), 32));
    }
  }
});
