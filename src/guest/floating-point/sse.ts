// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestRegister } from "../core/contracts.ts";
import type { NumericExecutionContext, NumericExecutionResult, NumericOperand } from "./contracts.ts";
import { NumericFault } from "./contracts.ts";
import { executeRawSse, prepareRawSse } from "./raw-sse.ts";
import {
  arithmetic, compareBinary, convertBinary, decodeBinary, decodeBinary32, denormalOperand, encodeBinary, formatFor, fromInteger,
  integerConversion, invalid, precision, readBits, rounding, squareRoot, underflow, writeBits, zero,
} from "./binary.ts";
import type { BinaryResult, BinaryValue } from "./binary.ts";

class UnsupportedSse extends Error {}
const registerNames: readonly GuestRegister[] = ["rax", "rcx", "rdx", "rbx", "rsp", "rbp", "rsi", "rdi", "r8", "r9", "r10", "r11", "r12", "r13", "r14", "r15"];
const registerViews = new WeakMap<Uint8Array, Uint8Array[]>();
function generalRegister(index: number): GuestRegister {
  const name = registerNames[index];
  if (name === undefined) throw new UnsupportedSse("Invalid general register index");
  return name;
}
function xmm(context: NumericExecutionContext, index: number): Uint8Array {
  const registers = context.state.simd.xmm;
  if (!Number.isInteger(index) || index < 0 || (index + 1) * 16 > registers.length) throw new UnsupportedSse("Invalid XMM register index");
  let views = registerViews.get(registers);
  if (views === undefined) { views = []; registerViews.set(registers, views); }
  let view = views[index];
  if (view === undefined) { view = registers.subarray(index * 16, index * 16 + 16); views[index] = view; }
  return view;
}
function operand(context: NumericExecutionContext): NumericOperand {
  if (context.instruction.operand === null) throw new UnsupportedSse("SSE instruction requires an operand");
  return context.instruction.operand;
}
function load(context: NumericExecutionContext, byteLength: number, requireAlignment = true): Uint8Array {
  const source = operand(context);
  if (requireAlignment && byteLength === 16) aligned(context);
  return source.kind === "register" ? xmm(context, source.index).slice(0, byteLength) : context.memory.copy(source.address, byteLength);
}
function aligned(context: NumericExecutionContext): void {
  const source = operand(context);
  if (source.kind === "memory" && source.address.byteOffset % 16n !== 0n) throw new NumericFault(13, "Unaligned 16-byte SIMD operand");
}
function signal(context: NumericExecutionContext, flags: number): void {
  const state = context.state.simd;
  state.mxcsr |= flags;
  if ((flags & ~(state.mxcsr >> 7) & 63) !== 0) throw new NumericFault(19, "Unmasked SIMD floating-point exception");
}
function sourceValue(context: NumericExecutionContext, bytes: Uint8Array, width: 32 | 64, offset: number): BinaryValue {
  const value = width === 32
    ? decodeBinary32(((bytes[offset] ?? 0) | (bytes[offset + 1] ?? 0) << 8 | (bytes[offset + 2] ?? 0) << 16 | (bytes[offset + 3] ?? 0) << 24) >>> 0)
    : decodeBinary(new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(0, true), 64);
  return value.kind === "finite" && value.denormal && (context.state.simd.mxcsr & 64) !== 0 ? zero(value.sign) : value;
}
function finish(context: NumericExecutionContext, result: BinaryResult): BinaryResult {
  const flush = (context.state.simd.mxcsr & 0x8000) !== 0 && (context.state.simd.mxcsr & 0x800) !== 0;
  if (flush && result.value.kind === "finite" && result.value.denormal && (result.flags & underflow) !== 0) {
    return { value: zero(result.value.sign), flags: result.flags | underflow | precision, roundedUp: false };
  }
  return result;
}
function lane(bytes: Uint8Array, index: number, width: number): bigint {
  const offset = index * width / 8;
  switch (width) {
    case 8: return BigInt(bytes[offset] ?? 0);
    case 16: return BigInt((bytes[offset] ?? 0) | (bytes[offset + 1] ?? 0) << 8);
    case 32: return BigInt(((bytes[offset] ?? 0) | (bytes[offset + 1] ?? 0) << 8 | (bytes[offset + 2] ?? 0) << 16 | (bytes[offset + 3] ?? 0) << 24) >>> 0);
    case 64: return new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigUint64(0, true);
    default: return readBits(bytes.subarray(offset, offset + width / 8));
  }
}
function setLane(bytes: Uint8Array, index: number, width: number, value: bigint): void {
  const offset = index * width / 8;
  if (width === 8) bytes[offset] = Number(BigInt.asUintN(8, value));
  else if (width === 16 || width === 32 || width === 64) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, width / 8);
    if (width === 16) view.setUint16(0, Number(BigInt.asUintN(16, value)), true);
    else if (width === 32) view.setUint32(0, Number(BigInt.asUintN(32, value)), true);
    else view.setBigUint64(0, value, true);
  } else bytes.set(writeBits(BigInt.asUintN(width, value), width / 8), offset);
}
function integerSource(context: NumericExecutionContext, width: 32 | 64): bigint {
  const source = operand(context);
  return BigInt.asIntN(width, source.kind === "register" ? context.state.registers.read(generalRegister(source.index), width) : readBits(context.memory.copy(source.address, width / 8)));
}

