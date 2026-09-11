// SPDX-License-Identifier: GPL-3.0-or-later WITH GCC-exception-3.1
// GNU libstdc++ 4.8 ios_init.cc, ios.cc, basic_ios.tcc, and stdio_sync_filebuf.h.
import type { GuestAddress, GuestCallContext, GuestCallResult } from "../../../contracts/execution.ts";
import { integer, requiredPointer, writeUnsigned } from "../common/memory.ts";
import { CxxAbiData } from "./cxx-data.ts";
import { SystemVClassicLocale } from "./locale.ts";
import { SystemVStdio } from "./stdio.ts";
import { UnsupportedSystemVService } from "./contracts.ts";
import type { SystemVServiceHost } from "./contracts.ts";

export interface SystemVIosLayout {
  readonly size: number; readonly precision: number; readonly width: number; readonly flags: number;
  readonly exceptions: number; readonly state: number; readonly callbacks: number; readonly localWords: number;
  readonly wordSize: number; readonly words: number; readonly locale: number; readonly tie: number;
  readonly fill: number; readonly fillInitialized: number; readonly buffer: number; readonly ctype: number;
  readonly numPut: number; readonly numGet: number;
}
export function systemVIosLayout(pointerBytes: 4 | 8, wide: boolean): SystemVIosLayout {
  if (pointerBytes === 8) return { size: 264, precision: 8, width: 16, flags: 24, exceptions: 28, state: 32,
    callbacks: 40, localWords: 64, wordSize: 192, words: 200, locale: 208, tie: 216, fill: 224,
    fillInitialized: wide ? 228 : 225, buffer: 232, ctype: 240, numPut: 248, numGet: 256 };
  return { size: wide ? 140 : 136, precision: 4, width: 8, flags: 12, exceptions: 16, state: 20,
    callbacks: 24, localWords: 36, wordSize: 100, words: 104, locale: 108, tie: 112, fill: 116,
    fillInitialized: wide ? 120 : 117, buffer: wide ? 124 : 120, ctype: wide ? 128 : 124,
    numPut: wide ? 132 : 128, numGet: wide ? 136 : 132 };
}
export interface SystemVStandardStream {
  readonly name: string; readonly address: GuestAddress; readonly ios: GuestAddress;
  readonly wide: boolean; readonly input: boolean;
}

