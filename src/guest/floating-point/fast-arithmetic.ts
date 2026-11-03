// SPDX-License-Identifier: GPL-2.0-or-later
import { loadF64LE, loadU32LE, storeF64LE, storeU32LE } from "../../foundation/binary.ts";

/**
 * Error-free double arithmetic for the SSE and x87 fast paths. Operands are limited to a window of binary exponents in which the
 * Dekker/Knuth error terms cannot overflow or underflow, so `error` is the exact sign of (exact result - rounded result).
 * Everything else (NaN, infinity, subnormal, huge or tiny magnitudes, division by zero) is refused for the exact rational path.
 * Results are written to retained fields; nothing is allocated per call.
 */
export const fastResult = { value: 0, error: 0 };

const windowLow = 2 ** -200,
  windowHigh = 2 ** 200,
  resultLow = 2 ** -1000,
  resultHigh = 2 ** 1000;
const split = 134217729;

export function inWindow(value: number): boolean {
  if (value === 0) return true;
  const magnitude = Math.abs(value);
  return magnitude >= windowLow && magnitude <= windowHigh;
}

/** operation: 0 add, 1 multiply, 2 subtract, 3 divide. Returns false with no result when the exact path is required. */
export function fastArithmetic(operation: number, a: number, b: number): boolean {
  if (!inWindow(a) || !inWindow(b)) return false;
  let result: number, error: number;
  if (operation === 0 || operation === 2) {
    const y = operation === 0 ? b : -b;
    result = a + y;
    const virtual = result - a;
    error = a - (result - virtual) + (y - virtual);
  } else if (operation === 1) {
    result = a * b;
    error = productError(a, b, result);
  } else {
    if (b === 0) return false;
    result = a / b;
    const product = result * b;
    const remainder = a - product - productError(result, b, product);
    error = remainder === 0 ? 0 : remainder > 0 === b > 0 ? 1 : -1;
  }
  if (result !== 0) {
    const magnitude = Math.abs(result);
    if (magnitude < resultLow || magnitude > resultHigh) return false;
  }
  fastResult.value = result;
  fastResult.error = error;
  return true;
}

function productError(a: number, b: number, product: number): number {
  const ca = split * a,
    ah = ca - (ca - a),
    al = a - ah;
  const cb = split * b,
    bh = cb - (cb - b),
    bl = b - bh;
  return ah * bh - product + ah * bl + al * bh + al * bl;
}

const bytes = new Uint8Array(8);
/** Loads a 10-byte x87 register as a double when it is exactly one inside the window, else NaN. */
export function extendedToDouble(registers: Uint8Array, slot: number): number {
  const base = slot * 10;
  const high = loadU32LE(registers, base + 4),
    low = loadU32LE(registers, base);
  const exponentWord = (registers[base + 8] ?? 0) | ((registers[base + 9] ?? 0) << 8);
  const sign = exponentWord >>> 15,
    exponent = exponentWord & 0x7fff;
  if (exponent === 0 && high === 0 && low === 0) return sign === 1 ? -0 : 0;
  if (exponent < 16383 - 200 || exponent > 16383 + 200 || (high & 0x80000000) === 0 || (low & 0x7ff) !== 0) return Number.NaN;
  // Drop the explicit integer bit; 52 fraction bits remain after removing the zero low 11 bits.
  const fractionHigh = (high >>> 11) & 0xfffff;
  const fractionLow = ((high << 21) | (low >>> 11)) >>> 0;
  storeU32LE(bytes, 0, fractionLow);
  storeU32LE(bytes, 4, ((sign << 31) | ((exponent - 16383 + 1023) << 20) | fractionHigh) >>> 0);
  return loadF64LE(bytes, 0);
}

/** Writes a finite double produced by fastArithmetic into a 10-byte x87 register. */
export function doubleToExtended(registers: Uint8Array, slot: number, value: number): void {
  const base = slot * 10;
  storeF64LE(bytes, 0, value);
  const low = loadU32LE(bytes, 0),
    high = loadU32LE(bytes, 4);
  const sign = high >>> 31,
    exponent = (high >>> 20) & 0x7ff;
  if (value === 0) {
    registers.fill(0, base, base + 10);
    registers[base + 9] = sign << 7;
    return;
  }
  const mantissaHigh = (0x80000000 | ((high & 0xfffff) << 11) | (low >>> 21)) >>> 0;
  storeU32LE(registers, base, (low << 11) >>> 0);
  storeU32LE(registers, base + 4, mantissaHigh);
  const biased = exponent - 1023 + 16383;
  registers[base + 8] = biased & 0xff;
  registers[base + 9] = (sign << 7) | (biased >>> 8);
}
