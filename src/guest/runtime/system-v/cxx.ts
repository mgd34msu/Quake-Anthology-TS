// SPDX-License-Identifier: GPL-2.0-or-later
import { count, pointer, requiredPointer } from "../common/memory.ts";
import type { SystemVServiceHost } from "./contracts.ts";
import { UnsupportedSystemVService } from "./contracts.ts";

export function installCxx(host: SystemVServiceHost): void {
  const m = host.memory, cxx = "libstdc++.so.6", cxa = ["CXXABI_1.3", null], old = ["GLIBCXX_3.4", null];
  host.service("libc.so.6", "__cxa_atexit", [m.pointerBytes === 4 ? "GLIBC_2.1.3" : "GLIBC_2.2.5", null], ["pointer", "pointer", "pointer"], "int32", (_context, args) => {
    host.registerDestructor(requiredPointer(args, 0), pointer(args, 1), pointer(args, 2)); return { kind: "int32", value: 0 };
  });
  host.service("libc.so.6", "__cxa_finalize", [m.pointerBytes === 4 ? "GLIBC_2.1.3" : "GLIBC_2.2.5", null], ["pointer"], "void", (context, args) => {
    host.finalizeDestructors(context, pointer(args, 0)); return { kind: "void" };
  });
  host.service(cxx, "__cxa_guard_acquire", cxa, ["pointer"], "int32", (context, args) => {
    const guard = requiredPointer(args, 0);
    if (m.readUint8(guard) !== 0) return { kind: "int32", value: 0 };
    if (m.readUint8(m.offset(guard, 1n)) !== 0) throw new UnsupportedSystemVService(cxx, "__cxa_guard_acquire", "CXXABI_1.3", context, "recursive local static initialization");
    m.writeUint8(m.offset(guard, 1n), 1); return { kind: "int32", value: 1 };
  });
  host.service(cxx, "__cxa_guard_release", cxa, ["pointer"], "void", (_context, args) => {
    const guard = requiredPointer(args, 0); m.writeUint8(guard, 1); m.writeUint8(m.offset(guard, 1n), 0); return { kind: "void" };
  });
  host.service(cxx, "__cxa_guard_abort", cxa, ["pointer"], "void", (_context, args) => { m.writeUint8(m.offset(requiredPointer(args, 0), 1n), 0); return { kind: "void" }; });
  for (const name of [m.pointerBytes === 4 ? "_Znwj" : "_Znwm", m.pointerBytes === 4 ? "_Znaj" : "_Znam"]) host.service(cxx, name, old, [host.pointerStorage], "pointer", (_context, args) => ({ kind: "pointer", value: host.allocate(count(args, 0)) }));
  for (const name of ["_ZdlPv", "_ZdaPv"]) host.service(cxx, name, old, ["pointer"], "void", (_context, args) => { host.free(pointer(args, 0)); return { kind: "void" }; });
  // An exception allocation includes raw Itanium/GNU bookkeeping before the user object.
  const exceptionHeader = m.pointerBytes === 4 ? 96 : 128;
  host.service(cxx, "__cxa_allocate_exception", cxa, [host.pointerStorage], "pointer", (_context, args) => {
    const allocation = host.allocate(count(args, 0) + exceptionHeader);
    return { kind: "pointer", value: m.offset(allocation, BigInt(exceptionHeader)) };
  });
  host.service(cxx, "__cxa_free_exception", cxa, ["pointer"], "void", (_context, args) => {
    host.free(m.offset(requiredPointer(args, 0), -BigInt(exceptionHeader))); return { kind: "void" };
  });
}
