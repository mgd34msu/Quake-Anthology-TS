// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestIntegerWidth, GuestProcessorState, GuestRegister, MappedGuestMemory } from '../core/contracts.ts';
import { SparseGuestMemory } from '../core/memory.ts';
import { IntegerRegisterFile, ProcessorFlags } from '../core/registers.ts';
import type { AluOperation } from '../x86/arithmetic.ts';
import { canonicalAddress, readOperand, writableOperand, writeOperand } from './decoder.ts';
import type { X64MemoryOperand, X64Operand } from './decoder.ts';
import { x64Advance, x64Lock } from './plan.ts';
import type { X64Flow, X64SemanticPlan } from './plan.ts';

const registerMembers = Object.getOwnPropertyNames(IntegerRegisterFile.prototype);
const flagMembers = Object.getOwnPropertyNames(ProcessorFlags.prototype);
const memoryMembers = Object.getOwnPropertyNames(SparseGuestMemory.prototype);
function originalInstance(value: object, prototype: object, members: readonly string[]): boolean {
  const actual: unknown = Object.getPrototypeOf(value);
  return actual === prototype && members.every(member => !Object.hasOwn(value, member));
}

const offsets: Readonly<Record<GuestRegister, number>> = {
  rax: 0, rcx: 8, rdx: 16, rbx: 24, rsp: 32, rbp: 40, rsi: 48, rdi: 56,
  r8: 64, r9: 72, r10: 80, r11: 88, r12: 96, r13: 104, r14: 112, r15: 120,
};
interface RegisterOperand { readonly kind: 'register'; readonly offset: number; readonly width: GuestIntegerWidth; readonly highByte: boolean; }
interface MemoryOperand { readonly kind: 'memory'; readonly source: X64MemoryOperand; readonly width: GuestIntegerWidth; }
type Operand = RegisterOperand | MemoryOperand;
interface Immediate { readonly kind: 'immediate'; readonly low: number; readonly high: number; }
type Source = Operand | Immediate;
interface EffectiveAddress {
  readonly base: number | null;
  readonly index: number | null;
  readonly shift: 0 | 1 | 2 | 3;
  readonly low: number;
  readonly high: number;
  readonly addressBits: 32 | 64;
}
type Operation =
  | { readonly kind: 'move'; readonly destination: Operand; readonly source: Source }
  | { readonly kind: 'lea'; readonly destination: RegisterOperand; readonly source: EffectiveAddress }
  | { readonly kind: 'alu'; readonly operation: AluOperation; readonly destination: Operand; readonly source: Source }
  | { readonly kind: 'branch'; readonly condition: number | null; readonly target: bigint };
export interface X64IntegerPlan { readonly operation: Operation; readonly original: X64SemanticPlan; }

function operand(value: X64Operand): Operand {
  return value.kind === 'register'
    ? { kind: 'register', offset: offsets[value.register], width: value.width, highByte: value.highByte }
    : { kind: 'memory', source: value, width: value.width };
}
function source(value: X64Operand | bigint): Source {
  if (typeof value !== 'bigint') return operand(value);
  const word = BigInt.asUintN(64, value);
  return { kind: 'immediate', low: Number(word & 0xffffffffn), high: Number(word >> 32n) };
}

/** Preparation only reduces static instruction fields; no guest data or source functions execute here. */
export function prepareX64IntegerPlan(plan: X64SemanticPlan): X64IntegerPlan | null {
  const op = plan.operation;
  switch (op.kind) {
    case 'move': return { original: plan, operation: { kind: 'move', destination: operand(op.destination), source: source(op.source) } };
    case 'alu': return { original: plan, operation: { kind: 'alu', operation: op.operation, destination: operand(op.destination), source: source(op.source) } };
    case 'branch': return { original: plan, operation: { kind: 'branch', condition: op.condition, target: plan.nextIP + op.displacement } };
    case 'lea': {
      const destination = operand(op.destination);
      if (destination.kind !== 'register') return null;
      const value = op.source, shift = value.scale === 1n ? 0 : value.scale === 2n ? 1 : value.scale === 4n ? 2 : value.scale === 8n ? 3 : null;
      if (shift === null) return null;
      const displacement = BigInt.asUintN(64, value.displacement + (value.ripRelative ? plan.nextIP : 0n));
      return { original: plan, operation: { kind: 'lea', destination, source: {
        base: value.ripRelative || value.base === null ? null : offsets[value.base],
        index: value.index === null ? null : offsets[value.index], shift,
        low: Number(displacement & 0xffffffffn), high: Number(displacement >> 32n), addressBits: value.addressBits,
      } } };
    }
    default: return null;
  }
}

