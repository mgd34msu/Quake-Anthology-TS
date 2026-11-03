// SPDX-License-Identifier: GPL-2.0-or-later
import {
  arithmetic,
  binary80,
  convertBinary,
  denormalOperand,
  fromInteger,
  indefinite,
  invalid,
  precision,
  roundRational,
  zero,
  zeroDivide,
} from "./binary.ts";
import type { BinaryResult, BinaryValue, Rounding, Sign } from "./binary.ts";
import { x87Trigonometric } from "./trigonometric.ts";

// Fixed-point evaluation with integer guard bits, like trigonometric.ts: no binary64 operation participates.
const bits = 320n;
const scale = 1n << bits;
const guard = 64n;

function bitLength(value: bigint): number {
  return value === 0n ? 0 : value.toString(2).length;
}
function topExponent(value: Extract<BinaryValue, { readonly kind: "finite" }>): number {
  return bitLength(value.coefficient) - 1 + value.exponent;
}
function nanOperand(...values: readonly BinaryValue[]): boolean {
  return values.some(value => value.kind === "nan" || value.kind === "unsupported");
}
function invalidResult(): BinaryResult {
  return { value: indefinite(), flags: invalid, roundedUp: false };
}
function denormalFlag(...values: readonly BinaryValue[]): number {
  return values.some(value => value.kind === "finite" && value.denormal) ? denormalOperand : 0;
}
function signedNegate(sign: Sign): Sign {
  return sign === 0 ? 1 : 0;
}

/** ln 2 in `scale` units with guard bits, from 2 * atanh(1/3). */
let ln2Cache: bigint | null = null;
function ln2(): bigint {
  if (ln2Cache !== null) return ln2Cache;
  const one = 1n << (bits + guard);
  const ninth = 9n;
  let power = one / 3n,
    sum = power;
  for (let index = 1n; power !== 0n; index++) {
    power /= ninth;
    sum += power / (2n * index + 1n);
  }
  ln2Cache = (2n * sum) >> guard;
  return ln2Cache;
}

/** FSCALE: ST(0) * 2^trunc(ST(1)). */
export function x87Scale(value: BinaryValue, exponent: BinaryValue, mode: Rounding): BinaryResult {
  if (nanOperand(value, exponent)) return arithmetic("add", value, exponent, binary80, mode);
  const flags = denormalFlag(value, exponent);
  if (exponent.kind === "infinity") {
    if (exponent.sign === 0)
      return value.kind === "finite" && value.coefficient === 0n
        ? invalidResult()
        : { value: value.kind === "infinity" ? value : { kind: "infinity", sign: value.sign }, flags, roundedUp: false };
    return value.kind === "infinity" ? invalidResult() : { value: zero(value.sign), flags, roundedUp: false };
  }
  if (value.kind !== "finite" || exponent.kind !== "finite") return { value, flags, roundedUp: false };
  if (value.coefficient === 0n) return { value, flags, roundedUp: false };
  let count = 0n;
  if (exponent.coefficient !== 0n) {
    const magnitude =
      exponent.exponent >= 0 ? exponent.coefficient << BigInt(Math.min(exponent.exponent, 64)) : exponent.coefficient >> BigInt(-exponent.exponent);
    count = exponent.sign === 1 ? -magnitude : magnitude;
  }
  // Anything this far out overflows or underflows regardless of the operand.
  const clamped = Number(count > 100000n ? 100000n : count < -100000n ? -100000n : count);
  const result = convertBinary({ ...value, exponent: value.exponent + clamped, denormal: false }, binary80, mode);
  return { ...result, flags: result.flags | flags };
}

