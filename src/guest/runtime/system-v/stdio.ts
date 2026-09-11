// SPDX-License-Identifier: LGPL-2.1-or-later
// GLIBC _IO_FILE layouts and operations: glibc 2.17 libio/{libio.h,stdfiles.c,fileops.c}.
import type { GuestAddress, GuestCallContext, GuestCallResult } from "../../../contracts/execution.ts";
import { count, integer, pointer, requiredPointer } from "../common/memory.ts";
import { UnsupportedSystemVService } from "./contracts.ts";
import type { SystemVServiceHost } from "./contracts.ts";

export interface SystemVFileLayout {
  readonly size: number; readonly descriptor: number; readonly mode: number; readonly lock: number;
  readonly offset: number; readonly wideData: number; readonly oldOffset: number;
}
export function systemVFileLayout(width: 4 | 8): SystemVFileLayout {
  return width === 8 ? { size: 216, descriptor: 112, mode: 192, lock: 136, offset: 144, wideData: 160, oldOffset: 120 }
    : { size: 148, descriptor: 56, mode: 104, lock: 72, offset: 76, wideData: 88, oldOffset: 64 };
}

export class SystemVStdio {
  readonly stdin: GuestAddress;
  readonly stdout: GuestAddress;
  readonly stderr: GuestAddress;
  readonly layout: SystemVFileLayout;
  constructor(readonly host: SystemVServiceHost) {
    const m = host.memory;
    this.layout = systemVFileLayout(m.pointerBytes);
    this.stdin = this.create(0, null);
    this.stdout = this.create(1, this.stdin);
    this.stderr = this.create(2, this.stdout);
    const version = m.pointerBytes === 4 ? "GLIBC_2.0" : "GLIBC_2.2.5";
    for (const [name, value] of [["stdin", this.stdin], ["stdout", this.stdout], ["stderr", this.stderr]] satisfies readonly (readonly [string, GuestAddress])[]) {
      const slot = host.allocate(m.pointerBytes); m.writePointer(slot, value);
      host.data("libc.so.6", name, version, slot, m.pointerBytes);
      host.data("libc.so.6", `_IO_2_1_${name}_`, m.pointerBytes === 4 ? "GLIBC_2.1" : version, value, this.layout.size + m.pointerBytes);
    }
    host.service("libc.so.6", "fflush", [version, null], ["pointer"], "int32", (context, args) => {
      const file = pointer(args, 0);
      if (file !== null) return { kind: "int32", value: this.flush(file, context) };
      const first = this.flush(this.stdout, context), second = this.flush(this.stderr, context);
      return { kind: "int32", value: first === 0 && second === 0 ? 0 : -1 };
    });
    for (const name of ["fputc", "putc"]) host.service("libc.so.6", name, [version, null], ["int32", "pointer"], "int32", (context, args) => ({
      kind: "int32", value: this.put(requiredPointer(args, 1), Number(integer(args, 0) & 255n), false, context),
    }));
    for (const name of ["fgetc", "getc"]) host.service("libc.so.6", name, [version, null], ["pointer"], "int32", (context, args) => ({
      kind: "int32", value: this.get(requiredPointer(args, 0), false, context),
    }));
    host.service("libc.so.6", "ungetc", [version, null], ["int32", "pointer"], "int32", (_context, args) => ({
      kind: "int32", value: this.unget(requiredPointer(args, 1), Number(integer(args, 0)), false),
    }));
    host.service("libc.so.6", "fwrite", [version, null], ["pointer", host.pointerStorage, host.pointerStorage, "pointer"], host.pointerStorage, (context, args) => {
      const size = count(args, 1), total = size * count(args, 2);
      const written = total === 0 ? 0 : this.write(requiredPointer(args, 3), m.copy(requiredPointer(args, 0), total), context);
      return this.sizeResult(size === 0 ? 0 : Math.floor(written / size));
    });
    host.service("libc.so.6", "fread", [version, null], ["pointer", host.pointerStorage, host.pointerStorage, "pointer"], host.pointerStorage, (context, args) => {
      const size = count(args, 1), total = size * count(args, 2);
      if (total === 0) return this.sizeResult(0);
      const destination = requiredPointer(args, 0), file = requiredPointer(args, 3);
      let read = 0;
      for (; read < total; read++) { const value = this.get(file, false, context); if (value < 0) break; m.writeUint8(m.offset(destination, BigInt(read)), value); }
      return this.sizeResult(Math.floor(read / size));
    });
    host.service("libc.so.6", "fwide", [m.pointerBytes === 4 ? "GLIBC_2.1" : version, null], ["pointer", "int32"], "int32", (_context, args) => {
      const file = requiredPointer(args, 0), slot = m.offset(file, BigInt(this.layout.mode));
      if (m.readInt32(slot) === 0) m.writeInt32(slot, Math.sign(Number(integer(args, 1))));
      return { kind: "int32", value: m.readInt32(slot) };
    });
    const table = host.allocate(21 * m.pointerBytes);
    host.data("libc.so.6", "_IO_file_jumps", m.pointerBytes === 4 ? "GLIBC_2.1" : version, table, 21 * m.pointerBytes);
    const operations = ["finish", "overflow", "underflow", "uflow", "pbackfail", "xsputn", "xsgetn", "seekoff", "seekpos", "setbuf", "sync", "doallocate", "read", "write", "seek", "close", "stat", "showmanyc", "imbue"];
    operations.forEach((operation, index) => {
      const name = `__guest_IO_file_${operation}`;
      let address: GuestAddress;
      if (operation === "sync") {
        host.service("libc.so.6", name, [null], ["pointer"], "int32", (context, args) => ({ kind: "int32", value: this.flush(requiredPointer(args, 0), context) }));
        const bound = host.resolveAddress("libc.so.6", name, null); if (bound === null) throw new Error("Missing FILE sync"); address = bound;
      } else if (operation === "overflow") {
        host.service("libc.so.6", name, [null], ["pointer", "int32"], "int32", (context, args) => {
          const file = requiredPointer(args, 0), value = Number(integer(args, 1));
          return { kind: "int32", value: value === -1 ? this.flush(file, context) === 0 ? 0 : -1 : this.put(file, value & 255, false, context) };
        });
        const bound = host.resolveAddress("libc.so.6", name, null); if (bound === null) throw new Error("Missing FILE overflow"); address = bound;
      } else {
        address = host.unavailable("libc.so.6", name, ["pointer"], "void", "this FILE virtual operation is not implemented");
      }
      m.writePointer(m.offset(table, BigInt((index + 2) * m.pointerBytes)), address);
    });
    const wideTable = host.allocate(21 * m.pointerBytes);
    host.data("libc.so.6", "_IO_wfile_jumps", m.pointerBytes === 4 ? "GLIBC_2.1" : version, wideTable, 21 * m.pointerBytes);
    operations.forEach((operation, index) => {
      const address = operation === "sync" ? m.readPointer(m.offset(table, BigInt((index + 2) * m.pointerBytes)))
        : host.unavailable("libc.so.6", `__guest_IO_wfile_${operation}`, ["pointer"], "void", "this wide FILE virtual operation is not implemented");
      m.writePointer(m.offset(wideTable, BigInt((index + 2) * m.pointerBytes)), address);
    });
    for (const file of [this.stdin, this.stdout, this.stderr]) {
      m.writePointer(m.offset(file, BigInt(this.layout.size)), table);
      const wide = m.readPointer(m.offset(file, BigInt(this.layout.wideData)));
      if (wide === null) throw new Error("Missing wide FILE data");
      m.writePointer(m.offset(wide, m.pointerBytes === 4 ? 176n : 304n), wideTable);
    }
  }
  private sizeResult(value: number): GuestCallResult {
    return this.host.memory.pointerBytes === 4 ? { kind: "uint32", value } : { kind: "uint64", value: BigInt(value) };
  }
  private field(file: GuestAddress, pointerIndex: number): GuestAddress {
    return this.host.memory.offset(file, BigInt(pointerIndex * this.host.memory.pointerBytes));
  }
  private create(descriptor: number, chain: GuestAddress | null): GuestAddress {
    const { host } = this, m = host.memory, file = host.allocate(this.layout.size + m.pointerBytes);
    const flags = 0xfbad0000 | 0x2080 | (descriptor === 0 ? 8 : 4) | (descriptor === 2 ? 2 : 0);
    m.writeUint32(file, flags >>> 0);
    m.writePointer(this.field(file, 13), chain);
    m.writeInt32(m.offset(file, BigInt(this.layout.descriptor)), descriptor);
    m.writeInt64(m.offset(file, BigInt(this.layout.offset)), -1n);
    if (m.pointerBytes === 8) m.writeInt64(m.offset(file, BigInt(this.layout.oldOffset)), -1n);
    else m.writeInt32(m.offset(file, BigInt(this.layout.oldOffset)), -1);
    m.writePointer(m.offset(file, BigInt(this.layout.lock)), host.allocate(m.pointerBytes * 2 + 8));
    // _IO_wide_data starts with eleven wchar_t pointers and an mbstate_t.
    m.writePointer(m.offset(file, BigInt(this.layout.wideData)), host.allocate(m.pointerBytes === 8 ? 312 : 180));
    return file;
  }
  private descriptor(file: GuestAddress): number {
    const m = this.host.memory;
    if ((m.readUint32(file) & 0xffff0000) >>> 0 !== 0xfbad0000) throw new TypeError("Invalid guest FILE magic");
    return m.readInt32(m.offset(file, BigInt(this.layout.descriptor)));
  }
  private orient(file: GuestAddress, wide: boolean): boolean {
    const m = this.host.memory, mode = m.offset(file, BigInt(this.layout.mode)), desired = wide ? 1 : -1;
    const current = m.readInt32(mode);
    if (current === 0) m.writeInt32(mode, desired);
    return current === 0 || current === desired;
  }
  private error(file: GuestAddress, errno: number): number {
    this.host.errno = errno;
    this.host.memory.writeUint32(file, this.host.memory.readUint32(file) | 0x20);
    return -1;
  }
  private outputBuffer(file: GuestAddress): GuestAddress {
    const m = this.host.memory;
    const existing = m.readPointer(this.field(file, 7));
    if (existing !== null) return existing;
    const start = this.host.allocate(8192), end = m.offset(start, 8192n);
    for (const index of [4, 5, 7]) m.writePointer(this.field(file, index), start);
    for (const index of [6, 8]) m.writePointer(this.field(file, index), end);
    if (this.descriptor(file) === 1 && this.host.capabilities.outputIsTerminal === true) m.writeUint32(file, m.readUint32(file) | 0x200);
    return start;
  }
  flush(file: GuestAddress, context: GuestCallContext): number {
    const m = this.host.memory, descriptor = this.descriptor(file);
    const base = m.readPointer(this.field(file, 4)), next = m.readPointer(this.field(file, 5));
    if (descriptor === 0) return 0;
    if (descriptor !== 1 && descriptor !== 2) return this.error(file, 9);
    if (base !== null && next !== null && next.byteOffset > base.byteOffset) {
      const output = this.host.capabilities.standardOutput;
      if (output === undefined) throw new UnsupportedSystemVService("libc.so.6", "fflush", null, context, "no standard output capability supplied");
      const length = Number(next.byteOffset - base.byteOffset), bytes = m.copy(base, length);
      let written = 0;
      while (written < length) {
        const count = output(descriptor === 1 ? "stdout" : "stderr", bytes.subarray(written));
        if (!Number.isSafeInteger(count) || count <= 0 || count > length - written) {
          m.write(base, bytes.subarray(written)); m.writePointer(this.field(file, 5), m.offset(base, BigInt(length - written)));
          return this.error(file, 5);
        }
        written += count;
      }
      m.writePointer(this.field(file, 5), base);
    }
    const result = this.host.capabilities.standardFlush?.(descriptor === 1 ? "stdout" : "stderr") ?? 0;
    return result === 0 ? 0 : this.error(file, 5);
  }
  private putByte(file: GuestAddress, value: number, context: GuestCallContext): number {
    const m = this.host.memory;
    if ((m.readUint32(file) & 8) !== 0) return this.error(file, 9);
    this.outputBuffer(file);
    let next = m.readPointer(this.field(file, 5));
    const end = m.readPointer(this.field(file, 6));
    if (next === null || end === null) throw new Error("Missing FILE output buffer");
    if (next.byteOffset >= end.byteOffset) {
      if (this.flush(file, context) !== 0) return -1;
      next = m.readPointer(this.field(file, 5));
      if (next === null) throw new Error("Missing FILE write pointer");
    }
    m.writeUint8(next, value); m.writePointer(this.field(file, 5), m.offset(next, 1n));
    const flags = m.readUint32(file);
    if ((flags & 2) !== 0 || (flags & 0x200) !== 0 && value === 10) {
      if (this.flush(file, context) !== 0) return -1;
    }
    return value;
  }
  put(file: GuestAddress, value: number, wide: boolean, context: GuestCallContext): number {
    this.descriptor(file);
    if (!this.orient(file, wide)) return -1;
    if (wide && (value < 0 || value > 127)) return this.error(file, 84);
    return this.putByte(file, value & 255, context) < 0 ? -1 : value;
  }
  write(file: GuestAddress, bytes: Uint8Array, context: GuestCallContext): number {
    this.descriptor(file);
    if (!this.orient(file, false)) return 0;
    let written = 0;
    for (const byte of bytes) { if (this.putByte(file, byte, context) < 0) break; written++; }
    return written;
  }
  get(file: GuestAddress, wide: boolean, context: GuestCallContext): number {
    const m = this.host.memory;
    if (this.descriptor(file) !== 0 || (m.readUint32(file) & 4) !== 0) return this.error(file, 9);
    if (!this.orient(file, wide)) return -1;
    let next = m.readPointer(this.field(file, 1)), end = m.readPointer(this.field(file, 2));
    if (next === null || end === null || next.byteOffset >= end.byteOffset) {
      const input = this.host.capabilities.standardInput;
      if (input === undefined) throw new UnsupportedSystemVService("libc.so.6", "fgetc", null, context, "no standard input capability supplied");
      const bytes = input(8192);
      if (bytes.length > 8192) throw new RangeError("Input capability exceeded requested count");
      if (bytes.length === 0) { m.writeUint32(file, m.readUint32(file) | 0x10); return -1; }
      const buffer = m.readPointer(this.field(file, 7)) ?? this.host.allocate(8192);
      m.write(buffer, bytes);
      m.writePointer(this.field(file, 7), buffer); m.writePointer(this.field(file, 8), m.offset(buffer, 8192n));
      next = buffer; end = m.offset(buffer, BigInt(bytes.length));
      m.writePointer(this.field(file, 3), buffer); m.writePointer(this.field(file, 2), end);
    }
    const byte = m.readUint8(next);
    m.writePointer(this.field(file, 1), m.offset(next, 1n));
    if (wide && byte > 127) return this.error(file, 84);
    return byte;
  }
  unget(file: GuestAddress, value: number, wide: boolean): number {
    if (value === -1 || value === 0xffffffff || !this.orient(file, wide)) return -1;
    const m = this.host.memory, next = m.readPointer(this.field(file, 1)), base = m.readPointer(this.field(file, 3));
    if (next === null || base === null || next.byteOffset <= base.byteOffset) return -1;
    const prior = m.offset(next, -1n); m.writeUint8(prior, value & 255); m.writePointer(this.field(file, 1), prior);
    m.writeUint32(file, m.readUint32(file) & ~0x10);
    return value;
  }
}
