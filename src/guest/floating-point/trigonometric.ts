// SPDX-License-Identifier: GPL-2.0-or-later
import { arithmetic, roundRational, zero, binary80, convertBinary, denormalOperand, fromInteger, indefinite, invalid, precision } from "./binary.ts";
import type { BinaryResult, BinaryValue, Rounding } from "./binary.ts";

// Intel's x87 target is sin/cos(x * pi / p), where p is the 68-bit approximation of pi.
// https://www.intel.com/content/www/us/en/developer/articles/technical/the-difference-between-x87-instructions-and-mathematical-functions.html
const fractionBits = 256;
const scale = 1n << 256n;
const pi = 0x3243f6a8885a308d313198a2e03707344a4093822299f31d0082efa98ec4e6c89n;
const sourcePi = pi >> 190n;
const sourcePiScaled = sourcePi << 190n;
export type X87TrigonometricResult = { readonly kind: "out-of-range" } | { readonly kind: "result"; readonly result: BinaryResult };

/** Polynomial evaluation uses integer guard bits; no binary64 trigonometric operation participates. */
export function x87Trigonometric(value: BinaryValue, cosine: boolean, mode: Rounding): X87TrigonometricResult {
  if (value.kind === "infinity") return { kind: "result", result: { value: indefinite(), flags: invalid, roundedUp: false } };
  if (value.kind !== "finite") return { kind: "result", result: convertBinary(value, binary80, mode) };
  if (value.coefficient === 0n) return { kind: "result", result: { value: cosine ? fromInteger(1n) : value, flags: 0, roundedUp: false } };
  const exponent = value.coefficient.toString(2).length - 1 + value.exponent;
  if (exponent >= 63) return { kind: "out-of-range" };
  const flags = precision | (value.denormal ? denormalOperand : 0);
  if (exponent <= -128) {
    const approximation: BinaryValue = cosine
      ? { kind: "finite", sign: 0, coefficient: scale - 1n, exponent: -fractionBits, denormal: false }
      : { kind: "finite", sign: value.sign, coefficient: ((value.coefficient * pi) << 128n) / sourcePi, exponent: value.exponent - 318, denormal: false };
    const result = convertBinary(approximation, binary80, mode);
    return { kind: "result", result: { ...result, flags: result.flags | flags } };
  }
  const shift = value.exponent + fractionBits;
  let angle = (shift >= 0 ? value.coefficient << BigInt(shift) : value.coefficient >> BigInt(-shift)) % (sourcePiScaled * 2n);
  if (angle > sourcePiScaled) angle -= sourcePiScaled * 2n;
  if (value.sign === 1) angle = -angle;
  angle = angle * pi / sourcePiScaled;
  const squared = angle * angle;
  let term = cosine ? scale : angle, sum = term;
  for (let index = 1n; term !== 0n; index++) {
    const denominator = cosine ? (2n * index - 1n) * (2n * index) : (2n * index) * (2n * index + 1n);
    term = -term * squared / (scale * scale * denominator);
    sum += term;
  }
  const result = convertBinary({ kind: "finite", sign: sum < 0n ? 1 : 0, coefficient: sum < 0n ? -sum : sum, exponent: -fractionBits, denormal: false }, binary80, mode);
  return { kind: "result", result: { ...result, flags: result.flags | flags } };
}

/** FPATAN consumes Cartesian (ST(1), ST(0)), including signed axes and infinities. */
export function x87Arctangent(y: BinaryValue, x: BinaryValue, mode: Rounding): BinaryResult {
  if (y.kind === "nan" || y.kind === "unsupported" || x.kind === "nan" || x.kind === "unsupported") return arithmetic("add", y, x, binary80, mode);
  const sourceFlags = (y.kind === "finite" && y.denormal || x.kind === "finite" && x.denormal) ? denormalOperand : 0;
  const angleResult = (angle: bigint): BinaryResult => {
    const result = roundRational(y.sign, angle, scale, 0, binary80, mode);
    return { ...result, flags: result.flags | sourceFlags | (angle === 0n ? 0 : precision) };
  };
  if (y.kind === "finite" && y.coefficient === 0n) return x.sign === 1 ? angleResult(pi) : { value: zero(y.sign), flags: sourceFlags, roundedUp: false };
  if (y.kind === "infinity") return angleResult(x.kind === "infinity" ? x.sign === 1 ? pi * 3n / 4n : pi / 4n : pi / 2n);
  if (x.kind === "infinity") return angleResult(x.sign === 1 ? pi : 0n);
  if (x.coefficient === 0n) return angleResult(pi / 2n);
  const shift = y.exponent - x.exponent;
  const numerator = shift >= 0 ? y.coefficient << BigInt(shift) : y.coefficient;
  const denominator = shift >= 0 ? x.coefficient : x.coefficient << BigInt(-shift);
  if (x.sign === 0 && numerator << 128n <= denominator) {
    // atan(r) is just below r. Keep that side of exact binary boundaries even
    // when the ratio is far below the fixed-point polynomial's resolution.
    const result = roundRational(y.sign, numerator * (scale - 1n), denominator * scale, 0, binary80, mode);
    return { ...result, flags: result.flags | sourceFlags | precision };
  }
  const reciprocal = numerator > denominator;
  let z = reciprocal ? denominator * scale / numerator : numerator * scale / denominator;
  const reduced = z > scale / 2n;
  if (reduced) z = (z - scale) * scale / (z + scale);
  const squared = z * z;
  let power = z, angle = z;
  for (let index = 1n; power !== 0n; index++) {
    power = -power * squared / (scale * scale);
    angle += power / (2n * index + 1n);
  }
  if (reduced) angle += pi / 4n;
  if (reciprocal) angle = pi / 2n - angle;
  if (x.sign === 1) angle = pi - angle;
  return angleResult(angle);
}