/** One instance belongs to one run invocation; a committed store may re-enter the same CPU. */
export class X64IntegerKernel {
  #low = 0;
  #high = 0;
  private constructor(readonly flags: ProcessorFlags, private readonly words: DataView,
    private readonly state: GuestProcessorState, private readonly memory: SparseGuestMemory) {}

  static create(state: GuestProcessorState, memory: MappedGuestMemory): X64IntegerKernel | null {
    if (state.architecture !== 'x86-64' || !(state.registers instanceof IntegerRegisterFile) || state.registers.architecture !== 'x86-64'
      || !originalInstance(state.registers, IntegerRegisterFile.prototype, registerMembers)
      || !(state.flags instanceof ProcessorFlags) || !originalInstance(state.flags, ProcessorFlags.prototype, flagMembers)
      || !(memory instanceof SparseGuestMemory) || !originalInstance(memory, SparseGuestMemory.prototype, memoryMembers)) return null;
    return new X64IntegerKernel(state.flags, state.registers.integerView, state, memory);
  }

  execute(plan: X64IntegerPlan): X64Flow {
    const op = plan.operation, original = plan.original;
    switch (op.kind) {
      case 'move':
        x64Lock(original.lock, null, false);
        this.#read(op.source, original.nextIP);
        this.#write(op.destination, original.nextIP);
        return x64Advance;
      case 'lea':
        x64Lock(original.lock, null, false);
        this.#address(op.source);
        this.#write(op.destination, original.nextIP);
        return x64Advance;
      case 'alu': {
        // Source reads precede LOCK/write admission in the original semantic handler.
        this.#read(op.source, original.nextIP);
        const rightLow = this.#low, rightHigh = this.#high;
        const writes = op.operation !== 'cmp' && op.operation !== 'test';
        x64Lock(original.lock, op.destination.kind === 'memory' ? op.destination.source : null, writes);
        if (writes && op.destination.kind === 'memory') writableOperand(this.memory, this.state, op.destination.source, original.nextIP);
        this.#read(op.destination, original.nextIP);
        this.#alu(op.operation, op.destination.width, rightLow, rightHigh);
        if (writes) this.#write(op.destination, original.nextIP);
        return x64Advance;
      }
      case 'branch':
        x64Lock(original.lock, null, false);
        return op.condition === null || this.#condition(op.condition)
          ? { kind: 'branch', target: canonicalAddress(op.target) } : x64Advance;
    }
  }

  #read(value: Source, nextIP: bigint): void {
    if (value.kind === 'immediate') { this.#low = value.low; this.#high = value.high; return; }
    if (value.kind === 'memory') {
      const bits = readOperand(this.memory, this.state, value.source, nextIP);
      this.#low = Number(bits & 0xffffffffn); this.#high = Number(bits >> 32n);
      return;
    }
    const low = this.words.getUint32(value.offset, true);
    this.#low = value.width === 8 ? (low >>> (value.highByte ? 8 : 0)) & 255 : value.width === 16 ? low & 65535 : low;
    this.#high = value.width === 64 ? this.words.getUint32(value.offset + 4, true) : 0;
  }

