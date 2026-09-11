// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, GuestCallContext, GuestCallResult, GuestCallValue, GuestStorage } from "../../../../contracts/execution.ts";
import { integer, pointer, requiredPointer } from "../../common/memory.ts";
import type { WindowsImportImplementation, WindowsServiceHost } from "../contracts.ts";
import { UnsupportedWindowsImport } from "../contracts.ts";
import { MsvcLocale } from "./locale.ts";

const library = "msvcp140.dll";
const streambuf = "?$basic_streambuf@DU?$char_traits@D@std@@@std@@";
const ios = "?$basic_ios@DU?$char_traits@D@std@@@std@@";
const ostream = "?$basic_ostream@DU?$char_traits@D@std@@@std@@";
const iostream = "?$basic_iostream@DU?$char_traits@D@std@@@std@@";
const p = (value: GuestAddress | null): GuestCallValue => ({ kind: "pointer", value });
const i = (value: number): GuestCallValue => ({ kind: "int32", value });
const n = (value: bigint): GuestCallValue => ({ kind: "int64", value });
const nothing = (): GuestCallResult => ({ kind: "void" });
function resultInteger(result: GuestCallResult): bigint { if (result.kind !== "int32" && result.kind !== "uint32" && result.kind !== "int64" && result.kind !== "uint64") throw new TypeError("MSVC integer result required"); return BigInt(result.value); }

/** Layout: Microsoft STL streambuf/xiosbase/ios, MS x64 ABI.
 * The retail DLL's stringstream ctor RVA 0x8b070 uses buffer +0x18,
 * basic_ios +0x98 and its own stringbuf vftable (RVA 0x142910).
 * Derived buffer allocation, high-water updates and seeks run in the guest CPU.
 */
