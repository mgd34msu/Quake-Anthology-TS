// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress } from "../../../../contracts/execution.ts";
import type { MappedGuestMemory } from "../../../core/contracts.ts";
import { decodeBinary, readBits } from "../../../floating-point/binary.ts";
import type { BinaryValue } from "../../../floating-point/binary.ts";
import { readUnsigned } from "../memory.ts";

export type FormatArgumentType = "int" | "int64" | "pointer" | "double" | "long-double";
export type FormatArgument = { readonly kind: "integer"; readonly value: bigint } | { readonly kind: "float"; readonly value: BinaryValue };

/** va_list is passed by value on Windows/i386 and points to the ABI save descriptor on SysV x64. */
export class FormatArguments {
  private cursor: GuestAddress | null;
  private gp = 0;
  private fp = 0;
  private registers: GuestAddress | null = null;
  private readonly descriptor: GuestAddress | null;
  constructor(private readonly memory: MappedGuestMemory, private readonly dialect: "windows" | "system-v", address: GuestAddress | null) {
    this.descriptor = dialect === "system-v" && memory.pointerBytes === 8 ? address : null;
    if (this.descriptor !== null) {
      this.gp = memory.readUint32(this.descriptor); this.fp = memory.readUint32(memory.offset(this.descriptor, 4n));
      this.cursor = memory.readPointer(memory.offset(this.descriptor, 8n));
      this.registers = memory.readPointer(memory.offset(this.descriptor, 16n));
      if (this.gp > 48 || this.gp % 8 !== 0 || this.fp < 48 || this.fp > 176 || (this.fp - 48) % 16 !== 0)
        throw new RangeError("Invalid System V x64 va_list register offsets");
    } else this.cursor = address;
  }
  next(type: FormatArgumentType): FormatArgument {
    const m = this.memory, extended = type === "long-double" && this.dialect === "system-v";
    const floating = type === "double" || type === "long-double";
    const size = extended ? m.pointerBytes === 8 ? 16 : 12 : floating || type === "int64" ? 8 : type === "pointer" ? m.pointerBytes : 4;
    let address: GuestAddress;
    if (this.descriptor !== null && !extended && (floating ? this.fp < 176 : this.gp < 48)) {
      if (this.registers === null) throw new TypeError("va_list register save area is null");
      address = m.offset(this.registers, BigInt(floating ? this.fp : this.gp));
      if (floating) { this.fp += 16; m.writeUint32(m.offset(this.descriptor, 4n), this.fp); }
      else { this.gp += 8; m.writeUint32(this.descriptor, this.gp); }
    } else {
      if (this.cursor === null) throw new TypeError("va_list argument storage is null");
      const alignment = this.descriptor !== null && extended ? 16n : BigInt(m.pointerBytes);
      const aligned = (this.cursor.byteOffset + alignment - 1n) / alignment * alignment;
      address = m.offset(this.cursor, aligned - this.cursor.byteOffset);
      const slot = m.pointerBytes === 8 ? Math.ceil(size / 8) * 8 : Math.ceil(size / 4) * 4;
      this.cursor = m.offset(address, BigInt(slot));
      if (this.descriptor !== null) m.writePointer(m.offset(this.descriptor, 8n), this.cursor);
    }
    return floating ? { kind: "float", value: decodeBinary(readBits(m.copy(address, extended ? 10 : 8)), extended ? 80 : 64) }
      : { kind: "integer", value: readUnsigned(m, address, size) };
  }
}
