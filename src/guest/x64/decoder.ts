// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress } from "../../contracts/execution.ts";
import type { GuestIntegerWidth, GuestProcessorState, GuestRegister, MappedGuestMemory } from "../core/contracts.ts";
import { GuestMemoryFault } from "../core/memory.ts";

export class X64ProcessorFault extends Error {
  constructor(readonly vector: number, detail: string) { super(detail); this.name = "X64ProcessorFault"; }
}
export class X64Unsupported extends Error {
  constructor(detail: string) { super(detail); this.name = "X64Unsupported"; }
}

const registers: readonly GuestRegister[] = ["rax", "rcx", "rdx", "rbx", "rsp", "rbp", "rsi", "rdi", "r8", "r9", "r10", "r11", "r12", "r13", "r14", "r15"];
export function registerName(index: number): GuestRegister {
  const register = registers[index];
  if (register === undefined) throw new X64ProcessorFault(6, `Invalid register index ${index}`);
  return register;
}
export interface X64RegisterOperand {
  readonly kind: "register";
  readonly register: GuestRegister;
  readonly width: GuestIntegerWidth;
  readonly highByte: boolean;
}
export interface X64MemoryOperand {
  readonly kind: "memory";
  readonly width: GuestIntegerWidth;
  readonly base: GuestRegister | null;
  readonly index: GuestRegister | null;
  readonly scale: bigint;
  readonly displacement: bigint;
  readonly ripRelative: boolean;
  readonly addressBits: 32 | 64;
  readonly segment: "fs" | "gs" | null;
}
export type X64Operand = X64RegisterOperand | X64MemoryOperand;
export interface X64ModRM {
  readonly byte: number;
  readonly extension: number;
  readonly registerIndex: number;
  readonly rmIndex: number;
  readonly reg: X64RegisterOperand;
  readonly rm: X64Operand;
}

export function canonicalAddress(value: bigint): bigint {
  const raw = BigInt.asUintN(64, value);
  if (raw > 0x7fffffffffffn && raw < 0xffff800000000000n) throw new X64ProcessorFault(13, `Noncanonical 48-bit virtual address 0x${raw.toString(16)}`);
  return raw;
}

export function guestAddress(memory: MappedGuestMemory, raw: bigint, access: "read" | "write" | "execute" = "read"): GuestAddress {
  const value = canonicalAddress(raw);
  const address = memory.pointer(value);
  if (address === null) throw new GuestMemoryFault("null-address", memory.module, value, 1, access, "null guest address");
  return address;
}

export function readMemory(memory: MappedGuestMemory, address: GuestAddress, width: GuestIntegerWidth): bigint {
  switch (width) {
    case 8: return BigInt(memory.readUint8(address));
    case 16: return BigInt(memory.readUint16(address));
    case 32: return BigInt(memory.readUint32(address));
    case 64: return memory.readUint64(address);
  }
}
export function writeMemory(memory: MappedGuestMemory, address: GuestAddress, width: GuestIntegerWidth, value: bigint): undefined {
  const normalized = BigInt.asUintN(width, value);
  switch (width) {
    case 8: return memory.writeUint8(address, Number(normalized));
    case 16: return memory.writeUint16(address, Number(normalized));
    case 32: return memory.writeUint32(address, Number(normalized));
    case 64: return memory.writeUint64(address, normalized);
  }
}

/** AMD APM volume 3 sections 1.2-1.7; memory addresses wait until all immediates are decoded. */
export class X64DecodeCursor {
  readonly start: bigint;
  readonly #fetchNext: (() => number) | null;
  readonly bytes: number[] = [];
  readonly opcode: number;
  rex: number | null = null;
  operandOverride = false;
  addressOverride = false;
  lock = false;
  repeat: "none" | "f2" | "f3" = "none";
  segment: "fs" | "gs" | null = null;

  constructor(readonly memory: MappedGuestMemory, readonly state: GuestProcessorState) {
    this.start = state.instructionPointer;
    // The complete architectural instruction window stays canonical and cannot wrap.
    // Boundary instructions retain the per-byte address/fault path below.
    this.#fetchNext = (this.start > 0n && this.start <= 0x7ffffffffff1n)
      || (this.start >= 0xffff800000000000n && this.start <= 0xfffffffffffffff1n)
      ? memory.fetchSequence(this.start) : null;
    while (true) {
      const byte = this.readByte();
      if (byte >= 0x40 && byte <= 0x4f) { this.rex = byte; continue; }
      if (byte === 0x66) this.operandOverride = true;
      else if (byte === 0x67) this.addressOverride = true;
      else if (byte === 0xf0) this.lock = true;
      else if (byte === 0xf2) this.repeat = "f2";
      else if (byte === 0xf3) this.repeat = "f3";
      else if (byte === 0x64) this.segment = "fs";
      else if (byte === 0x65) this.segment = "gs";
      else if (byte === 0x2e || byte === 0x36 || byte === 0x3e || byte === 0x26) this.segment = null;
      else { this.opcode = byte; break; }
      this.rex = null;
    }
  }
  get nextIP(): bigint { return BigInt.asUintN(64, this.start + BigInt(this.bytes.length)); }
  get width(): 16 | 32 | 64 { return ((this.rex ?? 0) & 8) !== 0 ? 64 : this.operandOverride ? 16 : 32; }
  get stackWidth(): 16 | 64 { return this.operandOverride ? 16 : 64; }
  get addressBits(): 32 | 64 { return this.addressOverride ? 32 : 64; }
  get rexB(): number { return ((this.rex ?? 0) & 1) !== 0 ? 8 : 0; }
  get rexX(): number { return ((this.rex ?? 0) & 2) !== 0 ? 8 : 0; }
  get rexR(): number { return ((this.rex ?? 0) & 4) !== 0 ? 8 : 0; }
  get numericPrefix(): "none" | "66" | "f2" | "f3" { return this.repeat !== "none" ? this.repeat : this.operandOverride ? "66" : "none"; }

