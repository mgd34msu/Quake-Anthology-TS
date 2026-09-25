// SPDX-License-Identifier: GPL-2.0-or-later
export type Sign = 0 | 1;
export type Rounding = "nearest" | "down" | "up" | "zero";
export type BinaryWidth = 32 | 64 | 80;
export type BinaryValue = { readonly kind: "finite"; readonly sign: Sign; readonly coefficient: bigint; readonly exponent: number; readonly denormal: boolean }
  | { readonly kind: "infinity"; readonly sign: Sign }
  | { readonly kind: "nan"; readonly sign: Sign; readonly payload: bigint; readonly signaling: boolean }
  | { readonly kind: "unsupported"; readonly sign: Sign };
export interface BinaryResult { readonly value: BinaryValue; readonly flags: number; readonly roundedUp: boolean }
export interface BinaryFormat { readonly precision: number; readonly minimumExponent: number; readonly maximumExponent: number }
export const binary32: BinaryFormat = { precision: 24, minimumExponent: -126, maximumExponent: 127 };
export const binary64: BinaryFormat = { precision: 53, minimumExponent: -1022, maximumExponent: 1023 };
export const binary80: BinaryFormat = { precision: 64, minimumExponent: -16382, maximumExponent: 16383 };
export const invalid = 1;
export const denormalOperand = 2;
export const zeroDivide = 4;
export const overflow = 8;
export const underflow = 16;
export const precision = 32;

export function rounding(bits: number): Rounding {
  switch (bits & 3) { case 0: return "nearest"; case 1: return "down"; case 2: return "up"; default: return "zero"; }
}
export function formatFor(width: BinaryWidth): BinaryFormat { return width === 32 ? binary32 : width === 64 ? binary64 : binary80; }
export function zero(sign: Sign = 0): BinaryValue { return { kind: "finite", sign, coefficient: 0n, exponent: 0, denormal: false }; }
export function indefinite(): BinaryValue { return { kind: "nan", sign: 1, payload: 1n << 62n, signaling: false }; }
export function fromInteger(value: bigint): BinaryValue {
  return { kind: "finite", sign: value < 0n ? 1 : 0, coefficient: value < 0n ? -value : value, exponent: 0, denormal: false };
}
export function negate(value: BinaryValue): BinaryValue { return { ...value, sign: value.sign === 0 ? 1 : 0 }; }
export function quiet(value: BinaryValue): BinaryValue {
  return value.kind === "nan" ? { ...value, signaling: false, payload: value.payload | (1n << 62n) } : value;
}

export function readBits(bytes: Uint8Array): bigint {
  let result = 0n;
  for (let index = bytes.length - 1; index >= 0; index--) result = (result << 8n) | BigInt(bytes[index] ?? 0);
  return result;
}
export function writeBits(value: bigint, byteLength: number): Uint8Array {
  const result = new Uint8Array(byteLength);
  for (let index = 0; index < byteLength; index++) result[index] = Number((value >> BigInt(index * 8)) & 255n);
  return result;
}
/** Decode an IEEE binary32 word without rounding its stored significand. */
export function decodeBinary32(bits: number): BinaryValue {
  const sign: Sign = (bits >>> 31) === 0 ? 0 : 1;
  const exponent = (bits >>> 23) & 255, fraction = bits & 0x7fffff;
  if (exponent === 255) {
    if (fraction === 0) return { kind: "infinity", sign };
    return { kind: "nan", sign, payload: BigInt(fraction) << 40n, signaling: (fraction & 0x400000) === 0 };
  }
  return { kind: "finite", sign, coefficient: BigInt(exponent === 0 ? fraction : fraction | 0x800000),
    exponent: (exponent === 0 ? 1 : exponent) - 150, denormal: exponent === 0 && fraction !== 0 };
}

