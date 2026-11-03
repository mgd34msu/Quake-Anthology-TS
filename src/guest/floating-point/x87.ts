// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestX87State } from "../core/contracts.ts";
import type { NumericExecutionContext, NumericExecutionResult } from "./contracts.ts";
import { NumericFault } from "./contracts.ts";
import {
  arithmetic, binary80, compareBinary, convertBinary, decodeBinary, denormalOperand, encodeBinary, formatFor,
  fromInteger, indefinite, integerConversion, invalid, overflow, precision, readBits, roundIntegral, rounding, squareRoot, underflow, writeBits, zero,
} from "./binary.ts";
import { loadF32LE, loadF64LE } from "../../foundation/binary.ts";
import type { BinaryFormat, BinaryOperation, BinaryResult, BinaryValue } from "./binary.ts";

import { doubleToExtended, extendedToDouble, fastArithmetic, fastResult, inWindow } from "./fast-arithmetic.ts";
import { x87Arctangent, x87Trigonometric } from "./trigonometric.ts";
import { x87Extract, x87Log2, x87Log2PlusOne, x87Remainder, x87Scale, x87SineCosine, x87Tangent, x87TwoPowerMinusOne } from "./x87-extended.ts";

class DeferredX87Exception extends Error {}
class UnsupportedX87 extends Error {}

function top(state: GuestX87State): number { return (state.statusWord >> 11) & 7; }
function physical(state: GuestX87State, index: number): number { return (top(state) + index) & 7; }
function tag(state: GuestX87State, slot: number): number { return (state.tagWord >> (slot * 2)) & 3; }
function setTag(state: GuestX87State, slot: number, value: number): void {
  state.tagWord = (state.tagWord & ~(3 << (slot * 2))) | (value << (slot * 2));
}
function setTop(state: GuestX87State, value: number): void { state.statusWord = (state.statusWord & ~0x3800) | ((value & 7) << 11); }
function raise(state: GuestX87State, flags: number, roundedUp = false, registerWrapped = false): void {
  state.statusWord = (state.statusWord & ~0x200) | (roundedUp ? 0x200 : 0) | flags;
  const unmasked = flags & ~state.controlWord & 63;
  if (unmasked !== 0) {
    state.statusWord |= 0x8080;
    if ((unmasked & ~(precision | (registerWrapped ? overflow | underflow : 0))) !== 0) throw new DeferredX87Exception();
  }
}
function stackFault(state: GuestX87State, overflowed: boolean): void { raise(state, invalid | 64, overflowed); }
export function readX87Register(state: GuestX87State, index = 0): BinaryValue {
  const slot = physical(state, index);
  if (tag(state, slot) === 3) { stackFault(state, false); return indefinite(); }
  return decodeBinary(readBits(state.registers.subarray(slot * 10, slot * 10 + 10)), 80);
}
export function writeX87Register(state: GuestX87State, index: number, value: BinaryValue): void {
  const slot = physical(state, index);
  state.registers.set(writeBits(encodeBinary(value, 80), 10), slot * 10);
  setTag(state, slot, value.kind === "finite" ? value.coefficient === 0n ? 1 : value.denormal ? 2 : 0 : 2);
}
function rawRegister(state: GuestX87State, index: number): bigint {
  const slot = physical(state, index);
  if (tag(state, slot) === 3) { stackFault(state, false); return encodeBinary(indefinite(), 80); }
  return readBits(state.registers.subarray(slot * 10, slot * 10 + 10));
}
function writeRawRegister(state: GuestX87State, index: number, bits: bigint): void {
  const value = decodeBinary(bits, 80);
  writeX87Register(state, index, value);
  state.registers.set(writeBits(bits, 10), physical(state, index) * 10);
  if ((bits & (0x7fffn << 64n)) === 0n && (bits & ((1n << 64n) - 1n)) !== 0n) setTag(state, physical(state, index), 2);
}
function pushRaw(state: GuestX87State, bits: bigint): void {
  const next = (top(state) - 1) & 7;
  if (tag(state, next) !== 3) { stackFault(state, true); bits = encodeBinary(indefinite(), 80); }
  else state.statusWord &= ~0x200;
  setTop(state, next);
  writeRawRegister(state, 0, bits);
}
export function pushX87(state: GuestX87State, value: BinaryValue): void {
  const next = (top(state) - 1) & 7;
  if (tag(state, next) !== 3) { stackFault(state, true); value = indefinite(); }
  else state.statusWord &= ~0x200;
  setTop(state, next);
  writeX87Register(state, 0, value);
}
export function popX87(state: GuestX87State): void { setTag(state, top(state), 3); setTop(state, top(state) + 1); }
export function initializeX87(state: GuestX87State): void {
  state.controlWord = 0x37f; state.statusWord = 0; state.tagWord = 0xffff;
  state.lastOpcode = 0; state.instructionPointer = 0n; state.dataPointer = 0n;
  state.instructionSelector = 0; state.dataSelector = 0;
}
function resultFormat(state: GuestX87State): BinaryFormat {
  const pc = (state.controlWord >> 8) & 3;
  if (pc === 1) throw new UnsupportedX87("Reserved x87 precision-control encoding");
  return { ...binary80, precision: pc === 0 ? 24 : pc === 2 ? 53 : 64 };
}
function commit(state: GuestX87State, index: number, result: BinaryResult, registerWrapped = false): void {
  raise(state, result.flags, result.roundedUp, registerWrapped);
  writeX87Register(state, index, result.value);
}

