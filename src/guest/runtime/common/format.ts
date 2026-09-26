// SPDX-License-Identifier: GPL-2.0-or-later
import { Buffer } from "node:buffer";
import type { GuestAddress } from "../../../contracts/execution.ts";
import type { MappedGuestMemory } from "../../core/contracts.ts";
import { SparseGuestMemory } from "../../core/memory.ts";
import { readString, writeUnsigned } from "./memory.ts";
import { FormatArguments } from "./format/arguments.ts";
import type { FormatArgument, FormatArgumentType } from "./format/arguments.ts";
import { formatFloat } from "./format/float.ts";
import type { FormatRounding } from "./format/float.ts";

export interface GuestFormatRequest {
  readonly memory: MappedGuestMemory;
  readonly dialect: "windows" | "system-v";
  readonly format: GuestAddress | null;
  readonly arguments: GuestAddress | null;
  readonly buffer: GuestAddress | null;
  readonly capacity: bigint;
  readonly termination: "c99" | "ucrt" | "ucrt-legacy";
  /** UCRT's count flag is independent from its legacy termination flag. */
  readonly continueCount?: boolean;
  readonly rounding?: FormatRounding;
  readonly exponentDigits?: 2 | 3;
  /** glibc's positive fortify flag forbids %n in writable format storage. */
  readonly fortify?: boolean;
}
export interface GuestFormatResult { readonly result: number; readonly errno: number | null; }
export class GuestFormatFortifyFailure extends Error {
  constructor(message: string) { super(message); this.name = "GuestFormatFortifyFailure"; }
}
class FormatFailure extends Error { constructor(readonly errno: number, message: string) { super(message); } }
class BufferFull extends Error {}
interface Reference { readonly index: number; readonly type: FormatArgumentType; }
type Amount = { readonly kind: "literal"; readonly value: number } | { readonly kind: "argument"; readonly reference: Reference };
interface Conversion {
  readonly kind: "conversion"; readonly code: string; readonly length: string; readonly flags: string;
  readonly width: Amount; readonly precision: Amount | null; readonly argument: Reference | null;
}
type Token = { readonly kind: "literal"; readonly text: string } | Conversion;
interface ParsedFormat { readonly tokens: readonly Token[]; readonly positional: boolean; readonly references: readonly Reference[]; }
const parsedFormats: Record<GuestFormatRequest["dialect"], Record<4 | 8, Map<string, ParsedFormat>>> = {
  windows: { 4: new Map(), 8: new Map() }, "system-v": { 4: new Map(), 8: new Map() },
};
function retainedFormat(text: string, request: GuestFormatRequest): ParsedFormat {
  const formats = parsedFormats[request.dialect][request.memory.pointerBytes];
  const retained = formats.get(text);
  if (retained !== undefined) return retained;
  const result = parse(text, request);
  if (text.length <= 4096) {
    if (formats.size === 256) {
      const oldest = formats.keys().next();
      if (!oldest.done) formats.delete(oldest.value);
    }
    formats.set(text, result);
  }
  return result;
}
function integerBits(length: string, request: GuestFormatRequest): number {
  switch (length) {
    case "hh": return 8;
    case "h": return 16;
    case "ll": case "j": case "I64": case "q": return 64;
    case "L": return request.dialect === "system-v" ? 64 : 32;
    case "l": return request.dialect === "windows" ? 32 : request.memory.pointerBytes * 8;
    case "z": case "t": case "I": return request.memory.pointerBytes * 8;
    default: return 32;
  }
}
function parse(text: string, request: GuestFormatRequest): ParsedFormat {
  const tokens: Token[] = [], references: Reference[] = [];
  let at = 0, sequence = 0, positional = false, sequential = false;
  const invalid = (): never => { throw new FormatFailure(22, "Invalid guest printf conversion"); };
  const number = (): number => {
    const start = at; while (/[0-9]/.test(text.charAt(at)) && at < text.length) at++;
    const value = Number(text.slice(start, at));
    if (value > 0x7fffffff) throw new FormatFailure(request.dialect === "windows" ? 132 : 75, "printf width exceeds INT_MAX");
    return value;
  };
  const position = (): number | null => {
    const start = at, value = number();
    if (text.charAt(at) !== "$") { at = start; return null; }
    if (request.dialect === "windows" || value < 1 || value > 4096) return invalid();
    at++; return value - 1;
  };
  const reference = (type: FormatArgumentType, index: number | null): Reference => {
    if (index === null) sequential = true; else positional = true;
    if (positional && sequential) return invalid();
    const result = { type, index: index ?? sequence++ }; references.push(result); return result;
  };
  const amount = (): Amount => {
    if (text.charAt(at) !== "*") return { kind: "literal", value: number() };
    at++; return { kind: "argument", reference: reference("int", position()) };
  };
  while (at < text.length) {
    const start = at;
    while (at < text.length && text.charAt(at) !== "%") at++;
    if (at > start) tokens.push({ kind: "literal", text: text.slice(start, at) });
    if (at === text.length) break;
    at++;
    if (text.charAt(at) === "%") { tokens.push({ kind: "literal", text: "%" }); at++; continue; }
    const index = position(); let flags = "", length = "";
    while (at < text.length && "-+ #0'".includes(text.charAt(at))) { flags += text.charAt(at); at++; }
    const width = amount(); let precision: Amount | null = null;
    if (text.charAt(at) === ".") { at++; precision = amount(); }
    for (const candidate of ["I64", "I32", "hh", "ll", "h", "l", "L", "j", "z", "t", "I", "w", "q"])
      if (text.startsWith(candidate, at)) { length = candidate; at += candidate.length; break; }
    const code = text.charAt(at++);
    if (!"diouxXfFeEgGaAcCsSpn".includes(code) || code.length === 0) return invalid();
    if (request.dialect === "system-v" && ["I", "I32", "I64", "w"].includes(length)) return invalid();
    const type: FormatArgumentType = "fFeEgGaA".includes(code) ? length === "L" ? "long-double" : "double"
      : "sSpn".includes(code) ? "pointer" : "cC".includes(code) ? "int" : integerBits(length, request) === 64 ? "int64" : "int";
    tokens.push({ kind: "conversion", code, length, flags, width, precision, argument: reference(type, index) });
  }
  return { tokens, positional, references };
}