export function decodeBinary(bits: bigint, width: BinaryWidth): BinaryValue {
  const fractionBits = width === 32 ? 23 : width === 64 ? 52 : 63;
  const storageBits = width === 80 ? 64 : fractionBits;
  const exponentBits = width === 32 ? 8 : width === 64 ? 11 : 15;
  const exponentMask = (1 << exponentBits) - 1;
  const bias = (1 << (exponentBits - 1)) - 1;
  const sign: Sign = ((bits >> BigInt(width - 1)) & 1n) === 0n ? 0 : 1;
  const exponent = Number((bits >> BigInt(storageBits)) & BigInt(exponentMask));
  const fraction = bits & ((1n << BigInt(fractionBits)) - 1n);
  const integer = width === 80 ? (bits >> 63n) & 1n : exponent === 0 ? 0n : 1n;
  if (width === 80 && exponent !== 0 && integer === 0n) return { kind: "unsupported", sign };
  if (exponent === exponentMask) {
    if (fraction === 0n) return { kind: "infinity", sign };
    const payload = fraction << BigInt(63 - fractionBits);
    return { kind: "nan", sign, payload, signaling: (payload & (1n << 62n)) === 0n };
  }
  const coefficient = (integer << BigInt(fractionBits)) | fraction;
  return { kind: "finite", sign, coefficient, exponent: (exponent === 0 ? 1 : exponent) - bias - fractionBits,
    denormal: exponent === 0 && coefficient !== 0n && integer === 0n };
}

function length(value: bigint): number { return value === 0n ? 0 : value.toString(2).length; }
function compareScaled(left: bigint, right: bigint, shift: number): number {
  const a = shift >= 0 ? left << BigInt(shift) : left;
  const b = shift >= 0 ? right : right << BigInt(-shift);
  return a < b ? -1 : a > b ? 1 : 0;
}
function ratioExponent(numerator: bigint, denominator: bigint): number {
  let exponent = length(numerator) - length(denominator);
  if (compareScaled(numerator, denominator, -exponent) < 0) exponent--;
  return exponent;
}

function roundedQuotient(numerator: bigint, denominator: bigint, sign: Sign, mode: Rounding): { quotient: bigint; inexact: boolean; up: boolean } {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const inexact = remainder !== 0n;
  const up = inexact && (mode === "nearest" ? remainder * 2n > denominator || (remainder * 2n === denominator && (quotient & 1n) !== 0n)
    : mode === "up" ? sign === 0 : mode === "down" ? sign === 1 : false);
  return { quotient: quotient + (up ? 1n : 0n), inexact, up };
}

export function roundRational(sign: Sign, numerator: bigint, denominator: bigint, exponent: number, format: BinaryFormat, mode: Rounding): BinaryResult {
  if (numerator === 0n) return { value: zero(sign), flags: 0, roundedUp: false };
  const top = ratioExponent(numerator, denominator) + exponent;
  const quantum = Math.max(top - format.precision + 1, format.minimumExponent - format.precision + 1);
  const shift = exponent - quantum;
  const rounded = roundedQuotient(shift >= 0 ? numerator << BigInt(shift) : numerator,
    shift >= 0 ? denominator : denominator << BigInt(-shift), sign, mode);
  const resultTop = length(rounded.quotient) - 1 + quantum;
  if (resultTop > format.maximumExponent) {
    const infinite = mode === "nearest" || (mode === "up" && sign === 0) || (mode === "down" && sign === 1);
    return { value: infinite ? { kind: "infinity", sign } : {
      kind: "finite", sign, coefficient: (1n << BigInt(format.precision)) - 1n,
      exponent: format.maximumExponent - format.precision + 1, denormal: false,
    }, flags: overflow | precision, roundedUp: infinite };
  }
  const tiny = resultTop < format.minimumExponent;
  return { value: { kind: "finite", sign, coefficient: rounded.quotient, exponent: quantum, denormal: tiny && rounded.quotient !== 0n },
    flags: rounded.inexact ? precision | (tiny ? underflow : 0) : 0, roundedUp: rounded.up };
}

export function convertBinary(value: BinaryValue, format: BinaryFormat, mode: Rounding): BinaryResult {
  if (value.kind === "unsupported") return { value: indefinite(), flags: invalid, roundedUp: false };
  if (value.kind === "nan") return { value: quiet(value), flags: value.signaling ? invalid : 0, roundedUp: false };
  if (value.kind === "infinity") return { value, flags: 0, roundedUp: false };
  return roundRational(value.sign, value.coefficient, 1n, value.exponent, format, mode);
}

