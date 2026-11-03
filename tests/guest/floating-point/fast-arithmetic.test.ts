// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createContentDigest } from "../../../src/contracts/content.ts";
import type { ModuleIdentity } from "../../../src/contracts/execution.ts";
import { createGuestProcessorState, SparseGuestMemory } from "../../../src/guest/core/index.ts";
import { executeNumericInstruction, readX87Register, writeX87Register } from "../../../src/guest/floating-point/index.ts";
import { arithmetic, binary80, decodeBinary, encodeBinary, formatFor } from "../../../src/guest/floating-point/binary.ts";
import type { BinaryOperation } from "../../../src/guest/floating-point/binary.ts";

const module: ModuleIdentity = { id: "test:fast-arithmetic", artifactPath: "authored-fast-vectors", revision: "1", digest: createContentDigest("69".repeat(32)) };
let seed = 0x2468ace1;
function random(): number { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed; }
function sample(): number {
  const kind = random() % 6;
  if (kind === 0) return [0, -0, 1, -1, 0.1, 3, 1 / 3, 2 ** 30, 2 ** -30, 123456.789][random() % 10] ?? 0;
  if (kind === 1) return Math.fround((random() / 4294967296 - 0.5) * 2 ** ((random() % 40) - 20));
  if (kind === 2) return random() % 2000 - 1000;
  if (kind === 3) return (random() / 4294967296 - 0.5) * 2 ** ((random() % 120) - 60);
  if (kind === 4) return (random() / 4294967296) * 2 ** ((random() % 400) - 200);
  return 2 ** ((random() % 440) - 220) * (random() % 2 === 0 ? 1 : -1);
}
function bits64(value: number): bigint { const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, value, true); return view.getBigUint64(0, true); }

const x87Operations: readonly (readonly [number, BinaryOperation, boolean])[] = [[0, "add", false], [1, "multiply", false], [4, "subtract", false], [5, "subtract", true], [6, "divide", false], [7, "divide", true]];


test("x87 fast arithmetic matches the exact rational path in value, tag and status for every precision control", () => {
  let compared = 0;
  for (const pc of [0, 2, 3]) {
    for (const [group, name, reversed] of x87Operations) {
      for (let index = 0; index < 1200; index++) {
        const a = sample(), b = sample();
        const state = createGuestProcessorState({ architecture: "i386", instructionPointer: 0n, stackPointer: 0n, flags: 0n, x87ControlWord: (0x37f & ~0x300) | (pc << 8), mxcsr: 0x1f80, mxcsrMask: 0xffff });
        const memory = new SparseGuestMemory({ module, pointerBytes: 4 });
        // Place operands: st(1)=b pushed first, st(0)=a pushed second.
        state.x87.statusWord = 0; state.x87.tagWord = 0xffff;
        for (const value of [b, a]) {
          const top = (((state.x87.statusWord >> 11) & 7) - 1) & 7;
          state.x87.statusWord = (state.x87.statusWord & ~0x3800) | (top << 11);
          writeX87Register(state.x87, 0, decodeBinary(bits64(value), 64));
        }
        const left = readX87Register(state.x87, 0), right = readX87Register(state.x87, 1);
        const result = executeNumericInstruction({ state, memory, instruction: { opcode: 0xd8, secondaryOpcode: null, modrm: 0xc0 | (group << 3) | 1, registerIndex: 0,
          operand: { kind: "register", index: 1 }, prefix: "none", operandBits: 32, immediate: null } });
        expect(result.kind).toBe("executed");
        const swap = reversed;
        const expected = arithmetic(name, swap ? right : left, swap ? left : right, { ...binary80, precision: pc === 0 ? 24 : pc === 2 ? 53 : 64 }, "nearest");
        const actual = readX87Register(state.x87, 0);
        expect([encodeBinary(actual, 80), state.x87.statusWord & 0x23f]).toEqual([encodeBinary(expected.value, 80), (expected.flags | (expected.roundedUp ? 0x200 : 0)) & 0x23f]);
        compared++;
      }
    }
  }
  expect(compared).toBe(3 * 6 * 1200);
});

test("binary64 SSE arithmetic on the fast path matches the exact rational path, including inexact flags", () => {
  const operations: readonly (readonly [number, BinaryOperation])[] = [[0x58, "add"], [0x5c, "subtract"], [0x59, "multiply"], [0x5e, "divide"]];
  for (const [opcode, name] of operations) {
    for (let index = 0; index < 3000; index++) {
      const a = sample(), b = sample(), c = sample(), d = sample();
      const state = createGuestProcessorState({ architecture: "i386", instructionPointer: 0n, stackPointer: 0n, flags: 0n, x87ControlWord: 0x37f, mxcsr: 0x1f80, mxcsrMask: 0xffff });
      const memory = new SparseGuestMemory({ module, pointerBytes: 4 });
      const view = new DataView(state.simd.xmm.buffer, state.simd.xmm.byteOffset, 32);
      const packed = index % 2 === 1;
      view.setFloat64(0, a, true); view.setFloat64(8, c, true); view.setFloat64(16, b, true); view.setFloat64(24, d, true);
      const result = executeNumericInstruction({ state, memory, instruction: { opcode: 0x0f, secondaryOpcode: opcode, modrm: 0xc1, registerIndex: 0, operand: { kind: "register", index: 1 },
        prefix: packed ? "66" : "f2", operandBits: 32, immediate: null } });
      expect(result.kind).toBe("executed");
      let flags = 0;
      const lane = (x: number, y: number) => { const e = arithmetic(name, decodeBinary(bits64(x), 64), decodeBinary(bits64(y), 64), formatFor(64), "nearest", "sse"); flags |= e.flags & 63; return encodeBinary(e.value, 64); };
      const low = lane(a, b);
      expect(BigInt.asUintN(64, view.getBigUint64(0, true))).toBe(low);
      if (packed) expect(view.getBigUint64(8, true)).toBe(lane(c, d)); else expect(view.getFloat64(8, true)).toBe(c);
      expect(state.simd.mxcsr & 63).toBe(flags);
    }
  }
});

test("x87 fast path refuses unmasked precision exceptions, directed rounding and values outside the window", () => {
  for (const control of [0x37f & ~0x20, 0x37f | 0x400]) {
    const state = createGuestProcessorState({ architecture: "i386", instructionPointer: 0n, stackPointer: 0n, flags: 0n, x87ControlWord: control, mxcsr: 0x1f80, mxcsrMask: 0xffff });
    const memory = new SparseGuestMemory({ module, pointerBytes: 4 });
    for (const value of [3, 1]) {
      const top = (((state.x87.statusWord >> 11) & 7) - 1) & 7;
      state.x87.statusWord = (state.x87.statusWord & ~0x3800) | (top << 11);
      writeX87Register(state.x87, 0, decodeBinary(bits64(value), 64));
    }
    const result = executeNumericInstruction({ state, memory, instruction: { opcode: 0xd8, secondaryOpcode: null, modrm: 0xf1, registerIndex: 0, operand: { kind: "register", index: 1 }, prefix: "none", operandBits: 32, immediate: null } });
    expect(result.kind).toBe("executed");
    expect((state.x87.statusWord & 0x20) !== 0).toBe(true);
  }
});
