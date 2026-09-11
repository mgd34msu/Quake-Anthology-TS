// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestFlags, GuestIntegerWidth } from "../core/contracts.ts";

export type AluOperation = "add" | "or" | "adc" | "sbb" | "and" | "sub" | "xor" | "cmp" | "test";
export type ShiftOperation = "rol" | "ror" | "rcl" | "rcr" | "shl" | "shr" | "sar";

export function resultFlags(width: GuestIntegerWidth, value: bigint, flags: GuestFlags): undefined {
  const result = BigInt.asUintN(width, value);
  flags.set("zero", result === 0n);
  flags.set("sign", (result & (1n << BigInt(width - 1))) !== 0n);
  let byte = Number(result & 255n), parity = true;
  while (byte !== 0) { parity = !parity; byte &= byte - 1; }
  flags.set("parity", parity);
  return undefined;
}

/** Intel SDM Volume 2, ADD/ADC/SUB/SBB and logical instruction flag definitions. */
export function alu(operation: AluOperation, width: GuestIntegerWidth, left: bigint, right: bigint, flags: GuestFlags): bigint {
  const a = BigInt.asUintN(width, left), b = BigInt.asUintN(width, right);
  const sign = 1n << BigInt(width - 1), limit = 1n << BigInt(width);
  const carry = flags.get("carry") ? 1n : 0n;
  let full: bigint;
  switch (operation) {
    case "add": case "adc": {
      const incoming = operation === "adc" ? carry : 0n;
      full = a + b + incoming;
      flags.set("carry", full >= limit);
      flags.set("overflow", ((~(a ^ b) & (a ^ full)) & sign) !== 0n);
      flags.set("auxiliary-carry", (a & 15n) + (b & 15n) + incoming > 15n);
      break;
    }
    case "sub": case "cmp": case "sbb": {
      const incoming = operation === "sbb" ? carry : 0n;
      full = a - b - incoming;
      flags.set("carry", full < 0n);
      flags.set("overflow", (((a ^ b) & (a ^ full)) & sign) !== 0n);
      flags.set("auxiliary-carry", (a & 15n) < (b & 15n) + incoming);
      break;
    }
    case "and": case "test": full = a & b; flags.set("carry", false); flags.set("overflow", false); break;
    case "or": full = a | b; flags.set("carry", false); flags.set("overflow", false); break;
    case "xor": full = a ^ b; flags.set("carry", false); flags.set("overflow", false); break;
  }
  const result = BigInt.asUintN(width, full);
  resultFlags(width, result, flags);
  return result;
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
  for (let step = 0; step < effective; step++) {
    const high = (result & sign) !== 0n, low = (result & 1n) !== 0n;
    switch (operation) {
      case "rol": result = BigInt.asUintN(width, (result << 1n) | (high ? 1n : 0n)); carry = high; break;
      case "ror": result = (result >> 1n) | (low ? sign : 0n); carry = low; break;
      case "rcl": result = BigInt.asUintN(width, (result << 1n) | (carry ? 1n : 0n)); carry = high; break;
      case "rcr": result = (result >> 1n) | (carry ? sign : 0n); carry = low; break;
      case "shl": result = BigInt.asUintN(width, result << 1n); carry = high; break;
      case "shr": result >>= 1n; carry = low; break;
      case "sar": result = (result >> 1n) | (high ? sign : 0n); carry = low; break;
    }
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
  const zero = flags.get("zero"), carry = flags.get("carry"), sign = flags.get("sign"), overflow = flags.get("overflow");
  switch (code) {
    case 0: return overflow;
    case 1: return !overflow;
    case 2: return carry;
    case 3: return !carry;
    case 4: return zero;
    case 5: return !zero;
    case 6: return carry || zero;
    case 7: return !carry && !zero;
    case 8: return sign;
    case 9: return !sign;
    case 10: return flags.get("parity");
    case 11: return !flags.get("parity");
    case 12: return sign !== overflow;
    case 13: return sign === overflow;
    case 14: return zero || sign !== overflow;
    case 15: return !zero && sign === overflow;
    default: throw new RangeError(`Invalid condition code ${code}`);
  }
}
