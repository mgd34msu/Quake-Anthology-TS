// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestCallResult, GuestStorage } from "../../../contracts/execution.ts";
import { argument, count, fillBytes, integer, moveBytes, pointer, readPointer, readString, readUnsigned, requiredPointer, stringBytes, stringLength, writePointer, writeUnsigned } from "../common/memory.ts";
import type { WindowsServiceHost } from "./contracts.ts";
import { UnsupportedWindowsImport } from "./contracts.ts";
import { installWindowsFormat } from "../common/format/services.ts";

export function installCrt(host: WindowsServiceHost): void {
  const memory = host.memory, width = memory.pointerBytes;
  // Microsoft STL xtime.cpp: FILETIME ticks minus the 1601-to-1970 epoch offset.
  host.service("msvcp140.dll", "_Xtime_get_ticks", [], "int64", () => ({ kind: "int64", value: BigInt(Math.trunc(host.capabilities.nowMilliseconds?.() ?? Date.now())) * 10000n }));
  function service(family: string, name: string, parameters: readonly GuestStorage[], result: GuestStorage | "void", invoke: Parameters<WindowsServiceHost["service"]>[4]): void {
    for (const library of [family === "vcruntime" ? "vcruntime140.dll" : `api-ms-win-crt-${family}-l1-1-0.dll`, "ucrtbase.dll", "msvcrt.dll"]) host.service(library, name, parameters, result, invoke);
  }
  const zero = (): GuestCallResult => ({ kind: "int32", value: 0 });
  const done = (): GuestCallResult => ({ kind: "void" });
  service("heap", "malloc", [host.pointerStorage], "pointer", (_context, args) => ({ kind: "pointer", value: host.allocate(count(args, 0)) }));
  service("heap", "calloc", [host.pointerStorage, host.pointerStorage], "pointer", (_context, args) => {
    const size = integer(args, 0) * integer(args, 1); return { kind: "pointer", value: size > 0x10000000n ? null : host.allocate(Number(size)) };
  });
  service("heap", "free", ["pointer"], "void", (_context, args) => { if (!host.free(pointer(args, 0))) throw new Error("CRT free of invalid guest allocation"); return done(); });
  service("heap", "_callnewh", [host.pointerStorage], "int32", () => zero());
  for (const name of ["memcpy", "memmove"]) service("vcruntime", name, ["pointer", "pointer", host.pointerStorage], "pointer", (_context, args) => {
    const size = count(args, 2), destination = pointer(args, 0); if (size > 0) moveBytes(memory, requiredPointer(args, 0), requiredPointer(args, 1), size); return { kind: "pointer", value: destination };
  });
  service("vcruntime", "memset", ["pointer", "int32", host.pointerStorage], "pointer", (_context, args) => {
    const size = count(args, 2), destination = pointer(args, 0); if (size > 0) fillBytes(memory, requiredPointer(args, 0), size, Number(integer(args, 1)) & 255); return { kind: "pointer", value: destination };
  });
  service("vcruntime", "memcmp", ["pointer", "pointer", host.pointerStorage], "int32", (_context, args) => {
    const size = count(args, 2); if (size === 0) return zero(); const left = memory.copy(requiredPointer(args, 0), size), right = memory.copy(requiredPointer(args, 1), size);
    for (let i = 0; i < size; i++) { const a = left[i] ?? 0, b = right[i] ?? 0; if (a !== b) return { kind: "int32", value: a - b }; } return zero();
  });
  service("vcruntime", "memchr", ["pointer", "int32", host.pointerStorage], "pointer", (_context, args) => {
    const size = count(args, 2); if (size === 0) return { kind: "pointer", value: null }; const address = requiredPointer(args, 0);
    const index = memory.copy(address, size).indexOf(Number(integer(args, 1)) & 255); return { kind: "pointer", value: index < 0 ? null : memory.offset(address, BigInt(index)) };
  });
  service("string", "strlen", ["pointer"], host.pointerStorage, (_context, args) => { const value = stringLength(memory, requiredPointer(args, 0)); return host.pointerStorage === "uint64" ? { kind: "uint64", value: BigInt(value) } : { kind: "uint32", value }; });
  for (const name of ["strcmp", "strncmp"]) service("string", name, name === "strcmp" ? ["pointer", "pointer"] : ["pointer", "pointer", host.pointerStorage], "int32", (_context, args) => {
    const left = requiredPointer(args, 0), right = requiredPointer(args, 1), maximum = name === "strcmp" ? 1048576 : count(args, 2);
    for (let i = 0; i < maximum; i++) { const a = Number(readUnsigned(memory, memory.offset(left, BigInt(i)), 1)), b = Number(readUnsigned(memory, memory.offset(right, BigInt(i)), 1));
      if (a !== b) return { kind: "int32", value: a - b }; if (a === 0) return zero(); } return zero();
  });
  service("vcruntime", "strchr", ["pointer", "int32"], "pointer", (_context, args) => {
    const address = requiredPointer(args, 0), text = readString(memory, address) + "\0", index = text.indexOf(String.fromCharCode(Number(integer(args, 1)) & 255)); return { kind: "pointer", value: index < 0 ? null : memory.offset(address, BigInt(index)) };
  });
  service("vcruntime", "strstr", ["pointer", "pointer"], "pointer", (_context, args) => {
    const address = requiredPointer(args, 0), index = readString(memory, address).indexOf(readString(memory, requiredPointer(args, 1))); return { kind: "pointer", value: index < 0 ? null : memory.offset(address, BigInt(index)) };
  });
  service("runtime", "_configure_narrow_argv", ["int32"], "int32", (context, args) => { const mode = integer(args, 0); if (mode < 0n || mode > 2n) throw new UnsupportedWindowsImport("ucrtbase.dll", "_configure_narrow_argv", context, "invalid argument mode"); return zero(); });
  service("runtime", "_initialize_narrow_environment", [], "int32", () => zero());
  const onexit = memory.allocate({ byteLength: width * 3, label: "UCRT process onexit table" });
  service("runtime", "_initialize_onexit_table", ["pointer"], "int32", (_context, args) => { memory.write(requiredPointer(args, 0), new Uint8Array(width * 3)); return zero(); });
  const registerExit: Parameters<WindowsServiceHost["service"]>[4] = (_context, args) => {
    const table = requiredPointer(args, 0), callback = requiredPointer(args, 1);
    let begin = readPointer(memory, table), end = readPointer(memory, memory.offset(table, BigInt(width))), capacity = readPointer(memory, memory.offset(table, BigInt(width * 2)));
    if (begin === null || end === null || capacity === null || end.byteOffset === capacity.byteOffset) {
      const existing = begin === null || end === null ? 0 : Number(end.byteOffset - begin.byteOffset);
      const next = host.allocate(Math.max(32 * width, existing * 2)); if (next === null) return { kind: "int32", value: -1 };
      if (begin !== null) { moveBytes(memory, next, begin, existing); host.free(begin); }
      begin = next; end = memory.offset(next, BigInt(existing)); capacity = memory.offset(next, BigInt(Math.max(32 * width, existing * 2)));
      writePointer(memory, table, begin); writePointer(memory, memory.offset(table, BigInt(width * 2)), capacity);
    }
    writePointer(memory, end, callback); writePointer(memory, memory.offset(table, BigInt(width)), memory.offset(end, BigInt(width))); return zero();
  };
  service("runtime", "_register_onexit_function", ["pointer", "pointer"], "int32", registerExit);
  service("runtime", "_crt_atexit", ["pointer"], "int32", (context, args) => registerExit(context, [{ kind: "pointer", value: onexit }, argument(args, 0)]));
  const executeExit: Parameters<WindowsServiceHost["service"]>[4] = (context, args) => {
    const table = requiredPointer(args, 0), begin = readPointer(memory, table), end = readPointer(memory, memory.offset(table, BigInt(width)));
    if (begin !== null && end !== null) {
      for (let at = end.byteOffset - BigInt(width); at >= begin.byteOffset; at -= BigInt(width)) {
        const slot = memory.pointer(at); if (slot === null) throw new Error("Null onexit slot"); const callback = readPointer(memory, slot); writePointer(memory, slot, null);
        if (callback !== null) host.invoke(context, callback, [], "void", []);
      }
      host.free(begin);
    }
    memory.write(table, new Uint8Array(width * 3)); return zero();
  };
  service("runtime", "_execute_onexit_table", ["pointer"], "int32", executeExit);
  service("runtime", "_cexit", [], "void", (context) => { executeExit(context, [{ kind: "pointer", value: onexit }]); return done(); });
  for (const name of ["_initterm", "_initterm_e"]) service("runtime", name, ["pointer", "pointer"], name === "_initterm" ? "void" : "int32", (context, args) => {
    const begin = requiredPointer(args, 0), end = requiredPointer(args, 1);
    if (end.byteOffset < begin.byteOffset || (end.byteOffset - begin.byteOffset) % BigInt(width) !== 0n || end.byteOffset - begin.byteOffset > 1048576n) throw new Error("Invalid CRT initializer range");
    for (let at = begin.byteOffset; at < end.byteOffset; at += BigInt(width)) {
      const slot = memory.pointer(at); if (slot === null) throw new Error("Null CRT initializer slot"); const callback = readPointer(memory, slot);
      if (callback === null) continue; const result = host.invoke(context, callback, [], name === "_initterm" ? "void" : "int32", []);
      if (result.kind === "int32" && result.value !== 0) return result;
    }
    return name === "_initterm" ? done() : zero();
  });
  service("vcruntime", "__std_type_info_destroy_list", ["pointer"], "void", (context, args) => {
    const header = memory.copy(requiredPointer(args, 0), width === 4 ? 8 : 16);
    if (header.some(byte => byte !== 0)) throw new UnsupportedWindowsImport("vcruntime140.dll", "__std_type_info_destroy_list", context, "populated type-name SLIST destruction is not implemented");
    return done();
  });
  installMath(host, service);
  installConversions(host, service);
  service("utility", "qsort", ["pointer", host.pointerStorage, host.pointerStorage, "pointer"], "void", (context, args) => {
    const length = count(args, 1), size = count(args, 2); if (length < 2) return done();
    if (size === 0 || length * size > 0x10000000) throw new RangeError("Invalid guest qsort extent");
    const base = requiredPointer(args, 0), comparator = requiredPointer(args, 3); memory.check(base, length * size, "write");
    const at = (index: number) => memory.offset(base, BigInt(index * size));
    const compare = (left: number, right: number): number => {
      const result = host.invoke(context, comparator, ["pointer", "pointer"], "int32", [{ kind: "pointer", value: at(left) }, { kind: "pointer", value: at(right) }]);
      if (result.kind !== "int32") throw new TypeError("qsort comparator must return int"); return result.value;
    };
    const swap = (left: number, right: number): void => { const value = memory.copy(at(left), size); memory.write(at(left), memory.copy(at(right), size)); memory.write(at(right), value); };
    const sift = (start: number, end: number): void => {
      let root = start;
      while (root * 2 + 1 < end) {
        let child = root * 2 + 1; if (child + 1 < end && compare(child, child + 1) < 0) child++;
        if (compare(root, child) >= 0) return; swap(root, child); root = child;
      }
    };
    for (let start = Math.floor(length / 2) - 1; start >= 0; start--) sift(start, length);
    for (let end = length - 1; end > 0; end--) { swap(0, end); sift(0, end); }
    return done();
  });
}

