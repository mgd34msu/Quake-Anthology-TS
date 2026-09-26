// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestFlags, GuestIntegerWidth } from "../core/contracts.ts";

export type AluOperation = "add" | "or" | "adc" | "sbb" | "and" | "sub" | "xor" | "cmp" | "test";
export type ShiftOperation = "rol" | "ror" | "rcl" | "rcr" | "shl" | "shr" | "sar";

function parityFlag(byte: number): number {
  byte ^= byte >>> 4;
  return ((0x9669 >>> (byte & 15)) & 1) << 2;
}
function resultBits(width: GuestIntegerWidth, result: bigint): number {
  return (result === 0n ? 0x40 : 0) | (BigInt.asIntN(width, result) < 0n ? 0x80 : 0) | parityFlag(Number(result & 255n));
}

export function resultFlags(width: GuestIntegerWidth, value: bigint, flags: GuestFlags): undefined {
  flags.value = (flags.value & ~0xc4n) | BigInt(resultBits(width, BigInt.asUintN(width, value)));
  return undefined;
}

/** Intel SDM Volume 2, ADD/ADC/SUB/SBB and logical instruction flag definitions. */
export function alu(operation: AluOperation, width: GuestIntegerWidth, left: bigint, right: bigint, flags: GuestFlags): bigint {
  if (width !== 64) return narrowAlu(operation, width, left, right, flags);
  const a = BigInt.asUintN(64, left), b = BigInt.asUintN(64, right);
  let full: bigint, bits = 0, mask = 0x8d5n;
  switch (operation) {
    case "add": case "adc": {
      const incoming = operation === "adc" && flags.get("carry") ? 1n : 0n;
      full = a + b + incoming;
      if (full >= 0x10000000000000000n) bits |= 1;
      if ((~(a ^ b) & (a ^ full) & 0x8000000000000000n) !== 0n) bits |= 0x800;
      if ((a & 15n) + (b & 15n) + incoming > 15n) bits |= 0x10;
      break;
    }
    case "sub": case "cmp": case "sbb": {
      const incoming = operation === "sbb" && flags.get("carry") ? 1n : 0n;
      full = a - b - incoming;
      if (full < 0n) bits |= 1;
      if (((a ^ b) & (a ^ full) & 0x8000000000000000n) !== 0n) bits |= 0x800;
      if ((a & 15n) < (b & 15n) + incoming) bits |= 0x10;
      break;
    }
    case "and": case "test": full = a & b; mask = 0x8c5n; break;
    case "or": full = a | b; mask = 0x8c5n; break;
    case "xor": full = a ^ b; mask = 0x8c5n; break;
  }
  const result = BigInt.asUintN(64, full);
  flags.value = (flags.value & ~mask) | BigInt(bits | resultBits(64, result));
  return result;
}

// Two unsigned 32-bit operands plus carry fit exactly in a JavaScript number.
function narrowAlu(operation: AluOperation, width: 8 | 16 | 32, left: bigint, right: bigint, flags: GuestFlags): bigint {
  const a = Number(BigInt.asUintN(width, left)), b = Number(BigInt.asUintN(width, right));
  const limit = width === 32 ? 0x100000000 : 1 << width, sign = 1 << (width - 1);
  let full: number, bits = 0, mask = 0x8d5n;
  switch (operation) {
    case "add": case "adc": {
      const incoming = operation === "adc" && flags.get("carry") ? 1 : 0;
      full = a + b + incoming;
      if (full >= limit) bits |= 1;
      if ((~(a ^ b) & (a ^ full) & sign) !== 0) bits |= 0x800;
      if ((a & 15) + (b & 15) + incoming > 15) bits |= 0x10;
      break;
    }
    case "sub": case "cmp": case "sbb": {
      const incoming = operation === "sbb" && flags.get("carry") ? 1 : 0;
      full = a - b - incoming;
      if (full < 0) bits |= 1;
      if (((a ^ b) & (a ^ full) & sign) !== 0) bits |= 0x800;
      if ((a & 15) < (b & 15) + incoming) bits |= 0x10;
      break;
    }
    case "and": case "test": full = a & b; mask = 0x8c5n; break;
    case "or": full = a | b; mask = 0x8c5n; break;
    case "xor": full = a ^ b; mask = 0x8c5n; break;
  }
  const result = width === 32 ? full >>> 0 : full & (limit - 1);
  bits |= (result === 0 ? 0x40 : 0) | ((result & sign) !== 0 ? 0x80 : 0) | parityFlag(result & 255);
  flags.value = (flags.value & ~mask) | BigInt(bits);
  return BigInt(result);
}

