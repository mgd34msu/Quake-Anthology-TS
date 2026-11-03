// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestProcessorState, MappedGuestMemory } from "../core/contracts.ts";
import { SparseGuestMemory } from "../core/memory.ts";
import { IntegerRegisterFile, managedGuestProcessor, ProcessorFlags } from "../core/registers.ts";
import type { NumericExecutionContext, NumericExecutionResult, NumericInstruction, NumericOperand } from "../floating-point/contracts.ts";
import { shift, signedMultiply } from "./arithmetic.ts";
import type { ShiftOperation } from "./arithmetic.ts";
import { guestAddress, UnsupportedX86Instruction, X86ProcessorFault } from "./decoder.ts";

/** One predecoded instruction. It performs the instruction and returns the next instruction pointer. */
export type I386Step = () => number;

const registerMembers = Object.getOwnPropertyNames(IntegerRegisterFile.prototype);
const flagMembers = Object.getOwnPropertyNames(ProcessorFlags.prototype);
const memoryMembers = Object.getOwnPropertyNames(SparseGuestMemory.prototype);
function originalInstance(value: object, prototype: object, members: readonly string[]): boolean {
  const actual: unknown = Object.getPrototypeOf(value);
  return actual === prototype && members.every(member => !Object.hasOwn(value, member));
}

const EAX = 0,
  ECX = 2,
  EDX = 4,
  ESP = 8,
  EBP = 10,
  ESI = 12,
  EDI = 14;
const segmentNames: readonly string[] = ["ds", "ss", "es"];
const shiftNames: readonly ShiftOperation[] = ["rol", "ror", "rcl", "rcr", "shl", "shr", "shl", "sar"];

function parity(byte: number): number {
  byte ^= byte >>> 4;
  return ((0x9669 >>> (byte & 15)) & 1) << 2;
}

interface Rm {
  /** Effective address of a memory operand, or null for a register operand. */
  readonly ea: (() => number) | null;
  /** 0 is DS and 1 is SS. */
  readonly seg: 0 | 1;
  readonly idx: number;
  readonly sh: number;
}
interface ParsedModrm {
  readonly reg: number;
  readonly rm: number;
  readonly mode: number;
  readonly ea: (() => number) | null;
  readonly seg: 0 | 1;
  readonly end: number;
}

/**
 * Number-based executor for the common user-mode i386 instructions. Each supported instruction is predecoded once
 * from its guarded bytes into a closure that mirrors `I386Cpu`'s BigInt semantics exactly; anything else stays on the
 * generic path. A step finishes every fault check before it writes registers or flags, so a throw leaves the state intact.
 */
export class I386Fast {
  /** Flags produced by the last `#alu`, committed only after the instruction's last possible fault. */
  #next = 0;
  private constructor(
    readonly state: GuestProcessorState,
    readonly memory: SparseGuestMemory,
    readonly words: Uint32Array,
    readonly flags: ProcessorFlags,
    readonly registers: IntegerRegisterFile,
    readonly numeric: (context: NumericExecutionContext) => NumericExecutionResult,
  ) {}

  static create(state: GuestProcessorState, memory: MappedGuestMemory, numeric: (context: NumericExecutionContext) => NumericExecutionResult): I386Fast | null {
    if (state.architecture !== "i386") return null;
    const managed = managedGuestProcessor(state);
    const registers = managed?.registers ?? state.registers,
      flags = managed?.flags ?? state.flags;
    if (!(registers instanceof IntegerRegisterFile) || registers.architecture !== "i386" || !(flags instanceof ProcessorFlags)) return null;
    if (
      managed === null &&
      (!originalInstance(registers, IntegerRegisterFile.prototype, registerMembers) || !originalInstance(flags, ProcessorFlags.prototype, flagMembers))
    )
      return null;
    if (!(memory instanceof SparseGuestMemory) || (!SparseGuestMemory.managed(memory) && !originalInstance(memory, SparseGuestMemory.prototype, memoryMembers)))
      return null;
    const words = registers.integerWords;
    return words === null ? null : new I386Fast(state, memory, words, flags, registers, numeric);
  }