class Output {
  total = 0;
  used = 0;
  constructor(private readonly request: GuestFormatRequest) {}
  append(text: string): void {
    if (text.length === 0) return;
    const r = this.request, available = r.buffer === null ? 0 : Number(r.capacity > BigInt(this.used) ? r.capacity - BigInt(this.used) : 0n);
    const copied = Math.min(available, text.length);
    if (r.buffer !== null && copied > 0) {
      const bytes = new Uint8Array(copied);
      for (let index = 0; index < copied; index++) bytes[index] = text.charCodeAt(index);
      r.memory.write(r.memory.offset(r.buffer, BigInt(this.used)), bytes); this.used += copied;
    }
    if (r.buffer !== null && r.termination !== "c99" && r.continueCount !== true && copied < text.length) throw new BufferFull();
    this.total += text.length;
    if (this.total > 0x7fffffff) throw new FormatFailure(r.dialect === "windows" ? 132 : 75, "printf result exceeds INT_MAX");
  }
  repeat(character: string, count: number): void {
    // Counting large padding does not allocate a host string proportional to field width.
    if (count <= 0) return;
    const r = this.request;
    if (r.termination === "c99" || r.continueCount === true || r.buffer === null) {
      const available = r.buffer === null ? 0 : Math.max(0, Number(r.capacity - BigInt(this.used)));
      const copied = Math.min(count, available);
      for (let at = 0; at < copied; at += 4096) this.append(character.repeat(Math.min(4096, copied - at)));
      this.total += count - copied;
      if (this.total > 0x7fffffff) throw new FormatFailure(r.dialect === "windows" ? 132 : 75, "printf result exceeds INT_MAX");
    } else for (let at = 0; at < count; at += 4096) this.append(character.repeat(Math.min(4096, count - at)));
  }
  finish(error: number | null, full: boolean): GuestFormatResult {
    const r = this.request;
    if (r.buffer === null) return { result: error === null ? this.total : -1, errno: error };
    const capacity = r.capacity;
    if (r.termination === "ucrt-legacy") {
      if (BigInt(this.used) < capacity) r.memory.writeUint8(r.memory.offset(r.buffer, BigInt(this.used)), 0);
      return { result: error !== null || full || BigInt(this.total) > capacity ? -1 : this.total, errno: error };
    }
    if (capacity > 0n) {
      const at = error !== null && r.dialect === "windows" && r.termination === "c99" ? 0
        : BigInt(this.used) >= capacity ? Number(capacity - 1n) : this.used;
      r.memory.writeUint8(r.memory.offset(r.buffer, BigInt(at)), 0);
    }
    if (r.termination === "ucrt" && (capacity === 0n || BigInt(this.used) === capacity))
      return { result: capacity === 0n ? -1 : -2, errno: error };
    return { result: error === null ? this.total : -1, errno: error };
  }
}

