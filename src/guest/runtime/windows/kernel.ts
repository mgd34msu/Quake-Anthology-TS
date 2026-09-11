// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, GuestCallResult, GuestStorage } from "../../../contracts/execution.ts";
import { count, integer, pointer, readPointer, readString, readUnsigned, requiredPointer, stringBytes, writePointer, writeUnsigned } from "../common/memory.ts";
import { UnsupportedWindowsImport } from "./contracts.ts";
import type { WindowsFile, WindowsServiceHost } from "./contracts.ts";

export function installKernel(host: WindowsServiceHost): void {
  const memory = host.memory, width = memory.pointerBytes;
  const u32 = (value: number): GuestCallResult => ({ kind: "uint32", value: value >>> 0 });
  const bool = (value: boolean): GuestCallResult => ({ kind: "int32", value: value ? 1 : 0 });
  const ptr = (value: GuestAddress | null): GuestCallResult => ({ kind: "pointer", value });
  const done = (): GuestCallResult => ({ kind: "void" });
  const service = (name: string, parameters: readonly GuestStorage[], result: GuestStorage | "void", invoke: Parameters<WindowsServiceHost["service"]>[4]): void => host.service("kernel32.dll", name, parameters, result, invoke);
  const storedString = (value: string, wide = false): GuestAddress => {
    const bytes = stringBytes(value, wide); const address = memory.allocate({ byteLength: bytes.length }); memory.write(address, bytes); return address;
  };
  const commandLine = storedString(host.capabilities.commandLine ?? '"quake-typescript.exe"');
  const environment = [...(host.capabilities.environment ?? new Map<string, string>())].map(([key, value]) => `${key}=${value}`).join("\0") + "\0";
  const environmentA = storedString(environment), environmentW = storedString(environment, true);
  const invalid = memory.pointer((1n << BigInt(width * 8)) - 1n);
  const processHeap = memory.allocate({ byteLength: 16, label: "Windows process heap" });
  const heaps = new Set<bigint>([processHeap.byteOffset]);
  service("GetProcessHeap", [], "pointer", () => ptr(processHeap));
  service("GetLastError", [], "uint32", () => u32(host.lastError));
  service("SetLastError", ["uint32"], "void", (_context, args) => { host.lastError = Number(integer(args, 0)); return done(); });
  service("GetCurrentThreadId", [], "uint32", () => u32(host.threadId));
  service("GetCurrentProcessId", [], "uint32", () => u32(host.processId));
  service("GetCurrentProcess", [], "pointer", () => ptr(invalid));
  service("GetVersion", [], "uint32", () => u32(0x05650004));
  service("GetCommandLineA", [], "pointer", () => ptr(commandLine));
  service("GetACP", [], "uint32", () => u32(1252));
  service("GetOEMCP", [], "uint32", () => u32(437));
  service("GetCPInfo", ["uint32", "pointer"], "int32", (_context, args) => {
    const codepage = Number(integer(args, 0)); if (![0, 1, 1252, 437, 65001].includes(codepage)) { host.lastError = 87; return bool(false); }
    const address = requiredPointer(args, 1); memory.write(address, new Uint8Array(20)); writeUnsigned(memory, address, 4, codepage === 65001 ? 4n : 1n);
    writeUnsigned(memory, memory.offset(address, 4n), 2, 63n); return bool(true);
  });
  for (const [name, value] of [["GetEnvironmentStrings", environmentA], ["GetEnvironmentStringsA", environmentA], ["GetEnvironmentStringsW", environmentW]] satisfies readonly (readonly [string, GuestAddress])[]) service(name, [], "pointer", () => ptr(value));
  for (const name of ["FreeEnvironmentStringsA", "FreeEnvironmentStringsW"]) service(name, ["pointer"], "int32", () => bool(true));
  service("GetModuleHandleA", ["pointer"], "pointer", (_context, args) => { const name = pointer(args, 0); return ptr(name === null ? host.images[0]?.base ?? null : host.libraryHandle(readString(memory, name))); });
  service("LoadLibraryA", ["pointer"], "pointer", (_context, args) => {
    const handle = host.libraryHandle(readString(memory, requiredPointer(args, 0))); if (handle === null) host.lastError = 126; return ptr(handle);
  });
  service("GetProcAddress", ["pointer", "pointer"], "pointer", (_context, args) => {
    const handle = pointer(args, 0), name = pointer(args, 1); if (handle === null || name === null) { host.lastError = 127; return ptr(null); }
    const library = host.libraryName(handle);
    const address = library === null ? null : host.resolveAddress(library, name.byteOffset <= 65535n ? `#${name.byteOffset}` : readString(memory, name));
    if (address === null) host.lastError = 127; return ptr(address);
  });
  service("DisableThreadLibraryCalls", ["pointer"], "int32", (_context, args) => { const base = pointer(args, 0); const image = host.images.find(image => image.base.byteOffset === base?.byteOffset);
    if (image === undefined || image.tls !== null) { host.lastError = 87; return bool(false); } return bool(true); });
  service("GetModuleFileNameA", ["pointer", "pointer", "uint32"], "uint32", (_context, args) => {
    const handle = pointer(args, 0); const name = handle === null ? "quake-typescript.exe" : host.images.find(image => image.base.byteOffset === handle.byteOffset)?.module.artifactPath;
    if (name === undefined) { host.lastError = 126; return u32(0); }
    const size = count(args, 2); if (size === 0) { host.lastError = 122; return u32(0); }
    const bytes = stringBytes(name); memory.write(requiredPointer(args, 1), bytes.subarray(0, size));
    if (bytes.length > size) { host.lastError = 122; return u32(size); } return u32(bytes.length - 1);
  });
  service("HeapCreate", ["uint32", host.pointerStorage, host.pointerStorage], "pointer", () => {
    const address = memory.allocate({ byteLength: 16, label: "Windows heap handle" }); heaps.add(address.byteOffset); return ptr(address);
  });
  service("HeapAlloc", ["pointer", "uint32", host.pointerStorage], "pointer", (_context, args) => {
    const heap = pointer(args, 0); if (heap === null || !heaps.has(heap.byteOffset)) { host.lastError = 6; return ptr(null); }
    return ptr(host.allocate(count(args, 2), heap.byteOffset));
  });
  service("HeapFree", ["pointer", "uint32", "pointer"], "int32", (_context, args) => bool(host.free(pointer(args, 2), pointer(args, 0)?.byteOffset)));
  service("HeapReAlloc", ["pointer", "uint32", "pointer", host.pointerStorage], "pointer", (_context, args) => {
    const heap = pointer(args, 0), old = pointer(args, 2), size = count(args, 3), flags = Number(integer(args, 1));
    if (heap === null || old === null) { host.lastError = 87; return ptr(null); }
    const previous = host.allocationSize(old, heap.byteOffset); if (previous === null) { host.lastError = 87; return ptr(null); }
    if (size <= previous) return ptr(old);
    if ((flags & 16) !== 0) return ptr(null);
    const address = host.allocate(size, heap.byteOffset);
    if (address !== null) { memory.write(address, memory.copy(old, previous)); host.free(old, heap.byteOffset); }
    return ptr(address);
  });
  service("HeapDestroy", ["pointer"], "int32", (_context, args) => { const heap = pointer(args, 0); if (heap === null || heap.byteOffset === processHeap.byteOffset || !heaps.delete(heap.byteOffset)) return bool(false); host.destroyHeap(heap.byteOffset); memory.unmap(heap, 16); return bool(true); });
  const reservations = new Map<bigint, { readonly address: GuestAddress; readonly size: number }>();
  service("VirtualAlloc", ["pointer", host.pointerStorage, "uint32", "uint32"], "pointer", (context, args) => {
    const requested = pointer(args, 0), size = count(args, 1), flags = Number(integer(args, 2)), protection = Number(integer(args, 3));
    if (size === 0 || (flags & ~(0x1000 | 0x2000 | 0x100000)) !== 0 || ![1, 2, 4, 0x10, 0x20, 0x40].includes(protection)) throw new UnsupportedWindowsImport("kernel32.dll", "VirtualAlloc", context, "unsupported allocation flags/protection");
    const permissions = protection === 1 ? "none" : protection === 2 ? "read" : protection === 4 ? "read-write" : protection === 0x10 ? "execute" : protection === 0x20 ? "read-execute" : "read-write-execute";
    let address = requested;
    let bytes = Math.ceil(size / 4096) * 4096;
    if ((flags & 0x2000) !== 0 || address === null) {
      if (address === null) address = memory.allocate({ byteLength: bytes, alignment: 65536n, permissions: "none", label: "Windows VirtualAlloc" });
      else { const base = address.byteOffset & ~65535n; bytes = Math.ceil((Number(address.byteOffset - base) + size) / 4096) * 4096;
        try { address = memory.map({ base, byteLength: bytes, permissions: "none", label: "Windows VirtualAlloc" }); } catch { host.lastError = 487; return ptr(null); } }
      reservations.set(address.byteOffset, { address, size: bytes });
    } else {
      const base = address.byteOffset & ~4095n; bytes = Math.ceil((Number(address.byteOffset - base) + size) / 4096) * 4096;
      address = memory.pointer(base);
      if (address === null || ![...reservations.values()].some(region => base >= region.address.byteOffset && base + BigInt(bytes) <= region.address.byteOffset + BigInt(region.size))) { host.lastError = 487; return ptr(null); }
    }
    if ((flags & 0x1000) !== 0) memory.protect(address, bytes, permissions);
    return ptr(address);
  });
  service("VirtualFree", ["pointer", host.pointerStorage, "uint32"], "int32", (_context, args) => {
    const address = requiredPointer(args, 0), size = count(args, 1), flags = Number(integer(args, 2));
    if (flags === 0x8000 && size === 0) { const region = reservations.get(address.byteOffset); if (region === undefined) return bool(false);
      memory.unmap(address, region.size); reservations.delete(address.byteOffset); return bool(true); }
    if (flags === 0x4000 && size > 0) {
      const region = [...reservations.values()].find(region => address.byteOffset >= region.address.byteOffset && address.byteOffset + BigInt(size) <= region.address.byteOffset + BigInt(region.size));
      if (region === undefined) return bool(false);
      memory.protect(address, size, "read-write"); memory.write(address, new Uint8Array(size)); memory.protect(address, size, "none"); return bool(true);
    }
    host.lastError = 87; return bool(false);
  });
  const tls = new Set<number>();
  const dynamicTls = memory.allocate({ byteLength: 1024 * width, alignment: 16n, label: "Windows expansion TLS slots" });
  writePointer(memory, memory.offset(host.teb, width === 4 ? 0xf94n : 0x1780n), dynamicTls);
  const tlsSlot = (index: number): GuestAddress => index < 64 ? memory.offset(host.teb, (width === 4 ? 0xe10n : 0x1480n) + BigInt(index * width)) : memory.offset(dynamicTls, BigInt((index - 64) * width));
  service("TlsAlloc", [], "uint32", () => { for (let index = 0; index < 1088; index++) if (!tls.has(index)) { tls.add(index); writeUnsigned(memory, tlsSlot(index), width, 0n); return u32(index); } return u32(0xffffffff); });
  service("TlsFree", ["uint32"], "int32", (_context, args) => { const index = Number(integer(args, 0)); if (!tls.delete(index)) { host.lastError = 87; return bool(false); } return bool(true); });
  service("TlsGetValue", ["uint32"], "pointer", (_context, args) => { const index = Number(integer(args, 0)); if (!tls.has(index)) { host.lastError = 87; return ptr(null); }
    host.lastError = 0; return ptr(readPointer(memory, tlsSlot(index))); });
  service("TlsSetValue", ["uint32", "pointer"], "int32", (_context, args) => { const index = Number(integer(args, 0)); if (!tls.has(index)) { host.lastError = 87; return bool(false); }
    writePointer(memory, tlsSlot(index), pointer(args, 1)); return bool(true); });
  const locks = new Set<bigint>();
  service("InitializeCriticalSection", ["pointer"], "void", (_context, args) => { const address = requiredPointer(args, 0); memory.write(address, new Uint8Array(width === 4 ? 24 : 40)); writeUnsigned(memory, memory.offset(address, BigInt(width)), 4, 0xffffffffn); locks.add(address.byteOffset); return done(); });
  service("DeleteCriticalSection", ["pointer"], "void", (_context, args) => { locks.delete(requiredPointer(args, 0).byteOffset); return done(); });
  service("EnterCriticalSection", ["pointer"], "void", (context, args) => { const address = requiredPointer(args, 0); if (!locks.has(address.byteOffset)) throw new Error("Uninitialized guest critical section");
    const depth = readUnsigned(memory, memory.offset(address, BigInt(width + 4)), 4), owner = readUnsigned(memory, memory.offset(address, BigInt(width + 8)), width);
    if (depth !== 0n && owner !== BigInt(host.threadId)) throw new UnsupportedWindowsImport("kernel32.dll", "EnterCriticalSection", context, "contended lock requires a guest thread scheduler");
    writeUnsigned(memory, memory.offset(address, BigInt(width)), 4, depth); writeUnsigned(memory, memory.offset(address, BigInt(width + 4)), 4, depth + 1n);
    writeUnsigned(memory, memory.offset(address, BigInt(width + 8)), width, BigInt(host.threadId)); return done(); });
  service("LeaveCriticalSection", ["pointer"], "void", (_context, args) => { const address = requiredPointer(args, 0); const depth = readUnsigned(memory, memory.offset(address, BigInt(width + 4)), 4);
    if (!locks.has(address.byteOffset) || depth === 0n || readUnsigned(memory, memory.offset(address, BigInt(width + 8)), width) !== BigInt(host.threadId)) throw new Error("Unowned guest critical section");
    writeUnsigned(memory, memory.offset(address, BigInt(width)), 4, depth - 2n); writeUnsigned(memory, memory.offset(address, BigInt(width + 4)), 4, depth - 1n);
    if (depth === 1n) writeUnsigned(memory, memory.offset(address, BigInt(width + 8)), width, 0n); return done(); });
  for (const [name, change] of [["InterlockedIncrement", 1n], ["InterlockedDecrement", -1n]] satisfies readonly (readonly [string, bigint])[]) service(name, ["pointer"], "int32", (_context, args) => {
    const address = requiredPointer(args, 0); const value = BigInt.asIntN(32, readUnsigned(memory, address, 4) + change); writeUnsigned(memory, address, 4, value); return { kind: "int32", value: Number(value) }; });
  service("AcquireSRWLockExclusive", ["pointer"], "void", (context, args) => { const address = requiredPointer(args, 0); if (readUnsigned(memory, address, width) !== 0n) throw new UnsupportedWindowsImport("kernel32.dll", "AcquireSRWLockExclusive", context, "contended lock requires a guest thread scheduler"); writeUnsigned(memory, address, width, 1n); return done(); });
  service("ReleaseSRWLockExclusive", ["pointer"], "void", (_context, args) => { const address = requiredPointer(args, 0); if (readUnsigned(memory, address, width) === 0n) throw new Error("Unowned guest SRW lock"); writeUnsigned(memory, address, width, 0n); return done(); });
  service("InitializeSListHead", ["pointer"], "void", (_context, args) => { memory.write(requiredPointer(args, 0), new Uint8Array(width === 4 ? 8 : 16)); return done(); });
  service("WakeAllConditionVariable", ["pointer"], "void", () => done());
  service("IsDebuggerPresent", [], "int32", () => bool(false));
  service("IsProcessorFeaturePresent", ["uint32"], "int32", (_context, args) => bool([6, 10].includes(Number(integer(args, 0)))));
  const now = (): number => host.capabilities.nowMilliseconds?.() ?? Date.now();
  service("GetSystemTimeAsFileTime", ["pointer"], "void", (_context, args) => { writeUnsigned(memory, requiredPointer(args, 0), 8, BigInt(Math.trunc(now())) * 10000n + 116444736000000000n); return done(); });
  service("QueryPerformanceCounter", ["pointer"], "int32", (_context, args) => { writeUnsigned(memory, requiredPointer(args, 0), 8, host.capabilities.performanceCounter?.() ?? BigInt(Math.trunc(performance.now() * 1000))); return bool(true); });
  service("QueryPerformanceFrequency", ["pointer"], "int32", (_context, args) => { writeUnsigned(memory, requiredPointer(args, 0), 8, host.capabilities.performanceFrequency ?? 1000000n); return bool(true); });
  for (const name of ["GetSystemTime", "GetLocalTime"]) service(name, ["pointer"], "void", (_context, args) => {
    const date = new Date(now()), address = requiredPointer(args, 0); const local = name === "GetLocalTime";
    const fields = local ? [date.getFullYear(), date.getMonth() + 1, date.getDay(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()]
      : [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDay(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()];
    fields.forEach((value, index) => writeUnsigned(memory, memory.offset(address, BigInt(index * 2)), 2, BigInt(value))); return done();
  });
  service("GetTimeZoneInformation", ["pointer"], "uint32", (_context, args) => { const address = requiredPointer(args, 0); memory.write(address, new Uint8Array(172)); writeUnsigned(memory, address, 4, BigInt(new Date(now()).getTimezoneOffset())); return u32(0); });
  let exceptionFilter: GuestAddress | null = null;
  service("SetUnhandledExceptionFilter", ["pointer"], "pointer", (_context, args) => { const previous = exceptionFilter; exceptionFilter = pointer(args, 0); return ptr(previous); });
  service("RtlLookupFunctionEntry", ["uint64", "pointer", "pointer"], "pointer", (_context, args) => {
    const pc = integer(args, 0); const image = host.images.find(image => pc >= image.base.byteOffset && pc < image.base.byteOffset + image.byteLength);
    if (image === undefined) return ptr(null);
    const index = image.unwindRecords.findIndex(entry => pc >= image.base.byteOffset + BigInt(entry.beginRva) && pc < image.base.byteOffset + BigInt(entry.endRva));
    if (index < 0) return ptr(null); const table = image.pe.directories[3]; if (table === undefined) throw new Error("Missing PE exception directory");
    writeUnsigned(memory, requiredPointer(args, 1), 8, image.base.byteOffset); return ptr(memory.offset(image.base, BigInt(table.rva + index * 12)));
  });
  installFiles(host, service, storedString, invalid);
  installLocale(host, service);
}

function installFiles(host: WindowsServiceHost, service: (name: string, parameters: readonly GuestStorage[], result: GuestStorage | "void", invoke: Parameters<WindowsServiceHost["service"]>[4]) => void,
  storedString: (value: string, wide?: boolean) => GuestAddress, invalid: GuestAddress | null): void {
  const memory = host.memory, width = memory.pointerBytes;
  const handles = new Map<bigint, { readonly file: WindowsFile | "stdin" | "stdout" | "stderr"; offset: number }>();
  const standards = new Map<number, GuestAddress>();
  for (const [id, stream] of [[-10, "stdin"], [-11, "stdout"], [-12, "stderr"]] satisfies readonly (readonly [number, "stdin" | "stdout" | "stderr"])[]) {
    const address = storedString(stream); standards.set(id, address); handles.set(address.byteOffset, { file: stream, offset: 0 });
  }
  const ok = (value: boolean): GuestCallResult => ({ kind: "int32", value: value ? 1 : 0 });
  const handleAt = (address: GuestAddress | null) => address === null ? undefined : handles.get(address.byteOffset);
  service("GetStdHandle", ["int32"], "pointer", (_context, args) => ({ kind: "pointer", value: standards.get(Number(integer(args, 0))) ?? invalid }));
  service("SetStdHandle", ["int32", "pointer"], "int32", (_context, args) => { const address = pointer(args, 1); if (address === null) return ok(false); standards.set(Number(integer(args, 0)), address); return ok(true); });
  service("SetHandleCount", ["uint32"], "uint32", (_context, args) => ({ kind: "uint32", value: Number(integer(args, 0)) }));
  service("GetFileType", ["pointer"], "uint32", (_context, args) => { const entry = handleAt(pointer(args, 0)); return { kind: "uint32", value: entry === undefined ? 0 : typeof entry.file === "string" ? 2 : 1 }; });
  service("GetStartupInfoA", ["pointer"], "void", (_context, args) => {
    const address = requiredPointer(args, 0), size = width === 4 ? 68 : 104; memory.write(address, new Uint8Array(size)); writeUnsigned(memory, address, 4, BigInt(size));
    for (const [index, id] of [-10, -11, -12].entries()) writePointer(memory, memory.offset(address, BigInt((width === 4 ? 56 : 80) + index * width)), standards.get(id) ?? null);
    return { kind: "void" };
  });
  service("CreateFileA", ["pointer", "uint32", "uint32", "pointer", "uint32", "uint32", "pointer"], "pointer", (_context, args) => {
    const access = Number(integer(args, 1)), creation = Number(integer(args, 4));
    const file = host.capabilities.openFile?.(readString(memory, requiredPointer(args, 0)), { read: (access & 0x80000000) !== 0, write: (access & 0x40000000) !== 0, creation }) ?? null;
    if (file === null) { host.lastError = 2; return { kind: "pointer", value: invalid }; }
    const address = memory.allocate({ byteLength: 16, label: "Windows file handle" }); handles.set(address.byteOffset, { file, offset: 0 }); return { kind: "pointer", value: address };
  });
  service("ReadFile", ["pointer", "pointer", "uint32", "pointer", "pointer"], "int32", (context, args) => {
    const entry = handleAt(pointer(args, 0)); if (entry === undefined) { host.lastError = 6; return ok(false); }
    if (pointer(args, 4) !== null) throw new UnsupportedWindowsImport("kernel32.dll", "ReadFile", context, "overlapped I/O is not implemented");
    const length = count(args, 2); const bytes = entry.file === "stdin" ? host.capabilities.standardInput?.(length) ?? new Uint8Array()
      : typeof entry.file === "string" ? null : entry.file.read(entry.offset, length);
    if (bytes === null) { host.lastError = 5; return ok(false); }
    if (bytes.length > length) throw new Error("File capability exceeded requested read length");
    memory.write(requiredPointer(args, 1), bytes); entry.offset += bytes.length;
    const read = pointer(args, 3); if (read !== null) writeUnsigned(memory, read, 4, BigInt(bytes.length)); return ok(true);
  });
  service("WriteFile", ["pointer", "pointer", "uint32", "pointer", "pointer"], "int32", (context, args) => {
    const entry = handleAt(pointer(args, 0)); if (entry === undefined) { host.lastError = 6; return ok(false); }
    if (pointer(args, 4) !== null) throw new UnsupportedWindowsImport("kernel32.dll", "WriteFile", context, "overlapped I/O is not implemented");
    const bytes = memory.copy(requiredPointer(args, 1), count(args, 2)); let written: number;
    if (entry.file === "stdout" || entry.file === "stderr") { if (host.capabilities.standardOutput === undefined) { host.lastError = 6; return ok(false); } host.capabilities.standardOutput(entry.file, bytes); written = bytes.length; }
    else if (entry.file === "stdin") { host.lastError = 5; return ok(false); }
    else written = entry.file.write(entry.offset, bytes);
    entry.offset += written; const out = pointer(args, 3); if (out !== null) writeUnsigned(memory, out, 4, BigInt(written)); return ok(true);
  });
  service("CloseHandle", ["pointer"], "int32", (_context, args) => { const address = pointer(args, 0), entry = handleAt(address); if (entry === undefined || address === null) { host.lastError = 6; return ok(false); }
    if (typeof entry.file !== "string") entry.file.close(); handles.delete(address.byteOffset); return ok(true); });
  service("FlushFileBuffers", ["pointer"], "int32", (_context, args) => { const entry = handleAt(pointer(args, 0)); if (entry === undefined) return ok(false); if (typeof entry.file !== "string") entry.file.flush(); return ok(true); });
  service("SetFilePointer", ["pointer", "int32", "pointer", "uint32"], "uint32", (_context, args) => {
    const entry = handleAt(pointer(args, 0)); if (entry === undefined || typeof entry.file === "string") { host.lastError = 6; return { kind: "uint32", value: 0xffffffff }; }
    const high = pointer(args, 2), low = integer(args, 1); const distance = high === null ? low : BigInt.asIntN(32, readUnsigned(memory, high, 4)) << 32n | BigInt.asUintN(32, low);
    const origin = Number(integer(args, 3)); const position = BigInt(origin === 0 ? 0 : origin === 1 ? entry.offset : entry.file.size()) + distance;
    if (origin > 2 || position < 0n || position > BigInt(Number.MAX_SAFE_INTEGER)) { host.lastError = 87; return { kind: "uint32", value: 0xffffffff }; }
    entry.offset = Number(position); if (high !== null) writeUnsigned(memory, high, 4, position >> 32n); return { kind: "uint32", value: Number(position & 0xffffffffn) };
  });
  service("SetEndOfFile", ["pointer"], "int32", (_context, args) => { const entry = handleAt(pointer(args, 0)); if (entry === undefined || typeof entry.file === "string") return ok(false); entry.file.truncate(entry.offset); return ok(true); });
}

function installLocale(host: WindowsServiceHost, service: (name: string, parameters: readonly GuestStorage[], result: GuestStorage | "void", invoke: Parameters<WindowsServiceHost["service"]>[4]) => void): void {
  const memory = host.memory;
  function input(address: GuestAddress, length: number, wide: boolean): string {
    if (length === -1) return readString(memory, address, wide) + "\0";
    if (length < 0 || length > 1048576) throw new RangeError("Invalid Windows string length");
    let result = ""; for (let i = 0; i < length; i++) result += String.fromCharCode(Number(readUnsigned(memory, memory.offset(address, BigInt(i * (wide ? 2 : 1))), wide ? 2 : 1))); return result;
  }
  service("MultiByteToWideChar", ["uint32", "uint32", "pointer", "int32", "pointer", "int32"], "int32", (context, args) => {
    const cp = Number(integer(args, 0)); if (![0, 1252, 65001].includes(cp)) throw new UnsupportedWindowsImport("kernel32.dll", "MultiByteToWideChar", context, `code page ${cp}`);
    const source = input(requiredPointer(args, 2), Number(integer(args, 3)), false);
    const bytes = Uint8Array.from(source, char => char.charCodeAt(0)); const text = new TextDecoder(cp === 65001 ? "utf-8" : "windows-1252").decode(bytes);
    const capacity = Number(integer(args, 5)), output = pointer(args, 4);
    if (capacity !== 0) { if (output === null || capacity < text.length) { host.lastError = 122; return { kind: "int32", value: 0 }; } memory.write(output, stringBytes(text, true).subarray(0, text.length * 2)); }
    return { kind: "int32", value: text.length };
  });
  const cp1252 = new Map<number, number>(); const decoder = new TextDecoder("windows-1252"); for (let byte = 0; byte < 256; byte++) cp1252.set(decoder.decode(new Uint8Array([byte])).charCodeAt(0), byte);
  service("WideCharToMultiByte", ["uint32", "uint32", "pointer", "int32", "pointer", "int32", "pointer", "pointer"], "int32", (context, args) => {
    const cp = Number(integer(args, 0)); if (![0, 1252, 65001].includes(cp)) throw new UnsupportedWindowsImport("kernel32.dll", "WideCharToMultiByte", context, `code page ${cp}`);
    const source = input(requiredPointer(args, 2), Number(integer(args, 3)), true); let usedDefault = false;
    const bytes = cp === 65001 ? new TextEncoder().encode(source) : Uint8Array.from(source, char => { const value = cp1252.get(char.charCodeAt(0)); if (value !== undefined) return value; usedDefault = true; return 63; });
    const capacity = Number(integer(args, 5)), output = pointer(args, 4), used = pointer(args, 7);
    if (used !== null) writeUnsigned(memory, used, 4, usedDefault ? 1n : 0n);
    if (capacity !== 0) { if (output === null || capacity < bytes.length) { host.lastError = 122; return { kind: "int32", value: 0 }; } memory.write(output, bytes); }
    return { kind: "int32", value: bytes.length };
  });
  for (const wide of [false, true]) service(wide ? "GetStringTypeW" : "GetStringTypeA", wide ? ["uint32", "pointer", "int32", "pointer"] : ["uint32", "uint32", "pointer", "int32", "pointer"], "int32", (context, args) => {
    const shift = wide ? 0 : 1; if (integer(args, shift) !== 1n) throw new UnsupportedWindowsImport("kernel32.dll", "GetStringType", context, "only CT_CTYPE1 is implemented");
    const source = input(requiredPointer(args, shift + 1), Number(integer(args, shift + 2)), wide), output = requiredPointer(args, shift + 3);
    for (let index = 0; index < source.length; index++) {
      const char = source[index] ?? "", code = char.charCodeAt(0);
      const flags = (/[A-Z]/.test(char) ? 1 : 0) | (/[a-z]/.test(char) ? 2 : 0) | (/[0-9]/.test(char) ? 4 : 0) | (/\s/.test(char) ? 8 : 0)
        | (/[!-/:-@[-`{-~]/.test(char) ? 16 : 0) | (code < 32 || code === 127 ? 32 : 0) | (char === " " || char === "\t" ? 64 : 0)
        | (/[0-9a-fA-F]/.test(char) ? 128 : 0) | (/[a-zA-Z]/.test(char) ? 256 : 0);
      writeUnsigned(memory, memory.offset(output, BigInt(index * 2)), 2, BigInt(flags));
    }
    return { kind: "int32", value: 1 };
  });
  for (const wide of [false, true]) service(wide ? "LCMapStringW" : "LCMapStringA", ["uint32", "uint32", "pointer", "int32", "pointer", "int32"], "int32", (context, args) => {
    const flags = Number(integer(args, 1)); if (flags !== 0x100 && flags !== 0x200) throw new UnsupportedWindowsImport("kernel32.dll", "LCMapString", context, `flags ${flags}`);
    const source = input(requiredPointer(args, 2), Number(integer(args, 3)), wide); const mapped = flags === 0x100 ? source.toLowerCase() : source.toUpperCase();
    const capacity = Number(integer(args, 5)), output = pointer(args, 4);
    if (capacity !== 0) { if (output === null || capacity < mapped.length) { host.lastError = 122; return { kind: "int32", value: 0 }; }
      memory.write(output, stringBytes(mapped, wide).subarray(0, mapped.length * (wide ? 2 : 1))); }
    return { kind: "int32", value: mapped.length };
  });
}