export function encodeBinary(value: BinaryValue, width: BinaryWidth): bigint {
  const format = formatFor(width);
  const fractionBits = width === 32 ? 23 : width === 64 ? 52 : 63;
  const storageBits = width === 80 ? 64 : fractionBits;
  const exponentMask = width === 32 ? 255 : width === 64 ? 2047 : 32767;
  const sign = BigInt(value.sign) << BigInt(width - 1);
  const explicit = width === 80 ? 1n << 63n : 0n;
  if (value.kind === "unsupported") return encodeBinary(indefinite(), width);
  if (value.kind === "infinity") return sign | (BigInt(exponentMask) << BigInt(storageBits)) | explicit;
  if (value.kind === "nan") {
    let payload = value.payload >> BigInt(63 - fractionBits);
    if (payload === 0n) payload = 1n;
    return sign | (BigInt(exponentMask) << BigInt(storageBits)) | explicit | payload;
  }
  if (value.coefficient === 0n) return sign;
  const top = length(value.coefficient) - 1 + value.exponent;
  const quantum = Math.max(top - fractionBits, format.minimumExponent - fractionBits);
  const shift = value.exponent - quantum;
  const significand = shift >= 0 ? value.coefficient << BigInt(shift) : value.coefficient >> BigInt(-shift);
  const exponent = top < format.minimumExponent ? 0 : top + (1 - format.minimumExponent);
  const fraction = width === 80 ? significand : significand & ((1n << BigInt(fractionBits)) - 1n);
  return sign | (BigInt(exponent) << BigInt(storageBits)) | fraction;
}

function propagateNaN(left: BinaryValue, right: BinaryValue, selection: "x87" | "sse"): BinaryResult | null {
  if (left.kind === "unsupported" || right.kind === "unsupported") return { value: indefinite(), flags: invalid, roundedUp: false };
  if (left.kind !== "nan" && right.kind !== "nan") return null;
  const flags = (left.kind === "nan" && left.signaling) || (right.kind === "nan" && right.signaling) ? invalid : 0;
  let selected = left.kind === "nan" ? left : right;
  if (selection === "x87" && left.kind === "nan" && right.kind === "nan") {
    if (left.signaling !== right.signaling) selected = left.signaling ? right : left;
    else if (right.payload > left.payload || (right.payload === left.payload && right.sign < left.sign)) selected = right;
  }
  return { value: quiet(selected), flags, roundedUp: false };
}

export type BinaryOperation = "add" | "subtract" | "multiply" | "divide";
export function arithmetic(operation: BinaryOperation, left: BinaryValue, right: BinaryValue, format: BinaryFormat, mode: Rounding, selection: "x87" | "sse" = "x87"): BinaryResult {
  const nan = propagateNaN(left, right, selection);
  if (nan !== null) return nan;
  if (left.kind === "nan" || left.kind === "unsupported" || right.kind === "nan" || right.kind === "unsupported") throw new Error("Unresolved special operand");
  const sourceFlags = (left.kind === "finite" && left.denormal) || (right.kind === "finite" && right.denormal) ? denormalOperand : 0;
  const result = (value: BinaryValue, flags = 0): BinaryResult => ({ value, flags: flags | sourceFlags, roundedUp: false });
  const rightSign: Sign = operation === "subtract" ? right.sign === 0 ? 1 : 0 : right.sign;
  if (operation === "add" || operation === "subtract") {
    if (left.kind === "infinity" || right.kind === "infinity") {
      if (left.kind === "infinity" && right.kind === "infinity" && left.sign !== rightSign) return result(indefinite(), invalid);
      return result(left.kind === "infinity" ? left : { kind: "infinity", sign: rightSign });
    }
    const exponent = Math.min(left.exponent, right.exponent);
    const a = (left.sign === 1 ? -left.coefficient : left.coefficient) << BigInt(left.exponent - exponent);
    const b = (rightSign === 1 ? -right.coefficient : right.coefficient) << BigInt(right.exponent - exponent);
    const sum = a + b;
    const sign: Sign = sum < 0n ? 1 : sum > 0n ? 0 : left.sign === rightSign ? left.sign : mode === "down" ? 1 : 0;
    const rounded = roundRational(sign, sum < 0n ? -sum : sum, 1n, exponent, format, mode);
    return { ...rounded, flags: rounded.flags | sourceFlags };
  }
  const sign: Sign = left.sign === right.sign ? 0 : 1;
  if (operation === "multiply") {
    if (left.kind === "infinity" || right.kind === "infinity") {
      if ((left.kind === "finite" && left.coefficient === 0n) || (right.kind === "finite" && right.coefficient === 0n)) return result(indefinite(), invalid);
      return result({ kind: "infinity", sign });
    }
    const rounded = roundRational(sign, left.coefficient * right.coefficient, 1n, left.exponent + right.exponent, format, mode);
    return { ...rounded, flags: rounded.flags | sourceFlags };
  }
  if (left.kind === "infinity" && right.kind === "infinity") return result(indefinite(), invalid);
  if (left.kind === "infinity") return result({ kind: "infinity", sign });
  if (right.kind === "infinity") return result(zero(sign));
  if (right.coefficient === 0n) return result(left.coefficient === 0n ? indefinite() : { kind: "infinity", sign }, left.coefficient === 0n ? invalid : zeroDivide);
  const rounded = roundRational(sign, left.coefficient, right.coefficient, left.exponent - right.exponent, format, mode);
  return { ...rounded, flags: rounded.flags | sourceFlags };
}