export interface X87RemainderResult {
  readonly result: BinaryResult;
  readonly complete: boolean;
  readonly quotient: number;
}
/** FPREM (truncating) and FPREM1 (IEEE nearest-even); an exponent gap of 64 or more reduces by 32 bits per execution. */
export function x87Remainder(dividend: BinaryValue, divisor: BinaryValue, ieee: boolean, mode: Rounding): X87RemainderResult {
  const done = (result: BinaryResult, quotient = 0): X87RemainderResult => ({ result, complete: true, quotient });
  if (nanOperand(dividend, divisor)) return done(arithmetic("add", dividend, divisor, binary80, mode));
  const flags = denormalFlag(dividend, divisor);
  if (dividend.kind === "infinity" || (divisor.kind === "finite" && divisor.coefficient === 0n)) return done(invalidResult());
  if (divisor.kind === "infinity" || dividend.kind !== "finite" || divisor.kind !== "finite" || dividend.coefficient === 0n)
    return done({ value: dividend, flags, roundedUp: false });
  const gap = topExponent(dividend) - topExponent(divisor);
  const partial = gap >= 64;
  const lowest = Math.min(dividend.exponent, divisor.exponent);
  const a = dividend.coefficient << BigInt(dividend.exponent - lowest);
  let b = divisor.coefficient << BigInt(divisor.exponent - lowest);
  if (partial) b <<= BigInt(gap - 32);
  let quotient = a / b,
    remainder = a - quotient * b;
  if (ieee && !partial && (remainder * 2n > b || (remainder * 2n === b && (quotient & 1n) === 1n))) {
    quotient += 1n;
    remainder -= b;
  }
  const sign: Sign = remainder < 0n ? signedNegate(dividend.sign) : dividend.sign;
  const magnitude = remainder < 0n ? -remainder : remainder;
  const result =
    magnitude === 0n
      ? { value: zero(dividend.sign), flags: 0, roundedUp: false }
      : convertBinary({ kind: "finite", sign, coefficient: magnitude, exponent: lowest, denormal: false }, binary80, mode);
  return { result: { ...result, flags: result.flags | flags }, complete: !partial, quotient: Number(quotient & 7n) };
}

/** F2XM1: 2^x - 1. */
export function x87TwoPowerMinusOne(value: BinaryValue, mode: Rounding): BinaryResult {
  if (value.kind === "nan" || value.kind === "unsupported") return convertBinary(value, binary80, mode);
  if (value.kind === "infinity") return value.sign === 0 ? { value, flags: 0, roundedUp: false } : { value: fromInteger(-1n), flags: 0, roundedUp: false };
  const flags = precision | denormalFlag(value);
  if (value.coefficient === 0n) return { value, flags: denormalFlag(value), roundedUp: false };
  if (topExponent(value) < -300) {
    const result = roundRational(value.sign, value.coefficient * ln2(), scale, value.exponent, binary80, mode);
    return { ...result, flags: result.flags | flags };
  }
  const shift = value.exponent + Number(bits);
  const fixed = shift >= 0 ? value.coefficient << BigInt(shift) : value.coefficient >> BigInt(-shift);
  const y = ((value.sign === 1 ? -fixed : fixed) * ln2()) / scale;
  let term = y,
    sum = y;
  for (let index = 2n; term !== 0n; index++) {
    term = (term * y) / (scale * index);
    sum += term;
  }
  const result = convertBinary(
    { kind: "finite", sign: sum < 0n ? 1 : 0, coefficient: sum < 0n ? -sum : sum, exponent: -Number(bits), denormal: false },
    binary80,
    mode,
  );
  return { ...result, flags: result.flags | flags };
}

/** log2 of a positive finite coefficient * 2^exponent, in `scale` units (signed). */
function log2Fixed(coefficient: bigint, exponent: number): bigint {
  const length = bitLength(coefficient),
    e = length - 1 + exponent;
  const mantissa = length - 1 >= Number(bits) ? coefficient >> BigInt(length - 1 - Number(bits)) : coefficient << (bits - BigInt(length - 1));
  const z = ((mantissa - scale) * scale) / (mantissa + scale),
    squared = (z * z) / scale;
  let power = z,
    sum = z;
  for (let index = 1n; power !== 0n; index++) {
    power = (power * squared) / scale;
    sum += power / (2n * index + 1n);
  }
  return BigInt(e) * scale + (2n * sum * scale) / ln2();
}

