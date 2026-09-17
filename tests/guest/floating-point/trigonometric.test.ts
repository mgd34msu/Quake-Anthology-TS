import { expect, test } from "bun:test";
import { createContentDigest } from "../../../src/contracts/content.ts";
import type { ModuleIdentity } from "../../../src/contracts/execution.ts";
import { createGuestProcessorState, SparseGuestMemory } from "../../../src/guest/core/index.ts";
import { executeNumericInstruction, readX87Register, readX87Return } from "../../../src/guest/floating-point/index.ts";
import { pushX87 } from "../../../src/guest/floating-point/x87.ts";
import { decodeBinary, encodeBinary, fromInteger, zero } from "../../../src/guest/floating-point/binary.ts";
import type { BinaryValue } from "../../../src/guest/floating-point/binary.ts";
const module: ModuleIdentity = { id: "test:x87-trig", artifactPath: "authored-x87-vectors", revision: "1", digest: createContentDigest("66".repeat(32)) };
function fixture(value: BinaryValue, control = 0x37f) {
  const state = createGuestProcessorState({ architecture: "i386", instructionPointer: 0n, stackPointer: 0n, flags: 0n, x87ControlWord: control, mxcsr: 0x1f80, mxcsrMask: 0xffff });
  const memory = new SparseGuestMemory({ module, pointerBytes: 4 }); pushX87(state.x87, value);
  return { state, bits: () => encodeBinary(readX87Register(state.x87), 80), run: (cosine = false) => executeNumericInstruction({ state, memory, instruction: { opcode: 0xd9, secondaryOpcode: null, modrm: cosine ? 0xff : 0xfe, registerIndex: 7, operand: { kind: "register", index: cosine ? 7 : 6 }, prefix: "none", operandBits: 32, immediate: null } }) };
}
test("x87 trig preserves signed zero, full precision and Intel's 68-bit pi reduction", () => {
  const negativeZero = fixture(zero(1)); expect(negativeZero.run().kind).toBe("executed"); expect(negativeZero.bits()).toBe(0x80000000000000000000n);
  const cosineZero = fixture(zero()); expect(cosineZero.run(true).kind).toBe("executed"); expect(cosineZero.bits()).toBe(0x3fff8000000000000000n);
  const pi = fixture(decodeBinary(0x4000c90fdaa22168c235n, 80)); expect(pi.run().kind).toBe("executed"); expect(pi.bits()).toBe(0xbfbf8000000000000000n);
  const one = fixture(fromInteger(1n), 0x7f); expect(one.run().kind).toBe("executed"); expect(one.bits()).toBe(0x3ffed76aa47848677021n); expect(one.state.x87.statusWord & 32).toBe(32);
});
test("x87 trig range and exceptional operands follow deferred exception state", () => {
  for (const value of [fromInteger(1n << 63n), fromInteger(-(1n << 63n))]) { const f = fixture(value), bits = f.bits(); expect(f.run().kind).toBe("executed"); expect(f.bits()).toBe(bits); expect(f.state.x87.statusWord & 0x400).toBe(0x400); }
  const infinite = fixture({ kind: "infinity", sign: 0 }); expect(infinite.run().kind).toBe("executed"); expect(infinite.state.x87.statusWord & 1).toBe(1); expect(readX87Register(infinite.state.x87).kind).toBe("nan");
  const unmasked = fixture({ kind: "infinity", sign: 0 }, 0x37e); expect(unmasked.run().kind).toBe("executed"); expect(readX87Register(unmasked.state.x87).kind).toBe("infinity"); expect(unmasked.state.x87.statusWord & 0x8081).toBe(0x8081); expect(unmasked.run().kind).toBe("exception");
  const denormal = fixture(decodeBinary(1n, 80)); expect(denormal.run().kind).toBe("executed"); expect(denormal.state.x87.statusWord & 2).toBe(2); expect(denormal.bits()).toBe(1n);
});
test("x87 cosine tiny inputs obey directed rounding without losing the subtraction", () => {
  for (const exponent of [-128, -1000]) {
  const value: BinaryValue = { kind: "finite", sign: 0, coefficient: 1n, exponent, denormal: false };
  for (const mode of [0, 1, 2, 3]) { const f = fixture(value, 0x37f | mode << 10); expect(f.run(true).kind).toBe("executed"); expect(f.bits()).toBe(mode === 1 || mode === 3 ? 0x3ffeffffffffffffffffn : 0x3fff8000000000000000n); }
  }
});