export function installMsvcStreams(host: WindowsServiceHost): void {
  if (host.memory.pointerBytes !== 8) return;
  const memory = host.memory, locale = new MsvcLocale(host);
  const at = (address: GuestAddress, offset: number): GuestAddress => memory.offset(address, BigInt(offset));
  const ref = (address: GuestAddress): GuestAddress => { const value = memory.readPointer(address); if (value === null) throw new Error("Missing MSVC object pointer"); return value; };
  const bind = (name: string, parameters: readonly GuestStorage[], result: GuestStorage | "void", invoke: WindowsImportImplementation): void => host.service(library, name, parameters, result, invoke);
  const virtual = (context: GuestCallContext, object: GuestAddress, slot: number, parameters: readonly GuestStorage[], result: GuestStorage | "void", args: readonly GuestCallValue[]): GuestCallResult =>
    host.invoke(context, ref(at(ref(object), slot * 8)), ["pointer", ...parameters], result, [p(object), ...args]);
  const table = (names: readonly string[], label: string): GuestAddress => {
    const result = memory.allocate({ byteLength: names.length * 8, label });
    names.forEach((name, index) => { const target = host.resolveAddress(library, name); if (target === null) throw new Error(`Missing MSVC method ${name}`); memory.writePointer(at(result, index * 8), target); });
    memory.protect(result, names.length * 8, "read"); return result;
  };
  const virtualIos = (object: GuestAddress): GuestAddress => at(object, memory.readInt32(at(ref(object), 4)));
  const setstate = (context: GuestCallContext, object: GuestAddress, state: number): void => {
    const value = (memory.readInt32(at(object, 16)) | state | (memory.readPointer(at(object, 72)) === null ? 4 : 0)) & 0x17;
    memory.writeInt32(at(object, 16), value);
    if ((value & memory.readInt32(at(object, 20))) !== 0) throw new UnsupportedWindowsImport(library, "ios_base::failure", context, "stream exception requires guest C++ exception dispatch");
  };
  const basicDtor = (context: GuestCallContext, object: GuestAddress): void => {
    memory.writePointer(object, iosTable);
    if (memory.readUint64(at(object, 8)) !== 0n) throw new UnsupportedWindowsImport(library, "ios_base destructor", context, "standard stream ownership is not implemented");
    // _Callfns(erase_event), then destroy the sparse iword/pword and event lists.
    let call = memory.readPointer(at(object, 56));
    while (call !== null) { host.invoke(context, ref(at(call, 16)), ["int32", "pointer", "int32"], "void", [i(0), p(object), i(memory.readInt32(at(call, 8)))]); call = memory.readPointer(call); }
    for (const offset of [48, 56]) {
      let node = memory.readPointer(at(object, offset));
      while (node !== null) { const next = memory.readPointer(node); if (!host.free(node)) throw new Error("Invalid ios_base list allocation"); node = next; }
      memory.writePointer(at(object, offset), null);
    }
    locale.destroy(context, memory.readPointer(at(object, 64))); memory.writePointer(at(object, 64), null);
  };
  bind(`??1${ios}UEAA@XZ`, ["pointer"], "void", (context, args) => { basicDtor(context, requiredPointer(args, 0)); return nothing(); });
  bind("runtime:basic-ios-delete", ["pointer", "uint32"], "pointer", (context, args) => { const object = requiredPointer(args, 0); basicDtor(context, object); if ((integer(args, 1) & 1n) !== 0n && !host.free(object)) throw new Error("Invalid basic_ios allocation"); return p(object); });
  const iosTable = table(["runtime:basic-ios-delete"], "MSVC basic_ios vftable");
  const constructIos = (object: GuestAddress): void => { memory.write(object, new Uint8Array(96)); memory.writePointer(object, iosTable); };
  bind(`??0${ios}IEAA@XZ`, ["pointer"], "pointer", (_context, args) => { const object = requiredPointer(args, 0); constructIos(object); return p(object); });
  bind(`?rdbuf@${ios}QEBAPEAV?$basic_streambuf@DU?$char_traits@D@std@@@2@XZ`, ["pointer"], "pointer", (_context, args) => p(memory.readPointer(at(requiredPointer(args, 0), 72))));
  bind(`?setstate@${ios}QEAAXH_N@Z`, ["pointer", "int32", "uint32"], "void", (context, args) => { setstate(context, requiredPointer(args, 0), Number(integer(args, 1))); return nothing(); });
  bind("?good@ios_base@std@@QEBA_NXZ", ["pointer"], "uint32", (_context, args) => ({ kind: "uint32", value: Number(memory.readInt32(at(requiredPointer(args, 0), 16)) === 0) }));
  const initialize = (object: GuestAddress, buffer: GuestAddress | null): void => {
    memory.writeUint64(at(object, 8), 0n); memory.writeInt32(at(object, 16), buffer === null ? 4 : 0); memory.writeInt32(at(object, 20), 0);
    memory.writeInt32(at(object, 24), 0x201); memory.writeInt64(at(object, 32), 6n); memory.writeInt64(at(object, 40), 0n);
    memory.writePointer(at(object, 48), null); memory.writePointer(at(object, 56), null); memory.writePointer(at(object, 64), locale.create());
    memory.writePointer(at(object, 72), buffer); memory.writePointer(at(object, 80), null); memory.writeUint8(at(object, 88), 32);
  };
  const ostreamVb = memory.allocate({ byteLength: 8, label: "MSVC ostream vbtable" }); memory.writeInt32(at(ostreamVb, 4), 16); memory.protect(ostreamVb, 8, "read");
  const iostreamVb = memory.allocate({ byteLength: 16, label: "MSVC iostream vbtables" }); memory.writeInt32(at(iostreamVb, 4), 32); memory.writeInt32(at(iostreamVb, 12), 16); memory.protect(iostreamVb, 16, "read");
  bind(`??0${ostream}QEAA@PEAV?$basic_streambuf@DU?$char_traits@D@std@@@1@_N@Z`, ["pointer", "pointer", "uint32", "int32"], "pointer", (context, args) => {
    const object = requiredPointer(args, 0);
    if (integer(args, 2) !== 0n) throw new UnsupportedWindowsImport(library, "basic_ostream constructor", context, "standard stream registration is not implemented");
    if (integer(args, 3) !== 0n) { memory.writePointer(object, ostreamVb); constructIos(at(object, 16)); }
    const base = virtualIos(object); memory.writePointer(base, ostreamTable); memory.writeInt32(at(base, -4), Number(base.byteOffset - object.byteOffset) - 16); initialize(base, pointer(args, 1)); return p(object);
  });
  bind(`??0${iostream}QEAA@PEAV?$basic_streambuf@DU?$char_traits@D@std@@@1@@Z`, ["pointer", "pointer", "int32"], "pointer", (_context, args) => {
    const object = requiredPointer(args, 0);
    if (integer(args, 2) !== 0n) { memory.writePointer(object, iostreamVb); memory.writePointer(at(object, 16), at(iostreamVb, 8)); constructIos(at(object, 32)); }
    memory.writeInt64(at(object, 8), 0n);
    const base = virtualIos(object); memory.writePointer(base, iostreamTable); memory.writeInt32(at(base, -4), Number(base.byteOffset - object.byteOffset) - 32); initialize(base, pointer(args, 1)); return p(object);
  });
  // MSVC base destructors receive this adjusted to the vfptr's static offset,
  // without the dynamic virtual-base displacement (retail call RVA 0x80f9c).
  // basic_ios is destroyed separately by the most-derived destructor.
  bind(`??1${ostream}UEAA@XZ`, ["pointer"], "void", (_context, args) => { const object = at(requiredPointer(args, 0), -16), base = virtualIos(object); memory.writePointer(base, ostreamTable); memory.writeInt32(at(base, -4), Number(base.byteOffset - object.byteOffset) - 16); return nothing(); });
  bind(`??1${iostream}UEAA@XZ`, ["pointer"], "void", (_context, args) => { const object = at(requiredPointer(args, 0), -32), base = virtualIos(object); memory.writePointer(base, iostreamTable); memory.writeInt32(at(base, -4), Number(base.byteOffset - object.byteOffset) - 32); return nothing(); });
  bind("runtime:ostream-delete", ["pointer", "uint32"], "pointer", (context, args) => { throw new UnsupportedWindowsImport(library, "basic_ostream deleting destructor", context, `standalone deleting destructor at ${requiredPointer(args, 0).byteOffset.toString(16)} is not implemented`); });
  const ostreamTable = table(["runtime:ostream-delete"], "MSVC ostream vftable"), iostreamTable = table(["runtime:ostream-delete"], "MSVC iostream vftable");

  const bufferDtor = (context: GuestCallContext, object: GuestAddress): void => { memory.writePointer(object, bufferTable); locale.destroy(context, memory.readPointer(at(object, 96))); memory.writePointer(at(object, 96), null); };
  bind(`??1${streambuf}UEAA@XZ`, ["pointer"], "void", (context, args) => { bufferDtor(context, requiredPointer(args, 0)); return nothing(); });
  bind("runtime:streambuf-delete", ["pointer", "uint32"], "pointer", (context, args) => { const object = requiredPointer(args, 0); bufferDtor(context, object); if ((integer(args, 1) & 1n) !== 0n && !host.free(object)) throw new Error("Invalid streambuf allocation"); return p(object); });
  // Base streambuf has no external lock, device, seek operation or imbue action.
  for (const method of ["_Lock", "_Unlock"]) bind(`?${method}@${streambuf}UEAAXXZ`, ["pointer"], "void", () => nothing());
  for (const method of ["overflow", "pbackfail"]) bind(`runtime:streambuf-${method}`, ["pointer", "int32"], "int32", () => i(-1));
  bind("runtime:streambuf-underflow", ["pointer"], "int32", () => i(-1));
  bind(`?showmanyc@${streambuf}MEAA_JXZ`, ["pointer"], "int64", () => n(0n));
  bind(`?sync@${streambuf}MEAAHXZ`, ["pointer"], "int32", () => i(0));
  bind(`?setbuf@${streambuf}MEAAPEAV12@PEAD_J@Z`, ["pointer", "pointer", "int64"], "pointer", (_context, args) => p(requiredPointer(args, 0)));
  bind(`?imbue@${streambuf}MEAAXAEBVlocale@2@@Z`, ["pointer", "pointer"], "void", () => nothing());
  const field = (object: GuestAddress, offset: number): GuestAddress | null => memory.readPointer(ref(at(object, offset)));
  const available = (object: GuestAddress, input: boolean): number => field(object, input ? 56 : 64) === null ? 0 : memory.readInt32(ref(at(object, input ? 80 : 88)));
  const bump = (object: GuestAddress, amount: number, input: boolean): GuestAddress => {
    const nextSlot = ref(at(object, input ? 56 : 64)), next = ref(nextSlot), countSlot = ref(at(object, input ? 80 : 88));
    memory.writePointer(nextSlot, at(next, amount)); memory.writeInt32(countSlot, memory.readInt32(countSlot) - amount); return next;
  };
  const get = (context: GuestCallContext, object: GuestAddress, consume: boolean): number => {
    if (available(object, true) > 0) return memory.readUint8(consume ? bump(object, 1, true) : ref(ref(at(object, 56))));
    return Number(resultInteger(virtual(context, object, consume ? 7 : 6, [], "int32", [])));
  };
  const put = (context: GuestCallContext, object: GuestAddress, character: number): number => {
    if (available(object, false) > 0) { memory.writeUint8(bump(object, 1, false), character & 255); return character & 255; }
    return Number(resultInteger(virtual(context, object, 3, ["int32"], "int32", [i(character & 255)])));
  };
  for (const entry of [{ name: "eback", offset: 24 }, { name: "pbase", offset: 32 }, { name: "gptr", offset: 56 }, { name: "pptr", offset: 64 }])
    bind(`?${entry.name}@${streambuf}IEBAPEADXZ`, ["pointer"], "pointer", (_context, args) => p(field(requiredPointer(args, 0), entry.offset)));
  for (const input of [true, false]) bind(`?${input ? "egptr" : "epptr"}@${streambuf}IEBAPEADXZ`, ["pointer"], "pointer", (_context, args) => {
    const object = requiredPointer(args, 0), next = field(object, input ? 56 : 64); return p(next === null ? null : at(next, memory.readInt32(ref(at(object, input ? 80 : 88)))));
  });
  bind(`?uflow@${streambuf}MEAAHXZ`, ["pointer"], "int32", (context, args) => {
    const object = requiredPointer(args, 0); if (resultInteger(virtual(context, object, 6, [], "int32", [])) === -1n) return i(-1); return i(memory.readUint8(bump(object, 1, true)));
  });
  bind(`?sputc@${streambuf}QEAAHD@Z`, ["pointer", "int32"], "int32", (context, args) => i(put(context, requiredPointer(args, 0), Number(integer(args, 1)))));
  for (const input of [true, false]) bind(`?${input ? "xsgetn" : "xsputn"}@${streambuf}MEAA_J${input ? "PEAD" : "PEBD"}_J@Z`, ["pointer", "pointer", "int64"], "int64", (context, args) => {
    const object = requiredPointer(args, 0), data = requiredPointer(args, 1), requested = integer(args, 2); if (requested <= 0n) return n(0n); if (requested > 0x10000000n) throw new RangeError("MSVC stream transfer exceeds limit");
    const length = Number(requested); let copied = 0;
    while (copied < length) {
      const amount = Math.min(available(object, input), length - copied);
      if (amount > 0) { const buffer = bump(object, amount, input); if (input) memory.write(at(data, copied), memory.copy(buffer, amount)); else memory.write(buffer, memory.copy(at(data, copied), amount)); copied += amount; }
      else if (input) { const character = get(context, object, true); if (character === -1) break; memory.writeUint8(at(data, copied++), character); }
      else { if (put(context, object, memory.readUint8(at(data, copied))) === -1) break; copied++; }
    }
    return n(BigInt(copied));
  });
  bind(`?sputn@${streambuf}QEAA_JPEBD_J@Z`, ["pointer", "pointer", "int64"], "int64", (context, args) => virtual(context, requiredPointer(args, 0), 9, ["pointer", "int64"], "int64", [p(requiredPointer(args, 1)), n(integer(args, 2))]));
  for (const method of ["seekoff", "seekpos"]) bind(`runtime:streambuf-${method}`, method === "seekoff" ? ["pointer", "pointer", "int64", "int32", "int32"] : ["pointer", "pointer", "pointer", "int32"], "pointer", (_context, args) => {
    const result = requiredPointer(args, 1); memory.write(result, new Uint8Array(24)); memory.writeInt64(at(result, 8), -1n); return p(result);
  });
  const bufferTable = table(["runtime:streambuf-delete", `?_Lock@${streambuf}UEAAXXZ`, `?_Unlock@${streambuf}UEAAXXZ`, "runtime:streambuf-overflow", "runtime:streambuf-pbackfail", `?showmanyc@${streambuf}MEAA_JXZ`, "runtime:streambuf-underflow", `?uflow@${streambuf}MEAAHXZ`, `?xsgetn@${streambuf}MEAA_JPEAD_J@Z`, `?xsputn@${streambuf}MEAA_JPEBD_J@Z`, "runtime:streambuf-seekoff", "runtime:streambuf-seekpos", `?setbuf@${streambuf}MEAAPEAV12@PEAD_J@Z`, `?sync@${streambuf}MEAAHXZ`, `?imbue@${streambuf}MEAAXAEBVlocale@2@@Z`], "MSVC streambuf vftable");
  bind(`??0${streambuf}IEAA@XZ`, ["pointer"], "pointer", (_context, args) => {
    const object = requiredPointer(args, 0); memory.write(object, new Uint8Array(104)); memory.writePointer(object, bufferTable);
    for (const entry of [{ slot: 24, target: 8 }, { slot: 32, target: 16 }, { slot: 56, target: 40 }, { slot: 64, target: 48 }, { slot: 80, target: 72 }, { slot: 88, target: 76 }]) memory.writePointer(at(object, entry.slot), at(object, entry.target));
    memory.writePointer(at(object, 96), locale.create()); return p(object);
  });
  const flush = (context: GuestCallContext, object: GuestAddress): void => {
    const base = virtualIos(object), buffer = memory.readPointer(at(base, 72)); if (buffer === null) return;
    virtual(context, buffer, 1, [], "void", []);
    try {
      if (memory.readInt32(at(base, 16)) === 0) {
        const tied = memory.readPointer(at(base, 80)); if (tied !== null && tied.byteOffset !== object.byteOffset) flush(context, tied);
        if (memory.readInt32(at(base, 16)) === 0 && resultInteger(virtual(context, buffer, 13, [], "int32", [])) === -1n) setstate(context, base, 4);
      }
      suffix(context, object);
    }
    finally { virtual(context, buffer, 2, [], "void", []); }
  };
  const suffix = (context: GuestCallContext, object: GuestAddress): void => {
    const base = virtualIos(object); if (memory.readInt32(at(base, 16)) !== 0 || (memory.readInt32(at(base, 24)) & 2) === 0) return;
    const buffer = memory.readPointer(at(base, 72)); if (buffer !== null && resultInteger(virtual(context, buffer, 13, [], "int32", [])) === -1n) setstate(context, base, 4);
  };
  bind(`?flush@${ostream}QEAAAEAV12@XZ`, ["pointer"], "pointer", (context, args) => { const object = requiredPointer(args, 0); flush(context, object); return p(object); });
  bind(`?_Osfx@${ostream}QEAAXXZ`, ["pointer"], "void", (context, args) => { suffix(context, requiredPointer(args, 0)); return nothing(); });
  // C++ throw/unwind remains an explicit runtime stop; no exception can be active
  // while this runtime is executing normal guest instructions.
  bind("?uncaught_exception@std@@YA_NXZ", [], "uint32", () => ({ kind: "uint32", value: 0 }));
  bind(`?tellp@${ostream}QEAA?AV?$fpos@U_Mbstatet@@@2@XZ`, ["pointer", "pointer"], "pointer", (context, args) => {
    const base = virtualIos(requiredPointer(args, 0)), result = requiredPointer(args, 1);
    if ((memory.readInt32(at(base, 16)) & 6) !== 0) { memory.write(result, new Uint8Array(24)); memory.writeInt64(at(result, 8), -1n); return p(result); }
    return virtual(context, ref(at(base, 72)), 10, ["pointer", "int64", "int32", "int32"], "pointer", [p(result), n(0n), i(1), i(2)]);
  });
  for (const bits of [32, 64]) bind(`??6${ostream}QEAAAEAV01@${bits === 32 ? "H" : "_J"}@Z`, ["pointer", bits === 32 ? "int32" : "int64"], "pointer", (context, args) => {
    const object = requiredPointer(args, 0), base = virtualIos(object), buffer = memory.readPointer(at(base, 72));
    if (buffer !== null) virtual(context, buffer, 1, [], "void", []);
    try {
      if (memory.readInt32(at(base, 16)) === 0 && buffer !== null) {
        const tied = memory.readPointer(at(base, 80)); if (tied !== null && tied.byteOffset !== object.byteOffset) flush(context, tied);
        if (memory.readInt32(at(base, 16)) === 0) {
          const implementation = ref(ref(at(base, 64)));
          if (implementation.byteOffset !== locale.global.byteOffset || memory.readUint64(at(implementation, 24)) !== 0n) throw new UnsupportedWindowsImport(library, "ostream integer insertion", context, "custom num_put locale requires facet dispatch");
          const flags = memory.readInt32(at(base, 24)), basefield = flags & 0xe00, radix = basefield === 0x400 ? 8 : basefield === 0x800 ? 16 : 10;
          const value = radix === 10 ? BigInt.asIntN(bits, integer(args, 1)) : BigInt.asUintN(bits, integer(args, 1));
          let digits = (value < 0n ? -value : value).toString(radix), prefix = value < 0n ? "-" : radix === 10 && (flags & 0x20) !== 0 ? "+" : "";
          if (radix !== 10 && value !== 0n && (flags & 8) !== 0) prefix = radix === 16 ? "0x" : "0";
          if ((flags & 4) !== 0) { digits = digits.toUpperCase(); prefix = prefix.toUpperCase(); }
          const width = memory.readInt64(at(base, 40)); if (width > 0x1000000n) throw new RangeError("MSVC numeric field exceeds limit");
          const fill = String.fromCharCode(memory.readUint8(at(base, 88))).repeat(Math.max(0, Number(width) - prefix.length - digits.length)), adjustment = flags & 0x1c0;
          const text = adjustment === 0x40 ? prefix + digits + fill : adjustment === 0x100 ? prefix + fill + digits : fill + prefix + digits;
          for (let index = 0; index < text.length; index++) if (put(context, buffer, text.charCodeAt(index)) === -1) { setstate(context, base, 4); break; }
          memory.writeInt64(at(base, 40), 0n);
        }
      }
      setstate(context, base, 0); suffix(context, object);
    } finally { if (buffer !== null) virtual(context, buffer, 2, [], "void", []); }
    return p(object);
  });
  bind(`??6${ostream}QEAAAEAV01@PEAV?$basic_streambuf@DU?$char_traits@D@std@@@1@@Z`, ["pointer", "pointer"], "pointer", (context, args) => {
    const object = requiredPointer(args, 0), base = virtualIos(object), target = memory.readPointer(at(base, 72)), source = pointer(args, 1); let copied = false, state = 0;
    if (target !== null) virtual(context, target, 1, [], "void", []);
    try {
      if (memory.readInt32(at(base, 16)) === 0 && target !== null && source !== null) {
        const tied = memory.readPointer(at(base, 80)); if (tied !== null && tied.byteOffset !== object.byteOffset) flush(context, tied);
        if (memory.readInt32(at(base, 16)) === 0) for (;;) { const character = get(context, source, false); if (character === -1) break; if (put(context, target, character) === -1) { state |= 4; break; } get(context, source, true); copied = true; }
      }
      memory.writeInt64(at(base, 40), 0n); setstate(context, base, source === null ? 4 : state | (copied ? 0 : 2)); suffix(context, object);
    } finally { if (target !== null) virtual(context, target, 2, [], "void", []); }
    return p(object);
  });
}
