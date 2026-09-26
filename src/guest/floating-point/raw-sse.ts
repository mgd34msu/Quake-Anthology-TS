// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestProcessorState, GuestSimdState, MappedGuestMemory } from "../core/contracts.ts";
import type { NumericExecutionResult, NumericInstruction, NumericOperand } from "./contracts.ts";

export type RawSseOperation =
  | { readonly kind: "move"; readonly registerIndex: number; readonly size: 4 | 8 | 16; readonly store: boolean; readonly aligned: boolean }
  | { readonly kind: "logic"; readonly registerIndex: number; readonly operation: "and" | "and-not" | "or" | "xor" };
const executed: NumericExecutionResult = { kind: "executed" };
const memoryOperands = new WeakMap<GuestSimdState, Uint8Array>();

export function prepareRawSse(opcode: number, prefix: NumericInstruction["prefix"], registerIndex: number): RawSseOperation | null {
  if (opcode === 0x10 || opcode === 0x11 || (opcode === 0x28 || opcode === 0x29) && (prefix === "none" || prefix === "66")
    || (opcode === 0x6f || opcode === 0x7f) && (prefix === "66" || prefix === "f3")) {
    const scalar = (opcode === 0x10 || opcode === 0x11) && (prefix === "f2" || prefix === "f3");
    return Object.freeze({ kind: "move", registerIndex, size: scalar ? prefix === "f2" ? 8 : 4 : 16,
      store: opcode === 0x11 || opcode === 0x29 || opcode === 0x7f,
      aligned: opcode === 0x28 || opcode === 0x29 || (opcode === 0x6f || opcode === 0x7f) && prefix === "66" });
  }
  if (opcode >= 0x54 && opcode <= 0x57 && (prefix === "none" || prefix === "66")
    || (opcode === 0xdb || opcode === 0xdf || opcode === 0xeb || opcode === 0xef) && prefix === "66") {
    return Object.freeze({ kind: "logic", registerIndex,
      operation: opcode === 0x54 || opcode === 0xdb ? "and" : opcode === 0x55 || opcode === 0xdf ? "and-not"
        : opcode === 0x56 || opcode === 0xeb ? "or" : "xor" });
  }
  return null;
}

function validRegister(bytes: Uint8Array, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && (index + 1) * 16 <= bytes.length;
}
export function executeRawSse(operation: RawSseOperation, operand: NumericOperand, state: GuestProcessorState, memory: MappedGuestMemory): NumericExecutionResult {
  const registers = state.simd.xmm, destination = operation.registerIndex * 16;
  if (!validRegister(registers, operation.registerIndex)) return { kind: "unsupported", detail: "Invalid XMM register index" };
  if (operand.kind === "memory" && (operation.kind === "logic" || operation.aligned) && operand.address.byteOffset % 16n !== 0n)
    return { kind: "exception", vector: 13, detail: "Unaligned 16-byte SIMD operand" };
  if (operand.kind === "register" && !validRegister(registers, operand.index)) return { kind: "unsupported", detail: "Invalid XMM register index" };
  if (operation.kind === "move") {
    const size = operation.size;
    if (operand.kind === "register") {
      const other = operand.index * 16;
      if (operation.store) registers.copyWithin(other, destination, destination + size);
      else registers.copyWithin(destination, other, other + size);
    } else if (operation.store) memory.write(operand.address, registers.subarray(destination, destination + size));
    else {
      memory.copyInto(operand.address, registers, destination, size);
      if (size < 16) registers.fill(0, destination + size, destination + 16);
    }
    return executed;
  }
  let right: Uint8Array, rightOffset = 0;
  if (operand.kind === "register") { right = registers; rightOffset = operand.index * 16; }
  else {
    let retained = memoryOperands.get(state.simd);
    if (retained === undefined) { retained = new Uint8Array(16); memoryOperands.set(state.simd, retained); }
    memory.copyInto(operand.address, retained);
    right = retained;
  }
  for (let index = 0; index < 16; index++) {
    const leftByte = registers[destination + index], rightByte = right[rightOffset + index];
    if (leftByte === undefined || rightByte === undefined) throw new Error("Qualified SSE register or source range is incomplete");
    registers[destination + index] = operation.operation === "and" ? leftByte & rightByte
      : operation.operation === "and-not" ? ~leftByte & rightByte : operation.operation === "or" ? leftByte | rightByte : leftByte ^ rightByte;
  }
  return executed;
}