export function compareBinary(left: BinaryValue, right: BinaryValue): "less" | "equal" | "greater" | "unordered" {
  if (left.kind === "nan" || right.kind === "nan" || left.kind === "unsupported" || right.kind === "unsupported") return "unordered";
  if (left.kind === "finite" && right.kind === "finite" && left.coefficient === 0n && right.coefficient === 0n) return "equal";
  if (left.sign !== right.sign) return left.sign === 1 ? "less" : "greater";
  let comparison: number;
  if (left.kind === "infinity") comparison = right.kind === "infinity" ? 0 : 1;
  else if (right.kind === "infinity") comparison = -1;
  else comparison = compareScaled(left.coefficient, right.coefficient, left.exponent - right.exponent);
  if (left.sign === 1) comparison = -comparison;
  return comparison < 0 ? "less" : comparison > 0 ? "greater" : "equal";
}

export function integerConversion(value: BinaryValue, width: 16 | 32 | 64, mode: Rounding): { value: bigint; flags: number; roundedUp: boolean } {
  const bad = { value: -(1n << BigInt(width - 1)), flags: invalid, roundedUp: false };
  if (value.kind !== "finite") return bad;
  const rounded = roundedQuotient(value.exponent >= 0 ? value.coefficient << BigInt(value.exponent) : value.coefficient,
    value.exponent >= 0 ? 1n : 1n << BigInt(-value.exponent), value.sign, mode);
  const signed = value.sign === 1 ? -rounded.quotient : rounded.quotient;
  if (signed < -(1n << BigInt(width - 1)) || signed >= 1n << BigInt(width - 1)) return bad;
  return { value: signed, flags: rounded.inexact ? precision : 0, roundedUp: rounded.up };
}

export function roundIntegral(value: BinaryValue, mode: Rounding): BinaryResult {
  if (value.kind !== "finite") return convertBinary(value, binary80, mode);
  if (value.exponent >= 0) return { value, flags: 0, roundedUp: false };
  const rounded = roundedQuotient(value.coefficient, 1n << BigInt(-value.exponent), value.sign, mode);
  return { value: { kind: "finite", sign: value.sign, coefficient: rounded.quotient, exponent: 0, denormal: false },
    flags: (rounded.inexact ? precision : 0) | (value.denormal ? denormalOperand : 0), roundedUp: rounded.up };
}

function integerSquareRoot(value: bigint): bigint {
  if (value < 2n) return value;
  let estimate = 1n << BigInt(Math.ceil(length(value) / 2));
  for (;;) {
    const next = (estimate + value / estimate) >> 1n;
    if (next >= estimate) return estimate;
    estimate = next;
  }
}
export function squareRoot(value: BinaryValue, format: BinaryFormat, mode: Rounding): BinaryResult {
  if (value.kind === "nan" || value.kind === "unsupported") return convertBinary(value, format, mode);
  if (value.kind === "finite" && value.coefficient === 0n) return { value, flags: 0, roundedUp: false };
  if (value.sign === 1) return { value: indefinite(), flags: invalid, roundedUp: false };
  if (value.kind === "infinity") return { value, flags: 0, roundedUp: false };
  const top = Math.floor((length(value.coefficient) - 1 + value.exponent) / 2);
  const quantum = Math.max(top - format.precision + 1, format.minimumExponent - format.precision + 1);
  const shift = value.exponent - quantum * 2;
  const numerator = shift >= 0 ? value.coefficient << BigInt(shift) : value.coefficient;
  const denominator = shift >= 0 ? 1n : 1n << BigInt(-shift);
  const floor = integerSquareRoot(numerator / denominator);
  const inexact = floor * floor * denominator !== numerator;
  const halfway = (floor * 2n + 1n) ** 2n * denominator;
  const up = inexact && (mode === "up" || (mode === "nearest" && (numerator * 4n > halfway || (numerator * 4n === halfway && (floor & 1n) !== 0n))));
  return { value: { kind: "finite", sign: 0, coefficient: floor + (up ? 1n : 0n), exponent: quantum, denormal: false },
    flags: (inexact ? precision : 0) | (value.denormal ? denormalOperand : 0), roundedUp: up };
}
