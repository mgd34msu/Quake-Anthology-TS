// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress } from "../../contracts/execution.ts";
import type { GuestAccess, GuestIntegerWidth, GuestProcessorState, GuestRegister, GuestSegments, MappedGuestMemory } from "../core/contracts.ts";
import { GuestMemoryFault } from "../core/memory.ts";

export type X86Width = 8 | 16 | 32;
export type SegmentName = keyof GuestSegments;
export type X86Operand = { readonly kind: "register"; readonly register: GuestRegister; readonly highByte: boolean; readonly index: number }
  | { readonly kind: "memory"; readonly offset: bigint; readonly segment: SegmentName; readonly stackPointerBase: boolean };
export interface X86ModRM { readonly byte: number; readonly group: number; readonly register: X86Operand; readonly operand: X86Operand }
export class UnsupportedX86Instruction extends Error {}
export class X86ProcessorFault extends Error {
  constructor(readonly vector: number, detail: string, readonly errorCode: bigint | null = null) { super(detail); }
}

export function guestAddress(memory: MappedGuestMemory, raw: bigint, access: GuestAccess = "read", length = 1): GuestAddress {
  const result = memory.pointer(raw);
  if (result === null) throw new GuestMemoryFault("null-address", memory.module, raw, length, access, "null guest address");
  return result;
}

export function registerOperand(index: number, width: GuestIntegerWidth): X86Operand {
  const highByte = width === 8 && index >= 4;
  const actual = highByte ? index - 4 : index;
  let register: GuestRegister;
  switch (actual) {
    case 0: register = "rax"; break; case 1: register = "rcx"; break; case 2: register = "rdx"; break; case 3: register = "rbx"; break;
    case 4: register = "rsp"; break; case 5: register = "rbp"; break; case 6: register = "rsi"; break; case 7: register = "rdi"; break;
    default: throw new RangeError(`Invalid i386 register index ${index}`);
  }
  return { kind: "register", register, highByte, index };
}

