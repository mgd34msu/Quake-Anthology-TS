// SPDX-License-Identifier: GPL-2.0-or-later
import type {
  GuestArchitecture, GuestFlag, GuestFlags, GuestIntegerRegisters, GuestIntegerWidth,
  GuestProcessorState, GuestRegister, GuestSegment,
} from "./contracts.ts";

const registerIndex: Readonly<Record<GuestRegister, number>> = {
  rax: 0, rcx: 1, rdx: 2, rbx: 3, rsp: 4, rbp: 5, rsi: 6, rdi: 7,
  r8: 8, r9: 9, r10: 10, r11: 11, r12: 12, r13: 13, r14: 14, r15: 15,
};
const flagBit: Readonly<Record<GuestFlag, bigint>> = {
  carry: 0n, parity: 2n, "auxiliary-carry": 4n, zero: 6n, sign: 7n, trap: 8n,
  interrupt: 9n, direction: 10n, overflow: 11n, resume: 16n, "virtual-8086": 17n,
  "alignment-check": 18n, "virtual-interrupt": 19n, "virtual-interrupt-pending": 20n, identification: 21n,
};

/** Physical 64-bit register slots, including the legacy low/high byte aliases. */
export class IntegerRegisterFile implements GuestIntegerRegisters {
  readonly #bytes: Uint8Array;
  readonly #view: DataView;
  constructor(readonly architecture: GuestArchitecture) {
    this.#bytes = new Uint8Array(architecture === "i386" ? 64 : 128);
    this.#view = new DataView(this.#bytes.buffer);
  }
  read(register: GuestRegister, width: GuestIntegerWidth, highByte = false): bigint {
    const offset = this.#offset(register, width, highByte);
    return BigInt.asUintN(width, this.#view.getBigUint64(offset, true) >> (highByte ? 8n : 0n));
  }
  write(register: GuestRegister, width: GuestIntegerWidth, value: bigint, highByte = false): undefined {
    const offset = this.#offset(register, width, highByte);
    const shift = highByte ? 8n : 0n;
    const normalized = BigInt.asUintN(width, value);
    if (width === 32 || width === 64) {
      this.#view.setBigUint64(offset, normalized, true);
    } else {
      const mask = ((1n << BigInt(width)) - 1n) << shift;
      this.#view.setBigUint64(offset, (this.#view.getBigUint64(offset, true) & ~mask) | (normalized << shift), true);
    }
    return undefined;
  }
  checkpoint(): Uint8Array { return this.#bytes.slice(); }
  restore(bytes: Uint8Array): undefined {
    if (bytes.byteLength !== this.#bytes.byteLength) throw new RangeError("Guest register snapshot has the wrong architecture or length");
    if (this.architecture === "i386") {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let offset = 4; offset < bytes.byteLength; offset += 8) {
        if (view.getUint32(offset, true) !== 0) throw new RangeError("i386 snapshot has nonzero upper register bits");
      }
    }
    this.#bytes.set(bytes);
    return undefined;
  }
  #offset(register: GuestRegister, width: GuestIntegerWidth, highByte: boolean): number {
    const index = registerIndex[register];
    if (this.architecture === "i386" && (index >= 8 || width === 64)) throw new RangeError("Register is not available in i386 mode");
    if (highByte && (width !== 8 || index > 3)) throw new RangeError("Only AH, CH, DH, and BH have high-byte register aliases");
    if (this.architecture === "i386" && width === 8 && index > 3) throw new RangeError("SPL, BPL, SIL, and DIL require x86-64 mode");
    return index * 8;
  }
}

/** Stores all flag bits; instruction and ABI owners apply their own writable-bit masks. */
export class ProcessorFlags implements GuestFlags {
  #value: bigint;
  constructor(value: bigint) { this.#value = BigInt.asUintN(64, value); }
  get value(): bigint { return this.#value; }
  set value(value: bigint) { this.#value = BigInt.asUintN(64, value); }
  get(flag: GuestFlag): boolean { return (this.#value & (1n << flagBit[flag])) !== 0n; }
  set(flag: GuestFlag, value: boolean): undefined {
    const mask = 1n << flagBit[flag];
    this.#value = value ? this.#value | mask : this.#value & ~mask;
    return undefined;
  }
}

export interface GuestProcessorInitialState {
  readonly architecture: GuestArchitecture;
  readonly instructionPointer: bigint;
  readonly stackPointer: bigint;
  readonly flags: bigint;
  readonly x87ControlWord: number;
  readonly mxcsr: number;
  readonly mxcsrMask: number;
}

/** The loader/runtime supplies its selected initial environment; this does not execute instructions. */
export function createGuestProcessorState(initial: GuestProcessorInitialState): GuestProcessorState {
  const registers = new IntegerRegisterFile(initial.architecture);
  const width = initial.architecture === "i386" ? 32 : 64;
  const limit = 1n << BigInt(width);
  if (initial.instructionPointer < 0n || initial.instructionPointer >= limit || initial.stackPointer < 0n || initial.stackPointer >= limit) {
    throw new RangeError("Initial guest IP or stack pointer exceeds its architecture");
  }
  if (!Number.isInteger(initial.x87ControlWord) || initial.x87ControlWord < 0 || initial.x87ControlWord > 0xffff
    || !Number.isInteger(initial.mxcsr) || initial.mxcsr < 0 || initial.mxcsr > 0xffffffff
    || !Number.isInteger(initial.mxcsrMask) || initial.mxcsrMask < 0 || initial.mxcsrMask > 0xffffffff) {
    throw new RangeError("Initial floating-point control state exceeds its register width");
  }
  const segment = (): GuestSegment => ({ selector: 0, base: 0n, limit: limit - 1n });
  registers.write("rsp", width, initial.stackPointer);
  return {
    architecture: initial.architecture, registers, instructionPointer: initial.instructionPointer,
    flags: new ProcessorFlags(initial.flags),
    segments: { cs: segment(), ds: segment(), es: segment(), ss: segment(), fs: segment(), gs: segment() },
    x87: { registers: new Uint8Array(80), controlWord: initial.x87ControlWord, statusWord: 0, tagWord: 0xffff,
      lastOpcode: 0, instructionPointer: 0n, dataPointer: 0n, instructionSelector: 0, dataSelector: 0 },
    simd: { xmm: new Uint8Array(initial.architecture === "i386" ? 128 : 256), mxcsr: initial.mxcsr, mxcsrMask: initial.mxcsrMask },
  };
}