export function writeX87Return(state: GuestX87State, value: number, storage: "float32" | "float64"): void {
  const bytes = new Uint8Array(storage === "float32" ? 4 : 8);
  const view = new DataView(bytes.buffer);
  if (storage === "float32") view.setFloat32(0, value, true); else view.setFloat64(0, value, true);
  const decoded = decodeBinary(readBits(bytes), storage === "float32" ? 32 : 64);
  const converted = convertBinary(decoded, binary80, rounding(state.controlWord >> 10));
  raise(state, converted.flags);
  pushX87(state, converted.value);
}
export function readX87Return(state: GuestX87State, storage: "float32" | "float64"): number {
  const width = storage === "float32" ? 32 : 64;
  const result = convertBinary(readX87Register(state), formatFor(width), rounding(state.controlWord >> 10));
  const bytes = writeBits(encodeBinary(result.value, width), width / 8);
  const view = new DataView(bytes.buffer);
  return width === 32 ? view.getFloat32(0, true) : view.getFloat64(0, true);
}

function compare(context: NumericExecutionContext, right: BinaryValue, unorderedQuiet: boolean, integerFlags: boolean): void {
  const state = context.state.x87;
  const left = readX87Register(state);
  const unordered = compareBinary(left, right);
  const invalidOperand = left.kind === "unsupported" || right.kind === "unsupported"
    || (left.kind === "nan" && (!unorderedQuiet || left.signaling)) || (right.kind === "nan" && (!unorderedQuiet || right.signaling));
  raise(state, invalidOperand ? invalid : (left.kind === "finite" && left.denormal) || (right.kind === "finite" && right.denormal) ? denormalOperand : 0);
  if (integerFlags) {
    context.state.flags.set("carry", unordered === "less" || unordered === "unordered");
    context.state.flags.set("zero", unordered === "equal" || unordered === "unordered");
    context.state.flags.set("parity", unordered === "unordered");
    context.state.flags.set("overflow", false); context.state.flags.set("sign", false); context.state.flags.set("auxiliary-carry", false);
  } else {
    state.statusWord = (state.statusWord & ~0x4500) | (unordered === "less" ? 0x100 : unordered === "equal" ? 0x4000 : unordered === "unordered" ? 0x4500 : 0);
  }
}

