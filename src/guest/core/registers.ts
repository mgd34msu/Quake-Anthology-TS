// SPDX-License-Identifier: GPL-2.0-or-later
import type {
  GuestArchitecture, GuestFlag, GuestFlags, GuestIntegerRegisters, GuestIntegerWidth,
  GuestProcessorState, GuestRegister, GuestSegment,
} from "./contracts.ts";

const registerIndex: Readonly<Record<GuestRegister, number>> = {
  rax: 0, rcx: 1, rdx: 2, rbx: 3, rsp: 4, rbp: 5, rsi: 6, rdi: 7,
  r8: 8, r9: 9, r10: 10, r11: 11, r12: 12, r13: 13, r14: 14, r15: 15,
};
const flagMask: Readonly<Record<GuestFlag, number>> = {
  carry: 0x1, parity: 0x4, "auxiliary-carry": 0x10, zero: 0x40, sign: 0x80, trap: 0x100,
  interrupt: 0x200, direction: 0x400, overflow: 0x800, resume: 0x10000, "virtual-8086": 0x20000,
  "alignment-check": 0x40000, "virtual-interrupt": 0x80000, "virtual-interrupt-pending": 0x100000, identification: 0x200000,
};

/** Physical 64-bit register slots, including the legacy low/high byte aliases. */
export class IntegerRegisterFile implements GuestIntegerRegisters {
  readonly #bytes: Uint8Array;
  readonly #view: DataView;
  constructor(readonly architecture: GuestArchitecture) {
    this.#bytes = new Uint8Array(architecture === "i386" ? 64 : 128);
    this.#view = new DataView(this.#bytes.buffer);
  }
  static createManaged(architecture: GuestArchitecture): IntegerRegisterFile {
    const registers = new IntegerRegisterFile(architecture), view = registers.#view;
    Object.defineProperties(view, {
      getUint32: { value: view.getUint32 }, setUint8: { value: view.setUint8 },
      setUint16: { value: view.setUint16 }, setUint32: { value: view.setUint32 },
      getBigUint64: { value: view.getBigUint64 }, setBigUint64: { value: view.setBigUint64 },
    });
    Object.freeze(view);
    Object.defineProperties(registers, {
      integerView: { get: () => view }, read: { value: registers.read }, write: { value: registers.write },
      checkpoint: { value: registers.checkpoint }, restore: { value: registers.restore },
      attached: { value: registers.attached },
    });
    Object.freeze(registers);
    return registers;
  }
  attached(): boolean { return this.#bytes.byteLength === (this.architecture === "i386" ? 64 : 128); }
  get integerView(): DataView { return this.#view; }
  read(register: GuestRegister, width: GuestIntegerWidth, highByte = false): bigint {
    const offset = this.#offset(register, width, highByte);
    if (width === 64) return this.#view.getBigUint64(offset, true);
    return BigInt(width === 32 ? this.#view.getUint32(offset, true) : width === 16
      ? this.#view.getUint16(offset, true) : this.#view.getUint8(offset + (highByte ? 1 : 0)));
  }
  write(register: GuestRegister, width: GuestIntegerWidth, value: bigint, highByte = false): undefined {
    const offset = this.#offset(register, width, highByte);
    if (width === 64) { this.#view.setBigUint64(offset, value, true); return undefined; }
    const normalized = BigInt.asUintN(width, value);
    if (width === 32) {
      this.#view.setBigUint64(offset, normalized, true);
    } else if (width === 16) this.#view.setUint16(offset, Number(normalized), true);
    else this.#view.setUint8(offset + (highByte ? 1 : 0), Number(normalized));
    return undefined;
  }
  checkpoint(destination?: Uint8Array): Uint8Array {
    if (destination === undefined) return this.#bytes.slice();
    if (destination.byteLength !== this.#bytes.byteLength) throw new RangeError("Guest register snapshot has the wrong architecture or length");
    destination.set(this.#bytes);
    return destination;
  }
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
  #value: bigint | null;
  #low: number;
  #high: number;
  constructor(value: bigint) {
    this.#value = BigInt.asUintN(64, value);
    this.#low = Number(this.#value & 0xffffffffn);
    this.#high = Number(this.#value >> 32n);
  }
  static createManaged(value: bigint): ProcessorFlags {
    const flags = new ProcessorFlags(value);
    Object.defineProperties(flags, {
      value: { get: () => flags.#read(), set: (next: bigint) => flags.#write(next) },
      lowWord: { get: () => flags.#low }, highWord: { get: () => flags.#high },
      restoreWords: { value: flags.restoreWords }, writeLowWord: { value: flags.writeLowWord },
      get: { value: flags.get }, set: { value: flags.set },
    });
    Object.freeze(flags);
    return flags;
  }
  get value(): bigint { return this.#read(); }
  set value(value: bigint) { this.#write(value); }
  #read(): bigint { return this.#value ??= (BigInt(this.#high) << 32n) | BigInt(this.#low); }
  #write(value: bigint): void {
    this.#value = BigInt.asUintN(64, value);
    this.#low = Number(this.#value & 0xffffffffn);
    this.#high = Number(this.#value >> 32n);
  }
  get lowWord(): number { return this.#low; }
  get highWord(): number { return this.#high; }
  restoreWords(low: number, high: number): void { this.#low = low >>> 0; this.#high = high >>> 0; this.#value = null; }
  writeLowWord(value: number): void { this.#low = value >>> 0; this.#value = null; }
  get(flag: GuestFlag): boolean { return (this.#low & flagMask[flag]) !== 0; }
  set(flag: GuestFlag, value: boolean): undefined {
    const mask = flagMask[flag];
    this.writeLowWord(value ? this.#low | mask : this.#low & ~mask);
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
  return createState(initial, false);
}
interface ManagedProcessor {
  readonly registers: IntegerRegisterFile;
  readonly flags: ProcessorFlags;
}
const managedProcessors = new WeakMap<GuestProcessorState, ManagedProcessor>();
/** An explicit loader-owned state has stable architectural bindings; bytes and register values remain live. */
export function createManagedGuestProcessorState(initial: GuestProcessorInitialState): GuestProcessorState {
  return createState(initial, true);
}
export function managedGuestProcessor(state: GuestProcessorState): ManagedProcessor | null {
  return managedProcessors.get(state) ?? null;
}
function createState(initial: GuestProcessorInitialState, managed: boolean): GuestProcessorState {
  const registers = managed ? IntegerRegisterFile.createManaged(initial.architecture) : new IntegerRegisterFile(initial.architecture);
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
  const flags = managed ? ProcessorFlags.createManaged(initial.flags) : new ProcessorFlags(initial.flags);
  const state: GuestProcessorState = {
    architecture: initial.architecture, registers, instructionPointer: initial.instructionPointer,
    flags,
    segments: { cs: segment(), ds: segment(), es: segment(), ss: segment(), fs: segment(), gs: segment() },
    x87: { registers: new Uint8Array(80), controlWord: initial.x87ControlWord, statusWord: 0, tagWord: 0xffff,
      lastOpcode: 0, instructionPointer: 0n, dataPointer: 0n, instructionSelector: 0, dataSelector: 0 },
    simd: { xmm: new Uint8Array(initial.architecture === "i386" ? 128 : 256), mxcsr: initial.mxcsr, mxcsrMask: initial.mxcsrMask },
  };
  if (managed) {
    let instructionPointer = initial.instructionPointer;
    Object.defineProperty(state, "instructionPointer", { configurable: false,
      get: () => instructionPointer, set: (value: bigint) => { instructionPointer = value; } });
    const segments = state.segments;
    for (const value of [segments.cs, segments.ds, segments.es, segments.ss, segments.fs, segments.gs]) Object.seal(value);
    Object.freeze(state.segments);
    Object.defineProperty(state.x87, "registers", { writable: false, configurable: false });
    Object.defineProperty(state.simd, "xmm", { writable: false, configurable: false });
    Object.seal(state.x87); Object.seal(state.simd);
    for (const key of ["architecture", "registers", "flags", "segments", "x87", "simd"]) {
      Object.defineProperty(state, key, { writable: false, configurable: false });
    }
    Object.seal(state);
    managedProcessors.set(state, Object.freeze({ registers, flags }));
  }
  return state;
}
