// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress } from "../../../../contracts/execution.ts";
import { rounding } from "../../../floating-point/binary.ts";
import type { WindowsServiceHost } from "../../windows/contracts.ts";
import { UnsupportedWindowsImport } from "../../windows/contracts.ts";
import type { SystemVServiceHost } from "../../system-v/contracts.ts";
import { integer, pointer, requiredPointer } from "../memory.ts";
import { formatGuestBuffer, GuestFormatFortifyFailure } from "../format.ts";

export function installWindowsFormat(host: WindowsServiceHost, errno: GuestAddress): void {
  for (const library of ["api-ms-win-crt-stdio-l1-1-0.dll", "ucrtbase.dll", "msvcrt.dll"])
    host.service(library, "__stdio_common_vsprintf", ["uint64", "pointer", host.pointerStorage, "pointer", "pointer", "pointer"], "int32", (context, args) => {
      const options = integer(args, 0);
      if (pointer(args, 4) !== null) throw new UnsupportedWindowsImport(library, "__stdio_common_vsprintf", context, "explicit printf locale is not the installed C locale");
      if ((options & ~0x3fn) !== 0n || (options & 8n) !== 0n)
        throw new UnsupportedWindowsImport(library, "__stdio_common_vsprintf", context, "legacy MSVCRT compatibility formatting is not implemented");
      const result = formatGuestBuffer({ memory: host.memory, dialect: "windows", buffer: pointer(args, 1), capacity: integer(args, 2),
        format: pointer(args, 3), arguments: pointer(args, 5), termination: (options & 1n) !== 0n ? "ucrt-legacy" : (options & 2n) !== 0n ? "c99" : "ucrt",
        continueCount: (options & 2n) !== 0n,
        rounding: (options & 32n) !== 0n ? rounding(host.runner.options.cpu.state.simd.mxcsr >>> 13) : "legacy-nearest",
        exponentDigits: (options & 16n) !== 0n ? 3 : 2 });
      if (result.errno !== null) host.memory.writeInt32(errno, result.errno);
      return { kind: "int32", value: result.result };
    });
}

export function installSystemVFormat(host: SystemVServiceHost): void {
  const base = host.memory.pointerBytes === 4 ? "GLIBC_2.0" : "GLIBC_2.2.5";
  for (const checked of [false, true]) {
    const name = checked ? "__vsnprintf_chk" : "vsnprintf";
    host.service("libc.so.6", name, [checked ? "GLIBC_2.3.4" : base, null],
      checked ? ["pointer", host.pointerStorage, "int32", host.pointerStorage, "pointer", "pointer"] : ["pointer", host.pointerStorage, "pointer", "pointer"],
      "int32", (_context, args) => {
        const capacity = integer(args, 1);
        if (checked && integer(args, 3) < capacity) throw new GuestFormatFortifyFailure("glibc __vsnprintf_chk destination size is smaller than maxlen");
        // glibc clears the first byte before processing, including empty and overlapping formats.
        if (capacity > 0n) host.memory.writeUint8(requiredPointer(args, 0), 0);
        const result = formatGuestBuffer({ memory: host.memory, dialect: "system-v", buffer: pointer(args, 0), capacity,
          format: pointer(args, checked ? 4 : 2), arguments: pointer(args, checked ? 5 : 3), termination: "c99",
          fortify: checked && integer(args, 2) > 0n, rounding: rounding(host.runner.options.cpu.state.x87.controlWord >>> 10) });
        if (result.errno !== null) host.errno = result.errno;
        return { kind: "int32", value: result.result };
      });
  }
}