const floatLimit = 2 ** 120, floatFloor = 2 ** -120;
const operandBytes = new Uint8Array(8);
function fastRegister(state: GuestX87State, index: number): number {
  const slot = physical(state, index);
  return tag(state, slot) === 3 ? Number.NaN : extendedToDouble(state.registers, slot);
}
/**
 * ADD, MUL, SUB(R) and DIV(R) when both operands are exact doubles inside a safe exponent window, in round-to-nearest. Precision
 * control 53 or 24 rounds like the host double (24 only for binary32 operands), and 64 is taken only when the result is exact.
 * Anything else, including an unmasked precision exception, returns false before any state changes.
 */
function fastBinaryInstruction(state: GuestX87State, group: number, right: number, destination: number, reversed: boolean, pop: boolean): boolean {
  if (group === 2 || group === 3 || (state.controlWord & 0xc00) !== 0) return false;
  const control = (state.controlWord >> 8) & 3;
  if (control === 1) return false;
  const slot = physical(state, destination);
  if (tag(state, slot) === 3) return false;
  const left = extendedToDouble(state.registers, slot);
  if (!inWindow(left) || !inWindow(right)) return false;
  const reverse = (group === 5 || group === 7) !== reversed;
  const operation = group === 0 ? 0 : group === 1 ? 1 : group === 4 || group === 5 ? 2 : 3;
  if (!fastArithmetic(operation, reverse ? right : left, reverse ? left : right)) return false;
  let value = fastResult.value;
  let inexact = fastResult.error !== 0;
  let up = fastResult.error !== 0 && (value > 0) === (fastResult.error < 0);
  if (control === 0) {
    if (Math.fround(left) !== left || Math.fround(right) !== right) return false;
    if (value !== 0 && (Math.abs(value) > floatLimit || Math.abs(value) < floatFloor)) return false;
    const rounded = Math.fround(value);
    if (rounded !== value) { inexact = true; up = Math.abs(rounded) > Math.abs(value); value = rounded; }
  } else if (control === 3 && inexact) return false;
  if (inexact && (state.controlWord & precision) === 0) return false;
  state.statusWord = (state.statusWord & ~0x200) | (up ? 0x200 : 0) | (inexact ? precision : 0);
  doubleToExtended(state.registers, slot, value);
  setTag(state, slot, value === 0 ? 1 : 0);
  if (pop) popX87(state);
  return true;
}

function binaryInstruction(context: NumericExecutionContext, group: number, right: BinaryValue, destination: number, reversed: boolean, pop: boolean): void {
  const state = context.state.x87;
  if (group === 2 || group === 3) {
    compare(context, right, false, false);
    if (group === 3) popX87(state);
    return;
  }
  const operation: BinaryOperation = group === 0 ? "add" : group === 1 ? "multiply" : group === 4 || group === 5 ? "subtract" : "divide";
  const left = readX87Register(state, destination);
  const reverse = (group === 5 || group === 7) !== reversed;
  const format = resultFormat(state);
  const mode = rounding(state.controlWord >> 10);
  let result = arithmetic(operation, reverse ? right : left, reverse ? left : right, format, mode);
  let wrapped = false;
  if ((state.controlWord & (overflow | underflow)) !== (overflow | underflow)) {
    const unlimited = arithmetic(operation, reverse ? right : left, reverse ? left : right,
      { ...format, minimumExponent: -100000, maximumExponent: 100000 }, mode);
    if (unlimited.value.kind === "finite" && unlimited.value.coefficient !== 0n) {
      const exponent = unlimited.value.coefficient.toString(2).length - 1 + unlimited.value.exponent;
      const exception = exponent > format.maximumExponent ? overflow : exponent < format.minimumExponent ? underflow : 0;
      if ((exception & ~state.controlWord) !== 0) {
        result = { ...unlimited, value: { ...unlimited.value, exponent: unlimited.value.exponent + (exception === overflow ? -24576 : 24576) }, flags: unlimited.flags | exception };
        wrapped = true;
      }
    }
  }
  commit(state, destination, result, wrapped);
  if (pop) popX87(state);
}

