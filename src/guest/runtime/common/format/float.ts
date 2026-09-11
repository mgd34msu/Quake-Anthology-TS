// SPDX-License-Identifier: GPL-2.0-or-later
import type { BinaryValue, Rounding } from "../../../floating-point/binary.ts";

export type FormatRounding = Rounding | "legacy-nearest";
type Finite = Extract<BinaryValue, { kind: "finite" }>;

function quotient(numerator: bigint, denominator: bigint, sign: number, mode: FormatRounding): bigint {
  const value = numerator / denominator, remainder = numerator % denominator;
  const up = remainder !== 0n && (mode === "nearest" ? remainder * 2n > denominator || remainder * 2n === denominator && (value & 1n) !== 0n
    : mode === "legacy-nearest" ? remainder * 2n >= denominator : mode === "up" ? sign === 0 : mode === "down" ? sign === 1 : false);
  return value + (up ? 1n : 0n);
}
function ratio(value: Finite): readonly [bigint, bigint] {
  return value.exponent >= 0 ? [value.coefficient << BigInt(value.exponent), 1n] : [value.coefficient, 1n << BigInt(-value.exponent)];
}
function scaled(value: Finite, decimalPlaces: number, mode: FormatRounding): bigint {
  const [numerator, denominator] = ratio(value);
  return decimalPlaces >= 0 ? quotient(numerator * 10n ** BigInt(decimalPlaces), denominator, value.sign, mode)
    : quotient(numerator, denominator * 10n ** BigInt(-decimalPlaces), value.sign, mode);
}
function decimalExponent(value: Finite): number {
  if (value.coefficient === 0n) return 0;
  const [n, d] = ratio(value);
  let exponent = n.toString().length - d.toString().length;
  if (exponent >= 0 ? n < d * 10n ** BigInt(exponent) : n * 10n ** BigInt(-exponent) < d) exponent--;
  return exponent;
}
function fixedDigits(digits: string, places: number, point: boolean): string {
  if (places === 0) return digits + (point ? "." : "");
  const padded = digits.padStart(places + 1, "0");
  return padded.slice(0, -places) + "." + padded.slice(-places);
}
function exponentSuffix(exponent: number, marker: string, minimum: number): string {
  return marker + (exponent < 0 ? "-" : "+") + Math.abs(exponent).toString().padStart(minimum, "0");
}
function significant(value: Finite, precision: number, mode: FormatRounding): { digits: string; exponent: number } {
  let exponent = decimalExponent(value), digits = scaled(value, precision - 1 - exponent, mode).toString();
  if (digits.length > precision) { exponent++; digits = digits.slice(0, precision); }
  return { digits: digits.padStart(precision, "0"), exponent };
}
function hex(value: Finite, precision: number | null, alternate: boolean, mode: FormatRounding, windows: boolean, extended: boolean): string {
  const fractionBits = extended ? 63 : 52;
  let exponent = value.coefficient === 0n ? 0 : value.denormal ? extended ? -16382 : -1022
    : value.exponent + fractionBits;
  // glibc writes x87's explicit integer bit as the top bit of one hex digit.
  const leadingBits = extended && !windows ? 4 : 1;
  exponent -= value.coefficient === 0n ? 0 : leadingBits - 1;
  const fraction = fractionBits - leadingBits + 1, natural = Math.ceil(fraction / 4);
  const places = precision ?? (windows ? 13 : natural);
  const shift = places * 4 - fraction;
  let digits = (shift >= 0 ? value.coefficient << BigInt(shift)
    : quotient(value.coefficient, 1n << BigInt(-shift), value.sign, mode)).toString(16).padStart(places + 1, "0");
  if (digits.length > places + 1) { digits = "1" + "0".repeat(places); exponent += 4; }
  const head = digits.slice(0, -places || undefined), tail = places === 0 ? "" : digits.slice(-places);
  const fractionText = precision === null && !windows ? tail.replace(/0+$/, "") : tail;
  return "0x" + head + (fractionText.length > 0 || alternate ? "." + fractionText : "") + exponentSuffix(exponent, "p", 1);
}

/** Decimal conversion rounds the guest binary value itself, including x87 values beyond binary64. */
export function formatFloat(value: BinaryValue, conversion: string, precision: number | null, alternate: boolean,
  mode: FormatRounding, windows: boolean, extended: boolean, exponentDigits: number): string {
  const lower = conversion.toLowerCase(), upper = conversion !== lower;
  let text: string;
  if (value.kind === "infinity") text = "inf";
  else if (value.kind === "unsupported") text = windows ? "nan(ind)" : "nan";
  else if (value.kind === "nan") text = windows && value.signaling ? "nan(snan)"
    : windows && value.sign === 1 && value.payload === 1n << 62n ? "nan(ind)" : "nan";
  else if (lower === "a") text = hex(value, precision, alternate, mode, windows, extended);
  else if (lower === "f") {
    const places = precision ?? 6;
    text = fixedDigits(scaled(value, places, mode).toString(), places, alternate);
  } else {
    const places = precision ?? 6, count = lower === "e" ? places + 1 : Math.max(1, places);
    const { digits, exponent } = significant(value, count, mode);
    if (lower === "e" || exponent < -4 || exponent >= count) {
      let tail = digits.slice(1);
      if (lower === "g" && !alternate) tail = tail.replace(/0+$/, "");
      text = digits.charAt(0) + (tail.length > 0 || alternate ? "." + tail : "") + exponentSuffix(exponent, "e", exponentDigits);
    } else {
      const decimalPlaces = count - 1 - exponent;
      text = fixedDigits(digits, decimalPlaces, alternate);
      if (!alternate && text.includes(".")) text = text.replace(/0+$/, "").replace(/\.$/, "");
    }
  }
  return upper ? text.toUpperCase() : text;
}