function logTimes(y: BinaryValue, x: BinaryValue, plusOne: boolean, mode: Rounding): BinaryResult {
  if (nanOperand(y, x)) return arithmetic("add", y, x, binary80, mode);
  const flags = denormalFlag(y, x);
  const infinite = (sign: Sign): BinaryResult => ({ value: { kind: "infinity", sign }, flags, roundedUp: false });
  const yZero = y.kind === "finite" && y.coefficient === 0n;
  // The argument of the logarithm is x (FYL2X) or 1 + x (FYL2XP1).
  if (x.kind === "infinity") {
    if (x.sign === 1) return invalidResult();
    return yZero ? invalidResult() : infinite(y.sign);
  }
  if (x.kind !== "finite") return invalidResult();
  let coefficient = x.coefficient,
    exponent = x.exponent,
    sign: Sign = x.sign;
  if (plusOne) {
    if (x.coefficient === 0n) return y.kind === "finite" ? { value: zero((y.sign ^ x.sign) as Sign), flags, roundedUp: false } : invalidResult();
    if (topExponent(x) < -200) {
      if (y.kind === "infinity") return infinite((y.sign ^ x.sign) as Sign);
      if (y.kind !== "finite") return invalidResult();
      const reciprocal = (scale << guard) / ln2();
      const result = roundRational((y.sign ^ x.sign) as Sign, y.coefficient * x.coefficient * reciprocal, 1n << guard, y.exponent + x.exponent, binary80, mode);
      return { ...result, flags: result.flags | flags | precision };
    }
    const shift = exponent < 0 ? -exponent : 0;
    const one = 1n << BigInt(shift);
    const aligned = exponent >= 0 ? x.coefficient << BigInt(exponent) : x.coefficient;
    const total = one + (x.sign === 1 ? -aligned : aligned);
    if (total <= 0n) return total === 0n ? (yZero ? invalidResult() : infinite(signedNegate(y.sign))) : invalidResult();
    coefficient = total;
    exponent = -shift;
    sign = 0;
  } else if (coefficient === 0n)
    return yZero ? invalidResult() : { value: { kind: "infinity", sign: signedNegate(y.sign) }, flags: flags | zeroDivide, roundedUp: false };
  else if (sign === 1) return invalidResult();
  const argumentIsOne = coefficient === 1n << BigInt(bitLength(coefficient) - 1) && exponent === -(bitLength(coefficient) - 1);
  if (y.kind === "infinity") return argumentIsOne ? invalidResult() : infinite(((exponent + bitLength(coefficient) - 1 < 0 ? 1 : 0) ^ y.sign) as Sign);
  if (y.kind !== "finite") return invalidResult();
  if (yZero) return { value: zero(y.sign), flags, roundedUp: false };
  const logarithm = log2Fixed(coefficient, exponent);
  if (logarithm === 0n) return { value: zero(y.sign), flags, roundedUp: false };
  const negative = logarithm < 0n;
  const result = roundRational((y.sign ^ (negative ? 1 : 0)) as Sign, y.coefficient * (negative ? -logarithm : logarithm), scale, y.exponent, binary80, mode);
  const exact = argumentIsOne || (logarithm % scale === 0n && result.flags === 0);
  return { ...result, flags: result.flags | flags | (exact ? 0 : precision) };
}
/** FYL2X: ST(1) * log2(ST(0)). */
export function x87Log2(y: BinaryValue, x: BinaryValue, mode: Rounding): BinaryResult {
  return logTimes(y, x, false, mode);
}
/** FYL2XP1: ST(1) * log2(ST(0) + 1). */
export function x87Log2PlusOne(y: BinaryValue, x: BinaryValue, mode: Rounding): BinaryResult {
  return logTimes(y, x, true, mode);
}

/** FXTRACT: unbiased exponent and significand in [1, 2). */
export function x87Extract(value: BinaryValue): { readonly exponent: BinaryValue; readonly significand: BinaryValue; readonly flags: number } {
  if (value.kind === "nan" || value.kind === "unsupported")
    return { exponent: value, significand: value, flags: value.kind === "nan" && !value.signaling ? 0 : invalid };
  if (value.kind === "infinity") return { exponent: { kind: "infinity", sign: 0 }, significand: value, flags: 0 };
  if (value.coefficient === 0n) return { exponent: { kind: "infinity", sign: 1 }, significand: value, flags: zeroDivide };
  const length = bitLength(value.coefficient);
  return {
    exponent: fromInteger(BigInt(topExponent(value))),
    significand: { kind: "finite", sign: value.sign, coefficient: value.coefficient, exponent: -(length - 1), denormal: false },
    flags: denormalFlag(value),
  };
}

/** FSINCOS and FPTAN share one reduction; null means the operand is beyond 2^63. */
export function x87SineCosine(value: BinaryValue, mode: Rounding): { readonly sine: BinaryResult; readonly cosine: BinaryResult } | null {
  const sine = x87Trigonometric(value, false, mode),
    cosine = x87Trigonometric(value, true, mode);
  if (sine.kind === "out-of-range" || cosine.kind === "out-of-range") return null;
  return { sine: sine.result, cosine: cosine.result };
}
export function x87Tangent(value: BinaryValue, mode: Rounding): BinaryResult | null {
  const pair = x87SineCosine(value, mode);
  if (pair === null) return null;
  const quotient = arithmetic("divide", pair.sine.value, pair.cosine.value, binary80, mode);
  return { ...quotient, flags: quotient.flags | pair.sine.flags | pair.cosine.flags };
}