  #write(destination: Operand, nextIP: bigint): void {
    if (destination.kind === 'memory') {
      const value = destination.width === 64 ? (BigInt(this.#high) << 32n) | BigInt(this.#low) : BigInt(this.#low);
      writeOperand(this.memory, this.state, destination.source, nextIP, value);
      return;
    }
    const offset = destination.offset;
    if (destination.width === 8) this.words.setUint8(offset + (destination.highByte ? 1 : 0), this.#low);
    else if (destination.width === 16) this.words.setUint16(offset, this.#low, true);
    else { this.words.setUint32(offset, this.#low, true); this.words.setUint32(offset + 4, destination.width === 64 ? this.#high : 0, true); }
  }

  #address(value: EffectiveAddress): void {
    const a = value.base === null ? 0 : this.words.getUint32(value.base, true);
    const ah = value.base === null || value.addressBits === 32 ? 0 : this.words.getUint32(value.base + 4, true);
    const b = value.index === null ? 0 : this.words.getUint32(value.index, true);
    const bh = value.index === null || value.addressBits === 32 ? 0 : this.words.getUint32(value.index + 4, true);
    const lowIndex = value.shift === 0 ? b : (b << value.shift) >>> 0;
    const highIndex = value.shift === 0 ? bh : ((bh << value.shift) | (b >>> (32 - value.shift))) >>> 0;
    const low = a + lowIndex + value.low;
    this.#low = low >>> 0;
    this.#high = value.addressBits === 32 ? 0 : (ah + highIndex + value.high + Math.floor(low / 0x100000000)) >>> 0;
  }

  #alu(operation: AluOperation, width: GuestIntegerWidth, rightLow: number, rightHigh: number): void {
    const limit = width === 8 ? 256 : width === 16 ? 65536 : 0x100000000;
    const a = this.#low, b = width === 8 ? rightLow & 255 : width === 16 ? rightLow & 65535 : rightLow;
    const ah = this.#high, bh = rightHigh;
    const sign = width === 8 ? 0x80 : width === 16 ? 0x8000 : 0x80000000;
    let low: number, high = 0, bits = 0, mask = 0x8d5;
    switch (operation) {
      case 'add': case 'adc': {
        const incoming = operation === 'adc' ? this.flags.lowWord & 1 : 0;
        const sum = a + b + incoming;
        low = width === 64 || width === 32 ? sum >>> 0 : sum & (limit - 1);
        if (width === 64) {
          const upper = ah + bh + (sum >= limit ? 1 : 0); high = upper >>> 0;
          if (upper >= limit) bits |= 1;
          if ((~(ah ^ bh) & (ah ^ high) & sign) !== 0) bits |= 0x800;
        } else {
          if (sum >= limit) bits |= 1;
          if ((~(a ^ b) & (a ^ low) & sign) !== 0) bits |= 0x800;
        }
        if ((a & 15) + (b & 15) + incoming > 15) bits |= 0x10;
        break;
      }
      case 'sub': case 'cmp': case 'sbb': {
        const incoming = operation === 'sbb' ? this.flags.lowWord & 1 : 0;
        const difference = a - b - incoming;
        low = width === 64 || width === 32 ? difference >>> 0 : difference & (limit - 1);
        if (width === 64) {
          const upper = ah - bh - (difference < 0 ? 1 : 0); high = upper >>> 0;
          if (upper < 0) bits |= 1;
          if (((ah ^ bh) & (ah ^ high) & sign) !== 0) bits |= 0x800;
        } else {
          if (difference < 0) bits |= 1;
          if (((a ^ b) & (a ^ low) & sign) !== 0) bits |= 0x800;
        }
        if ((a & 15) < (b & 15) + incoming) bits |= 0x10;
        break;
      }
      case 'and': case 'test': low = (a & b) >>> 0; high = (ah & bh) >>> 0; mask = 0x8c5; break;
      case 'or': low = (a | b) >>> 0; high = (ah | bh) >>> 0; mask = 0x8c5; break;
      case 'xor': low = (a ^ b) >>> 0; high = (ah ^ bh) >>> 0; mask = 0x8c5; break;
    }
    if (width !== 64) high = 0;
    let byte = low & 255; byte ^= byte >>> 4;
    bits |= (low === 0 && high === 0 ? 0x40 : 0) | (((width === 64 ? high : low) & sign) !== 0 ? 0x80 : 0) | (((0x9669 >>> (byte & 15)) & 1) << 2);
    this.flags.writeLowWord((this.flags.lowWord & ~mask) | bits);
    this.#low = low; this.#high = high;
  }

  #condition(code: number): boolean {
    const bits = this.flags.lowWord, carry = (bits & 1) !== 0, zero = (bits & 0x40) !== 0;
    const sign = (bits & 0x80) !== 0, overflow = (bits & 0x800) !== 0;
    switch (code) {
      case 0: return overflow; case 1: return !overflow;
      case 2: return carry; case 3: return !carry;
      case 4: return zero; case 5: return !zero;
      case 6: return carry || zero; case 7: return !carry && !zero;
      case 8: return sign; case 9: return !sign;
      case 10: return (bits & 4) !== 0; case 11: return (bits & 4) === 0;
      case 12: return sign !== overflow; case 13: return sign === overflow;
      case 14: return zero || sign !== overflow; case 15: return !zero && sign === overflow;
      default: throw new RangeError(`Invalid condition code ${code}`);
    }
  }
}