function environmentBytes(state: GuestX87State, width: 16 | 32 | 64): Uint8Array {
  const short = width === 16;
  const bytes = new Uint8Array(short ? 14 : 28);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, state.controlWord, true);
  view.setUint16(short ? 2 : 4, state.statusWord, true);
  view.setUint16(short ? 4 : 8, state.tagWord, true);
  if (short) {
    view.setUint16(6, Number(state.instructionPointer & 0xffffn), true); view.setUint16(8, state.instructionSelector, true);
    view.setUint16(10, Number(state.dataPointer & 0xffffn), true); view.setUint16(12, state.dataSelector, true);
  } else {
    view.setUint32(12, Number(state.instructionPointer & 0xffffffffn), true); view.setUint16(16, state.instructionSelector, true);
    view.setUint16(18, state.lastOpcode, true); view.setUint32(20, Number(state.dataPointer & 0xffffffffn), true); view.setUint16(24, state.dataSelector, true);
  }
  return bytes;
}
function restoreEnvironment(state: GuestX87State, bytes: Uint8Array, width: 16 | 32 | 64): void {
  const short = width === 16;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  state.controlWord = view.getUint16(0, true); state.statusWord = view.getUint16(short ? 2 : 4, true); state.tagWord = view.getUint16(short ? 4 : 8, true);
  state.instructionPointer = BigInt(short ? view.getUint16(6, true) : view.getUint32(12, true));
  state.instructionSelector = view.getUint16(short ? 8 : 16, true);
  state.dataPointer = BigInt(short ? view.getUint16(10, true) : view.getUint32(20, true)); state.dataSelector = view.getUint16(short ? 12 : 24, true);
  state.lastOpcode = short ? 0 : view.getUint16(18, true) & 0x7ff;
  if ((state.statusWord & ~state.controlWord & 63) !== 0) state.statusWord |= 0x8080;
  else state.statusWord &= ~0x8080;
}