  /** The executor assumes flat 32-bit segments; a processor with any other CS/DS/ES/SS stays on the generic path. */
  flat(): boolean {
    const { cs, ds, es, ss } = this.state.segments;
    return (
      cs.base === 0n &&
      cs.limit === 0xffffffffn &&
      ds.base === 0n &&
      ds.limit === 0xffffffffn &&
      es.base === 0n &&
      es.limit === 0xffffffffn &&
      ss.base === 0n &&
      ss.limit === 0xffffffffn
    );
  }

  // Memory

  #fault(segment: number): X86ProcessorFault {
    return new X86ProcessorFault(segment === 1 ? 12 : 13, `${segmentNames[segment] ?? "ds"} segment limit exceeded`, 0n);
  }
  #load(address: number, size: 1 | 2 | 4, segment: number): number {
    if (address > 0x100000000 - size) throw this.#fault(segment);
    const value = this.memory.scalarRead(address, size);
    if (value >= 0) return value;
    const target = guestAddress(this.memory, BigInt(address), "read", size);
    return size === 4 ? this.memory.readUint32(target) : size === 2 ? this.memory.readUint16(target) : this.memory.readUint8(target);
  }
  #store(address: number, size: 1 | 2 | 4, segment: number, value: number): void {
    if (address > 0x100000000 - size) throw this.#fault(segment);
    if (this.memory.scalarWrite(address, size, value)) return;
    const target = guestAddress(this.memory, BigInt(address), "write", size);
    if (size === 4) this.memory.writeUint32(target, value);
    else if (size === 2) this.memory.writeUint16(target, value);
    else this.memory.writeUint8(target, value);
  }
  #probeWrite(address: number, size: 1 | 2 | 4, segment: number): void {
    if (address > 0x100000000 - size) throw this.#fault(segment);
    this.memory.check(guestAddress(this.memory, BigInt(address), "write", size), size, "write");
  }
  #get(rm: Rm, address: number, size: 1 | 2 | 4): number {
    if (rm.ea !== null) return this.#load(address, size, rm.seg);
    const value = this.words[rm.idx] ?? 0;
    return size === 4 ? value : size === 2 ? value & 0xffff : (value >>> rm.sh) & 255;
  }
  #put(rm: Rm, address: number, size: 1 | 2 | 4, value: number): void {
    if (rm.ea !== null) {
      this.#store(address, size, rm.seg, value);
      return;
    }
    const old = this.words[rm.idx] ?? 0;
    this.words[rm.idx] = size === 4 ? value : size === 2 ? (old & 0xffff0000) | value : (old & ~(255 << rm.sh)) | (value << rm.sh);
  }
  #push(value: number): void {
    const pointer = ((this.words[ESP] ?? 0) - 4) >>> 0;
    this.#store(pointer, 4, 1, value);
    this.words[ESP] = pointer;
  }
  #pop(): number {
    const pointer = this.words[ESP] ?? 0,
      value = this.#load(pointer, 4, 1);
    this.words[ESP] = (pointer + 4) >>> 0;
    return value;
  }

  // Arithmetic. Operation numbers follow the ALU opcode order (add or adc sbb and sub xor cmp) with test as 8.

  #alu(operation: number, a: number, b: number, wide: boolean): number {
    const low = this.flags.lowWord,
      sign = wide ? 0x80000000 : 0x80;
    let full: number,
      bits = 0,
      mask = 0x8d5;
    switch (operation) {
      case 0:
      case 2: {
        const incoming = operation === 2 ? low & 1 : 0;
        full = a + b + incoming;
        if (full >= (wide ? 0x100000000 : 0x100)) bits |= 1;
        if ((~(a ^ b) & (a ^ full) & sign) !== 0) bits |= 0x800;
        if ((a & 15) + (b & 15) + incoming > 15) bits |= 0x10;
        break;
      }
      case 3:
      case 5:
      case 7: {
        const incoming = operation === 3 ? low & 1 : 0;
        full = a - b - incoming;
        if (full < 0) bits |= 1;
        if (((a ^ b) & (a ^ full) & sign) !== 0) bits |= 0x800;
        if ((a & 15) < (b & 15) + incoming) bits |= 0x10;
        break;
      }
      case 4:
      case 8:
        full = a & b;
        mask = 0x8c5;
        break;
      case 1:
        full = a | b;
        mask = 0x8c5;
        break;
      default:
        full = a ^ b;
        mask = 0x8c5;
        break;
    }
    const result = wide ? full >>> 0 : full & 0xff;
    bits |= (result === 0 ? 0x40 : 0) | ((result & sign) !== 0 ? 0x80 : 0) | parity(result & 255);
    this.#next = (low & ~mask) | bits;
    return result;
  }
  #commit(): void {
    this.flags.writeLowWord(this.#next);
  }
  #condition(code: number): boolean {
    const bits = this.flags.lowWord,
      carry = (bits & 1) !== 0,
      zero = (bits & 0x40) !== 0,
      sign = (bits & 0x80) !== 0,
      overflow = (bits & 0x800) !== 0;
    switch (code) {
      case 0:
        return overflow;
      case 1:
        return !overflow;
      case 2:
        return carry;
      case 3:
        return !carry;
      case 4:
        return zero;
      case 5:
        return !zero;
      case 6:
        return carry || zero;
      case 7:
        return !carry && !zero;
      case 8:
        return sign;
      case 9:
        return !sign;
      case 10:
        return (bits & 4) !== 0;
      case 11:
        return (bits & 4) === 0;
      case 12:
        return sign !== overflow;
      case 13:
        return sign === overflow;
      case 14:
        return zero || sign !== overflow;
      default:
        return !zero && sign === overflow;
    }
  }

  // Predecoding

  #parse(bytes: readonly number[], position: number): ParsedModrm | null {
    const byte = bytes[position];
    if (byte === undefined) return null;
    const mode = byte >> 6,
      reg = (byte >> 3) & 7,
      rm = byte & 7;
    if (mode === 3) return { reg, rm, mode, ea: null, seg: 0, end: position + 1 };
    let cursor = position + 1,
      base = -1,
      index = -1,
      scale = 1,
      displacement = 0,
      stack = false;
    const at = (offset: number): number => bytes[offset] ?? 0;
    const signed8 = (offset: number): number => (at(offset) << 24) >> 24;
    const word32 = (offset: number): number => at(offset) | (at(offset + 1) << 8) | (at(offset + 2) << 16) | (at(offset + 3) << 24);
    if (rm === 4) {
      const sib = bytes[cursor++];
      if (sib === undefined) return null;
      const sibIndex = (sib >> 3) & 7,
        sibBase = sib & 7;
      if (sibIndex !== 4) {
        index = sibIndex * 2;
        scale = 1 << (sib >> 6);
      }
      if (sibBase === 5 && mode === 0) {
        displacement = word32(cursor);
        cursor += 4;
      } else {
        base = sibBase * 2;
        stack = sibBase === 4 || sibBase === 5;
      }
    } else if (rm === 5 && mode === 0) {
      displacement = word32(cursor);
      cursor += 4;
    } else {
      base = rm * 2;
      stack = rm === 5;
    }
    if (mode === 1) {
      displacement += signed8(cursor);
      cursor += 1;
    } else if (mode === 2) {
      displacement += word32(cursor);
      cursor += 4;
    }
    const w = this.words,
      offset = displacement;
    let ea: () => number;
    if (index < 0) {
      if (base < 0) {
        const constant = offset >>> 0;
        ea = () => constant;
      } else if (offset === 0) ea = () => w[base] ?? 0;
      else ea = () => ((w[base] ?? 0) + offset) >>> 0;
    } else if (base < 0) ea = () => ((w[index] ?? 0) * scale + offset) >>> 0;
    else ea = () => ((w[base] ?? 0) + (w[index] ?? 0) * scale + offset) >>> 0;
    return { reg, rm, mode, ea, seg: stack ? 1 : 0, end: cursor };
  }
  #rm(parsed: ParsedModrm, wide: boolean): Rm {
    return {
      ea: parsed.mode === 3 ? null : parsed.ea,
      seg: parsed.seg,
      idx: wide ? parsed.rm * 2 : (parsed.rm & 3) * 2,
      sh: !wide && (parsed.rm & 4) !== 0 ? 8 : 0,
    };
  }

  /** Builds the step for an instruction at `ip` or returns null when the generic interpreter must execute it. */
  build(bytes: readonly number[], ip: number): I386Step | null {
    if (ip + bytes.length > 0x100000000) return null;
    const cursor = new Cursor(bytes),
      next = (ip + bytes.length) >>> 0;
    let op = cursor.u8(),
      repeat = false;
    if (op === 0xf3) {
      repeat = true;
      op = cursor.u8();
    }
    const step = this.#decode(cursor, op, repeat, ip, next);
    return step !== null && cursor.position === bytes.length ? step : null;
  }

  #modrm(cursor: Cursor, wide: boolean): { readonly parsed: ParsedModrm; readonly rm: Rm; readonly register: Rm } | null {
    const parsed = this.#parse(cursor.bytes, cursor.position);
    if (parsed === null) return null;
    cursor.position = parsed.end;
    return { parsed, rm: this.#rm(parsed, wide), register: this.#rm({ ...parsed, mode: 3, rm: parsed.reg }, wide) };
  }

  #decode(cursor: Cursor, op: number, repeat: boolean, ip: number, next: number): I386Step | null {
    const w = this.words,
      self = this,
      flags = this.flags;
    if (repeat && op !== 0xa4 && op !== 0xa5 && op !== 0xaa && op !== 0xab) return null;
    if (op <= 0x3d && (op & 7) <= 5) {
      const operation = op >> 3,
        form = op & 7,
        wide = (form & 1) === 1,
        writes = operation !== 7,
        size = wide ? 4 : 1;
      if (form <= 3) {
        const decoded = this.#modrm(cursor, wide);
        if (decoded === null) return null;
        const { rm, register } = decoded;
        if (form < 2) {
          return () => {
            const address = rm.ea === null ? 0 : rm.ea();
            const right = self.#get(register, 0, size),
              left = self.#get(rm, address, size);
            const result = self.#alu(operation, left, right, wide);
            if (writes) self.#put(rm, address, size, result);
            self.#commit();
            return next;
          };
        }
        return () => {
          const address = rm.ea === null ? 0 : rm.ea();
          const right = self.#get(rm, address, size),
            left = self.#get(register, 0, size);
          const result = self.#alu(operation, left, right, wide);
          if (writes) self.#put(register, 0, size, result);
          self.#commit();
          return next;
        };
      }
      const immediate = wide ? cursor.u32() : cursor.u8();
      return () => {
        const result = self.#alu(operation, self.#get(accumulator, 0, size), immediate, wide);
        if (writes) self.#put(accumulator, 0, size, result);
        self.#commit();
        return next;
      };
    }
    if (op >= 0x40 && op <= 0x4f) {
      const index = (op & 7) * 2,
        decrement = op >= 0x48;
      return () => {
        const carry = flags.lowWord & 1;
        w[index] = self.#alu(decrement ? 5 : 0, w[index] ?? 0, 1, true);
        self.#next = (self.#next & ~1) | carry;
        self.#commit();
        return next;
      };
    }
    if (op >= 0x50 && op <= 0x57) {
      const index = (op & 7) * 2;
      return () => {
        self.#push(w[index] ?? 0);
        return next;
      };
    }
    if (op >= 0x58 && op <= 0x5f) {
      const index = (op & 7) * 2;
      return () => {
        w[index] = self.#pop();
        return next;
      };
    }
    if (op >= 0x70 && op <= 0x7f) {
      const target = (next + cursor.s8()) >>> 0,
        code = op & 15;
      return () => (self.#condition(code) ? target : next);
    }
    if (op >= 0xb0 && op <= 0xb7) {
      const register = this.#rm({ reg: 0, rm: op & 7, mode: 3, ea: null, seg: 0, end: 0 }, false),
        value = cursor.u8();
      return () => {
        self.#put(register, 0, 1, value);
        return next;
      };
    }
    if (op >= 0xb8 && op <= 0xbf) {
      const index = (op & 7) * 2,
        value = cursor.u32();
      return () => {
        w[index] = value;
        return next;
      };
    }
    if (op >= 0xd8 && op <= 0xdf) return this.#floating(cursor, op, ip, next);
    switch (op) {
      case 0x0f:
        return this.#extended(cursor, cursor.u8(), next);
      case 0x68: {
        const value = cursor.u32();
        return () => {
          self.#push(value);
          return next;
        };
      }
      case 0x6a: {
        const value = cursor.s8() >>> 0;
        return () => {
          self.#push(value);
          return next;
        };
      }
      case 0x69:
      case 0x6b: {
        const decoded = this.#modrm(cursor, true);
        if (decoded === null) return null;
        const { rm, parsed } = decoded,
          register = parsed.reg * 2,
          immediate = BigInt(op === 0x6b ? cursor.s8() : cursor.u32() | 0);
        return () => {
          const address = rm.ea === null ? 0 : rm.ea();
          w[register] = Number(signedMultiply(32, BigInt(self.#get(rm, address, 4)), immediate, flags));
          return next;
        };
      }
      case 0x80:
      case 0x81:
      case 0x82:
      case 0x83: {
        const wide = op === 0x81 || op === 0x83,
          decoded = this.#modrm(cursor, wide);
        if (decoded === null) return null;
        const rm = decoded.rm,
          operation = decoded.parsed.reg,
          writes = operation !== 7,
          size = wide ? 4 : 1;
        const immediate = op === 0x83 ? cursor.s8() >>> 0 : wide ? cursor.u32() : cursor.u8();
        return () => {
          const address = rm.ea === null ? 0 : rm.ea();
          const result = self.#alu(operation, self.#get(rm, address, size), immediate, wide);
          if (writes) self.#put(rm, address, size, result);
          self.#commit();
          return next;
        };
      }
      case 0x84:
      case 0x85: {
        const wide = op === 0x85,
          decoded = this.#modrm(cursor, wide);
        if (decoded === null) return null;
        const { rm, register } = decoded,
          size = wide ? 4 : 1;
        return () => {
          const address = rm.ea === null ? 0 : rm.ea();
          const right = self.#get(register, 0, size);
          self.#alu(8, self.#get(rm, address, size), right, wide);
          self.#commit();
          return next;
        };
      }
      case 0x88:
      case 0x89:
      case 0x8a:
      case 0x8b: {
        const wide = (op & 1) === 1,
          decoded = this.#modrm(cursor, wide);
        if (decoded === null) return null;
        const { rm, register } = decoded,
          size = wide ? 4 : 1;
        if (op < 0x8a)
          return () => {
            const address = rm.ea === null ? 0 : rm.ea();
            self.#put(rm, address, size, self.#get(register, 0, size));
            return next;
          };
        return () => {
          const address = rm.ea === null ? 0 : rm.ea();
          self.#put(register, 0, size, self.#get(rm, address, size));
          return next;
        };
      }
      case 0x8d: {
        const decoded = this.#modrm(cursor, true);
        if (decoded === null || decoded.rm.ea === null) return null;
        const ea = decoded.rm.ea,
          register = decoded.parsed.reg * 2;
        return () => {
          w[register] = ea();
          return next;
        };
      }
      case 0x90:
        return () => next;
      case 0x98:
        return () => {
          w[EAX] = (((w[EAX] ?? 0) << 16) >> 16) >>> 0;
          return next;
        };
      case 0x99:
        return () => {
          w[EDX] = ((w[EAX] ?? 0) & 0x80000000) !== 0 ? 0xffffffff : 0;
          return next;
        };
      case 0xa0:
      case 0xa1:
      case 0xa2:
      case 0xa3: {
        const size = (op & 1) === 1 ? 4 : 1,
          address = cursor.u32();
        if (op < 0xa2)
          return () => {
            self.#put(accumulator, 0, size, self.#load(address, size, 0));
            return next;
          };
        return () => {
          self.#store(address, size, 0, self.#get(accumulator, 0, size));
          return next;
        };
      }
      case 0xa4:
      case 0xa5:
      case 0xaa:
      case 0xab:
        return this.#string(op, repeat, ip, next);
      case 0xac:
      case 0xad:
        return repeat ? null : this.#string(op, false, ip, next);
      case 0xa8:
      case 0xa9: {
        const wide = op === 0xa9,
          size = wide ? 4 : 1,
          immediate = wide ? cursor.u32() : cursor.u8();
        return () => {
          self.#alu(8, self.#get(accumulator, 0, size), immediate, wide);
          self.#commit();
          return next;
        };
      }
      case 0xc0:
      case 0xc1:
      case 0xd0:
      case 0xd1:
      case 0xd2:
      case 0xd3: {
        const wide = (op & 1) === 1,
          decoded = this.#modrm(cursor, wide);
        if (decoded === null) return null;
        const rm = decoded.rm,
          operation = shiftNames[decoded.parsed.reg] ?? "shl",
          size = wide ? 4 : 1,
          bits = wide ? 32 : 8;
        const fixed = op < 0xd0 ? cursor.u8() : op < 0xd2 ? 1 : -1;
        return () => {
          const count = fixed >= 0 ? fixed : (w[ECX] ?? 0) & 255;
          const address = rm.ea === null ? 0 : rm.ea();
          const value = self.#get(rm, address, size);
          if (rm.ea !== null) self.#probeWrite(address, size, rm.seg);
          self.#put(rm, address, size, Number(shift(operation, bits, BigInt(value), count, flags)));
          return next;
        };
      }
      case 0xc2:
      case 0xc3: {
        const adjustment = op === 0xc2 ? cursor.u16() : 0;
        return () => {
          const target = self.#pop();
          w[ESP] = ((w[ESP] ?? 0) + adjustment) >>> 0;
          return target;
        };
      }
      case 0xc6:
      case 0xc7: {
        const wide = op === 0xc7,
          decoded = this.#modrm(cursor, wide);
        if (decoded === null || decoded.parsed.reg !== 0) return null;
        const rm = decoded.rm,
          size = wide ? 4 : 1,
          value = wide ? cursor.u32() : cursor.u8();
        return () => {
          const address = rm.ea === null ? 0 : rm.ea();
          self.#put(rm, address, size, value);
          return next;
        };
      }
      case 0xc9:
        return () => {
          const frame = w[EBP] ?? 0,
            value = self.#load(frame, 4, 1);
          w[ESP] = (frame + 4) >>> 0;
          w[EBP] = value;
          return next;
        };
      case 0xe8: {
        const target = (next + cursor.u32()) >>> 0;
        return () => {
          self.#push(next);
          return target;
        };
      }
      case 0xe9: {
        const target = (next + cursor.u32()) >>> 0;
        return () => target;
      }
      case 0xeb: {
        const target = (next + cursor.s8()) >>> 0;
        return () => target;
      }
      case 0xf5:
        return () => {
          flags.writeLowWord(flags.lowWord ^ 1);
          return next;
        };
      case 0xf6:
      case 0xf7: {
        const wide = op === 0xf7,
          decoded = this.#modrm(cursor, wide);
        if (decoded === null) return null;
        const rm = decoded.rm,
          group = decoded.parsed.reg,
          size = wide ? 4 : 1;
        if (group === 0 || group === 1) {
          const immediate = wide ? cursor.u32() : cursor.u8();
          return () => {
            const address = rm.ea === null ? 0 : rm.ea();
            self.#alu(8, self.#get(rm, address, size), immediate, wide);
            self.#commit();
            return next;
          };
        }
        if (group === 2) {
          return () => {
            const address = rm.ea === null ? 0 : rm.ea(),
              value = self.#get(rm, address, size);
            self.#put(rm, address, size, wide ? ~value >>> 0 : ~value & 255);
            return next;
          };
        }
        if (group === 3) {
          return () => {
            const address = rm.ea === null ? 0 : rm.ea();
            const result = self.#alu(5, 0, self.#get(rm, address, size), wide);
            self.#put(rm, address, size, result);
            self.#commit();
            return next;
          };
        }
        return null;
      }
      case 0xf8:
        return () => {
          flags.writeLowWord(flags.lowWord & ~1);
          return next;
        };
      case 0xf9:
        return () => {
          flags.writeLowWord(flags.lowWord | 1);
          return next;
        };
      case 0xfc:
        return () => {
          flags.writeLowWord(flags.lowWord & ~0x400);
          return next;
        };
      case 0xfd:
        return () => {
          flags.writeLowWord(flags.lowWord | 0x400);
          return next;
        };
      case 0xff: {
        const decoded = this.#modrm(cursor, true);
        if (decoded === null) return null;
        const rm = decoded.rm,
          group = decoded.parsed.reg;
        if (group === 0 || group === 1) {
          return () => {
            const address = rm.ea === null ? 0 : rm.ea(),
              carry = flags.lowWord & 1;
            const result = self.#alu(group === 1 ? 5 : 0, self.#get(rm, address, 4), 1, true);
            self.#put(rm, address, 4, result);
            self.#next = (self.#next & ~1) | carry;
            self.#commit();
            return next;
          };
        }
        if (group === 2)
          return () => {
            const address = rm.ea === null ? 0 : rm.ea(),
              target = self.#get(rm, address, 4);
            self.#push(next);
            return target;
          };
        if (group === 4) return () => self.#get(rm, rm.ea === null ? 0 : rm.ea(), 4);
        if (group === 6)
          return () => {
            const address = rm.ea === null ? 0 : rm.ea();
            self.#push(self.#get(rm, address, 4));
            return next;
          };
        return null;
      }
      default:
        return null;
    }
  }

  #extended(cursor: Cursor, op: number, next: number): I386Step | null {
    const w = this.words,
      self = this,
      flags = this.flags;
    if (op >= 0x80 && op <= 0x8f) {
      const target = (next + cursor.u32()) >>> 0,
        code = op & 15;
      return () => (self.#condition(code) ? target : next);
    }
    if (op >= 0x90 && op <= 0x9f) {
      const decoded = this.#modrm(cursor, false);
      if (decoded === null) return null;
      const rm = decoded.rm,
        code = op & 15;
      return () => {
        const address = rm.ea === null ? 0 : rm.ea();
        self.#put(rm, address, 1, self.#condition(code) ? 1 : 0);
        return next;
      };
    }
    if (op >= 0x40 && op <= 0x4f) {
      const decoded = this.#modrm(cursor, true);
      if (decoded === null) return null;
      const rm = decoded.rm,
        code = op & 15,
        register = decoded.parsed.reg * 2;
      return () => {
        const address = rm.ea === null ? 0 : rm.ea(),
          value = self.#get(rm, address, 4);
        if (self.#condition(code)) w[register] = value;
        return next;
      };
    }
    switch (op) {
      case 0xb6:
      case 0xb7:
      case 0xbe:
      case 0xbf: {
        const sourceSize = (op & 1) === 0 ? 1 : 2,
          decoded = this.#modrm(cursor, sourceSize === 2);
        if (decoded === null) return null;
        const rm = decoded.rm,
          register = decoded.parsed.reg * 2,
          signed = op >= 0xbe;
        return () => {
          const address = rm.ea === null ? 0 : rm.ea(),
            value = self.#get(rm, address, sourceSize);
          w[register] = signed ? (sourceSize === 1 ? (value << 24) >> 24 : (value << 16) >> 16) >>> 0 : value;
          return next;
        };
      }
      case 0xaf: {
        const decoded = this.#modrm(cursor, true);
        if (decoded === null) return null;
        const rm = decoded.rm,
          register = decoded.parsed.reg * 2;
        return () => {
          const address = rm.ea === null ? 0 : rm.ea(),
            right = self.#get(rm, address, 4);
          w[register] = Number(signedMultiply(32, BigInt(w[register] ?? 0), BigInt(right), flags));
          return next;
        };
      }
      default:
        return null;
    }
  }

  /** One iteration per step, exactly as the generic interpreter: each REP iteration is one instruction and leaves restartable state. */
  #string(op: number, repeat: boolean, ip: number, next: number): I386Step {
    const w = this.words,
      self = this,
      flags = this.flags,
      wide = (op & 1) === 1,
      size = wide ? 4 : 1,
      category = op & 0xfe;
    return () => {
      let count = 0;
      if (repeat) {
        count = w[ECX] ?? 0;
        if (count === 0) return next;
      }
      const step = (flags.lowWord & 0x400) !== 0 ? -size : size;
      if (category === 0xa4) {
        const source = w[ESI] ?? 0,
          destination = w[EDI] ?? 0;
        self.#store(destination, size, 2, self.#load(source, size, 0));
        w[ESI] = (source + step) >>> 0;
        w[EDI] = (destination + step) >>> 0;
      } else if (category === 0xaa) {
        const destination = w[EDI] ?? 0,
          value = w[EAX] ?? 0;
        self.#store(destination, size, 2, wide ? value : value & 255);
        w[EDI] = (destination + step) >>> 0;
      } else {
        const source = w[ESI] ?? 0,
          value = self.#load(source, size, 0);
        w[EAX] = wide ? value : ((w[EAX] ?? 0) & ~255) | value;
        w[ESI] = (source + step) >>> 0;
      }
      if (!repeat) return next;
      w[ECX] = (count - 1) >>> 0;
      return count !== 1 ? ip : next;
    };
  }

  #floating(cursor: Cursor, op: number, ip: number, next: number): I386Step | null {
    const start = cursor.position,
      parsed = this.#parse(cursor.bytes, start);
    if (parsed === null) return null;
    cursor.position = parsed.end;
    const self = this,
      state = this.state,
      memory = this.memory,
      registers = this.registers,
      flags = this.flags,
      ea = parsed.ea;
    const template: Omit<NumericInstruction, "operand"> = {
      opcode: op,
      secondaryOpcode: null,
      modrm: cursor.at(start),
      registerIndex: parsed.reg,
      prefix: "none",
      operandBits: 32,
      immediate: null,
    };
    const register: NumericOperand = { kind: "register", index: parsed.rm };
    const saved = new Uint8Array(64);
    return () => {
      const operand: NumericOperand = ea === null ? register : { kind: "memory", address: guestAddress(memory, BigInt(ea()), "read", 1) };
      const instruction: NumericInstruction = { ...template, operand };
      registers.checkpoint(saved);
      const low = flags.lowWord,
        high = flags.highWord;
      state.instructionPointer = BigInt(ip);
      try {
        const result = self.numeric({ state, memory, instruction });
        if (result.kind === "unsupported") throw new UnsupportedX86Instruction(result.detail);
        if (result.kind === "exception") throw new X86ProcessorFault(result.vector, result.detail);
      } catch (error) {
        registers.restore(saved);
        flags.restoreWords(low, high);
        throw error;
      }
      return next;
    };
  }
}

const accumulator: Rm = { ea: null, seg: 0, idx: EAX, sh: 0 };

class Cursor {
  position = 0;
  constructor(readonly bytes: readonly number[]) {}
  at(offset: number): number {
    return this.bytes[offset] ?? 0;
  }
  u8(): number {
    return this.at(this.position++);
  }
  s8(): number {
    return (this.at(this.position++) << 24) >> 24;
  }
  u16(): number {
    const value = this.at(this.position) | (this.at(this.position + 1) << 8);
    this.position += 2;
    return value;
  }
  u32(): number {
    const value = (this.at(this.position) | (this.at(this.position + 1) << 8) | (this.at(this.position + 2) << 16) | (this.at(this.position + 3) << 24)) >>> 0;
    this.position += 4;
    return value;
  }
}
