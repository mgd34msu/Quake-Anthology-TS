// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createContentDigest } from "../../../src/contracts/content.ts";
import type { ModuleIdentity } from "../../../src/contracts/execution.ts";
import { createGuestProcessorState, SparseGuestMemory } from "../../../src/guest/core/index.ts";
import { executeNumericInstruction, readX87Register, readX87Return } from "../../../src/guest/floating-point/index.ts";
import { popX87, pushX87 } from "../../../src/guest/floating-point/x87.ts";
import { decodeBinary, encodeBinary, fromInteger } from "../../../src/guest/floating-point/binary.ts";
import type { BinaryValue } from "../../../src/guest/floating-point/binary.ts";

const module: ModuleIdentity = { id: "test:x87-extended", artifactPath: "authored-x87-vectors", revision: "1", digest: createContentDigest("67".repeat(32)) };
const double = (value: number): BinaryValue => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, true);
  return decodeBinary(new DataView(bytes.buffer).getBigUint64(0, true), 64);
};
/** Operands are listed from ST(0) downward. */
function run(modrm: number, ...stack: readonly BinaryValue[]) {
  const state = createGuestProcessorState({
    architecture: "i386",
    instructionPointer: 0n,
    stackPointer: 0n,
    flags: 0n,
    x87ControlWord: 0x37f,
    mxcsr: 0x1f80,
    mxcsrMask: 0xffff,
  });
  const memory = new SparseGuestMemory({ module, pointerBytes: 4 });
  for (const value of [...stack].reverse()) pushX87(state.x87, value);
  const result = executeNumericInstruction({
    state,
    memory,
    instruction: {
      opcode: 0xd9,
      secondaryOpcode: null,
      modrm,
      registerIndex: (modrm >> 3) & 7,
      operand: { kind: "register", index: modrm & 7 },
      prefix: "none",
      operandBits: 32,
      immediate: null,
    },
  });
  expect(result.kind).toBe("executed");
  return { state, st0: () => readX87Return(state.x87, "float64"), pop: () => popX87(state.x87), bits: () => encodeBinary(readX87Register(state.x87), 80) };
}

test("FSCALE multiplies by two to the truncated ST(1)", () => {
  expect(run(0xfd, double(3), double(2.9)).st0()).toBe(12);
  expect(run(0xfd, double(3), double(-1.9)).st0()).toBe(1.5);
  expect(run(0xfd, double(-0.75), double(0)).st0()).toBe(-0.75);
});

test("FPREM truncates and FPREM1 rounds the quotient, reporting its low bits in C0, C3 and C1", () => {
  const trunc = run(0xf8, double(10), double(3));
  expect(trunc.st0()).toBe(1);
  expect(trunc.state.x87.statusWord & 0x4700).toBe(0x4200);
  const nearest = run(0xf5, double(11), double(3));
  expect(nearest.st0()).toBe(-1);
  expect(nearest.state.x87.statusWord & 0x4700).toBe(0x100);
  const tie = run(0xf5, double(5), double(2));
  expect(tie.st0()).toBe(1);
  expect(tie.state.x87.statusWord & 0x4700).toBe(0x4000);
});

test("FPREM reports an incomplete reduction when the exponents are far apart", () => {
  const first = run(0xf8, double(2 ** 100 + 2 ** 60), double(3));
  expect(first.state.x87.statusWord & 0x400).toBe(0x400);
  expect(first.st0()).toBeLessThan(2 ** 100);
});

test("F2XM1, FYL2X and FYL2XP1 are exact at their exact points and accurate elsewhere", () => {
  expect(run(0xf0, double(1)).st0()).toBe(1);
  expect(run(0xf0, double(-1)).st0()).toBe(-0.5);
  expect(run(0xf0, double(0.5)).st0()).toBeCloseTo(Math.SQRT2 - 1, 15);
  const log = run(0xf1, double(8), double(1));
  expect(log.st0()).toBe(3);
  const negative = run(0xf1, double(0.5), double(2));
  expect(negative.st0()).toBe(-2);
  const inexact = run(0xf1, double(10), double(1));
  expect(inexact.st0()).toBeCloseTo(Math.log2(10), 15);
  expect(inexact.state.x87.statusWord & 32).toBe(32);
  const plusOne = run(0xf9, double(0.5), double(1));
  expect(plusOne.st0()).toBeCloseTo(Math.log2(1.5), 15);
  const zero = run(0xf1, double(0), double(1));
  expect(zero.st0()).toBe(-Infinity);
  expect(zero.state.x87.statusWord & 4).toBe(4);
});

test("FPTAN, FSINCOS and FXTRACT push their second result", () => {
  const tangent = run(0xf2, double(0.5));
  expect(tangent.st0()).toBe(1);
  tangent.pop();
  expect(tangent.st0()).toBeCloseTo(Math.tan(0.5), 15);
  const pair = run(0xfb, double(1));
  expect(pair.st0()).toBeCloseTo(Math.cos(1), 15);
  pair.pop();
  expect(pair.st0()).toBeCloseTo(Math.sin(1), 15);
  const far = run(0xf2, fromInteger(1n << 63n));
  expect(far.state.x87.statusWord & 0x400).toBe(0x400);
  const parts = run(0xf4, double(12));
  expect(parts.st0()).toBe(1.5);
  parts.pop();
  expect(parts.st0()).toBe(3);
});