function execute(context: NumericExecutionContext): void {
  const { instruction, memory } = context;
  const state = context.state.x87;
  const opcode = instruction.opcode;
  const modrm = instruction.modrm;
  const group = modrm === null ? 0 : (modrm >> 3) & 7;
  const noWait = (opcode === 0xdb && (modrm === 0xe2 || modrm === 0xe3)) || (opcode === 0xdf && modrm === 0xe0)
    || ((opcode === 0xd9 || opcode === 0xdd) && instruction.operand?.kind === "memory" && (group === 6 || group === 7));
  if (!noWait && (state.statusWord & ~state.controlWord & 63) !== 0) throw new NumericFault(16, "Pending x87 floating-point exception");
  if (opcode === 0x9b) return;
  if (modrm === null || instruction.operand === null) throw new UnsupportedX87("x87 instruction requires ModRM and an operand");
  if (opcode === 0xdb && modrm === 0xe2) { state.statusWord &= 0x7f00; return; }
  if (opcode === 0xdb && modrm === 0xe3) { initializeX87(state); return; }
  if (opcode === 0xdf && modrm === 0xe0) { context.state.registers.write("rax", 16, BigInt(state.statusWord)); return; }
  const controlMemory = instruction.operand.kind === "memory" && (opcode === 0xd9 || opcode === 0xdd) && group >= 4;
  if (!controlMemory) {
    state.lastOpcode = ((opcode & 7) << 8) | modrm;
    state.instructionPointer = context.state.instructionPointer;
    state.instructionSelector = context.state.segments.cs.selector;
  }
  if (instruction.operand.kind === "memory") {
    const address = instruction.operand.address;
    if ((opcode === 0xd9 || opcode === 0xdd) && (group === 4 || group === 6)) {
      const size = instruction.operandBits === 16 ? 14 : 28;
      if (group === 4) {
        const bytes = memory.copy(address, size + (opcode === 0xdd ? 80 : 0));
        restoreEnvironment(state, bytes.subarray(0, size), instruction.operandBits);
        if (opcode === 0xdd) {
          for (let index = 0; index < 8; index++) state.registers.set(bytes.subarray(size + index * 10, size + index * 10 + 10), physical(state, index) * 10);
        }
      } else {
        const bytes = new Uint8Array(size + (opcode === 0xdd ? 80 : 0));
        bytes.set(environmentBytes(state, instruction.operandBits));
        if (opcode === 0xdd) for (let index = 0; index < 8; index++) bytes.set(state.registers.subarray(physical(state, index) * 10, physical(state, index) * 10 + 10), size + index * 10);
        memory.write(address, bytes);
        if (opcode === 0xdd) initializeX87(state); else state.controlWord |= 63;
      }
      return;
    }
    if (opcode === 0xd9 && group === 5) {
      state.controlWord = Number(readBits(memory.copy(address, 2)));
      if ((state.statusWord & ~state.controlWord & 63) !== 0) state.statusWord |= 0x8080;
      else state.statusWord &= ~0x8080;
      return;
    }
    if ((opcode === 0xd9 || opcode === 0xdd) && group === 7) { memory.write(address, writeBits(BigInt(opcode === 0xd9 ? state.controlWord : state.statusWord), 2)); return; }
    state.dataPointer = address.byteOffset; state.dataSelector = context.state.segments.ds.selector;
    if (opcode === 0xd8 || opcode === 0xdc) {
      const size = opcode === 0xd8 ? 4 : 8;
      memory.copyInto(address, operandBytes, 0, size);
      if (fastBinaryInstruction(state, group, size === 4 ? loadF32LE(operandBytes, 0) : loadF64LE(operandBytes, 0), 0, false, false)) return;
      binaryInstruction(context, group, decodeBinary(readBits(operandBytes.subarray(0, size)), opcode === 0xd8 ? 32 : 64), 0, false, false);
      return;
    }
    if (opcode === 0xda || opcode === 0xde) {
      const right = opcode === 0xda || opcode === 0xde
        ? fromInteger(BigInt.asIntN(opcode === 0xda ? 32 : 16, readBits(memory.copy(address, opcode === 0xda ? 4 : 2))))
        : decodeBinary(readBits(memory.copy(address, opcode === 0xd8 ? 4 : 8)), opcode === 0xd8 ? 32 : 64);
      binaryInstruction(context, group, right, 0, false, false);
      return;
    }
    const realWidth = opcode === 0xd9 ? 32 : opcode === 0xdd ? 64 : 80;
    const integerWidth = opcode === 0xdb ? 32 : opcode === 0xdf && (group === 5 || group === 7) ? 64 : 16;
    const real = opcode === 0xd9 || opcode === 0xdd || (opcode === 0xdb && (group === 5 || group === 7));
    const load = group === 0 || (group === 5 && (opcode === 0xdb || opcode === 0xdf));
    const store = group === 2 || group === 3 || group === 7 || (group === 1 && (opcode === 0xdb || opcode === 0xdd || opcode === 0xdf));
    if (!load && !store) throw new UnsupportedX87(`Unsupported x87 memory opcode ${opcode.toString(16)}/${group}`);
    if (load) {
      if (realWidth === 80 && real) { pushRaw(state, readBits(memory.copy(address, 10))); return; }
      const value = real ? decodeBinary(readBits(memory.copy(address, realWidth / 8)), realWidth)
        : fromInteger(BigInt.asIntN(integerWidth, readBits(memory.copy(address, integerWidth / 8))));
      const result = convertBinary(value, binary80, rounding(state.controlWord >> 10));
      raise(state, result.flags | (value.kind === "finite" && value.denormal ? denormalOperand : 0));
      pushX87(state, result.value);
    } else {
      const value = readX87Register(state);
      if (real && group !== 1) {
        const result = realWidth === 80 ? { value, flags: 0, roundedUp: false } : convertBinary(value, formatFor(realWidth), rounding(state.controlWord >> 10));
        const tiny = result.value.kind === "finite" && result.value.denormal;
        const rangeException = (result.flags & overflow) | (tiny || (result.flags & underflow) !== 0 ? underflow : 0);
        if ((rangeException & ~state.controlWord) !== 0) raise(state, rangeException, false);
        raise(state, result.flags, result.roundedUp);
        memory.write(address, writeBits(realWidth === 80 ? rawRegister(state, 0) : encodeBinary(result.value, realWidth), realWidth / 8));
      } else {
        const width = opcode === 0xdd && group === 1 ? 64 : integerWidth;
        const result = integerConversion(value, width, group === 1 ? "zero" : rounding(state.controlWord >> 10));
        raise(state, result.flags, result.roundedUp);
        memory.write(address, writeBits(BigInt.asUintN(width, result.value), width / 8));
      }
      if (group === 1 || group === 3 || group === 7) popX87(state);
    }
    return;
  }
  const index = modrm & 7;
  if (opcode === 0xd8) {
    if (fastBinaryInstruction(state, group, fastRegister(state, index), 0, false, false)) return;
    binaryInstruction(context, group, readX87Register(state, index), 0, false, false); return;
  }
  if (opcode === 0xdc || opcode === 0xde) {
    if (opcode === 0xde && modrm === 0xd9) { compare(context, readX87Register(state, 1), false, false); popX87(state); popX87(state); return; }
    if (group === 2 || group === 3) throw new UnsupportedX87("Reserved x87 register comparison encoding");
    if (fastBinaryInstruction(state, group, fastRegister(state, 0), index, true, opcode === 0xde)) return;
    binaryInstruction(context, group, readX87Register(state), index, true, opcode === 0xde); return;
  }
  if (opcode === 0xd9) {
    if (group === 0) { pushRaw(state, rawRegister(state, index)); return; }
    if (group === 1) { const a = rawRegister(state, 0); const b = rawRegister(state, index); writeRawRegister(state, 0, b); writeRawRegister(state, index, a); return; }
    if (modrm === 0xd0) return;
    if (modrm === 0xe0 || modrm === 0xe1) {
      const bits = rawRegister(state, 0); writeRawRegister(state, 0, modrm === 0xe0 ? bits ^ (1n << 79n) : bits & ((1n << 79n) - 1n)); return;
    }
    if (modrm === 0xe4) { compare(context, zero(), false, false); return; }
    if (modrm === 0xe5) {
      const empty = tag(state, top(state)) === 3;
      const value = empty ? zero() : readX87Register(state);
      const bits = empty ? 0x4100 : value.kind === "unsupported" ? 0 : value.kind === "nan" ? 0x100 : value.kind === "infinity" ? 0x500
        : value.coefficient === 0n ? 0x4000 : value.denormal ? 0x4400 : 0x400;
      state.statusWord = (state.statusWord & ~0x4700) | bits | (value.sign === 1 ? 0x200 : 0); return;
    }
    if (modrm === 0xeb) {
      const constant: BinaryValue = { kind: "finite", sign: 0, coefficient: 0xc90fdaa22168c234cn, exponent: -66, denormal: false };
      pushX87(state, convertBinary(constant, binary80, rounding(state.controlWord >> 10)).value);
      return;
    }
    if (modrm === 0xe8 || modrm === 0xee) { pushX87(state, modrm === 0xe8 ? fromInteger(1n) : zero()); return; }
    if (modrm === 0xf6 || modrm === 0xf7) { setTop(state, top(state) + (modrm === 0xf6 ? -1 : 1)); state.statusWord &= ~0x200; return; }
    if (modrm === 0xf3) {
      commit(state, 1, x87Arctangent(readX87Register(state, 1), readX87Register(state), rounding(state.controlWord >> 10)));
      popX87(state); return;
    }
    if (modrm === 0xfa) { commit(state, 0, squareRoot(readX87Register(state), resultFormat(state), rounding(state.controlWord >> 10))); return; }
    if (modrm === 0xfe || modrm === 0xff) {
      const result = x87Trigonometric(readX87Register(state), modrm === 0xff, rounding(state.controlWord >> 10));
      if (result.kind === "out-of-range") { state.statusWord |= 0x400; return; }
      state.statusWord &= ~0x400;
      commit(state, 0, result.result);
      return;
    }
    if (modrm === 0xfc) {
      commit(state, 0, roundIntegral(readX87Register(state), rounding(state.controlWord >> 10))); return;
    }
    const mode = rounding(state.controlWord >> 10);
    if (modrm === 0xf0) { commit(state, 0, x87TwoPowerMinusOne(readX87Register(state), mode)); return; }
    if (modrm === 0xf1 || modrm === 0xf9) {
      const x = readX87Register(state), y = readX87Register(state, 1);
      commit(state, 1, modrm === 0xf1 ? x87Log2(y, x, mode) : x87Log2PlusOne(y, x, mode)); popX87(state); return;
    }
    if (modrm === 0xf2 || modrm === 0xfb) {
      const value = readX87Register(state);
      const pair = modrm === 0xfb ? x87SineCosine(value, mode) : null, tangent = modrm === 0xf2 ? x87Tangent(value, mode) : null;
      if (pair === null && tangent === null) { state.statusWord |= 0x400; return; }
      state.statusWord &= ~0x400;
      if (pair !== null) { commit(state, 0, pair.sine); pushX87(state, pair.cosine.value); raise(state, pair.cosine.flags, pair.cosine.roundedUp); }
      else if (tangent !== null) { commit(state, 0, tangent); pushX87(state, fromInteger(1n)); }
      return;
    }
    if (modrm === 0xf4) {
      const parts = x87Extract(readX87Register(state));
      raise(state, parts.flags); writeX87Register(state, 0, parts.exponent); pushX87(state, parts.significand); return;
    }
    if (modrm === 0xf5 || modrm === 0xf8) {
      const outcome = x87Remainder(readX87Register(state), readX87Register(state, 1), modrm === 0xf5, mode);
      commit(state, 0, outcome.result);
      // C2 reports an incomplete reduction; otherwise C0, C3 and C1 carry quotient bits 2, 1 and 0.
      const q = outcome.quotient;
      state.statusWord = (state.statusWord & ~0x4700) | (outcome.complete ? ((q & 4) !== 0 ? 0x100 : 0) | ((q & 2) !== 0 ? 0x4000 : 0) | ((q & 1) !== 0 ? 0x200 : 0) : 0x400);
      return;
    }
    if (modrm === 0xfd) { commit(state, 0, x87Scale(readX87Register(state), readX87Register(state, 1), mode)); return; }
    throw new UnsupportedX87(`Unsupported x87 special opcode d9 ${modrm.toString(16)}`);
  }
  if (opcode === 0xdd) {
    if (group === 0) { setTag(state, physical(state, index), 3); return; }
    if (group === 2 || group === 3) { writeRawRegister(state, index, rawRegister(state, 0)); if (group === 3) popX87(state); return; }
    if (group === 4 || group === 5) { compare(context, readX87Register(state, index), true, false); if (group === 5) popX87(state); return; }
  }
  if (opcode === 0xda && modrm === 0xe9) { compare(context, readX87Register(state, 1), true, false); popX87(state); popX87(state); return; }
  if ((opcode === 0xdb || opcode === 0xdf) && (group === 5 || group === 6)) {
    compare(context, readX87Register(state, index), group === 5, true); if (opcode === 0xdf) popX87(state); return;
  }
  if ((opcode === 0xda || opcode === 0xdb) && group <= 3) {
    const flags = context.state.flags;
    const condition = group === 0 ? flags.get("carry") : group === 1 ? flags.get("zero") : group === 2 ? flags.get("carry") || flags.get("zero") : flags.get("parity");
    const source = readX87Register(state, index); readX87Register(state);
    if (condition === (opcode === 0xda)) writeX87Register(state, 0, source);
    return;
  }
  throw new UnsupportedX87(`Unsupported x87 opcode ${opcode.toString(16)} ${modrm.toString(16)}`);
}

export function executeX87(context: NumericExecutionContext): NumericExecutionResult {
  try {
    execute(context);
    return { kind: "executed" };
  } catch (error: unknown) {
    if (error instanceof DeferredX87Exception) return { kind: "executed" };
    if (error instanceof UnsupportedX87) return { kind: "unsupported", detail: error.message };
    throw error;
  }
}