function floating(context: NumericExecutionContext, opcode: number): void {
  const instruction = context.instruction;
  const scalar = instruction.prefix === "f2" || instruction.prefix === "f3";
  const width = instruction.prefix === "66" || instruction.prefix === "f2" ? 64 : 32;
  const count = scalar ? 1 : 128 / width;
  const destination = xmm(context, instruction.registerIndex);
  const leftBytes = destination.slice();
  const rightBytes = load(context, scalar ? width / 8 : 16);
  const output = destination.slice();
  const mode = rounding(context.state.simd.mxcsr >> 13);
  let flags = 0;
  for (let index = 0; index < count; index++) {
    const left = sourceValue(context, leftBytes, width, index * width / 8);
    const right = sourceValue(context, rightBytes, width, index * width / 8);
    let result: BinaryResult;
    if (opcode === 0x51) result = squareRoot(right, formatFor(width), mode);
    else if (opcode === 0x5d || opcode === 0x5f) {
      const comparison = compareBinary(left, right);
      const selected = comparison === "unordered" || comparison === "equal" ? right
        : (opcode === 0x5d ? comparison === "less" : comparison === "greater") ? left : right;
      const special = (left.kind === "nan" && left.signaling) || (right.kind === "nan" && right.signaling);
      result = { value: selected, flags: special ? invalid : (left.kind === "finite" && left.denormal) || (right.kind === "finite" && right.denormal) ? denormalOperand : 0, roundedUp: false };
    } else if (opcode === 0xc2) {
      if (instruction.immediate === null) throw new UnsupportedSse("CMP requires an immediate predicate");
      const predicate = instruction.immediate & 7;
      const comparison = compareBinary(left, right);
      const unordered = comparison === "unordered";
      const less = comparison === "less";
      const equal = comparison === "equal";
      const yes = predicate === 0 ? equal : predicate === 1 ? less : predicate === 2 ? less || equal : predicate === 3 ? unordered
        : predicate === 4 ? !equal : predicate === 5 ? !less : predicate === 6 ? !(less || equal) : !unordered;
      const signalingPredicate = predicate === 1 || predicate === 2 || predicate === 5 || predicate === 6;
      if ((left.kind === "nan" && (left.signaling || signalingPredicate)) || (right.kind === "nan" && (right.signaling || signalingPredicate))) flags |= invalid;
      else if ((left.kind === "finite" && left.denormal) || (right.kind === "finite" && right.denormal)) flags |= denormalOperand;
      setLane(output, index, width, yes ? (1n << BigInt(width)) - 1n : 0n);
      continue;
    } else {
      const operation = opcode === 0x58 ? "add" : opcode === 0x59 ? "multiply" : opcode === 0x5c ? "subtract" : "divide";
      result = arithmetic(operation, left, right, formatFor(width), mode, "sse");
    }
    result = finish(context, result);
    flags |= result.flags;
    setLane(output, index, width, encodeBinary(result.value, width));
  }
  signal(context, flags);
  destination.set(output);
}