function installMath(host: WindowsServiceHost, service: (family: string, name: string, parameters: readonly GuestStorage[], result: GuestStorage | "void", invoke: Parameters<WindowsServiceHost["service"]>[4]) => void): void {
  const real = (args: Parameters<Parameters<WindowsServiceHost["service"]>[4]>[1], index: number): number => { const value = argument(args, index); if (value.kind !== "float32" && value.kind !== "float64") throw new TypeError("CRT floating argument required"); return value.value; };
  const unary: readonly (readonly [string, (value: number) => number])[] = [["acosf", Math.acos], ["sinf", Math.sin], ["ceilf", Math.ceil], ["cosf", Math.cos], ["truncf", Math.trunc], ["log2f", Math.log2], ["floorf", Math.floor], ["sqrtf", Math.sqrt], ["tanf", Math.tan]];
  for (const [name, fn] of unary) service("math", name, ["float32"], "float32", (_context, args) => ({ kind: "float32", value: Math.fround(fn(real(args, 0))) }));
  for (const [name, fn] of [["atan2f", Math.atan2], ["fmodf", (a: number, b: number) => a % b]] satisfies readonly (readonly [string, (a: number, b: number) => number])[]) service("math", name, ["float32", "float32"], "float32", (_context, args) => ({ kind: "float32", value: Math.fround(fn(real(args, 0), real(args, 1))) }));
  service("math", "pow", ["float64", "float64"], "float64", (_context, args) => ({ kind: "float64", value: Math.pow(real(args, 0), real(args, 1)) }));
  service("math", "nextafterf", ["float32", "float32"], "float32", (_context, args) => {
    const a = Math.fround(real(args, 0)), b = Math.fround(real(args, 1)); if (Number.isNaN(a) || Number.isNaN(b)) return { kind: "float32", value: a + b }; if (a === b) return { kind: "float32", value: b };
    const view = new DataView(new ArrayBuffer(4)); view.setFloat32(0, a, true); let bits = view.getUint32(0, true);
    if (a === 0) bits = b < 0 ? 0x80000001 : 1; else bits = (bits + ((b > a) === (a > 0) ? 1 : -1)) >>> 0;
    view.setUint32(0, bits, true); return { kind: "float32", value: view.getFloat32(0, true) };
  });
  service("math", "modf", ["float64", "pointer"], "float64", (_context, args) => {
    const a = real(args, 0), whole = Math.trunc(a), bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, whole, true); host.memory.write(requiredPointer(args, 1), bytes);
    const fraction = Number.isFinite(a) ? a - whole : Number.isNaN(a) ? NaN : 0;
    return { kind: "float64", value: fraction === 0 && (a < 0 || Object.is(a, -0)) ? -0 : fraction };
  });
  for (const name of ["_dclass", "_fdclass", "_dsign"]) service("math", name, [name === "_fdclass" ? "float32" : "float64"], "int16", (_context, args) => {
    const a = real(args, 0); const value = name === "_dsign" ? a < 0 || Object.is(a, -0) ? 0x8000 : 0
      : Number.isNaN(a) ? 2 : !Number.isFinite(a) ? 1 : a === 0 ? 0 : Math.abs(a) < (name === "_fdclass" ? 2 ** -126 : 2 ** -1022) ? -2 : -1;
    return { kind: "int32", value: value === 0x8000 ? -32768 : value };
  });
}

