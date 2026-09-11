// SPDX-License-Identifier: GPL-3.0-or-later WITH GCC-exception-3.1
// GNU libstdc++ 4.8 and Itanium C++ ABI data representation.
import type { GuestAddress, GuestStorage } from "../../../contracts/execution.ts";
import { stringBytes, writeUnsigned } from "../common/memory.ts";
import type { SystemVImplementation, SystemVServiceHost } from "./contracts.ts";

export class CxxAbiData {
  readonly #types = new Map<string, GuestAddress>();
  readonly #classInfoVtables = new Map<string, GuestAddress>();
  constructor(readonly host: SystemVServiceHost) {
    const m = host.memory, p = m.pointerBytes;
    const className = "N10__cxxabiv117__class_type_infoE", singleName = "N10__cxxabiv120__si_class_type_infoE", multipleName = "N10__cxxabiv121__vmi_class_type_infoE";
    const base = this.data("_ZTISt9type_info", 2 * p);
    const classInfo = this.data(`_ZTI${className}`, 3 * p, "CXXABI_1.3");
    const singleInfo = this.data(`_ZTI${singleName}`, 3 * p, "CXXABI_1.3");
    const multipleInfo = this.data(`_ZTI${multipleName}`, 3 * p, "CXXABI_1.3");
    const pointerTest = this.function("__guest_type_info_is_pointer", ["pointer"], "int32", () => ({ kind: "int32", value: 0 }));
    const functionTest = this.function("__guest_type_info_is_function", ["pointer"], "int32", () => ({ kind: "int32", value: 0 }));
    for (const [form, name, type] of [["class", className, classInfo], ["si", singleName, singleInfo], ["vmi", multipleName, multipleInfo]] satisfies readonly (readonly [string, string, GuestAddress])[]) {
      const table = this.data(`_ZTV${name}`, 11 * p, "CXXABI_1.3");
      m.writePointer(this.slot(table, p), type);
      for (let index = 0; index < 9; index++) m.writePointer(this.slot(table, (index + 2) * p), index === 2 ? pointerTest : index === 3 ? functionTest : this.unsupported(`__guest_${form}_type_info_virtual_${index}`));
      this.#classInfoVtables.set(form, this.slot(table, 2 * p));
    }
    const classVtable = this.#classInfoVtables.get("class"), singleVtable = this.#classInfoVtables.get("si");
    if (classVtable === undefined || singleVtable === undefined) throw new Error("Missing RTTI class tables");
    m.writePointer(base, classVtable); m.writePointer(this.slot(base, p), this.bytes("St9type_info"));
    for (const [name, type, parent] of [[className, classInfo, base], [singleName, singleInfo, classInfo], [multipleName, multipleInfo, classInfo]] satisfies readonly (readonly [string, GuestAddress, GuestAddress])[]) {
      m.writePointer(type, singleVtable); m.writePointer(this.slot(type, p), this.bytes(name)); m.writePointer(this.slot(type, 2 * p), parent);
      this.#types.set(name, type);
    }
    this.#types.set("St9type_info", base);
  }
  slot(address: GuestAddress, offset: number): GuestAddress { return this.host.memory.offset(address, BigInt(offset)); }
  bytes(text: string): GuestAddress {
    const bytes = stringBytes(text), address = this.host.allocate(bytes.length);
    this.host.memory.write(address, bytes); return address;
  }
  function(name: string, parameters: readonly GuestStorage[], result: GuestStorage | "void", invoke: SystemVImplementation, version = "GLIBCXX_3.4"): GuestAddress {
    this.host.service("libstdc++.so.6", name, [version, null], parameters, result, invoke);
    const address = this.host.resolveAddress("libstdc++.so.6", name, version);
    if (address === null) throw new Error(`Unbound C++ service ${name}`);
    return address;
  }
  unsupported(name: string): GuestAddress {
    return this.host.unavailable("libstdc++.so.6", name, ["pointer"], "void", "this C++ virtual operation is not implemented");
  }
  data(name: string, size: number, version = "GLIBCXX_3.4"): GuestAddress {
    const address = this.host.allocate(size);
    this.host.data("libstdc++.so.6", name, version, address, size);
    return address;
  }
  /** Concrete class RTTI includes encoded nonvirtual or virtual base offsets. */
  type(name: string, bases: readonly { readonly type: GuestAddress; readonly offset: number; readonly flags: number }[] = []): GuestAddress {
    const prior = this.#types.get(name); if (prior !== undefined) return prior;
    const m = this.host.memory, p = m.pointerBytes;
    const form = bases.length === 0 ? "class" : bases.length === 1 && bases[0]?.offset === 0 && bases[0].flags === 2 ? "si" : "vmi";
    const vtable = this.#classInfoVtables.get(form);
    if (vtable === undefined) throw new Error("Missing RTTI class table");
    const size = form === "class" ? 2 * p : form === "si" ? 3 * p : 2 * p + 8 + bases.length * 2 * p;
    const address = this.data(`_ZTI${name}`, size), text = this.bytes(name);
    m.writePointer(address, vtable); m.writePointer(this.slot(address, p), text);
    if (form === "si") {
      const base = bases[0]; if (base === undefined) throw new Error("Missing single RTTI base");
      m.writePointer(this.slot(address, 2 * p), base.type);
    } else if (form === "vmi") {
      m.writeUint32(this.slot(address, 2 * p), 0); m.writeUint32(this.slot(address, 2 * p + 4), bases.length);
      bases.forEach((base, index) => {
        m.writePointer(this.slot(address, 2 * p + 8 + index * 2 * p), base.type);
        writeUnsigned(m, this.slot(address, 3 * p + 8 + index * 2 * p), p, BigInt(base.offset) * 256n | BigInt(base.flags));
      });
    }
    this.#types.set(name, address); return address;
  }
  vtable(name: string, type: GuestAddress, entries: readonly GuestAddress[]): GuestAddress {
    const m = this.host.memory, p = m.pointerBytes, table = this.data(`_ZTV${name}`, (entries.length + 2) * p);
    m.writePointer(this.slot(table, p), type);
    entries.forEach((entry, index) => m.writePointer(this.slot(table, (index + 2) * p), entry));
    return this.slot(table, 2 * p);
  }
}