export class SystemVIostreams {
  readonly stdio: SystemVStdio;
  readonly abi: CxxAbiData;
  readonly streams: readonly SystemVStandardStream[];
  readonly refcount: GuestAddress;
  readonly synchronized: GuestAddress;
  #locale: SystemVClassicLocale | null = null;
  constructor(readonly host: SystemVServiceHost) {
    const m = host.memory, p = m.pointerBytes;
    this.abi = new CxxAbiData(host); this.stdio = new SystemVStdio(host);
    this.#locale = new SystemVClassicLocale(this.abi);
    this.refcount = this.abi.data("_ZNSt8ios_base4Init11_S_refcountE", 4);
    this.synchronized = this.abi.data("_ZNSt8ios_base4Init20_S_synced_with_stdioE", 1); m.writeUint8(this.synchronized, 1);
    this.streams = ["cin", "cout", "cerr", "clog", "wcin", "wcout", "wcerr", "wclog"].map(name => {
      const wide = name.startsWith("w"), input = name.endsWith("cin"), prefix = (input ? 2 : 1) * p;
      const address = this.abi.data(`_ZSt${name.length}${name}`, prefix + systemVIosLayout(p, wide).size);
      return { name, wide, input, address, ios: this.abi.slot(address, prefix) };
    });
    for (const name of ["_ZNSt8ios_base4InitC1Ev", "_ZNSt8ios_base4InitC2Ev"]) this.abi.function(name, ["pointer"], "void", () => {
      this.initialize(); return { kind: "void" };
    });
    for (const name of ["_ZNSt8ios_base4InitD1Ev", "_ZNSt8ios_base4InitD2Ev"]) this.abi.function(name, ["pointer"], "void", context => {
      const previous = m.readInt32(this.refcount); m.writeInt32(this.refcount, previous - 1);
      if (previous === 2) for (const stream of this.streams.filter(stream => !stream.input)) this.flush(stream.address, stream.wide, context);
      return { kind: "void" };
    });
    for (const wide of [false, true]) {
      const c = wide ? "w" : "c";
      this.abi.function(`_ZNSt9basic_iosI${c}St11char_traitsI${c}EE5clearESt12_Ios_Iostate`, ["pointer", "int32"], "void", (context, args) => {
        this.clear(requiredPointer(args, 0), wide, Number(integer(args, 1)), context); return { kind: "void" };
      });
      this.abi.function(`_ZNS${wide ? "t13basic_ostreamIwSt11char_traitsIwEE" : "o"}5flushEv`, ["pointer"], "pointer", (context, args) => {
        const stream = requiredPointer(args, 0); this.flush(stream, wide, context); return { kind: "pointer", value: stream };
      });
    }
  }
  get locale(): SystemVClassicLocale | null { return this.#locale; }
  private initialize(): void {
    const m = this.host.memory, previous = m.readInt32(this.refcount);
    m.writeInt32(this.refcount, previous + 1);
    if (previous !== 0) return;
    m.writeUint8(this.synchronized, 1);
    const locale = this.#locale;
    if (locale === null) throw new Error("Classic locale was not constructed");
    for (const wide of [false, true]) {
      const buffers = { input: this.buffer(this.stdio.stdin, wide, locale), output: this.buffer(this.stdio.stdout, wide, locale), error: this.buffer(this.stdio.stderr, wide, locale) };
      for (const stream of this.streams.filter(stream => stream.wide === wide)) this.construct(stream,
        stream.input ? buffers.input : stream.name.endsWith("cout") ? buffers.output : buffers.error, locale);
      const output = this.streams.find(stream => stream.wide === wide && stream.name.endsWith("cout"));
      if (output === undefined) throw new Error("Missing standard output stream");
      for (const stream of this.streams.filter(stream => stream.wide === wide && (stream.input || stream.name.endsWith("cerr")))) {
        const layout = systemVIosLayout(m.pointerBytes, wide);
        m.writePointer(this.abi.slot(stream.ios, layout.tie), output.address);
        if (!stream.input) m.writeUint32(this.abi.slot(stream.ios, layout.flags), 0x3002);
      }
    }
    m.writeInt32(this.refcount, m.readInt32(this.refcount) + 1);
  }
  private construct(stream: SystemVStandardStream, buffer: GuestAddress, locale: SystemVClassicLocale): void {
    const { abi } = this, m = this.host.memory, p = m.pointerBytes, layout = systemVIosLayout(p, stream.wide), ios = stream.ios;
    const char = stream.wide ? "w" : "c";
    const iosBase = abi.type("St8ios_base"), basicIos = abi.type(`St9basic_iosI${char}St11char_traitsI${char}EE`, [{ type: iosBase, offset: 0, flags: 2 }]);
    const name = stream.wide ? `St13basic_${stream.input ? "istream" : "ostream"}IwSt11char_traitsIwEE` : stream.input ? "Si" : "So";
    const type = abi.type(name, [{ type: basicIos, offset: -3 * p, flags: 3 }]);
    const prefix = (stream.input ? 2 : 1) * p;
    // Primary address point: virtual-base offset, offset-to-top, RTTI, then two destructors.
    let table = this.host.resolveAddress("libstdc++.so.6", `_ZTV${name}`, "GLIBCXX_3.4");
    if (table === null) {
      table = abi.data(`_ZTV${name}`, 10 * p);
      writeUnsigned(m, table, p, BigInt(prefix)); m.writePointer(abi.slot(table, 2 * p), type);
      m.writePointer(abi.slot(table, 3 * p), abi.unsupported(`__guest_${name}_destructor`));
      m.writePointer(abi.slot(table, 4 * p), abi.unsupported(`__guest_${name}_deleting_destructor`));
      writeUnsigned(m, abi.slot(table, 5 * p), p, -BigInt(prefix)); writeUnsigned(m, abi.slot(table, 6 * p), p, -BigInt(prefix));
      m.writePointer(abi.slot(table, 7 * p), type);
      m.writePointer(abi.slot(table, 8 * p), abi.unsupported(`__guest_${name}_virtual_destructor`));
      m.writePointer(abi.slot(table, 9 * p), abi.unsupported(`__guest_${name}_virtual_deleting_destructor`));
    }
    m.writePointer(stream.address, abi.slot(table, 3 * p)); m.writePointer(ios, abi.slot(table, 8 * p));
    writeUnsigned(m, abi.slot(ios, layout.precision), p, 6n);
    m.writeUint32(abi.slot(ios, layout.flags), 0x1002); m.writeInt32(abi.slot(ios, layout.wordSize), 8);
    m.writePointer(abi.slot(ios, layout.words), abi.slot(ios, layout.localWords));
    m.writePointer(abi.slot(ios, layout.locale), locale.retain()); m.writePointer(abi.slot(ios, layout.buffer), buffer);
    const index = stream.wide ? 1 : 0;
    m.writePointer(abi.slot(ios, layout.ctype), locale.ctype[index]); m.writePointer(abi.slot(ios, layout.numPut), locale.numPut[index]);
    m.writePointer(abi.slot(ios, layout.numGet), locale.numGet[index]);
  }
  private buffer(file: GuestAddress, wide: boolean, locale: SystemVClassicLocale): GuestAddress {
    const { abi } = this, m = this.host.memory, p = m.pointerBytes, char = wide ? "w" : "c";
    const name = `N9__gnu_cxx18stdio_sync_filebufI${char}St11char_traitsI${char}EEE`;
    const address = this.host.allocate(10 * p), baseType = abi.type(`St15basic_streambufI${char}St11char_traitsI${char}EE`);
    const type = abi.type(name, [{ type: baseType, offset: 0, flags: 2 }]);
    let table = this.host.resolveAddress("libstdc++.so.6", `_ZTV${name}`, "GLIBCXX_3.4");
    if (table === null) {
      const signed = this.host.signedPointerStorage, character = wide ? "uint32" : "int32";
      const result = (value: number): GuestCallResult => wide ? { kind: "uint32", value: value >>> 0 } : { kind: "int32", value };
      const streamFile = (buffer: GuestAddress): GuestAddress => {
        const file = m.readPointer(abi.slot(buffer, 8 * p)); if (file === null) throw new Error("Missing synchronized FILE"); return file;
      };
      const fn = (suffix: string): string => `__guest_${name}_${suffix}`;
      const entries = [abi.unsupported(fn("destructor")), abi.unsupported(fn("deleting_destructor")),
        // These two inherited basic_streambuf virtual methods intentionally leave its state unchanged.
        abi.function(fn("imbue"), ["pointer", "pointer"], "void", () => ({ kind: "void" })),
        abi.function(fn("setbuf"), ["pointer", "pointer", signed], "pointer", (_context, args) => ({ kind: "pointer", value: requiredPointer(args, 0) })),
        abi.unsupported(fn("seekoff")), abi.unsupported(fn("seekpos")),
        abi.function(fn("sync"), ["pointer"], "int32", (context, args) => ({ kind: "int32", value: this.stdio.flush(streamFile(requiredPointer(args, 0)), context) })),
        abi.function(fn("showmanyc"), ["pointer"], signed, () => p === 4 ? { kind: "int32", value: 0 } : { kind: "int64", value: 0n }),
        abi.function(fn("xsgetn"), ["pointer", "pointer", signed], signed, (context, args) => {
          const buffer = requiredPointer(args, 0), destination = requiredPointer(args, 1), count = Number(integer(args, 2));
          let read = 0, last = -1;
          while (read < count) { last = this.stdio.get(streamFile(buffer), wide, context); if (last < 0) break;
            writeUnsigned(m, abi.slot(destination, read * (wide ? 4 : 1)), wide ? 4 : 1, BigInt(last)); read++; }
          m.writeUint32(abi.slot(buffer, 9 * p), (read > 0 ? Number(wide ? m.readUint32(abi.slot(destination, (read - 1) * 4)) : m.readUint8(abi.slot(destination, read - 1))) : -1) >>> 0);
          return p === 4 ? { kind: "int32", value: read } : { kind: "int64", value: BigInt(read) };
        }),
        abi.function(fn("underflow"), ["pointer"], character, (context, args) => {
          const file = streamFile(requiredPointer(args, 0)), value = this.stdio.get(file, wide, context); return result(this.stdio.unget(file, value, wide));
        }),
        abi.function(fn("uflow"), ["pointer"], character, (context, args) => {
          const buffer = requiredPointer(args, 0), value = this.stdio.get(streamFile(buffer), wide, context);
          m.writeUint32(abi.slot(buffer, 9 * p), value >>> 0); return result(value);
        }),
        abi.function(fn("pbackfail"), ["pointer", character], character, (_context, args) => {
          const buffer = requiredPointer(args, 0), supplied = Number(integer(args, 1));
          const value = supplied === -1 || supplied === 0xffffffff ? m.readInt32(abi.slot(buffer, 9 * p)) : supplied;
          const returned = this.stdio.unget(streamFile(buffer), value, wide); m.writeInt32(abi.slot(buffer, 9 * p), -1); return result(returned);
        }),
        abi.function(fn("xsputn"), ["pointer", "pointer", signed], signed, (context, args) => {
          const file = streamFile(requiredPointer(args, 0)), source = requiredPointer(args, 1), count = Number(integer(args, 2));
          let written = 0;
          for (; written < count; written++) { const value = wide ? m.readUint32(abi.slot(source, written * 4)) : m.readUint8(abi.slot(source, written)); if (this.stdio.put(file, value, wide, context) < 0) break; }
          return p === 4 ? { kind: "int32", value: written } : { kind: "int64", value: BigInt(written) };
        }),
        abi.function(fn("overflow"), ["pointer", character], character, (context, args) => {
          const file = streamFile(requiredPointer(args, 0)), value = Number(integer(args, 1));
          return result(value === -1 || value === 0xffffffff ? this.stdio.flush(file, context) === 0 ? 0 : -1 : this.stdio.put(file, value, wide, context));
        })];
      abi.vtable(name, type, entries);
      table = this.host.resolveAddress("libstdc++.so.6", `_ZTV${name}`, "GLIBCXX_3.4");
      if (table === null) throw new Error("Missing constructed streambuf vtable");
    }
    m.writePointer(address, abi.slot(table, 2 * p)); m.writePointer(abi.slot(address, 7 * p), locale.retain());
    m.writePointer(abi.slot(address, 8 * p), file); m.writeInt32(abi.slot(address, 9 * p), -1);
    return address;
  }
  private ios(stream: GuestAddress): GuestAddress {
    const m = this.host.memory, vptr = m.readPointer(stream);
    if (vptr === null) throw new TypeError("Unconstructed guest stream");
    const offset = m.pointerBytes === 4 ? BigInt(m.readInt32(this.abi.slot(vptr, -3 * m.pointerBytes))) : m.readInt64(this.abi.slot(vptr, -3 * m.pointerBytes));
    return m.offset(stream, offset);
  }
  clear(ios: GuestAddress, wide: boolean, state: number, context: GuestCallContext): void {
    const m = this.host.memory, layout = systemVIosLayout(m.pointerBytes, wide);
    if (m.readPointer(this.abi.slot(ios, layout.buffer)) === null) state |= 1;
    m.writeUint32(this.abi.slot(ios, layout.state), state);
    if ((state & m.readUint32(this.abi.slot(ios, layout.exceptions))) !== 0) throw new UnsupportedSystemVService("libstdc++.so.6", "__throw_ios_failure", "GLIBCXX_3.4", context, "guest iostream exception propagation is not implemented");
  }
  flush(stream: GuestAddress, wide: boolean, context: GuestCallContext): void {
    const m = this.host.memory, layout = systemVIosLayout(m.pointerBytes, wide), ios = this.ios(stream), p = m.pointerBytes;
    if (m.readUint32(this.abi.slot(ios, layout.state)) !== 0) return;
    const tied = m.readPointer(this.abi.slot(ios, layout.tie));
    if (tied !== null) this.flush(tied, wide, context);
    const buffer = m.readPointer(this.abi.slot(ios, layout.buffer));
    if (buffer === null) return;
    const vptr = m.readPointer(buffer); if (vptr === null) throw new Error("Stream buffer has no vtable");
    const sync = m.readPointer(this.abi.slot(vptr, 6 * p)); if (sync === null) throw new Error("Stream buffer has no sync method");
    const synchronize = (): void => {
      const result = this.host.invoke(context, sync, ["pointer"], "int32", [{ kind: "pointer", value: buffer }]);
      if (result.kind !== "int32") throw new TypeError("Stream buffer sync returned wrong type");
      if (result.value === -1) this.clear(ios, wide, m.readUint32(this.abi.slot(ios, layout.state)) | 1, context);
    };
    synchronize();
    if ((m.readUint32(this.abi.slot(ios, layout.flags)) & 0x2000) !== 0) synchronize();
  }
}