function conversions(context: NumericExecutionContext, opcode: number): void {
  const instruction = context.instruction;
  const destination = xmm(context, instruction.registerIndex);
  const mode = rounding(context.state.simd.mxcsr >> 13);
  if (opcode === 0x2a) {
    if (instruction.prefix !== "f2" && instruction.prefix !== "f3") throw new UnsupportedSse("MMX integer conversion is unsupported");
    const width = instruction.prefix === "f2" ? 64 : 32;
    const result = finish(context, convertBinary(fromInteger(integerSource(context, instruction.operandBits === 64 ? 64 : 32)), formatFor(width), mode));
    signal(context, result.flags); setLane(destination, 0, width, encodeBinary(result.value, width)); return;
  }
  if (opcode === 0x2c || opcode === 0x2d) {
    if (instruction.prefix !== "f2" && instruction.prefix !== "f3") throw new UnsupportedSse("MMX float conversion is unsupported");
    const width = instruction.prefix === "f2" ? 64 : 32;
    const outputWidth = instruction.operandBits === 64 ? 64 : 32;
    const input = sourceValue(context, load(context, width / 8), width, 0);
    const result = integerConversion(input, outputWidth, opcode === 0x2c ? "zero" : mode);
    signal(context, result.flags); context.state.registers.write(generalRegister(instruction.registerIndex), outputWidth, result.value); return;
  }
  const output = destination.slice();
  let flags = 0;
  if (opcode === 0x5a) {
    const scalar = instruction.prefix === "f2" || instruction.prefix === "f3";
    const sourceWidth = instruction.prefix === "66" || instruction.prefix === "f2" ? 64 : 32;
    const targetWidth = sourceWidth === 32 ? 64 : 32;
    const count = scalar ? 1 : 2;
    const source = load(context, count * sourceWidth / 8);
    if (!scalar) output.fill(0);
    for (let index = 0; index < count; index++) {
      const value = sourceValue(context, source, sourceWidth, index * sourceWidth / 8);
      const result = finish(context, convertBinary(value, formatFor(targetWidth), mode));
      flags |= result.flags | (value.kind === "finite" && value.denormal ? denormalOperand : 0);
      setLane(output, index, targetWidth, encodeBinary(result.value, targetWidth));
    }
  } else if (opcode === 0x5b) {
    const source = load(context, 16);
    for (let index = 0; index < 4; index++) {
      if (instruction.prefix === "none") {
        const result = convertBinary(fromInteger(BigInt.asIntN(32, lane(source, index, 32))), formatFor(32), mode);
        flags |= result.flags; setLane(output, index, 32, encodeBinary(result.value, 32));
      } else if (instruction.prefix === "66" || instruction.prefix === "f3") {
        const result = integerConversion(sourceValue(context, source, 32, index * 4), 32, instruction.prefix === "f3" ? "zero" : mode);
        flags |= result.flags; setLane(output, index, 32, result.value);
      } else throw new UnsupportedSse("Reserved 5B conversion prefix");
    }
  } else if (opcode === 0xe6) {
    if (instruction.prefix === "f3") {
      const source = load(context, 8);
      for (let index = 0; index < 2; index++) {
        const result = convertBinary(fromInteger(BigInt.asIntN(32, lane(source, index, 32))), formatFor(64), mode);
        flags |= result.flags; setLane(output, index, 64, encodeBinary(result.value, 64));
      }
    } else if (instruction.prefix === "66" || instruction.prefix === "f2") {
      const source = load(context, 16); output.fill(0);
      for (let index = 0; index < 2; index++) {
        const result = integerConversion(sourceValue(context, source, 64, index * 8), 32, instruction.prefix === "66" ? "zero" : mode);
        flags |= result.flags; setLane(output, index, 32, result.value);
      }
    } else throw new UnsupportedSse("Reserved E6 conversion prefix");
  } else throw new UnsupportedSse("Unsupported conversion opcode");
  signal(context, flags); destination.set(output);
}