function integer(value: FormatArgument): bigint {
  if (value.kind !== "integer") throw new FormatFailure(22, "printf argument used with conflicting types");
  return value.value;
}
function readonlyFormat(request: GuestFormatRequest, length: number): boolean {
  if (request.format === null) return false;
  let cursor = request.format.byteOffset; const end = cursor + BigInt(length + 1);
  for (const mapping of [...request.memory.mappings()].sort((a, b) => a.base < b.base ? -1 : a.base > b.base ? 1 : 0)) {
    const stop = mapping.base + BigInt(mapping.byteLength);
    if (stop <= cursor) continue;
    if (mapping.base > cursor || mapping.permissions.includes("write")) return false;
    cursor = stop; if (cursor >= end) return true;
  }
  return false;
}
function stringArgument(request: GuestFormatRequest, address: GuestAddress | null, wide: boolean, precision: number | null): string {
  if (address === null) return precision !== null && request.dialect === "system-v" && precision < 6 ? "" : "(null)".slice(0, precision ?? 6);
  const m = request.memory, width = wide ? request.dialect === "windows" ? 2 : 4 : 1;
  if (!wide && SparseGuestMemory.managed(m)) {
    if (precision === 0) return "";
    const length = m.findZero(address, precision ?? 1048576);
    if (length < 0 && precision === null) throw new RangeError("Guest printf string exceeds runtime string limit");
    const bytes = m.copy(address, length < 0 ? precision ?? 0 : length);
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
  }
  let text = "";
  for (let index = 0; precision === null || text.length < precision; index++) {
    if (index >= 1048576) throw new RangeError("Guest printf string exceeds runtime string limit");
    const at = m.offset(address, BigInt(index * width)), code = width === 4 ? m.readUint32(at) : width === 2 ? m.readUint16(at) : m.readUint8(at);
    if (code === 0) break;
    // The runtimes install the C locale. Wide-to-multibyte conversion must not use the host locale.
    if (wide && code > (request.dialect === "windows" ? 255 : 127)) throw new FormatFailure(request.dialect === "windows" ? 42 : 84, "Unrepresentable C-locale wide character");
    text += String.fromCharCode(code);
  }
  return text;
}

