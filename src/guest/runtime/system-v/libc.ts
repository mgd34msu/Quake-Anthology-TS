// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, GuestCallResult, GuestCallValue } from "../../../contracts/execution.ts";
import { count, integer, pointer, readString, requiredPointer, stringBytes } from "../common/memory.ts";
import type { SystemVServiceHost } from "./contracts.ts";
import { UnsupportedSystemVService } from "./contracts.ts";
import { installSystemVFormat } from "../common/format/services.ts";

function floating(args: readonly GuestCallValue[], index: number): number {
  const value = args[index];
  if (value?.kind !== "float32" && value?.kind !== "float64") throw new TypeError("System V floating argument required");
  return value.value;
}
function sizeValue(host: SystemVServiceHost, value: number): GuestCallResult { return host.pointerStorage === "uint32" ? { kind: "uint32", value } : { kind: "uint64", value: BigInt(value) }; }
function signedSizeValue(host: SystemVServiceHost, value: bigint): GuestCallResult { return host.signedPointerStorage === "int32" ? { kind: "int32", value: Number(BigInt.asIntN(32, value)) } : { kind: "int64", value }; }
function compare(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) if (a.charCodeAt(i) !== b.charCodeAt(i)) return a.charCodeAt(i) - b.charCodeAt(i);
  return a.length === b.length ? 0 : a.length < b.length ? -b.charCodeAt(length) : a.charCodeAt(length);
}
export function installLibc(host: SystemVServiceHost): void {
  installSystemVFormat(host);
  const m = host.memory, p = host.pointerStorage, base = m.pointerBytes === 4 ? "GLIBC_2.0" : "GLIBC_2.2.5";
  const version = [base, null], lib = "libc.so.6";
  host.service(lib, "__errno_location", version, [], "pointer", () => ({ kind: "pointer", value: host.errnoAddress }));
  if (m.pointerBytes === 8) host.service("ld-linux-x86-64.so.2", "__tls_get_addr", ["GLIBC_2.3", null], ["pointer"], "pointer", (_context, args) => {
    const index = requiredPointer(args, 0);
    return { kind: "pointer", value: host.tlsAddress(m.readUint64(index), m.readUint64(m.offset(index, 8n))) };
  });
  host.service(lib, "malloc", version, [p], "pointer", (_context, args) => ({ kind: "pointer", value: host.allocate(count(args, 0)) }));
  host.service(lib, "calloc", version, [p, p], "pointer", (_context, args) => {
    const total = integer(args, 0) * integer(args, 1);
    if (total > 0x10000000n) { host.errno = 12; return { kind: "pointer", value: null }; }
    return { kind: "pointer", value: host.allocate(Number(total)) };
  });
  host.service(lib, "free", version, ["pointer"], "void", (_context, args) => { host.free(pointer(args, 0)); return { kind: "void" }; });
  host.service(lib, "realloc", version, ["pointer", p], "pointer", (_context, args) => {
    const old = pointer(args, 0), size = count(args, 1);
    if (size === 0 && old !== null) { host.free(old); return { kind: "pointer", value: null }; }
    const oldSize = old === null ? 0 : host.allocationSize(old);
    if (oldSize === null) throw new Error("System V realloc of non-live allocation");
    const next = host.allocate(size);
    if (old !== null) { m.write(next, m.copy(old, Math.min(size, oldSize))); host.free(old); }
    return { kind: "pointer", value: next };
  });
  for (const name of ["memcpy", "memmove", "__memcpy_chk", "__memmove_chk"]) {
    const checked = name.startsWith("__");
    host.service(lib, name, checked ? ["GLIBC_2.3.4", null] : name === "memcpy" && m.pointerBytes === 8 ? [...version, "GLIBC_2.14"] : version,
      checked ? ["pointer", "pointer", p, p] : ["pointer", "pointer", p], "pointer", (_context, args) => {
        const destination = pointer(args, 0), source = pointer(args, 1), length = count(args, 2);
        if (checked && BigInt(length) > integer(args, 3)) throw new Error(`${name} detected guest buffer overflow`);
        if (length !== 0) {
          if (destination === null || source === null) throw new TypeError("Nonnull guest memory arguments required");
          m.write(destination, m.copy(source, length));
        }
        return { kind: "pointer", value: destination };
      });
  }
  host.service(lib, "memset", version, ["pointer", "int32", p], "pointer", (_context, args) => {
    const destination = pointer(args, 0), length = count(args, 2);
    if (length !== 0) { if (destination === null) throw new TypeError("Nonnull memset destination required"); m.write(destination, new Uint8Array(length).fill(Number(integer(args, 1) & 255n))); }
    return { kind: "pointer", value: destination };
  });
  host.service(lib, "memcmp", version, ["pointer", "pointer", p], "int32", (_context, args) => {
    const length = count(args, 2);
    if (length === 0) return { kind: "int32", value: 0 };
    const a = m.copy(requiredPointer(args, 0), length), b = m.copy(requiredPointer(args, 1), length);
    for (let index = 0; index < length; index++) { const delta = (a[index] ?? 0) - (b[index] ?? 0); if (delta !== 0) return { kind: "int32", value: delta }; }
    return { kind: "int32", value: 0 };
  });
  host.service(lib, "strlen", version, ["pointer"], p, (_context, args) => sizeValue(host, readString(m, requiredPointer(args, 0)).length));
  host.service(lib, "strcmp", version, ["pointer", "pointer"], "int32", (_context, args) => ({ kind: "int32", value: compare(readString(m, requiredPointer(args, 0)), readString(m, requiredPointer(args, 1))) }));
  for (const name of ["strcpy", "stpcpy", "strcat", "__strcpy_chk", "__stpcpy_chk", "__strcat_chk"]) {
    const checked = name.startsWith("__"), concatenate = name.includes("strcat"), end = name.includes("stpcpy");
    host.service(lib, name, checked ? ["GLIBC_2.3.4", null] : version, checked ? ["pointer", "pointer", p] : ["pointer", "pointer"], "pointer", (_context, args) => {
      const destination = requiredPointer(args, 0), text = readString(m, requiredPointer(args, 1));
      const prefix = concatenate ? readString(m, destination).length : 0;
      if (checked && BigInt(prefix + text.length + 1) > integer(args, 2)) throw new Error(`${name} detected guest buffer overflow`);
      m.write(m.offset(destination, BigInt(prefix)), stringBytes(text));
      return { kind: "pointer", value: end ? m.offset(destination, BigInt(text.length)) : destination };
    });
  }
  host.service(lib, "strncpy", version, ["pointer", "pointer", p], "pointer", (_context, args) => {
    const length = count(args, 2), destination = pointer(args, 0);
    if (length === 0) return { kind: "pointer", value: destination };
    if (destination === null) throw new TypeError("Nonnull strncpy destination required");
    const source = requiredPointer(args, 1), bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) { const byte = m.readUint8(m.offset(source, BigInt(i))); if (byte === 0) break; bytes[i] = byte; }
    m.write(destination, bytes); return { kind: "pointer", value: destination };
  });
  for (const name of ["strchr", "strrchr"]) host.service(lib, name, version, ["pointer", "int32"], "pointer", (_context, args) => {
    const source = requiredPointer(args, 0), text = `${readString(m, source)}\0`, needle = String.fromCharCode(Number(integer(args, 1) & 255n));
    const index = name === "strchr" ? text.indexOf(needle) : text.lastIndexOf(needle);
    return { kind: "pointer", value: index < 0 ? null : m.offset(source, BigInt(index)) };
  });
  for (const name of ["strstr", "strpbrk"]) host.service(lib, name, version, ["pointer", "pointer"], "pointer", (_context, args) => {
    const source = requiredPointer(args, 0), text = readString(m, source), needle = readString(m, requiredPointer(args, 1));
    const index = name === "strstr" ? text.indexOf(needle) : [...text].findIndex(character => needle.includes(character));
    return { kind: "pointer", value: index < 0 ? null : m.offset(source, BigInt(index)) };
  });
  const tokenSlot = m.allocate({ byteLength: m.pointerBytes, label: "System V strtok cursor" });
  host.service(lib, "strtok", version, ["pointer", "pointer"], "pointer", (_context, args) => {
    const source = pointer(args, 0) ?? m.readPointer(tokenSlot), delimiters = readString(m, requiredPointer(args, 1));
    if (source === null) return { kind: "pointer", value: null };
    const text = readString(m, source); let start = 0;
    while (start < text.length && delimiters.includes(text.charAt(start))) start++;
    if (start === text.length) { m.writePointer(tokenSlot, null); return { kind: "pointer", value: null }; }
    let end = start; while (end < text.length && !delimiters.includes(text.charAt(end))) end++;
    if (end < text.length) { m.writeUint8(m.offset(source, BigInt(end)), 0); m.writePointer(tokenSlot, m.offset(source, BigInt(end + 1))); }
    else m.writePointer(tokenSlot, null);
    return { kind: "pointer", value: m.offset(source, BigInt(start)) };
  });
  host.service(lib, "strtol", version, ["pointer", "pointer", "int32"], host.signedPointerStorage, (_context, args) => {
    const source = requiredPointer(args, 0), endPointer = pointer(args, 1), text = readString(m, source);
    let radix = Number(integer(args, 2)), index = 0, sign = 1n;
    if (radix !== 0 && (radix < 2 || radix > 36)) { host.errno = 22; if (endPointer !== null) m.writePointer(endPointer, source); return signedSizeValue(host, 0n); }
    while (index < text.length && " \t\n\r\v\f".includes(text.charAt(index))) index++;
    if (text.charAt(index) === "-" || text.charAt(index) === "+") { if (text.charAt(index) === "-") sign = -1n; index++; }
    if ((radix === 0 || radix === 16) && text.slice(index, index + 2).toLowerCase() === "0x" && /[0-9a-f]/i.test(text.charAt(index + 2))) { radix = 16; index += 2; }
    if (radix === 0) radix = text.charAt(index) === "0" ? 8 : 10;
    const first = index, limit = 1n << BigInt(m.pointerBytes * 8 - 1); let value = 0n;
    for (; index < text.length; index++) {
      const digit = "0123456789abcdefghijklmnopqrstuvwxyz".indexOf(text.charAt(index).toLowerCase());
      if (digit < 0 || digit >= radix) break;
      if (value <= limit) value = value * BigInt(radix) + BigInt(digit);
    }
    if (endPointer !== null) m.writePointer(endPointer, m.offset(source, BigInt(index === first ? 0 : index)));
    value *= sign;
    if (value < -limit || value >= limit) { host.errno = 34; value = value < 0n ? -limit : limit - 1n; }
    return signedSizeValue(host, value);
  });
  host.service(lib, "time", version, ["pointer"], host.signedPointerStorage, (context, args) => {
    if (host.capabilities.nowSeconds === undefined) throw new UnsupportedSystemVService(lib, "time", base, context, "no deterministic clock capability supplied");
    const value = host.capabilities.nowSeconds(), destination = pointer(args, 0);
    if (destination !== null) { if (m.pointerBytes === 4) m.writeInt32(destination, Number(BigInt.asIntN(32, value))); else m.writeInt64(destination, value); }
    return signedSizeValue(host, value);
  });
  host.service(lib, "qsort", version, ["pointer", p, p, "pointer"], "void", (context, args) => {
    const baseAddress = pointer(args, 0), length = count(args, 1), size = count(args, 2), comparator = requiredPointer(args, 3);
    if (length < 2 || size === 0) return { kind: "void" };
    if (baseAddress === null || length * size > 0x10000000) throw new RangeError("qsort range outside supported guest memory");
    m.check(baseAddress, length * size, "write");
    const at = (index: number): GuestAddress => m.offset(baseAddress, BigInt(index * size));
    const less = (a: number, b: number): boolean => {
      const result = host.invoke(context, comparator, ["pointer", "pointer"], "int32", [{ kind: "pointer", value: at(a) }, { kind: "pointer", value: at(b) }]);
      if (result.kind !== "int32") throw new TypeError("qsort comparator returned wrong type");
      return result.value < 0;
    };
    const swap = (a: number, b: number): void => { const bytes = m.copy(at(a), size); m.write(at(a), m.copy(at(b), size)); m.write(at(b), bytes); };
    const sift = (root: number, end: number): void => {
      for (let child = root * 2 + 1; child < end; child = root * 2 + 1) {
        if (child + 1 < end && less(child, child + 1)) child++;
        if (!less(root, child)) break;
        swap(root, child); root = child;
      }
    };
    for (let i = Math.floor(length / 2) - 1; i >= 0; i--) sift(i, length);
    for (let end = length - 1; end > 0; end--) { swap(0, end); sift(0, end); }
    return { kind: "void" };
  });
  for (const name of ["sin", "cos", "ceil", "floor", "sqrt", "fabs"]) {
    const operation = name === "sin" ? Math.sin : name === "cos" ? Math.cos : name === "ceil" ? Math.ceil : name === "floor" ? Math.floor : name === "sqrt" ? Math.sqrt : Math.abs;
    for (const storage of ["float32", "float64"] satisfies readonly ("float32" | "float64")[]) host.service("libm.so.6", `${name}${storage === "float32" ? "f" : ""}`, version, [storage], storage, (_context, args) => {
      const value = operation(floating(args, 0)); return storage === "float32" ? { kind: "float32", value: Math.fround(value) } : { kind: "float64", value };
    });
  }
  host.service("libm.so.6", "__atan2_finite", ["GLIBC_2.15", null], ["float64", "float64"], "float64", (_context, args) => ({ kind: "float64", value: Math.atan2(floating(args, 0), floating(args, 1)) }));
  for (const storage of ["float32", "float64"] satisfies readonly ("float32" | "float64")[]) host.service("libm.so.6", storage === "float32" ? "sincosf" : "sincos", [m.pointerBytes === 4 ? "GLIBC_2.1" : "GLIBC_2.2.5", null], [storage, "pointer", "pointer"], "void", (_context, args) => {
    const value = floating(args, 0), sine = requiredPointer(args, 1), cosine = requiredPointer(args, 2);
    if (storage === "float32") { m.writeFloat32(sine, Math.sin(value)); m.writeFloat32(cosine, Math.cos(value)); }
    else { m.writeFloat64(sine, Math.sin(value)); m.writeFloat64(cosine, Math.cos(value)); }
    return { kind: "void" };
  });
  host.service(lib, "__isnanf", version, ["float32"], "int32", (_context, args) => ({ kind: "int32", value: Number(Number.isNaN(floating(args, 0))) }));
  host.service(lib, "__stack_chk_fail", ["GLIBC_2.4", null], [], "void", context => { throw new UnsupportedSystemVService(lib, "__stack_chk_fail", "GLIBC_2.4", context, "guest stack protection failure"); });
}