function packedInteger(context: NumericExecutionContext, opcode: number): void {
  const instruction = context.instruction;
  if (instruction.prefix !== "66") throw new UnsupportedSse("MMX packed integer instruction is unsupported");
  const destination = xmm(context, instruction.registerIndex);
  const a = destination.slice();
  const b = load(context, 16);
  const output = new Uint8Array(16);
  const addWidth = opcode === 0xfc ? 8 : opcode === 0xfd ? 16 : opcode === 0xfe ? 32 : opcode === 0xd4 ? 64 : 0;
  const subtractWidth = opcode === 0xf8 ? 8 : opcode === 0xf9 ? 16 : opcode === 0xfa ? 32 : opcode === 0xfb ? 64 : 0;
  if (addWidth !== 0 || subtractWidth !== 0) {
    const width = addWidth || subtractWidth;
    for (let index = 0; index < 128 / width; index++) setLane(output, index, width, addWidth ? lane(a, index, width) + lane(b, index, width) : lane(a, index, width) - lane(b, index, width));
  } else if ((opcode >= 0x64 && opcode <= 0x66) || (opcode >= 0x74 && opcode <= 0x76)) {
    const width = opcode % 16 === 4 ? 8 : opcode % 16 === 5 ? 16 : 32;
    for (let index = 0; index < 128 / width; index++) {
      const left = BigInt.asIntN(width, lane(a, index, width)); const right = BigInt.asIntN(width, lane(b, index, width));
      setLane(output, index, width, (opcode < 0x70 ? left > right : left === right) ? -1n : 0n);
    }
  } else if ((opcode >= 0x60 && opcode <= 0x62) || (opcode >= 0x68 && opcode <= 0x6a) || opcode === 0x6c || opcode === 0x6d) {
    const width = opcode === 0x6c || opcode === 0x6d ? 64 : (opcode & 7) === 0 ? 8 : (opcode & 7) === 1 ? 16 : 32;
    const high = opcode >= 0x68 && opcode !== 0x6c;
    const start = high ? 64 / width : 0;
    for (let index = 0; index < 64 / width; index++) {
      setLane(output, index * 2, width, lane(a, start + index, width)); setLane(output, index * 2 + 1, width, lane(b, start + index, width));
    }
  } else if (opcode === 0xd5 || opcode === 0xe4 || opcode === 0xe5) {
    for (let index = 0; index < 8; index++) {
      const left = opcode === 0xe5 ? BigInt.asIntN(16, lane(a, index, 16)) : lane(a, index, 16);
      const right = opcode === 0xe5 ? BigInt.asIntN(16, lane(b, index, 16)) : lane(b, index, 16);
      setLane(output, index, 16, opcode === 0xd5 ? left * right : (left * right) >> 16n);
    }
  } else if (opcode === 0xf4) {
    setLane(output, 0, 64, lane(a, 0, 32) * lane(b, 0, 32)); setLane(output, 1, 64, lane(a, 2, 32) * lane(b, 2, 32));
  } else if (opcode === 0xf5) {
    for (let index = 0; index < 4; index++) setLane(output, index, 32,
      BigInt.asIntN(16, lane(a, index * 2, 16)) * BigInt.asIntN(16, lane(b, index * 2, 16))
      + BigInt.asIntN(16, lane(a, index * 2 + 1, 16)) * BigInt.asIntN(16, lane(b, index * 2 + 1, 16)));
  } else if (opcode === 0xf6) {
    for (let half = 0; half < 2; half++) {
      let sum = 0n;
      for (let index = half * 8; index < half * 8 + 8; index++) { const delta = lane(a, index, 8) - lane(b, index, 8); sum += delta < 0n ? -delta : delta; }
      setLane(output, half, 64, sum);
    }
  } else if ([0xd1, 0xd2, 0xd3, 0xe1, 0xe2, 0xf1, 0xf2, 0xf3].includes(opcode)) {
    const width = (opcode & 15) === 1 ? 16 : (opcode & 15) === 2 ? 32 : 64;
    const count = lane(b, 0, 64);
    for (let index = 0; index < 128 / width; index++) {
      const value = lane(a, index, width);
      const signed = BigInt.asIntN(width, value);
      const shifted = opcode >= 0xf0 ? count >= BigInt(width) ? 0n : value << count
        : opcode >= 0xe0 ? count >= BigInt(width) ? signed < 0n ? -1n : 0n : signed >> count
          : count >= BigInt(width) ? 0n : value >> count;
      setLane(output, index, width, shifted);
    }
  } else throw new UnsupportedSse(`Unsupported packed integer opcode ${opcode.toString(16)}`);
  destination.set(output);
}

