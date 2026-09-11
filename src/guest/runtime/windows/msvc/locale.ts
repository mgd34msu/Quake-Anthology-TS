// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, GuestCallContext, GuestCallValue } from "../../../../contracts/execution.ts";
import { integer, pointer, requiredPointer, readString, stringBytes } from "../../common/memory.ts";
import type { WindowsServiceHost } from "../contracts.ts";
import { UnsupportedWindowsImport } from "../contracts.ts";

const library = "msvcp140.dll";
const p = (value: GuestAddress | null): GuestCallValue => ({ kind: "pointer", value });

/** MSVC x64 xlocale/xfacet layout. Facet counts and ownership live in guest memory. */
export class MsvcLocale {
  readonly global: GuestAddress;
  readonly facetVtable: GuestAddress;
  readonly #locks: GuestAddress;
  constructor(readonly host: WindowsServiceHost) {
    const memory = host.memory;
    this.#locks = memory.allocate({ byteLength: 64, label: "MSVC recursive library locks" });
    host.service(library, "?_Incref@facet@locale@std@@UEAAXXZ", ["pointer"], "void", (_context, args) => { this.incref(requiredPointer(args, 0)); return { kind: "void" }; });
    host.service(library, "?_Decref@facet@locale@std@@UEAAPEAV_Facet_base@3@XZ", ["pointer"], "pointer", (_context, args) => p(this.decref(requiredPointer(args, 0))));
    host.service(library, "??1facet@locale@std@@MEAA@XZ", ["pointer"], "void", (_context, args) => { memory.writePointer(requiredPointer(args, 0), this.facetVtable); return { kind: "void" }; });
    host.service(library, "runtime:facet-delete", ["pointer", "uint32"], "pointer", (context, args) => {
      const facet = requiredPointer(args, 0);
      if (facet.byteOffset === this.global.byteOffset) throw new UnsupportedWindowsImport(library, "locale deletion", context, "the process classic/global locale still owns references");
      memory.writePointer(facet, this.facetVtable);
      if ((integer(args, 1) & 1n) !== 0n && !host.free(facet)) throw new Error("Invalid MSVC facet allocation");
      return p(facet);
    });
    this.facetVtable = memory.allocate({ byteLength: 24, label: "MSVC facet vftable" });
    ["runtime:facet-delete", "?_Incref@facet@locale@std@@UEAAXXZ", "?_Decref@facet@locale@std@@UEAAPEAV_Facet_base@3@XZ"].forEach((name, index) => {
      const address = host.resolveAddress(library, name); if (address === null) throw new Error("Missing MSVC facet method");
      memory.writePointer(memory.offset(this.facetVtable, BigInt(index * 8)), address);
    });
    memory.protect(this.facetVtable, 24, "read");
    this.global = memory.allocate({ byteLength: 56, label: "MSVC C locale implementation" });
    memory.writePointer(this.global, this.facetVtable);
    memory.writeUint32(memory.offset(this.global, 8n), 2); // classic() and the process global locale.
    memory.writeUint32(memory.offset(this.global, 32n), 63);
    const name = memory.allocate({ byteLength: 2, label: "MSVC locale name" }); memory.write(name, stringBytes("C")); memory.writePointer(memory.offset(this.global, 40n), name);
    host.service(library, "??0facet@locale@std@@IEAA@_K@Z", ["pointer", "uint64"], "pointer", (_context, args) => {
      const facet = requiredPointer(args, 0); memory.writePointer(facet, this.facetVtable); memory.writeUint32(memory.offset(facet, 8n), Number(BigInt.asUintN(32, integer(args, 1)))); return p(facet);
    });
    host.service(library, "?_Init@locale@std@@CAPEAV_Locimp@12@_N@Z", ["uint32"], "pointer", (_context, args) => { if ((integer(args, 0) & 255n) !== 0n) this.incref(this.global); return p(this.global); });
    host.service(library, "?_Getgloballocale@locale@std@@CAPEAV_Locimp@12@XZ", [], "pointer", () => p(this.global));
    host.service(library, "??0_Lockit@std@@QEAA@H@Z", ["pointer", "int32"], "pointer", (_context, args) => { const object = requiredPointer(args, 0); this.lock(object, Number(integer(args, 1))); return p(object); });
    host.service(library, "??1_Lockit@std@@QEAA@XZ", ["pointer"], "void", (_context, args) => { this.unlock(requiredPointer(args, 0)); return { kind: "void" }; });
    host.service(library, "??0_Locinfo@std@@QEAA@PEBD@Z", ["pointer", "pointer"], "pointer", (context, args) => {
      const object = requiredPointer(args, 0), supplied = pointer(args, 1), requested = supplied === null ? null : readString(memory, supplied);
      if (requested !== "C" && requested !== "") throw new UnsupportedWindowsImport(library, "_Locinfo", context, `locale ${requested} is not implemented`);
      memory.write(object, new Uint8Array(104)); this.lock(object, 0);
      for (const entry of [{ offset: 72n, wide: true }, { offset: 88n, wide: false }]) {
        const bytes = stringBytes("C", entry.wide), address = this.allocate(bytes.length); memory.write(address, bytes); memory.writePointer(memory.offset(object, entry.offset), address);
      }
      return p(object);
    });
    host.service(library, "??1_Locinfo@std@@QEAA@XZ", ["pointer"], "void", (_context, args) => {
      const object = requiredPointer(args, 0);
      for (let offset = 8n; offset <= 88n; offset += 16n) { const slot = memory.offset(object, offset); const allocation = memory.readPointer(slot); if (!host.free(allocation)) throw new Error("Invalid _Locinfo yarn allocation"); memory.writePointer(slot, null); }
      this.unlock(object); return { kind: "void" };
    });
    for (const word of ["true", "false"]) {
      const bytes = stringBytes(word), address = memory.allocate({ byteLength: bytes.length, label: `MSVC ${word} name` }); memory.write(address, bytes);
      host.service(library, `?_Get${word}@_Locinfo@std@@QEBAPEBDXZ`, ["pointer"], "pointer", () => p(address));
    }
    host.service(library, "?_Getlconv@_Locinfo@std@@QEBAPEBUlconv@@XZ", ["pointer"], "pointer", context => {
      const target = host.resolveAddress("ucrtbase.dll", "localeconv"); if (target === null) throw new Error("CRT localeconv missing"); return host.invoke(context, target, [], "pointer", []);
    });
    // _Cvtvec is returned through the member-function hidden result pointer in RDX.
    host.service(library, "?_Getcvt@_Locinfo@std@@QEBA?AU_Cvtvec@@XZ", ["pointer", "pointer"], "pointer", (_context, args) => {
      const result = requiredPointer(args, 1); memory.write(result, new Uint8Array(44)); memory.writeUint32(memory.offset(result, 4n), 1); memory.writeUint32(memory.offset(result, 8n), 1); return p(result);
    });
  }
  allocate(size: number): GuestAddress { const result = this.host.allocate(size); if (result === null) throw new RangeError("MSVC allocation failed"); return result; }
  incref(facet: GuestAddress): void { const memory = this.host.memory, slot = memory.offset(facet, 8n); memory.writeUint32(slot, memory.readUint32(slot) + 1); }
  decref(facet: GuestAddress): GuestAddress | null { const memory = this.host.memory, slot = memory.offset(facet, 8n), refs = memory.readUint32(slot); if (refs === 0) throw new Error("MSVC facet reference underflow"); memory.writeUint32(slot, refs - 1); return refs === 1 ? facet : null; }
  create(): GuestAddress { const result = this.allocate(8); this.incref(this.global); this.host.memory.writePointer(result, this.global); return result; }
  destroy(context: GuestCallContext, locale: GuestAddress | null): void {
    if (locale === null) return;
    const facet = this.host.memory.readPointer(locale); if (facet === null) throw new Error("Missing locale implementation");
    // The process C locale has the same reference protocol as guest-created facets.
    if (facet.byteOffset !== this.global.byteOffset) throw new UnsupportedWindowsImport(library, "locale destructor", context, "non-C locale implementation destructor is not implemented");
    if (this.decref(facet) !== null) throw new Error("MSVC process locale lost its owner references");
    if (!this.host.free(locale)) throw new Error("Invalid MSVC locale allocation");
  }
  lock(object: GuestAddress, kind: number): void {
    const memory = this.host.memory; memory.writeInt32(object, kind);
    if (kind < 0 || kind >= 8) return; // _Lockit deliberately ignores out-of-range categories.
    const slot = memory.offset(this.#locks, BigInt(kind * 8)), owner = memory.readUint32(slot), depthSlot = memory.offset(slot, 4n);
    if (owner !== 0 && owner !== this.host.threadId) throw new Error("MSVC lock contention requires thread scheduling");
    memory.writeUint32(slot, this.host.threadId); memory.writeUint32(depthSlot, memory.readUint32(depthSlot) + 1);
  }
  unlock(object: GuestAddress): void {
    const memory = this.host.memory, kind = memory.readInt32(object); if (kind < 0 || kind >= 8) return;
    const slot = memory.offset(this.#locks, BigInt(kind * 8)), depthSlot = memory.offset(slot, 4n), depth = memory.readUint32(depthSlot);
    if (memory.readUint32(slot) !== this.host.threadId || depth === 0) throw new Error("Unowned MSVC lock release");
    memory.writeUint32(depthSlot, depth - 1); if (depth === 1) memory.writeUint32(slot, 0);
  }
}