export class X86Decoder {
  readonly start: bigint;
  readonly bytes: number[] = [];
  cursor: bigint;
  operandBits: 16 | 32 = 32;
  addressBits: 16 | 32 = 32;
  segment: SegmentName | null = null;
  repeat: "none" | "f2" | "f3" = "none";
  lock = false;
  readonly opcode: number;
  constructor(readonly state: GuestProcessorState, readonly memory: MappedGuestMemory) {
    this.start = state.instructionPointer;
    this.cursor = this.start;
    while (true) {
      const byte = this.byte();
      switch (byte) {
        case 0x66: this.operandBits = 16; continue;
        case 0x67: this.addressBits = 16; continue;
        case 0xf0: this.lock = true; continue;
        case 0xf2: this.repeat = "f2"; continue;
        case 0xf3: this.repeat = "f3"; continue;
        case 0x26: this.segment = "es"; continue;
        case 0x2e: this.segment = "cs"; continue;
        case 0x36: this.segment = "ss"; continue;
        case 0x3e: this.segment = "ds"; continue;
        case 0x64: this.segment = "fs"; continue;
        case 0x65: this.segment = "gs"; continue;
        default: this.opcode = byte; return;
      }
    }
  }
  byte(): number {
    if (this.bytes.length >= 15) throw new X86ProcessorFault(13, "Instruction exceeds the 15-byte architectural limit", 0n);
    if (this.cursor > this.state.segments.cs.limit) throw new X86ProcessorFault(13, "Instruction exceeds CS limit", 0n);
    const address = guestAddress(this.memory, BigInt.asUintN(32, this.state.segments.cs.base + this.cursor), "execute");
    const byte = this.memory.fetch(address, 1)[0];
    if (byte === undefined) throw new Error("Guest memory returned an empty instruction fetch");
    this.bytes.push(byte);
    this.cursor = BigInt.asUintN(32, this.cursor + 1n);
    return byte;
  }
  immediate(width: X86Width): bigint {
    let value = 0n;
    for (let offset = 0; offset < width; offset += 8) value |= BigInt(this.byte()) << BigInt(offset);
    return value;
  }
  signed(width: X86Width): bigint { return BigInt.asIntN(width, this.immediate(width)); }
  registerValue(index: number, width: 16 | 32): bigint {
    const operand = registerOperand(index, width);
    if (operand.kind !== "register") throw new Error("Expected decoded register");
    return this.state.registers.read(operand.register, width);
  }
  modrm(width: X86Width): X86ModRM {
    const byte = this.byte(), mode = byte >> 6, group = (byte >> 3) & 7, rm = byte & 7;
    const register = registerOperand(group, width);
    if (mode === 3) return { byte, group, register, operand: registerOperand(rm, width) };
    let offset = 0n, stack = false, stackPointerBase = false;
    if (this.addressBits === 16) {
      const bx = this.registerValue(3, 16), bp = this.registerValue(5, 16), si = this.registerValue(6, 16), di = this.registerValue(7, 16);
      switch (rm) {
        case 0: offset = bx + si; break; case 1: offset = bx + di; break;
        case 2: offset = bp + si; stack = true; break; case 3: offset = bp + di; stack = true; break;
        case 4: offset = si; break; case 5: offset = di; break;
        case 6: if (mode === 0) offset = this.immediate(16); else { offset = bp; stack = true; } break;
        case 7: offset = bx; break;
      }
      if (mode === 1) offset += this.signed(8);
      if (mode === 2) offset += this.signed(16);
    } else {
      if (rm === 4) {
        const sib = this.byte(), scale = sib >> 6, index = (sib >> 3) & 7, base = sib & 7;
        if (index !== 4) offset += this.registerValue(index, 32) << BigInt(scale);
        if (base === 5 && mode === 0) offset += this.immediate(32);
        else { offset += this.registerValue(base, 32); stack = base === 4 || base === 5; stackPointerBase = base === 4; }
      } else if (rm === 5 && mode === 0) offset = this.immediate(32);
      else { offset = this.registerValue(rm, 32); stack = rm === 5; }
      if (mode === 1) offset += this.signed(8);
      if (mode === 2) offset += this.signed(32);
    }
    return { byte, group, register, operand: { kind: "memory", offset: BigInt.asUintN(this.addressBits, offset),
      segment: this.segment ?? (stack ? "ss" : "ds"), stackPointerBase } };
  }
  address(operand: Extract<X86Operand, { readonly kind: "memory" }>, widthBytes: number, access: GuestAccess): GuestAddress {
    const segment = this.state.segments[operand.segment];
    if (operand.offset + BigInt(widthBytes) - 1n > segment.limit) throw new X86ProcessorFault(operand.segment === "ss" ? 12 : 13, `${operand.segment} segment limit exceeded`, 0n);
    return guestAddress(this.memory, BigInt.asUintN(32, segment.base + operand.offset), access, widthBytes);
  }
  read(operand: X86Operand, width: X86Width): bigint {
    if (operand.kind === "register") return this.state.registers.read(operand.register, width, operand.highByte);
    const address = this.address(operand, width / 8, "read");
    switch (width) { case 8: return BigInt(this.memory.readUint8(address)); case 16: return BigInt(this.memory.readUint16(address)); case 32: return BigInt(this.memory.readUint32(address)); }
  }
  checkWrite(operand: X86Operand, width: X86Width): undefined {
    if (operand.kind === "memory") this.memory.check(this.address(operand, width / 8, "write"), width / 8, "write");
    return undefined;
  }
  write(operand: X86Operand, width: X86Width, value: bigint): undefined {
    if (operand.kind === "register") return this.state.registers.write(operand.register, width, value, operand.highByte);
    const address = this.address(operand, width / 8, "write"), normalized = Number(BigInt.asUintN(width, value));
    switch (width) { case 8: return this.memory.writeUint8(address, normalized); case 16: return this.memory.writeUint16(address, normalized); case 32: return this.memory.writeUint32(address, normalized); }
  }
}