/** UCRT/glibc narrow printf over checked guest bytes; no host printf or native CRT calls. */
export function formatGuestBuffer(request: GuestFormatRequest): GuestFormatResult {
  if (request.capacity < 0n || request.capacity > (1n << BigInt(request.memory.pointerBytes * 8)) - 1n)
    throw new RangeError("Guest printf buffer count is not size_t");
  if (request.format === null || request.buffer === null && request.capacity !== 0n) return { result: -1, errno: 22 };
  const output = new Output(request);
  try {
    const text = readString(request.memory, request.format), parsed = retainedFormat(text, request);
    // A literal format need not touch a caller's otherwise unused va_list.
    const reader = parsed.references.length === 0 ? null : new FormatArguments(request.memory, request.dialect, request.arguments);
    const values = new Map<number, FormatArgument>();
    if (parsed.positional) {
      const types = new Map<number, FormatArgumentType>();
      for (const reference of parsed.references) {
        const previous = types.get(reference.index);
        if (previous !== undefined && previous !== reference.type) throw new FormatFailure(22, "Conflicting positional printf types");
        types.set(reference.index, reference.type);
      }
      for (let index = 0; index < types.size; index++) {
        const type = types.get(index);
        if (type === undefined || reader === null) throw new FormatFailure(22, "Gapped positional printf arguments");
        values.set(index, reader.next(type));
      }
    }
    const get = (reference: Reference): FormatArgument => {
      if (!parsed.positional) { if (reader === null) throw new Error("Missing printf argument reader"); return reader.next(reference.type); }
      const value = values.get(reference.index); if (value === undefined) throw new FormatFailure(22, "Missing positional printf argument"); return value;
    };
    const amount = (value: Amount): number => value.kind === "literal" ? value.value : Number(BigInt.asIntN(32, integer(get(value.reference))));
    for (const token of parsed.tokens) {
      if (token.kind === "literal") { output.append(token.text); continue; }
      let width = amount(token.width), precision = token.precision === null ? null : amount(token.precision);
      const left = token.flags.includes("-") || width < 0; width = Math.abs(width);
      if (precision !== null && precision < 0) precision = null;
      if (precision !== null && precision > 1048576) throw new RangeError("Guest printf precision exceeds runtime conversion limit");
      const alternate = token.flags.includes("#"), plus = token.flags.includes("+"), blank = token.flags.includes(" ");
      if (token.argument === null) throw new Error("Missing printf conversion argument");
      const value = get(token.argument), code = token.code;
      let body = "", prefix = "", zero = token.flags.includes("0") && !left;
      if ("diouxX".includes(code)) {
        const signed = code === "d" || code === "i", bits = integerBits(token.length, request);
        const number = signed ? BigInt.asIntN(bits, integer(value)) : BigInt.asUintN(bits, integer(value));
        const magnitude = number < 0n ? -number : number, radix = code === "o" ? 8 : code === "x" || code === "X" ? 16 : 10;
        body = precision === 0 && magnitude === 0n ? "" : magnitude.toString(radix);
        body = body.padStart(precision ?? 1, "0");
        if (code === "X") body = body.toUpperCase();
        if (signed) prefix = number < 0n ? "-" : plus ? "+" : blank ? " " : "";
        else if (alternate && radix === 16 && magnitude !== 0n) prefix = code === "X" ? "0X" : "0x";
        else if (alternate && radix === 8 && !body.startsWith("0")) prefix = "0";
        if (precision !== null) zero = false;
      } else if ("fFeEgGaA".includes(code)) {
        if (value.kind !== "float") throw new FormatFailure(22, "printf float argument required");
        body = formatFloat(value.value, code, precision, alternate, request.rounding ?? "nearest", request.dialect === "windows",
          token.length === "L" && request.dialect === "system-v", request.exponentDigits ?? 2);
        prefix = value.value.sign === 1 ? "-" : plus ? "+" : blank ? " " : "";
        if (value.value.kind !== "finite") zero = false;
        if (body.startsWith("0x") || body.startsWith("0X")) { prefix += body.slice(0, 2); body = body.slice(2); }
      } else if (code === "p") {
        const pointer = BigInt.asUintN(request.memory.pointerBytes * 8, integer(value));
        if (request.dialect === "windows") body = pointer.toString(16).toUpperCase().padStart(request.memory.pointerBytes * 2, "0");
        else if (pointer === 0n) { body = "(nil)"; zero = false; }
        else { prefix = "0x"; body = pointer.toString(16).padStart(precision ?? 1, "0"); }
      } else if (code === "s" || code === "S") {
        const wide = token.length === "l" || token.length === "w" || code === "S" && token.length !== "h";
        body = stringArgument(request, request.memory.pointer(integer(value)), wide, precision); zero = false;
      } else if (code === "c" || code === "C") {
        const wide = token.length === "l" || token.length === "w" || code === "C" && token.length !== "h";
        const number = Number(BigInt.asUintN(wide ? request.dialect === "windows" ? 16 : 32 : 8, integer(value)));
        if (wide && number > (request.dialect === "windows" ? 255 : 127)) throw new FormatFailure(request.dialect === "windows" ? 42 : 84, "Unrepresentable C-locale wide character");
        body = String.fromCharCode(number); zero = false;
      } else if (code === "n") {
        if (request.dialect === "windows") throw new FormatFailure(22, "UCRT printf count output is disabled");
        if (request.fortify === true && !readonlyFormat(request, text.length)) throw new GuestFormatFortifyFailure("glibc %n in writable format storage");
        const address = request.memory.pointer(integer(value)); if (address === null) throw new TypeError("Null printf count pointer");
        writeUnsigned(request.memory, address, integerBits(token.length, request) / 8, BigInt(output.total)); continue;
      }
      const padding = Math.max(0, width - prefix.length - body.length);
      if (!left && !zero) output.repeat(" ", padding);
      output.append(prefix); if (zero) output.repeat("0", padding); output.append(body);
      if (left) output.repeat(" ", padding);
    }
    return output.finish(null, false);
  } catch (error) {
    if (error instanceof BufferFull) return output.finish(null, true);
    if (error instanceof FormatFailure) return output.finish(error.errno, false);
    throw error;
  }
}
