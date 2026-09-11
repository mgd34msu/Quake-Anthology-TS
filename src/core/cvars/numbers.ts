/* Quake Q_atof and Quake III Cvar_SetValue, adapted from quake-1-re-ts
 * common/common.ts and quake-3-ts core/cvar.ts. GPL-2.0-or-later. */
import { float32ToBits } from "../numeric.ts";

export function quakeAtof(text: string): number {
  let offset = 0, sign = 1, value = 0;
  if (text.charAt(offset) === "-") { sign = -1; offset++; }
  if (text.charAt(offset) === "0" && /[xX]/.test(text.charAt(offset + 1))) {
    offset += 2;
    while (offset < text.length) {
      const byte = text.charCodeAt(offset++);
      const digit = byte >= 48 && byte <= 57 ? byte - 48 : byte >= 97 && byte <= 102 ? byte - 87 : byte >= 65 && byte <= 70 ? byte - 55 : -1;
      if (digit < 0) break;
      value = value * 16 + digit;
    }
    return value * sign;
  }
  if (text.charAt(offset) === "'") return sign * (text.charCodeAt(offset + 1) || 0);
  let decimal = -1, total = 0;
  while (offset < text.length) {
    const byte = text.charCodeAt(offset++);
    if (byte === 46) { decimal = total; continue; }
    if (byte < 48 || byte > 57) break;
    value = value * 10 + byte - 48;
    total++;
  }
  if (decimal !== -1) while (total-- > decimal) value /= 10;
  return value * sign;
}

/** C-locale %f rounds the exact binary32 fraction to six decimals, ties to even. */
export function cvarValueText(input: number, integerShortcut: boolean): string {
  const value = Math.fround(input);
  if (!Number.isFinite(value)) throw new RangeError("Cvar_SetValue requires a finite float");
  if (integerShortcut && value >= -2147483648 && value < 2147483648 && value === Math.trunc(value)) return String(value);
  const bits = float32ToBits(value), exponent = (bits >>> 23) & 255, fraction = bits & 0x7fffff;
  const significand = BigInt(exponent === 0 ? fraction : fraction + 0x800000);
  const shift = exponent === 0 ? -149 : exponent - 150, scaled = significand * 1000000n;
  let rounded: bigint;
  if (shift >= 0) rounded = scaled << BigInt(shift);
  else {
    const divisor = 1n << BigInt(-shift), lower = scaled / divisor, remainder = scaled % divisor;
    rounded = remainder * 2n > divisor || (remainder * 2n === divisor && lower % 2n !== 0n) ? lower + 1n : lower;
  }
  return `${bits >>> 31 ? "-" : ""}${rounded / 1000000n}.${String(rounded % 1000000n).padStart(6, "0")}`;
}
