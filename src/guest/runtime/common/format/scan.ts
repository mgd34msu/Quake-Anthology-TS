// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress } from "../../../../contracts/execution.ts";
import type { MappedGuestMemory } from "../../../core/contracts.ts";
import { encodeBinary, formatFor, roundRational, writeBits } from "../../../floating-point/binary.ts";
import { readString, writeUnsigned } from "../memory.ts";
import { FormatArguments } from "./arguments.ts";

export class UnsupportedGuestScan extends Error {}

type ScanDirective = { readonly kind: "space" } | { readonly kind: "literal"; readonly value: string }
  | { readonly kind: "number"; readonly code: "d" | "i" | "f"; readonly width: number; readonly suppressed: boolean; readonly bytes: 4 | 8 };
const whitespace = (value: string): boolean => /^[\t\n\v\f\r ]$/.test(value);

function directives(format: string): readonly ScanDirective[] {
  const result: ScanDirective[] = [];
  for (let index = 0; index < format.length;) {
    const value = format.charAt(index++);
    if (whitespace(value)) { result.push({ kind: "space" }); continue; }
    if (value !== "%") { result.push({ kind: "literal", value }); continue; }
    if (format.charAt(index) === "%") { index++; result.push({ kind: "literal", value: "%" }); continue; }
    const suppressed = format.charAt(index) === "*";
    if (suppressed) index++;
    let digits = "";
    while (/^[0-9]$/.test(format.charAt(index))) digits += format.charAt(index++);
    const width = digits.length === 0 ? Number.MAX_SAFE_INTEGER : Number(digits);
    if (!Number.isSafeInteger(width) || width === 0) throw new UnsupportedGuestScan("invalid numeric scanf field width");
    const long = format.charAt(index) === "l";
    if (long) index++;
    const code = format.charAt(index++);
    if ("fFeEgG".includes(code) && code.length === 1) result.push({ kind: "number", code: "f", width, suppressed, bytes: long ? 8 : 4 });
    else if ((code === "d" || code === "i") && !long) result.push({ kind: "number", code, width, suppressed, bytes: 4 });
    else throw new UnsupportedGuestScan(`unsupported scanf conversion in ${format}`);
  }
  return result;
}

/** Convert decimal directly to the destination precision, avoiding binary64 to binary32 double rounding. */
function decimalBytes(token: string, bytes: 4 | 8): Uint8Array {
  const sign = token.startsWith("-") ? 1 : 0;
  const unsigned = token.replace(/^[+-]/, ""), parts = unsigned.toLowerCase().split("e");
  const mantissa = parts[0] ?? "", dot = mantissa.indexOf(".");
  const digits = mantissa.replace(".", "").replace(/^0+/, "");
  const exponent = Number(parts[1] ?? "0") - (dot < 0 ? 0 : mantissa.length - dot - 1);
  const width = bytes === 4 ? 32 : 64;
  if (digits.length === 0) return writeBits(encodeBinary({ kind: "finite", sign, coefficient: 0n, exponent: 0, denormal: false }, width), bytes);
  // Values beyond these bounds round to infinity or signed zero in both supported formats.
  if (exponent + digits.length > 400) return writeBits(encodeBinary({ kind: "infinity", sign }, width), bytes);
  if (exponent + digits.length < -400) return writeBits(encodeBinary({ kind: "finite", sign, coefficient: 0n, exponent: 0, denormal: false }, width), bytes);
  const coefficient = BigInt(digits), power = 10n ** BigInt(Math.abs(exponent));
  return writeBits(encodeBinary(roundRational(sign, exponent >= 0 ? coefficient * power : coefficient,
    exponent >= 0 ? 1n : power, 0, formatFor(width), "nearest").value, width), bytes);
}

export function scanWindowsBuffer(options: {
  readonly memory: MappedGuestMemory; readonly input: GuestAddress; readonly capacity: bigint;
  readonly format: GuestAddress; readonly arguments: GuestAddress | null;
}): number {
  const { memory, input, capacity } = options;
  const parsed = directives(readString(memory, options.format)), args = new FormatArguments(memory, "windows", options.arguments);
  let cursor = 0, assigned = 0, converted = false;
  const peek = (): string => {
    if (BigInt(cursor) >= capacity) return "";
    const byte = memory.readUint8(memory.offset(input, BigInt(cursor)));
    return byte === 0 ? "" : String.fromCharCode(byte);
  };
  const failure = (): number => !converted && peek() === "" ? -1 : assigned;
  for (const directive of parsed) {
    if (directive.kind === "space") { while (whitespace(peek())) cursor++; continue; }
    if (directive.kind === "literal") {
      if (peek() !== directive.value) return failure();
      cursor++; continue;
    }
    while (whitespace(peek())) cursor++;
    if (peek() === "") return failure();
    const start = cursor;
    let token = "";
    const take = (): void => { token += peek(); cursor++; };
    const current = (): string => cursor - start < directive.width ? peek() : "";
    if (current() === "+" || current() === "-") take();
    if (directive.code === "f") {
      if (/^[iInN]$/.test(current())) {
        while (/^[a-zA-Z]$/.test(current()) && token.length < 9) take();
        if (/^[+-]?(?:inf|nan)/i.test(token)) throw new UnsupportedGuestScan("scanf nonfinite text is not implemented");
        return assigned;
      }
      while (/^[0-9]$/.test(current())) take();
      if (/^[+-]?0$/.test(token) && (current() === "x" || current() === "X")) throw new UnsupportedGuestScan("scanf hexadecimal floating input is not implemented");
      if (current() === ".") { take(); while (/^[0-9]$/.test(current())) take(); }
      if (current() === "e" || current() === "E") {
        take(); if (current() === "+" || current() === "-") take();
        while (/^[0-9]$/.test(current())) take();
      }
      if (!/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(token)) return assigned;
    } else {
      let base = 10;
      if (directive.code === "i" && current() === "0") {
        take(); base = 8;
        if (current() === "x" || current() === "X") { take(); base = 16; }
      }
      const digit = base === 16 ? /^[0-9a-fA-F]$/ : base === 8 ? /^[0-7]$/ : /^[0-9]$/;
      while (digit.test(current())) take();
      if (!/^[+-]?(?:[0-9]+|0[xX][0-9a-fA-F]+)$/.test(token)) return assigned;
    }
    converted = true;
    if (directive.suppressed) continue;
    const argument = args.next("pointer");
    if (argument.kind !== "integer") throw new TypeError("scanf destination must be a pointer");
    const destination = memory.pointer(argument.value);
    if (destination === null) throw new TypeError("scanf destination is null");
    if (directive.code === "f") memory.write(destination, decimalBytes(token, directive.bytes));
    else {
      const unsigned = token.replace(/^[+-]/, "");
      const value = BigInt(directive.code === "i" && /^0[0-7]+$/.test(unsigned) ? `0o${unsigned}` : unsigned);
      writeUnsigned(memory, destination, 4, token.startsWith("-") ? -value : value);
    }
    assigned++;
  }
  return assigned;
}