/** Undefined flags retain their prior bits; defined flags follow Intel's masked-count rules. */
export function shift(operation: ShiftOperation, width: GuestIntegerWidth, value: bigint, count: number, flags: GuestFlags): bigint {
  const masked = count & (width === 64 ? 63 : 31);
  const rotate = operation === "rol" || operation === "ror" || operation === "rcl" || operation === "rcr";
  const throughCarry = operation === "rcl" || operation === "rcr";
  const effective = rotate ? masked % (width + (throughCarry ? 1 : 0)) : masked;
  let result = BigInt.asUintN(width, value);
  if (effective === 0) {
    if (masked !== 0 && operation === "rol") flags.set("carry", (result & 1n) !== 0n);
    if (masked !== 0 && operation === "ror") flags.set("carry", (result & (1n << BigInt(width - 1))) !== 0n);
    return result;
  }
  const sign = 1n << BigInt(width - 1), originalSign = (result & sign) !== 0n;
  let carry = flags.get("carry");
  const amount = BigInt(effective);
  switch (operation) {
    case "rol":
      result = BigInt.asUintN(width, (result << amount) | (result >> BigInt(width - effective)));
      carry = (result & 1n) !== 0n;
      break;
    case "ror":
      result = BigInt.asUintN(width, (result >> amount) | (result << BigInt(width - effective)));
      carry = (result & sign) !== 0n;
      break;
    case "rcl": case "rcr": {
      const extended = (result << 1n) | (carry ? 1n : 0n), other = BigInt(width + 1 - effective);
      const rotated = BigInt.asUintN(width + 1, operation === "rcl"
        ? (extended << amount) | (extended >> other) : (extended >> amount) | (extended << other));
      result = rotated >> 1n; carry = (rotated & 1n) !== 0n;
      break;
    }
    case "shl":
      if (effective < width) carry = ((result >> BigInt(width - effective)) & 1n) !== 0n;
      result = BigInt.asUintN(width, result << amount);
      break;
    case "shr":
      if (effective < width) carry = ((result >> (amount - 1n)) & 1n) !== 0n;
      result >>= amount;
      break;
    case "sar":
      carry = effective >= width ? originalSign : ((result >> (amount - 1n)) & 1n) !== 0n;
      result = BigInt.asUintN(width, BigInt.asIntN(width, result) >> amount);
      break;
  }
  if (rotate || effective < width || operation === "sar") flags.set("carry", carry);
  if (!rotate) resultFlags(width, result, flags);
  if (masked === 1) {
    switch (operation) {
      case "rol": case "rcl": case "shl": flags.set("overflow", ((result & sign) !== 0n) !== carry); break;
      case "ror": case "rcr": flags.set("overflow", ((result & sign) !== 0n) !== ((result & (sign >> 1n)) !== 0n)); break;
      case "shr": flags.set("overflow", originalSign); break;
      case "sar": flags.set("overflow", false); break;
    }
  }
  return result;
}

export function signedMultiply(width: GuestIntegerWidth, left: bigint, right: bigint, flags: GuestFlags): bigint {
  const full = BigInt.asIntN(width, left) * BigInt.asIntN(width, right);
  const result = BigInt.asUintN(width, full), overflow = BigInt.asIntN(width, result) !== full;
  flags.set("carry", overflow);
  flags.set("overflow", overflow);
  return result;
}

export function condition(code: number, flags: GuestFlags): boolean {
  switch (code) {
    case 0: return flags.get("overflow");
    case 1: return !flags.get("overflow");
    case 2: return flags.get("carry");
    case 3: return !flags.get("carry");
    case 4: return flags.get("zero");
    case 5: return !flags.get("zero");
    case 6: return flags.get("carry") || flags.get("zero");
    case 7: return !flags.get("carry") && !flags.get("zero");
    case 8: return flags.get("sign");
    case 9: return !flags.get("sign");
    case 10: return flags.get("parity");
    case 11: return !flags.get("parity");
    case 12: return flags.get("sign") !== flags.get("overflow");
    case 13: return flags.get("sign") === flags.get("overflow");
    case 14: return flags.get("zero") || flags.get("sign") !== flags.get("overflow");
    case 15: return !flags.get("zero") && flags.get("sign") === flags.get("overflow");
    default: throw new RangeError(`Invalid condition code ${code}`);
  }
}