test("FLDPI rounds the architectural constant without raising precision", () => {
  for (const mode of [0, 1, 2, 3]) {
    const state = createGuestProcessorState({ architecture: "i386", instructionPointer: 0n, stackPointer: 0n, flags: 0n, x87ControlWord: 0x7f | mode << 10, mxcsr: 0x1f80, mxcsrMask: 0xffff });
    const memory = new SparseGuestMemory({ module, pointerBytes: 4 });
    expect(executeNumericInstruction({ state, memory, instruction: { opcode: 0xd9, secondaryOpcode: null, modrm: 0xeb, registerIndex: 5, operand: { kind: "register", index: 3 }, prefix: "none", operandBits: 32, immediate: null } }).kind).toBe("executed");
    expect(encodeBinary(readX87Register(state.x87), 80)).toBe(mode === 1 || mode === 3 ? 0x4000c90fdaa22168c234n : 0x4000c90fdaa22168c235n);
    expect(state.x87.statusWord & 0x220).toBe(0);
  }
});

function arctangent(y: BinaryValue, x: BinaryValue, control = 0x37f) {
  const state = createGuestProcessorState({ architecture: "i386", instructionPointer: 0n, stackPointer: 0n, flags: 0n, x87ControlWord: control, mxcsr: 0x1f80, mxcsrMask: 0xffff });
  const memory = new SparseGuestMemory({ module, pointerBytes: 4 });
  pushX87(state.x87, y); pushX87(state.x87, x);
  return { state, bits: () => encodeBinary(readX87Register(state.x87), 80), run: () => executeNumericInstruction({ state, memory, instruction: { opcode: 0xd9, secondaryOpcode: null, modrm: 0xf3, registerIndex: 6, operand: { kind: "register", index: 3 }, prefix: "none", operandBits: 32, immediate: null } }) };
}
test("FPATAN uses Cartesian quadrants and pops once at full extended precision", () => {
  for (const [x, expected] of [[1n, 0x3ffec90fdaa22168c235n], [-1n, 0x400096cbe3f9990e91a8n]]) {
    if (x === undefined || expected === undefined) throw new Error("Missing arctangent vector");
    for (const negative of [false, true]) {
      const f = arctangent(fromInteger(negative ? -1n : 1n), fromInteger(x), 0x7f);
      const previousTop = f.state.x87.statusWord & 0x3800;
      expect(f.run().kind).toBe("executed");
      expect(f.bits()).toBe(expected | (negative ? 1n << 79n : 0n));
      expect(f.state.x87.statusWord & 0x3800).toBe((previousTop + 0x800) & 0x3800);
      expect(f.state.x87.statusWord & 32).toBe(32);
    }
  }
});
test("FPATAN defines signed zero and infinite axes without division exceptions", () => {
  for (const sign of [0, 1]) {
    const y = zero(sign === 0 ? 0 : 1);
    const positive = arctangent(y, zero()); positive.run(); expect(positive.bits()).toBe(BigInt(sign) << 79n); expect(positive.state.x87.statusWord & 63).toBe(0);
    const negative = arctangent(y, zero(1)); negative.run(); expect(negative.bits()).toBe(0x4000c90fdaa22168c235n | BigInt(sign) << 79n); expect(negative.state.x87.statusWord & 5).toBe(0);
  }
  const both = arctangent({ kind: "infinity", sign: 0 }, { kind: "infinity", sign: 0 }); both.run(); expect(both.bits()).toBe(0x3ffec90fdaa22168c235n); expect(both.state.x87.statusWord & 5).toBe(0);
  const axis = arctangent(fromInteger(1n), zero()); axis.run(); expect(axis.bits()).toBe(0x3fffc90fdaa22168c235n);
});
test("FPATAN keeps tiny ratios and respects denormal and deferred invalid exceptions", () => {
  const nearest = arctangent(decodeBinary(1n, 80), fromInteger(1n)); nearest.run(); expect(nearest.bits()).toBe(1n); expect(nearest.state.x87.statusWord & 50).toBe(50);
  const down = arctangent(decodeBinary(1n, 80), fromInteger(1n), 0x77f); down.run(); expect(down.bits()).toBe(0n); expect(down.state.x87.statusWord & 50).toBe(50);
  const bad = arctangent({ kind: "nan", sign: 0, payload: 1n, signaling: true }, fromInteger(1n), 0x37e);
  const top = bad.state.x87.statusWord & 0x3800; expect(bad.run().kind).toBe("executed"); expect(bad.state.x87.statusWord & 0x3800).toBe(top); expect(bad.bits()).toBe(0x3fff8000000000000000n); expect(bad.run().kind).toBe("exception");
});

test("FPATAN evaluates finite ratios in both reduced branches and all quadrants", () => {
  for (const y of [-99, -3, 1, 7]) for (const x of [-31, -2, 1, 17]) {
    const f = arctangent(fromInteger(BigInt(y)), fromInteger(BigInt(x)));
    expect(f.run().kind).toBe("executed");
    expect(readX87Return(f.state.x87, "float64")).toBeCloseTo(Math.atan2(y, x), 14);
  }
  for (const mode of [0, 1, 2, 3]) {
    const f = arctangent(fromInteger(1n), fromInteger(1n), 0x37f | mode << 10); f.run();
    expect(f.bits()).toBe(mode === 1 || mode === 3 ? 0x3ffec90fdaa22168c234n : 0x3ffec90fdaa22168c235n);
  }
});