  readByte(): number {
    if (this.bytes.length >= 15) throw new X64ProcessorFault(13, "Instruction exceeds 15 bytes");
    const byte = this.#fetchNext === null ? this.memory.fetchByte(canonicalAddress(this.nextIP)) : this.#fetchNext();
    this.bytes.push(byte);
    return byte;
  }
  readUnsigned(byteLength: number): bigint {
    if (byteLength === 1) return BigInt(this.readByte());
    if (byteLength === 2) return BigInt(this.readByte() + this.readByte() * 0x100);
    if (byteLength === 4) return BigInt(this.readByte() + this.readByte() * 0x100
      + this.readByte() * 0x10000 + this.readByte() * 0x1000000);
    let result = 0n;
    for (let index = 0; index < byteLength; index += 1) result |= BigInt(this.readByte()) << BigInt(index * 8);
    return result;
  }
  readSigned(byteLength: number): bigint { return BigInt.asIntN(byteLength * 8, this.readUnsigned(byteLength)); }
  immediate(width: GuestIntegerWidth): bigint { return width === 64 ? this.readSigned(4) : this.readUnsigned(width / 8); }
  register(index: number, width: GuestIntegerWidth): X64RegisterOperand {
    if (width === 8 && this.rex === null && index >= 4 && index < 8) return { kind: "register", register: registerName(index - 4), width, highByte: true };
    return { kind: "register", register: registerName(index), width, highByte: false };
  }
  decodeModRM(width: GuestIntegerWidth): X64ModRM {
    const byte = this.readByte();
    const mode = byte >> 6;
    const extension = (byte >> 3) & 7;
    const lowRm = byte & 7;
    const registerIndex = extension + this.rexR;
    const rmIndex = lowRm + this.rexB;
    const reg = this.register(registerIndex, width);
    if (mode === 3) return { byte, extension, registerIndex, rmIndex, reg, rm: this.register(rmIndex, width) };
    let base: GuestRegister | null = null;
    let index: GuestRegister | null = null;
    let scale = 1n;
    let displacement = 0n;
    let ripRelative = false;
    if (lowRm === 4) {
      const sib = this.readByte();
      const lowBase = sib & 7;
      const lowIndex = (sib >> 3) & 7;
      scale = 1n << BigInt(sib >> 6);
      if (lowIndex !== 4 || this.rexX !== 0) index = registerName(lowIndex + this.rexX);
      if (mode === 0 && lowBase === 5) displacement = this.readSigned(4);
      else base = registerName(lowBase + this.rexB);
    } else if (mode === 0 && lowRm === 5) {
      ripRelative = true;
      displacement = this.readSigned(4);
    } else base = registerName(rmIndex);
    if (mode === 1) displacement = this.readSigned(1);
    else if (mode === 2) displacement = this.readSigned(4);
    return { byte, extension, registerIndex, rmIndex, reg, rm: { kind: "memory", width, base, index, scale, displacement, ripRelative, addressBits: this.addressBits, segment: this.segment } };
  }
  effectiveOffset(operand: X64MemoryOperand, nextIP = this.nextIP): bigint {
    const base = operand.ripRelative ? nextIP : operand.base === null ? 0n : this.state.registers.read(operand.base, operand.addressBits);
    const index = operand.index === null ? 0n : this.state.registers.read(operand.index, operand.addressBits) * operand.scale;
    return BigInt.asUintN(operand.addressBits, base + index + operand.displacement);
  }
  address(operand: X64MemoryOperand, access: "read" | "write" = "read"): GuestAddress {
    const segmentBase = operand.segment === null ? 0n : this.state.segments[operand.segment].base;
    return guestAddress(this.memory, this.effectiveOffset(operand) + segmentBase, access);
  }
  read(operand: X64Operand): bigint {
    return operand.kind === "register" ? this.state.registers.read(operand.register, operand.width, operand.highByte) : readMemory(this.memory, this.address(operand), operand.width);
  }
  write(operand: X64Operand, value: bigint): undefined {
    return operand.kind === "register" ? this.state.registers.write(operand.register, operand.width, value, operand.highByte) : writeMemory(this.memory, this.address(operand, "write"), operand.width, value);
  }
  writable(operand: X64Operand): undefined {
    if (operand.kind === "memory") this.memory.check(this.address(operand, "write"), operand.width / 8, "write");
    return undefined;
  }
}
