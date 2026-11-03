// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createContentDigest } from "../../../src/contracts/content.ts";
import type { ModuleIdentity } from "../../../src/contracts/execution.ts";
import { createGuestProcessorState, SparseGuestMemory } from "../../../src/guest/core/index.ts";
import { executeNumericInstruction } from "../../../src/guest/floating-point/index.ts";
import { arithmetic, binary32, decodeBinary32, encodeBinary } from "../../../src/guest/floating-point/binary.ts";
import type { BinaryOperation } from "../../../src/guest/floating-point/binary.ts";

const module: ModuleIdentity = { id: "test:sse-fast", artifactPath: "authored-sse-vectors", revision: "1", digest: createContentDigest("68".repeat(32)) };
const operations: readonly (readonly [number, BinaryOperation])[] = [[0x58, "add"], [0x5c, "subtract"], [0x59, "multiply"], [0x5e, "divide"]];

function float32Bits(value: number): number { const view = new DataView(new ArrayBuffer(4)); view.setFloat32(0, value, true); return view.getUint32(0, true); }
function execute(opcode: number, a: number, b: number, mxcsr: number) {
  const state = createGuestProcessorState({ architecture: "i386", instructionPointer: 0n, stackPointer: 0n, flags: 0n, x87ControlWord: 0x37f, mxcsr, mxcsrMask: 0xffff });
  const view = new DataView(state.simd.xmm.buffer, state.simd.xmm.byteOffset, 32);
  view.setUint32(0, a, true); view.setUint32(16, b, true); view.setUint32(4, 0x11223344, true);
  const memory = new SparseGuestMemory({ module, pointerBytes: 4 });
  executeNumericInstruction({ state, memory, instruction: { opcode: 0x0f, secondaryOpcode: opcode, modrm: 0xc1, registerIndex: 0, operand: { kind: "register", index: 1 },
    prefix: "f3", operandBits: 32, immediate: null } });
  return { bits: view.getUint32(0, true), upper: view.getUint32(4, true), status: state.simd.mxcsr & 63 };
}

test("binary32 scalar arithmetic on the fast path matches the exact rational path, including inexact flags", () => {
  let seed = 0x12345678;
  const random = (): number => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed; };
  const specials = [0, 0x80000000, 0x3f800000, 0xbf800000, 0x00800000, 0x7f7fffff, 0x7f800000, 0x7fc00000, 0x00000001, 0x3effffff, 0x40490fdb, float32Bits(0.1), float32Bits(3)];
  const samples: number[] = [...specials];
  for (let index = 0; index < 400; index++) samples.push(random(), ((random() & 0x807fffff) | (((random() % 24) + 115) << 23)) >>> 0);
  for (const [opcode, name] of operations) {
    for (let index = 0; index < 1500; index++) {
      const a = samples[random() % samples.length] ?? 0, b = samples[random() % samples.length] ?? 0;
      const expected = arithmetic(name, decodeBinary32(a), decodeBinary32(b), binary32, "nearest", "sse");
      const actual = execute(opcode, a, b, 0x1f80);
      expect(actual.upper).toBe(0x11223344);
      // The exact path canonicalizes nothing here: both quiet NaNs and numbers are compared as encoded bits.
      expect([actual.bits, actual.status]).toEqual([Number(encodeBinary(expected.value, 32)), expected.flags & 63]);
    }
  }
});

test("directed rounding still takes the exact path", () => {
  const down = execute(0x58, float32Bits(1), float32Bits(2 ** -30), 0x1f80 | (1 << 13));
  const nearest = execute(0x58, float32Bits(1), float32Bits(2 ** -30), 0x1f80);
  expect(down.bits).toBe(0x3f800000); expect(nearest.bits).toBe(0x3f800000);
  const up = execute(0x58, float32Bits(1), float32Bits(2 ** -30), 0x1f80 | (2 << 13));
  expect(up.bits).toBe(0x3f800001);
});