function installConversions(host: WindowsServiceHost, service: (family: string, name: string, parameters: readonly GuestStorage[], result: GuestStorage | "void", invoke: Parameters<WindowsServiceHost["service"]>[4]) => void): void {
  const memory = host.memory;
  const errno = memory.allocate({ byteLength: 4, label: "CRT thread errno" });
  service("runtime", "_errno", [], "pointer", () => ({ kind: "pointer", value: errno }));
  installWindowsFormat(host, errno);
  service("convert", "strtoul", ["pointer", "pointer", "int32"], "uint32", (_context, args) => {
    const source = requiredPointer(args, 0), end = pointer(args, 1), text = readString(memory, source); let base = Number(integer(args, 2)), index = 0;
    const finish = (value: number, stop: number): GuestCallResult => { if (end !== null) writePointer(memory, end, memory.offset(source, BigInt(stop))); return { kind: "uint32", value }; };
    if (base !== 0 && (base < 2 || base > 36)) { writeUnsigned(memory, errno, 4, 22n); return finish(0, 0); }
    while (index < text.length && /[ \t\n\r\f\v]/.test(text[index] ?? "")) index++;
    const negative = text[index] === "-"; if (negative || text[index] === "+") index++;
    const digit = (at: number): number => { const code = text.charCodeAt(at); return code >= 48 && code <= 57 ? code - 48 : code >= 65 && code <= 90 ? code - 55 : code >= 97 && code <= 122 ? code - 87 : 99; };
    if ((base === 0 || base === 16) && text[index] === "0" && /[xX]/.test(text[index + 1] ?? "") && digit(index + 2) < 16) { base = 16; index += 2; }
    if (base === 0) base = text[index] === "0" ? 8 : 10;
    const first = index; let value = 0n, overflowed = false;
    while (index < text.length && digit(index) < base) { value = value * BigInt(base) + BigInt(digit(index)); if (value > 0xffffffffn) { overflowed = true; value = 0xffffffffn; } index++; }
    if (index === first) return finish(0, 0);
    if (overflowed) { writeUnsigned(memory, errno, 4, 34n); return finish(0xffffffff, index); }
    return finish(Number(BigInt.asUintN(32, negative ? -value : value)), index);
  });
  for (const name of ["atoi", "atoll", "atof"]) service("convert", name, ["pointer"], name === "atoi" ? "int32" : name === "atoll" ? "int64" : "float64", (_context, args) => {
    const text = readString(memory, requiredPointer(args, 0));
    if (name === "atof") { const value = Number.parseFloat(text); return { kind: "float64", value: Number.isNaN(value) ? 0 : value }; }
    const match = /^\s*([+-]?\d+)/.exec(text), number = BigInt(match?.[1] ?? "0"); return name === "atoi" ? { kind: "int32", value: Number(BigInt.asIntN(32, number)) } : { kind: "int64", value: BigInt.asIntN(64, number) };
  });
  const timeBuffer = memory.allocate({ byteLength: 36, label: "CRT thread local tm" });
  service("time", "_time64", ["pointer"], "int64", (_context, args) => { const time = BigInt(Math.floor((host.capabilities.nowMilliseconds?.() ?? Date.now()) / 1000)); const out = pointer(args, 0); if (out !== null) writeUnsigned(memory, out, 8, time); return { kind: "int64", value: time }; });
  service("time", "_localtime64", ["pointer"], "pointer", (_context, args) => {
    const value = BigInt.asIntN(64, readUnsigned(memory, requiredPointer(args, 0), 8)); if (value < 0n || value > 32535215999n) return { kind: "pointer", value: null };
    const date = new Date(Number(value) * 1000), year = date.getFullYear(); const yday = Math.floor((Date.UTC(year, date.getMonth(), date.getDate()) - Date.UTC(year, 0, 1)) / 86400000);
    [date.getSeconds(), date.getMinutes(), date.getHours(), date.getDate(), date.getMonth(), year - 1900, date.getDay(), yday, date.getTimezoneOffset() < Math.max(new Date(year, 0, 1).getTimezoneOffset(), new Date(year, 6, 1).getTimezoneOffset()) ? 1 : 0]
      .forEach((entry, index) => writeUnsigned(memory, memory.offset(timeBuffer, BigInt(index * 4)), 4, BigInt(entry)));
    return { kind: "pointer", value: timeBuffer };
  });
  const locale = memory.allocate({ byteLength: memory.pointerBytes * 10 + 16, label: "CRT C locale lconv" });
  const empty = memory.allocate({ byteLength: 1 }), decimal = memory.allocate({ byteLength: 2 }); memory.write(decimal, stringBytes("."));
  for (let i = 0; i < 10; i++) writePointer(memory, memory.offset(locale, BigInt(i * memory.pointerBytes)), i === 0 ? decimal : empty);
  memory.write(memory.offset(locale, BigInt(memory.pointerBytes * 10)), new Uint8Array(14).fill(127));
  service("locale", "localeconv", [], "pointer", () => ({ kind: "pointer", value: locale }));
}