function execute(context: NumericExecutionContext): void {
  const instruction = context.instruction;
  const opcode = instruction.secondaryOpcode;
  if (opcode === null) throw new UnsupportedSse("Missing SSE secondary opcode");
  if ([0x14, 0x15, 0x28, 0x29, 0x2e, 0x2f, 0x50, 0x54, 0x55, 0x56, 0x57, 0xc6].includes(opcode)
    && instruction.prefix !== "none" && instruction.prefix !== "66") throw new UnsupportedSse("Reserved mandatory prefix for SSE instruction");
  if (opcode === 0xae) {
    const source = operand(context);
    if (source.kind !== "memory" || instruction.modrm === null) throw new UnsupportedSse("MXCSR instruction requires memory");
    const group = (instruction.modrm >> 3) & 7;
    if (group === 2) {
      const value = Number(readBits(context.memory.copy(source.address, 4)));
      if ((BigInt(value) & ~BigInt(context.state.simd.mxcsrMask)) !== 0n) throw new NumericFault(13, "Reserved MXCSR bits are set");
      context.state.simd.mxcsr = value;
    } else if (group === 3) context.memory.write(source.address, writeBits(BigInt(context.state.simd.mxcsr), 4));
    else throw new UnsupportedSse("FXSAVE/FXRSTOR/fence opcode is unsupported by the numeric executor");
    return;
  }
  if (opcode === 0x2a || opcode === 0x2c || opcode === 0x2d || opcode === 0x5a || opcode === 0x5b || opcode === 0xe6) { conversions(context, opcode); return; }
  const raw = prepareRawSse(opcode, instruction.prefix, instruction.registerIndex);
  if (raw !== null) {
    const result = executeRawSse(raw, operand(context), context.state, context.memory);
    if (result.kind === "unsupported") throw new UnsupportedSse(result.detail);
    if (result.kind === "exception") throw new NumericFault(result.vector, result.detail);
    return;
  }
  const destination = xmm(context, instruction.registerIndex);
  if (opcode === 0x6f || opcode === 0x7f) throw new UnsupportedSse("MMX move is unsupported");
  if (opcode === 0x6e || opcode === 0x7e) {
    if (opcode === 0x7e && instruction.prefix === "f3") { const bytes = load(context, 8); destination.fill(0); destination.set(bytes); return; }
    if (instruction.prefix !== "66") throw new UnsupportedSse("MMX MOVD/MOVQ is unsupported");
    const width = instruction.operandBits === 64 ? 64 : 32;
    if (opcode === 0x6e) { const value = integerSource(context, width); destination.fill(0); destination.set(writeBits(value, width / 8)); }
    else {
      const target = operand(context); const bits = readBits(destination.subarray(0, width / 8));
      if (target.kind === "register") context.state.registers.write(generalRegister(target.index), width, bits); else context.memory.write(target.address, writeBits(bits, width / 8));
    }
    return;
  }
  if (opcode === 0xd6 && instruction.prefix === "66") {
    const target = operand(context); const bytes = destination.slice(0, 8);
    if (target.kind === "register") { const register = xmm(context, target.index); register.fill(0); register.set(bytes); }
    else context.memory.write(target.address, bytes); return;
  }
  if (opcode === 0x12 || opcode === 0x13 || opcode === 0x16 || opcode === 0x17) {
    if (instruction.prefix !== "none" && instruction.prefix !== "66") throw new UnsupportedSse("SSE3 duplicate move is unsupported");
    const source = operand(context); const high = opcode === 0x16 || opcode === 0x17;
    if (opcode === 0x13 || opcode === 0x17) {
      if (source.kind !== "memory") throw new UnsupportedSse("MOVL/MOVH store requires memory");
      context.memory.write(source.address, destination.slice(high ? 8 : 0, high ? 16 : 8));
    } else if (source.kind === "memory") destination.set(context.memory.copy(source.address, 8), high ? 8 : 0);
    else {
      if (instruction.prefix === "66") throw new UnsupportedSse("MOVLPD/MOVHPD load requires memory");
      destination.set(xmm(context, source.index).slice(high ? 0 : 8, high ? 8 : 16), high ? 8 : 0);
    }
    return;
  }
  if (opcode === 0x14 || opcode === 0x15 || opcode === 0xc6 || opcode === 0x70) {
    const source = load(context, 16); const original = destination.slice(); const output = destination.slice();
    if (opcode === 0x70) {
      if (instruction.immediate === null) throw new UnsupportedSse("Shuffle requires immediate");
      if (instruction.prefix === "66") for (let index = 0; index < 4; index++) setLane(output, index, 32, lane(source, (instruction.immediate >> (2 * index)) & 3, 32));
      else if (instruction.prefix === "f2" || instruction.prefix === "f3") {
        output.set(source); const start = instruction.prefix === "f3" ? 4 : 0;
        for (let index = 0; index < 4; index++) setLane(output, start + index, 16, lane(source, start + ((instruction.immediate >> (2 * index)) & 3), 16));
      } else throw new UnsupportedSse("MMX shuffle is unsupported");
    } else {
      const width = instruction.prefix === "66" ? 64 : 32;
      if (opcode === 0xc6) {
        if (instruction.immediate === null) throw new UnsupportedSse("Shuffle requires immediate");
        for (let index = 0; index < 128 / width; index++) {
          const from = index < 64 / width ? original : source;
          const selected = (instruction.immediate >> (index * (width === 32 ? 2 : 1))) & (width === 32 ? 3 : 1);
          setLane(output, index, width, lane(from, selected, width));
        }
      } else {
        const start = opcode === 0x15 ? 64 / width : 0;
        for (let index = 0; index < 64 / width; index++) { setLane(output, index * 2, width, lane(original, start + index, width)); setLane(output, index * 2 + 1, width, lane(source, start + index, width)); }
      }
    }
    destination.set(output); return;
  }
  if (opcode === 0x50 || opcode === 0xd7) {
    if (operand(context).kind !== "register") throw new UnsupportedSse("MOVMSK/PMOVMSKB requires a register source");
    const source = load(context, 16); const width = opcode === 0xd7 ? 8 : instruction.prefix === "66" ? 64 : 32;
    if (opcode === 0xd7 && instruction.prefix !== "66") throw new UnsupportedSse("MMX PMOVMSKB is unsupported");
    let mask = 0n;
    for (let index = 0; index < 128 / width; index++) mask |= ((lane(source, index, width) >> BigInt(width - 1)) & 1n) << BigInt(index);
    context.state.registers.write(generalRegister(instruction.registerIndex), 32, mask); return;
  }
  if (opcode === 0x2e || opcode === 0x2f) {
    const width = instruction.prefix === "66" ? 64 : 32;
    const left = sourceValue(context, destination, width, 0); const right = sourceValue(context, load(context, width / 8), width, 0);
    const comparison = compareBinary(left, right);
    const nan = (left.kind === "nan" && (opcode === 0x2f || left.signaling)) || (right.kind === "nan" && (opcode === 0x2f || right.signaling));
    signal(context, nan ? invalid : (left.kind === "finite" && left.denormal) || (right.kind === "finite" && right.denormal) ? denormalOperand : 0);
    const flags = context.state.flags;
    flags.set("carry", comparison === "less" || comparison === "unordered"); flags.set("zero", comparison === "equal" || comparison === "unordered"); flags.set("parity", comparison === "unordered");
    flags.set("overflow", false); flags.set("auxiliary-carry", false); flags.set("sign", false); return;
  }
  if ([0x51, 0x58, 0x59, 0x5c, 0x5d, 0x5e, 0x5f, 0xc2].includes(opcode)) { floating(context, opcode); return; }
  if (opcode === 0xc4 || opcode === 0xc5) {
    if (instruction.prefix !== "66" || instruction.immediate === null) throw new UnsupportedSse("PINSRW/PEXTRW requires SSE2 prefix and immediate");
    const index = instruction.immediate & 7;
    if (opcode === 0xc4) {
      const source = operand(context);
      const value = source.kind === "register" ? context.state.registers.read(generalRegister(source.index), 32) : readBits(context.memory.copy(source.address, 2));
      setLane(destination, index, 16, value);
    } else {
      if (operand(context).kind !== "register") throw new UnsupportedSse("PEXTRW requires XMM source");
      context.state.registers.write(generalRegister(instruction.registerIndex), 32, lane(load(context, 16), index, 16));
    }
    return;
  }
  if (opcode === 0x71 || opcode === 0x72 || opcode === 0x73) {
    const target = operand(context);
    if (instruction.prefix !== "66" || instruction.immediate === null || instruction.modrm === null || target.kind !== "register") throw new UnsupportedSse("Immediate packed shift requires SSE2 register and immediate");
    const group = (instruction.modrm >> 3) & 7; const count = instruction.immediate;
    const register = xmm(context, target.index); const original = register.slice();
    if (opcode === 0x73 && (group === 3 || group === 7)) {
      register.set(writeBits(count >= 16 ? 0n : group === 3 ? readBits(original) >> BigInt(count * 8) : readBits(original) << BigInt(count * 8), 16)); return;
    }
    if (group !== 2 && group !== 4 && group !== 6) throw new UnsupportedSse("Reserved packed shift group");
    const width = opcode === 0x71 ? 16 : opcode === 0x72 ? 32 : 64;
    if (width === 64 && group === 4) throw new UnsupportedSse("PSRAQ is unavailable in legacy SSE2");
    for (let index = 0; index < 128 / width; index++) {
      const value = lane(original, index, width); const signed = BigInt.asIntN(width, value);
      setLane(register, index, width, group === 4 ? count >= width ? signed < 0n ? -1n : 0n : signed >> BigInt(count)
        : count >= width ? 0n : group === 2 ? value >> BigInt(count) : value << BigInt(count));
    }
    return;
  }
  packedInteger(context, opcode);
}

export function executeSse(context: NumericExecutionContext): NumericExecutionResult {
  try { execute(context); return { kind: "executed" }; }
  catch (error: unknown) { if (error instanceof UnsupportedSse) return { kind: "unsupported", detail: error.message }; throw error; }
}
